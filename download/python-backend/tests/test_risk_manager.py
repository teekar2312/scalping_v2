"""
test_risk_manager.py
====================
Unit tests for the V2 risk manager.

Tests cover:
    * ``TieredStop`` (soft/hard/weekly/overall)
    * ``PositionSizer`` (1% risk sizing + Sprint 7 #16 Kelly mode)
    * ``KellySizer`` (full Kelly, quarter-Kelly cap, history-derived)
    * Streak tracking (2 losses -> 30min cooldown, 3+ -> end of WIB day)
    * Correlation check (blocks >2 net same-side positions per currency)
"""
from __future__ import annotations

import pytest

from risk_manager import (
    TieredStop, TieredStopResult, PositionSizer, KellySizer, KellyResult,
    check_correlation, enforce_max_positions, enforce_max_daily_trades,
    DailyRiskTracker,
)


# --------------------------------------------------------------------------- #
# TieredStop
# --------------------------------------------------------------------------- #

class TestTieredStop:
    def setup_method(self) -> None:
        self.stop = TieredStop()

    def test_no_trigger_when_balance_above_starting(self):
        """+5% should not trigger any stop."""
        res = self.stop.evaluate(
            current_balance=10_500,
            daily_start=10_000, weekly_start=10_000, overall_start=10_000,
        )
        assert res.triggered is False
        assert res.level == "none"

    def test_soft_stop_at_minus_1_pct(self):
        """-1% should trigger soft stop."""
        res = self.stop.check_soft(current_balance=9_900,
                                   starting_balance=10_000)
        assert res.triggered is True
        assert res.level == "soft"

    def test_hard_stop_at_minus_2_pct(self):
        """-2% should trigger hard stop."""
        res = self.stop.check_hard(current_balance=9_800,
                                   starting_balance=10_000)
        assert res.triggered is True
        assert res.level == "hard"

    def test_weekly_stop_at_minus_4_pct(self):
        res = self.stop.check_weekly(current_balance=9_600,
                                     weekly_starting=10_000)
        assert res.triggered is True
        assert res.level == "weekly"

    def test_overall_stop_at_minus_10_pct(self):
        res = self.stop.check_overall(current_balance=9_000,
                                      overall_starting=10_000)
        assert res.triggered is True
        assert res.level == "overall"

    def test_most_severe_wins(self):
        """If both soft + hard are triggered, evaluate returns the most severe."""
        res = self.stop.evaluate(
            current_balance=9_500,  # -5%
            daily_start=10_000, weekly_start=10_000, overall_start=10_000,
        )
        # weekly (-4%) should be returned (overall -10% not triggered)
        assert res.level == "weekly"

    def test_zero_starting_balance_returns_none(self):
        """Edge case: starting_balance=0 -> no division-by-zero."""
        res = self.stop.check_soft(0.0, 0.0)
        assert res.triggered is False
        assert res.level == "none"


# --------------------------------------------------------------------------- #
# PositionSizer
# --------------------------------------------------------------------------- #

class TestPositionSizer:
    def test_1pct_risk_lot(self):
        """1% of $10k balance with 10-pip SL and $10/pip/lot => 1.0 lot."""
        sizer = PositionSizer(risk_pct=0.01)
        lot = sizer.calculate(balance=10_000, sl_pips=10,
                              pip_value_per_lot=10.0)
        # raw = (10000*0.01) / (10 * 10) = 100 / 100 = 1.0
        assert lot == pytest.approx(1.0, abs=0.01)

    def test_min_volume_when_sl_zero(self):
        sizer = PositionSizer(risk_pct=0.01)
        lot = sizer.calculate(balance=10_000, sl_pips=0,
                              pip_value_per_lot=10.0)
        assert lot == 0.01  # volume_min

    def test_max_volume_capped(self):
        sizer = PositionSizer(risk_pct=0.5)
        lot = sizer.calculate(balance=1_000_000, sl_pips=10,
                              pip_value_per_lot=10.0,
                              volume_max=100.0)
        assert lot == 100.0

    def test_volume_step_snap(self):
        """Result must be a multiple of volume_step."""
        sizer = PositionSizer(risk_pct=0.01)
        lot = sizer.calculate(balance=10_000, sl_pips=7,
                              pip_value_per_lot=10.0,
                              volume_step=0.01)
        # 100 / 70 ≈ 1.428 -> floored to 1.42
        assert lot == pytest.approx(1.42, abs=0.01)

    def test_kelly_mode_uses_quarter_kelly(self):
        """In kelly mode with f_actual=0.005, risk_pct should be 0.005."""
        sizer = PositionSizer(mode="kelly")
        lot = sizer.calculate(balance=10_000, sl_pips=10,
                              pip_value_per_lot=10.0,
                              kelly_stats={"f_actual": 0.005})
        # raw = 10000 * 0.005 / (10*10) = 50/100 = 0.5
        assert lot == pytest.approx(0.5, abs=0.01)

    def test_default_mode_reads_env(self, monkeypatch):
        """POSITION_SIZING_MODE env var selects default mode."""
        monkeypatch.setenv("POSITION_SIZING_MODE", "kelly")
        sizer = PositionSizer()
        assert sizer.mode == "kelly"

    def test_invalid_mode_falls_back_to_fixed(self, monkeypatch):
        monkeypatch.setenv("POSITION_SIZING_MODE", "garbage")
        sizer = PositionSizer()
        assert sizer.mode == "fixed"


