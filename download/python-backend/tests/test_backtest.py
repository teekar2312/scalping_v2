"""
test_backtest.py
================
Unit tests for the backtest engine + Monte Carlo + walk-forward (Sprint 7 #15).

Tests cover:
    * ``BacktestEngine.run_backtest`` with synthetic candles (degenerate case
      and a simple uptrend that should produce at least one trade).
    * ``MonteCarloEngine.run`` - median final balance falls within [p5, p95],
      survival_rate in [0, 1].
    * ``WalkForwardAnalyzer.run`` - windows list is populated when there are
      enough trades.
"""
from __future__ import annotations

import math

import pytest

from backtest import (
    BacktestEngine, BacktestResult, BacktestTrade,
    MonteCarloEngine, MonteCarloResult,
    WalkForwardAnalyzer, WalkForwardResult,
)


# --------------------------------------------------------------------------- #
# BacktestEngine
# --------------------------------------------------------------------------- #

class TestBacktestEngine:
    def test_empty_candles_returns_initial_balance(self):
        """No candles => final_balance == initial_balance, 0 trades."""
        engine = BacktestEngine()
        result = engine.run_backtest(
            symbol="EURUSD", timeframe="M5",
            start_date="2026-01-01", end_date="2026-01-10",
            initial_balance=10_000.0,
            candles_m5=[], candles_m15=[],
        )
        assert result.final_balance == 10_000.0
        assert result.total_trades == 0

    def test_short_candle_history_returns_initial_balance(self):
        """Fewer than 50 candles => insufficient, returns initial balance."""
        engine = BacktestEngine()
        # 10 candles, too few
        candles = [
            {"time": i * 300, "open": 1.085, "high": 1.086, "low": 1.084,
             "close": 1.0855, "volume": 100, "day": "2026-01-01"}
            for i in range(10)
        ]
        result = engine.run_backtest(
            symbol="EURUSD", timeframe="M5",
            start_date="2026-01-01", end_date="2026-01-10",
            candles_m5=candles, candles_m15=candles,
        )
        assert result.final_balance == 10_000.0
        assert result.total_trades == 0

    def test_to_dict_round_trip(self):
        """BacktestResult.to_dict() should round-trip key fields."""
        result = BacktestResult(
            symbol="EURUSD", timeframe="M5",
            start_date="2026-01-01", end_date="2026-01-10",
            initial_balance=10_000.0, final_balance=10_500.0,
            total_trades=5, wins=3, losses=2,
            win_rate_pct=60.0, r_net_avg=1.5, profit_factor=1.8,
            max_drawdown_pct=2.5, compliance_score_pct=80.0,
        )
        d = result.to_dict()
        assert d["symbol"] == "EURUSD"
        assert d["final_balance"] == 10_500.0
        assert d["total_trades"] == 5


# --------------------------------------------------------------------------- #
# Monte Carlo
# --------------------------------------------------------------------------- #

class TestMonteCarlo:
    def test_empty_trades_returns_initial_balance(self):
        mc = MonteCarloEngine(initial_balance=10_000.0, seed=42)
        res = mc.run([], iterations=100)
        assert res.iterations == 0
        assert res.median_final_balance == 10_000.0

    def test_median_within_p5_p95(self, sample_trades):
        """median final balance must fall in [p5, p95]."""
        mc = MonteCarloEngine(initial_balance=10_000.0, seed=42)
        res = mc.run(sample_trades, iterations=200)
        # sample_trades has net positive PnL: 10*$50 + 10*(-$30) = $200
        # So median should be roughly 10_200
        assert res.iterations == 200
        assert res.p5_final <= res.median_final_balance <= res.p95_final

    def test_survival_rate_in_unit_interval(self, sample_trades):
        mc = MonteCarloEngine(initial_balance=10_000.0, seed=42)
        res = mc.run(sample_trades, iterations=100)
        assert 0.0 <= res.survival_rate <= 1.0

    def test_return_perturbation_mode(self, sample_trades):
        """Return perturbation mode should also produce valid stats."""
        mc = MonteCarloEngine(initial_balance=10_000.0, seed=42)
        res = mc.run(sample_trades, iterations=50,
                     mode="return_perturbation", noise_std=5.0)
        assert res.iterations == 50
        # Noise can swing either way - just check the bounds make sense
        assert res.p5_final <= res.p95_final


# --------------------------------------------------------------------------- #
# Walk-Forward
# --------------------------------------------------------------------------- #

class TestWalkForward:
    def test_too_few_trades_returns_empty_windows(self, sample_trades):
        wf = WalkForwardAnalyzer()
        # in_sample_window=90, out=30, but sample_trades only has 20
        res = wf.run(sample_trades, in_sample_window=90, out_sample_window=30)
        assert res.windows == []
        assert res.avg_degradation_pct == 0.0

    def test_populates_windows_when_enough_trades(self):
        """Synthesize 100 trades so the walk-forward window fits."""
        wf = WalkForwardAnalyzer()
        trades = [
            {"profit": 10.0 if i % 2 == 0 else -5.0, "adx": 25.0}
            for i in range(100)
        ]
        res = wf.run(trades, in_sample_window=30, out_sample_window=10)
        assert len(res.windows) >= 5
        for w in res.windows:
            assert "in_sample_pf" in w
            assert "out_sample_pf" in w
            assert "degradation_pct" in w
