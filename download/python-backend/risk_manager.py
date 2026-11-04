"""
risk_manager.py
===============
Risk management for the V2 strategy.

Provides:
    * :class:`TieredStop`   - soft/hard/weekly/overall stop checks
    * :class:`DailyRiskTracker` - daily PnL, trade count, win/loss
    * :class:`PositionSizer`    - 1% risk lot sizing
    * :func:`enforce_max_positions`
    * :func:`enforce_max_daily_trades`
    * :func:`check_kill_switch`
    * :func:`lock_bot`

All thresholds come from :mod:`config` so they remain consistent with the
strategy PDF.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

import config as cfg
from config import settings
from database import get_or_create_daily, update_daily, get_bot_state, update_bot_state

logger = logging.getLogger(__name__)

StopLevel = Literal["none", "soft", "hard", "weekly", "overall"]


# --------------------------------------------------------------------------- #
# Tiered stop
# --------------------------------------------------------------------------- #

@dataclass
class TieredStopResult:
    """Outcome of a tiered-stop evaluation."""
    level: StopLevel
    triggered: bool
    pnl_pct: float
    threshold_pct: float
    message: str


class TieredStop:
    """Evaluate the four tiered stops: soft -1%, hard -2%, weekly -4%,
    overall -10% (all relative to starting balance).
    """

    def __init__(self, thresholds: dict[str, float] | None = None) -> None:
        self.thresholds = thresholds or dict(cfg.TIERED_STOPS)

    # ---- daily ---- #

    def check_soft(self, current_balance: float,
                   starting_balance: float) -> TieredStopResult:
        """Soft stop at -1% of the day's starting balance."""
        if starting_balance <= 0:
            return TieredStopResult("none", False, 0.0,
                                    self.thresholds["soft"], "no balance")
        pnl_pct = (current_balance - starting_balance) / starting_balance
        triggered = pnl_pct <= self.thresholds["soft"]
        return TieredStopResult(
            level="soft" if triggered else "none",
            triggered=triggered,
            pnl_pct=round(pnl_pct, 4),
            threshold_pct=self.thresholds["soft"],
            message=("Soft stop hit" if triggered else "ok"),
        )

    def check_hard(self, current_balance: float,
                   starting_balance: float) -> TieredStopResult:
        """Hard stop at -2% of the day's starting balance."""
        if starting_balance <= 0:
            return TieredStopResult("none", False, 0.0,
                                    self.thresholds["hard"], "no balance")
        pnl_pct = (current_balance - starting_balance) / starting_balance
        triggered = pnl_pct <= self.thresholds["hard"]
        return TieredStopResult(
            level="hard" if triggered else "none",
            triggered=triggered,
            pnl_pct=round(pnl_pct, 4),
            threshold_pct=self.thresholds["hard"],
            message=("Hard stop hit - close all + stop" if triggered else "ok"),
        )

    def check_weekly(self, current_balance: float,
                     weekly_starting: float) -> TieredStopResult:
        """Weekly stop at -4% of the week's starting balance."""
        if weekly_starting <= 0:
            return TieredStopResult("none", False, 0.0,
                                    self.thresholds["weekly"], "no balance")
        pnl_pct = (current_balance - weekly_starting) / weekly_starting
        triggered = pnl_pct <= self.thresholds["weekly"]
        return TieredStopResult(
            level="weekly" if triggered else "none",
            triggered=triggered,
            pnl_pct=round(pnl_pct, 4),
            threshold_pct=self.thresholds["weekly"],
            message=("Weekly stop hit - lock bot for the week"
                     if triggered else "ok"),
        )

    def check_overall(self, current_balance: float,
                      overall_starting: float) -> TieredStopResult:
        """Overall stop at -10% of the account's lifetime starting balance."""
        if overall_starting <= 0:
            return TieredStopResult("none", False, 0.0,
                                    self.thresholds["overall"], "no balance")
        pnl_pct = (current_balance - overall_starting) / overall_starting
        triggered = pnl_pct <= self.thresholds["overall"]
        return TieredStopResult(
            level="overall" if triggered else "none",
            triggered=triggered,
            pnl_pct=round(pnl_pct, 4),
            threshold_pct=self.thresholds["overall"],
            message=("OVERALL stop hit - lock bot indefinitely"
                     if triggered else "ok"),
        )

    def evaluate(self, current_balance: float,
                 daily_start: float,
                 weekly_start: float,
                 overall_start: float) -> TieredStopResult:
        """Run all four checks and return the most severe triggered level."""
        results = [
            self.check_overall(current_balance, overall_start),
            self.check_weekly(current_balance, weekly_start),
            self.check_hard(current_balance, daily_start),
            self.check_soft(current_balance, daily_start),
        ]
        for r in results:               # ordered most-severe first
            if r.triggered:
                return r
        return TieredStopResult("none", False, 0.0, 0.0, "ok")