# --------------------------------------------------------------------------- #
# KellySizer (Sprint 7 #16)
# --------------------------------------------------------------------------- #

class TestKellySizer:
    def test_kelly_balanced_strategy(self):
        """Win rate 50%, avg_win=2x avg_loss => f_kelly=0.25."""
        sizer = KellySizer()
        res = sizer.calculate(balance=10_000, win_rate=0.5,
                              avg_win=20.0, avg_loss=10.0,
                              sl_pips=10, pip_value_per_lot=10.0)
        # f = 0.5 - 0.5 / 2 = 0.25
        assert res.f_kelly == pytest.approx(0.25, abs=0.001)
        # quarter-Kelly
        assert res.f_actual == pytest.approx(0.0625, abs=0.001)
        # risk_pct capped at 2% -> 6.25% exceeds, so capped
        assert res.risk_pct == 0.02

    def test_kelly_zero_when_avg_loss_zero(self):
        """avg_loss=0 => degenerate, f_kelly=0."""
        sizer = KellySizer()
        res = sizer.calculate(balance=10_000, win_rate=0.6,
                              avg_win=20.0, avg_loss=0.0)
        assert res.f_kelly == 0.0
        assert res.f_actual == 0.0

    def test_kelly_zero_when_win_rate_zero(self):
        sizer = KellySizer()
        res = sizer.calculate(balance=10_000, win_rate=0.0,
                              avg_win=20.0, avg_loss=10.0)
        assert res.f_kelly == 0.0

    def test_kelly_from_history(self, sample_trades):
        sizer = KellySizer()
        res = sizer.calculate_from_history(sample_trades, balance=10_000)
        assert isinstance(res, KellyResult)
        # sample_trades has alternating wins/losses (10 wins @ $50, 10 losses @ $30)
        # win_rate = 0.5, avg_win = 50, avg_loss = 30
        # f = 0.5 - 0.5/(50/30) = 0.5 - 0.3 = 0.2
        assert res.f_kelly == pytest.approx(0.2, abs=0.001)

    def test_kelly_from_empty_history(self):
        sizer = KellySizer()
        res = sizer.calculate_from_history([], balance=10_000)
        assert res.f_kelly == 0.0


# --------------------------------------------------------------------------- #
# Streak tracking
# --------------------------------------------------------------------------- #

class TestStreak:
    def test_2_losses_engages_30min_cooldown(self, isolated_db):
        """2 consecutive losses should set cooldown_until ~= now+30min."""
        tracker = DailyRiskTracker()
        # Need to seed daily row first
        state = tracker.get_state(balance=10_000)
        # Record 2 losses
        tracker.record_trade(pnl=-50.0, win=False)
        state = tracker.record_trade(pnl=-50.0, win=False)
        assert state.consecutive_loss_count == 2
        assert state.cooldown_until is not None

    def test_win_resets_loss_streak(self, isolated_db):
        tracker = DailyRiskTracker()
        tracker.record_trade(pnl=-50.0, win=False)
        tracker.record_trade(pnl=-50.0, win=False)
        state = tracker.record_trade(pnl=+50.0, win=True)
        assert state.consecutive_loss_count == 0
        assert state.consecutive_win_count == 1


# --------------------------------------------------------------------------- #
# Correlation check
# --------------------------------------------------------------------------- #

class TestCorrelation:
    def test_first_trade_allowed(self):
        """No open positions => always allowed."""
        res = check_correlation(new_symbol="EURUSD",
                                direction="buy",
                                open_positions=[])
        assert res["allowed"] is True

    def test_blocks_too_many_same_side(self):
        """3 long EUR positions should block a 3rd."""
        positions = [
            {"symbol": "EURUSD", "type": "buy"},
            {"symbol": "EURUSD", "type": "buy"},
        ]
        res = check_correlation(new_symbol="EURUSD",
                                direction="buy",
                                open_positions=positions)
        assert res["allowed"] is False
        assert "Correlation block" in res["reason"]

    def test_allows_offsetting_trade(self):
        """A sell on EUR when we have 2 EUR longs should be allowed (offset)."""
        positions = [
            {"symbol": "EURUSD", "type": "buy"},
            {"symbol": "EURUSD", "type": "buy"},
        ]
        res = check_correlation(new_symbol="EURUSD",
                                direction="sell",
                                open_positions=positions)
        assert res["allowed"] is True


# --------------------------------------------------------------------------- #
# Enforcement helpers
# --------------------------------------------------------------------------- #

def test_enforce_max_positions():
    assert enforce_max_positions(2, max_positions=3) is True
    assert enforce_max_positions(3, max_positions=3) is False


def test_enforce_max_daily_trades():
    assert enforce_max_daily_trades(4, max_trades=5) is True
    assert enforce_max_daily_trades(5, max_trades=5) is False