# --------------------------------------------------------------------------- #
# Daily risk tracker
# --------------------------------------------------------------------------- #

@dataclass
class DailyRiskState:
    date: str
    starting_balance: float
    current_balance: float
    realized_pnl: float
    trade_count: int
    win_count: int
    loss_count: int
    soft_stop_hit: bool
    hard_stop_hit: bool


class DailyRiskTracker:
    """Track daily PnL, trade count and win/loss."""

    def __init__(self) -> None:
        self.tiered = TieredStop()

    def get_state(self, balance: float | None = None) -> DailyRiskState:
        """Get today's risk state. If ``balance`` is provided, refreshes
        ``current_balance`` and tiered-stop flags first.
        """
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        raw = get_or_create_daily(date_str, balance or 0.0)
        if balance is not None:
            # Refresh current_balance and stop flags
            soft = self.tiered.check_soft(balance, raw["starting_balance"])
            hard = self.tiered.check_hard(balance, raw["starting_balance"])
            update_daily(
                date_str,
                current_balance=balance,
                soft_stop_hit=soft.triggered,
                hard_stop_hit=hard.triggered,
            )
            raw["current_balance"] = balance
            raw["soft_stop_hit"] = soft.triggered
            raw["hard_stop_hit"] = hard.triggered
        return DailyRiskState(
            date=raw["date"],
            starting_balance=raw["starting_balance"],
            current_balance=raw["current_balance"],
            realized_pnl=raw["realized_pnl"],
            trade_count=raw["trade_count"],
            win_count=raw["win_count"],
            loss_count=raw["loss_count"],
            soft_stop_hit=raw["soft_stop_hit"],
            hard_stop_hit=raw["hard_stop_hit"],
        )

    def record_trade(self, pnl: float, win: bool) -> DailyRiskState:
        """Record a closed trade's PnL and update counts."""
        state = self.get_state()
        new_realized = state.realized_pnl + pnl
        new_count = state.trade_count + 1
        new_wins = state.win_count + (1 if win else 0)
        new_losses = state.loss_count + (0 if win else 1)
        update_daily(
            state.date,
            realized_pnl=new_realized,
            trade_count=new_count,
            win_count=new_wins,
            loss_count=new_losses,
            current_balance=state.starting_balance + new_realized,
        )
        return self.get_state()


# --------------------------------------------------------------------------- #
# Position sizer
# --------------------------------------------------------------------------- #

class PositionSizer:
    """1% risk position sizer using SL distance and pip value."""

    def __init__(self, risk_pct: float = cfg.RISK_PCT_PER_TRADE) -> None:
        self.risk_pct = risk_pct

    def calculate(self, balance: float, sl_pips: float,
                  pip_value_per_lot: float,
                  volume_step: float = 0.01,
                  volume_min: float = 0.01,
                  volume_max: float = 100.0) -> float:
        """Return the lot size that risks ``risk_pct`` of ``balance``."""
        if sl_pips <= 0 or pip_value_per_lot <= 0:
            return volume_min
        raw = (balance * self.risk_pct) / (sl_pips * pip_value_per_lot)
        if volume_step > 0:
            import math as _m
            raw = _m.floor(raw / volume_step) * volume_step
        raw = max(raw, volume_min)
        raw = min(raw, volume_max)
        return round(raw, 2)


# --------------------------------------------------------------------------- #
# Enforcement functions
# --------------------------------------------------------------------------- #

def enforce_max_positions(current_count: int,
                          max_positions: int = cfg.MAX_POSITIONS) -> bool:
    """Return ``True`` if a new position may be opened."""
    return current_count < max_positions


def enforce_max_daily_trades(current_count: int,
                             max_trades: int = cfg.MAX_DAILY_TRADES) -> bool:
    """Return ``True`` if another trade may be opened today."""
    return current_count < max_trades


def check_kill_switch(state: dict | None = None) -> bool:
    """Return ``True`` if the kill switch is currently engaged."""
    state = state or get_bot_state()
    return bool(state.get("kill_switch"))


def lock_bot(reason: str) -> dict:
    """Lock the bot (no new entries) with a reason."""
    return update_bot_state(is_locked=True, lock_reason=reason)


def unlock_bot() -> dict:
    """Clear the bot lock (manual override only)."""
    return update_bot_state(is_locked=False, lock_reason=None)


def engage_kill_switch() -> dict:
    """Engage the kill switch flag."""
    return update_bot_state(kill_switch=True, is_running=False,
                            lock_reason="kill_switch_engaged")


def release_kill_switch() -> dict:
    """Release the kill switch (manual override)."""
    return update_bot_state(kill_switch=False, lock_reason=None)


# --------------------------------------------------------------------------- #
# Composite risk gate
# --------------------------------------------------------------------------- #

@dataclass
class RiskGate:
    """Composite risk check result for the trading loop."""
    allow_new_entry: bool
    tiered_stop: TieredStopResult
    daily_trades_remaining: int
    positions_remaining: int
    kill_switch: bool
    bot_locked: bool
    reasons: list[str] = field(default_factory=list)


def evaluate_risk_gate(current_positions: int,
                       daily_state: DailyRiskState,
                       weekly_start: float,
                       overall_start: float,
                       current_balance: float) -> RiskGate:
    """Run all risk checks at once and return a gate decision."""
    tiered = TieredStop()
    stop = tiered.evaluate(
        current_balance=current_balance,
        daily_start=daily_state.starting_balance,
        weekly_start=weekly_start,
        overall_start=overall_start,
    )
    bot_state = get_bot_state()
    kill = bool(bot_state.get("kill_switch"))
    locked = bool(bot_state.get("is_locked"))

    reasons: list[str] = []
    if stop.triggered:
        reasons.append(f"tiered_stop:{stop.level}")
    if kill:
        reasons.append("kill_switch")
    if locked:
        reasons.append(f"locked:{bot_state.get('lock_reason')}")
    if not enforce_max_positions(current_positions):
        reasons.append("max_positions_reached")
    if not enforce_max_daily_trades(daily_state.trade_count):
        reasons.append("max_daily_trades_reached")
    if daily_state.soft_stop_hit:
        reasons.append("soft_stop_hit")
    if daily_state.hard_stop_hit:
        reasons.append("hard_stop_hit")

    allow = (len(reasons) == 0)
    return RiskGate(
        allow_new_entry=allow,
        tiered_stop=stop,
        daily_trades_remaining=max(0, cfg.MAX_DAILY_TRADES - daily_state.trade_count),
        positions_remaining=max(0, cfg.MAX_POSITIONS - current_positions),
        kill_switch=kill,
        bot_locked=locked,
        reasons=reasons,
    )


__all__ = [
    "TieredStop", "TieredStopResult", "DailyRiskTracker", "DailyRiskState",
    "PositionSizer", "RiskGate",
    "enforce_max_positions", "enforce_max_daily_trades",
    "check_kill_switch", "lock_bot", "unlock_bot",
    "engage_kill_switch", "release_kill_switch",
    "evaluate_risk_gate",
]
