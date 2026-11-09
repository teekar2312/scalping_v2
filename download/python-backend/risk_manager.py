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
from datetime import datetime, time, timedelta, timezone
from typing import Any, Literal

import config as cfg
from config import settings
from database import (
    get_or_create_daily, update_daily, get_bot_state, update_bot_state,
    list_open_trades,
)

logger = logging.getLogger(__name__)

StopLevel = Literal["none", "soft", "hard", "weekly", "overall"]


# --------------------------------------------------------------------------- #
# WIB timezone for cooldown end-of-day calc
# --------------------------------------------------------------------------- #

try:
    from zoneinfo import ZoneInfo
    _WIB = ZoneInfo(settings.timezone)
except Exception:  # pragma: no cover
    _WIB = timezone.utc


def _cooldown_until_for_streak(streak: int,
                               now_utc: datetime | None = None) -> datetime | None:
    """Compute the cooldown end-time for a given loss streak.

    * streak >= 3 -> end of WIB day (23:59:59 local)
    * streak >= 2 -> now + 30 minutes
    * otherwise   -> None
    """
    if streak < 2:
        return None
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    if streak >= 3:
        now_wib = now_utc.astimezone(_WIB)
        # End of today (WIB) at 23:59:59
        end_of_day_wib = datetime.combine(
            now_wib.date(), time(23, 59, 59),
        ).replace(tzinfo=_WIB)
        return end_of_day_wib.astimezone(timezone.utc)
    # streak == 2
    return now_utc + timedelta(minutes=30)


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
    consecutive_loss_count: int = 0
    consecutive_win_count: int = 0
    cooldown_until: str | None = None
    last_loss_time: str | None = None
    last_win_time: str | None = None


class DailyRiskTracker:
    """Track daily PnL, trade count and win/loss streaks."""

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
            consecutive_loss_count=raw.get("consecutive_loss_count", 0),
            consecutive_win_count=raw.get("consecutive_win_count", 0),
            cooldown_until=raw.get("cooldown_until"),
            last_loss_time=raw.get("last_loss_time"),
            last_win_time=raw.get("last_win_time"),
        )

    def record_trade(self, pnl: float, win: bool) -> DailyRiskState:
        """Record a closed trade's PnL and update counts + streak + cooldown.

        Streak rules:
            * Loss -> ``consecutive_loss_count`` +1, reset wins
            * Win  -> ``consecutive_win_count`` +1, reset losses
            * 2 losses -> 30-minute cooldown (UTC)
            * 3+ losses -> cooldown until end of WIB day (23:59:59 local)
        """
        state = self.get_state()
        new_realized = state.realized_pnl + pnl
        new_count = state.trade_count + 1
        new_wins = state.win_count + (1 if win else 0)
        new_losses = state.loss_count + (0 if win else 1)

        now_utc = datetime.now(timezone.utc)
        if win:
            new_streak_loss = 0
            new_streak_win = state.consecutive_win_count + 1
            update_fields: dict[str, Any] = {
                "realized_pnl": new_realized,
                "trade_count": new_count,
                "win_count": new_wins,
                "loss_count": new_losses,
                "current_balance": state.starting_balance + new_realized,
                "consecutive_loss_count": 0,
                "consecutive_win_count": new_streak_win,
                "last_win_time": now_utc,
            }
        else:
            new_streak_loss = state.consecutive_loss_count + 1
            update_fields = {
                "realized_pnl": new_realized,
                "trade_count": new_count,
                "win_count": new_wins,
                "loss_count": new_losses,
                "current_balance": state.starting_balance + new_realized,
                "consecutive_loss_count": new_streak_loss,
                "consecutive_win_count": 0,
                "last_loss_time": now_utc,
            }
            cooldown = _cooldown_until_for_streak(new_streak_loss, now_utc)
            if cooldown is not None:
                update_fields["cooldown_until"] = cooldown
                logger.warning(
                    "Cooldown engaged: %d losses in a row, until %s UTC",
                    new_streak_loss, cooldown.isoformat(),
                )

        update_daily(state.date, **update_fields)
        return self.get_state()

    def get_streak_status(self) -> dict[str, Any]:
        """Return a streak + cooldown summary for /api/status."""
        state = self.get_state()
        now_utc = datetime.now(timezone.utc)
        cooldown_str = state.cooldown_until
        cooldown_active = False
        if cooldown_str:
            try:
                cd_dt = datetime.fromisoformat(cooldown_str.replace("Z", "+00:00"))
                if cd_dt.tzinfo is None:
                    cd_dt = cd_dt.replace(tzinfo=timezone.utc)
                cooldown_active = cd_dt > now_utc
            except ValueError:
                cooldown_active = False
        return {
            "consecutive_losses": state.consecutive_loss_count,
            "consecutive_wins": state.consecutive_win_count,
            "cooldown_active": cooldown_active,
            "cooldown_until": cooldown_str,
            "last_loss_time": state.last_loss_time,
            "last_win_time": state.last_win_time,
        }


# --------------------------------------------------------------------------- #
# Correlation check (audit-fix Sprint 1 #6)
# --------------------------------------------------------------------------- #

# Each FX pair is decomposed into two currency legs.  For a BUY, the trader
# is long the base and short the quote; for a SELL the reverse.
def _split_pair(symbol: str) -> tuple[str, str]:
    sym = symbol.upper().replace("/", "")
    if len(sym) != 6:
        return ("", "")
    return (sym[:3], sym[3:])


def check_correlation(new_symbol: str,
                      direction: str,
                      open_positions: list[dict[str, Any]]
                      ) -> dict[str, Any]:
    """Block a new trade if it pushes a single currency's exposure too high.

    Rules
    -----
    * A BUY on EURUSD => +1 EUR, -1 USD
    * A SELL on EURUSD => -1 EUR, +1 USD
    * If any currency already has 2 open positions on the same side, the new
      trade is blocked (max 2 correlated positions per currency leg).

    Returns
    -------
    dict
        ``{"allowed": bool, "reason": str, "current_exposure": dict}``
    """
    base, quote = _split_pair(new_symbol)
    if not base:
        return {"allowed": True, "reason": "ok",
                "current_exposure": {}}
    is_buy = direction.lower() == "buy"

    # Build exposure map: currency -> signed net position count
    exposure: dict[str, int] = {}
    for p in open_positions:
        sym = p.get("symbol") or ""
        pdir = (p.get("direction") or p.get("type") or "").lower()
        b, q = _split_pair(sym)
        if not b:
            continue
        if pdir == "buy":
            exposure[b] = exposure.get(b, 0) + 1
            exposure[q] = exposure.get(q, 0) - 1
        else:
            exposure[b] = exposure.get(b, 0) - 1
            exposure[q] = exposure.get(q, 0) + 1

    # Apply the candidate trade
    new_long_ccy = base if is_buy else quote
    new_short_ccy = quote if is_buy else base
    projected_long = exposure.get(new_long_ccy, 0) + 1
    projected_short = exposure.get(new_short_ccy, 0) - 1

    reason = "ok"
    allowed = True
    # If the new trade pushes any single currency beyond 2 positions on the
    # same side, block it.
    if abs(projected_long) > 2:
        allowed = False
        reason = (f"Correlation block: {new_long_ccy} would have "
                  f"{projected_long:+d} net long positions (max 2)")
    elif abs(projected_short) > 2:
        allowed = False
        reason = (f"Correlation block: {new_short_ccy} would have "
                  f"{projected_short:+d} net short positions (max 2)")

    exposure_out = {k: v for k, v in exposure.items()}
    exposure_out[new_long_ccy] = projected_long
    exposure_out[new_short_ccy] = projected_short
    return {
        "allowed": allowed,
        "reason": reason,
        "current_exposure": exposure_out,
    }


# --------------------------------------------------------------------------- #
# Position sizer
# --------------------------------------------------------------------------- #

class PositionSizer:
    """1% risk position sizer using SL distance and pip value.

    Sprint 7 #16: ``mode`` selects the sizing strategy.
        * ``"fixed"``  - constant ``risk_pct`` (default, matches V2 spec)
        * ``"kelly"``  - quarter-Kelly fraction based on trade-history stats
    """

    def __init__(self, risk_pct: float = cfg.RISK_PCT_PER_TRADE,
                 mode: str | None = None) -> None:
        self.risk_pct = risk_pct
        # Mode override - explicit ctor arg wins, then env var, then default.
        import os as _os
        if mode is None:
            mode = _os.environ.get("POSITION_SIZING_MODE", "fixed").lower()
        if mode not in ("fixed", "kelly"):
            mode = "fixed"
        self.mode: str = mode

    def calculate(self, balance: float, sl_pips: float,
                  pip_value_per_lot: float,
                  volume_step: float = 0.01,
                  volume_min: float = 0.01,
                  volume_max: float = 100.0,
                  kelly_stats: dict[str, Any] | None = None) -> float:
        """Return the lot size that risks ``risk_pct`` of ``balance``.

        In ``"kelly"`` mode, ``kelly_stats`` should contain ``f_actual``
        (the quarter-Kelly fraction) - typically from
        :meth:`KellySizer.calculate_from_history`.  The fraction is capped at
        2% (max risk per trade).
        """
        if self.mode == "kelly" and kelly_stats:
            risk_pct = min(0.02, float(kelly_stats.get("f_actual", 0.0)))
        else:
            risk_pct = self.risk_pct
        if sl_pips <= 0 or pip_value_per_lot <= 0:
            return volume_min
        raw = (balance * risk_pct) / (sl_pips * pip_value_per_lot)
        if volume_step > 0:
            import math as _m
            raw = _m.floor(raw / volume_step) * volume_step
        raw = max(raw, volume_min)
        raw = min(raw, volume_max)
        return round(raw, 2)


# --------------------------------------------------------------------------- #
# Sprint 7 #16: Kelly Criterion position sizer
# --------------------------------------------------------------------------- #

@dataclass
class KellyResult:
    f_kelly: float          # full Kelly fraction (could be aggressive)
    f_actual: float         # quarter-Kelly (safety cap)
    risk_pct: float         # final risk % used (capped at 2%)
    recommended_lot: float
    win_rate: float
    avg_win: float
    avg_loss: float


class KellySizer:
    """Quarter-Kelly position sizer.

    Kelly formula:  f = W - (1 - W) / R
    where W = win-rate, R = avg_win / avg_loss.

    In practice we use **quarter-Kelly** (f_actual = f_kelly * 0.25) and cap
    the resulting risk at 2% per trade (more conservative than full Kelly).
    """

    KELLY_FRACTION: float = 0.25   # quarter-Kelly
    MAX_RISK_PCT: float = 0.02     # 2% hard cap

    def __init__(self, kelly_fraction: float = KELLY_FRACTION,
                 max_risk_pct: float = MAX_RISK_PCT) -> None:
        self.kelly_fraction = kelly_fraction
        self.max_risk_pct = max_risk_pct

    def calculate(self, balance: float,
                  win_rate: float,
                  avg_win: float,
                  avg_loss: float,
                  sl_pips: float = 10.0,
                  pip_value_per_lot: float = 10.0,
                  volume_step: float = 0.01,
                  volume_min: float = 0.01,
                  volume_max: float = 100.0) -> KellyResult:
        """Compute Kelly fraction and recommended lot size.

        ``avg_loss`` should be a positive number (absolute value of avg loss).
        Returns a :class:`KellyResult` with both full + quarter Kelly fractions.
        """
        if win_rate <= 0 or win_rate >= 1:
            # Edge cases - degenerate to no-trade
            f_kelly = 0.0
        elif avg_loss <= 0 or avg_win <= 0:
            f_kelly = 0.0
        else:
            R = avg_win / avg_loss
            f_kelly = win_rate - (1 - win_rate) / R
        f_actual = max(0.0, f_kelly * self.kelly_fraction)
        risk_pct = min(self.max_risk_pct, f_actual)
        # Compute recommended lot
        if sl_pips > 0 and pip_value_per_lot > 0:
            raw = (balance * risk_pct) / (sl_pips * pip_value_per_lot)
            if volume_step > 0:
                import math as _m
                raw = _m.floor(raw / volume_step) * volume_step
            raw = max(raw, volume_min)
            raw = min(raw, volume_max)
            recommended_lot = round(raw, 2)
        else:
            recommended_lot = volume_min
        return KellyResult(
            f_kelly=round(f_kelly, 4),
            f_actual=round(f_actual, 4),
            risk_pct=round(risk_pct, 4),
            recommended_lot=recommended_lot,
            win_rate=round(win_rate, 4),
            avg_win=round(avg_win, 4),
            avg_loss=round(avg_loss, 4),
        )

    def calculate_from_history(self, trades: list[dict[str, Any]],
                               balance: float,
                               sl_pips: float = 10.0,
                               pip_value_per_lot: float = 10.0,
                               volume_step: float = 0.01,
                               volume_min: float = 0.01,
                               volume_max: float = 100.0
                               ) -> KellyResult:
        """Auto-compute Kelly stats from a trade-history list.

        Each trade dict should have a ``profit`` (or ``pnl``) float field.
        """
        if not trades:
            return self.calculate(balance, 0.0, 0.0, 0.0,
                                  sl_pips, pip_value_per_lot,
                                  volume_step, volume_min, volume_max)
        wins: list[float] = []
        losses: list[float] = []
        for t in trades:
            try:
                p = float(t.get("profit") or t.get("pnl") or 0.0)
            except (TypeError, ValueError):
                continue
            if p > 0:
                wins.append(p)
            elif p < 0:
                losses.append(abs(p))
        total = len(wins) + len(losses)
        if total == 0:
            return self.calculate(balance, 0.0, 0.0, 0.0,
                                  sl_pips, pip_value_per_lot,
                                  volume_step, volume_min, volume_max)
        win_rate = len(wins) / total
        avg_win = (sum(wins) / len(wins)) if wins else 0.0
        avg_loss = (sum(losses) / len(losses)) if losses else 0.0
        return self.calculate(balance, win_rate, avg_win, avg_loss,
                              sl_pips, pip_value_per_lot,
                              volume_step, volume_min, volume_max)


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
                       current_balance: float,
                       new_symbol: str | None = None,
                       new_direction: str | None = None,
                       open_positions: list[dict[str, Any]] | None = None
                       ) -> RiskGate:
    """Run all risk checks at once and return a gate decision.

    Parameters
    ----------
    new_symbol, new_direction, open_positions
        Optional - if all three are provided, the correlation check is
        applied to the candidate trade.
    """
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

    # Cooldown check (audit-fix Sprint 1 #5)
    streak = (daily_state.consecutive_loss_count or 0)
    cooldown_str = daily_state.cooldown_until
    if cooldown_str:
        try:
            cd_dt = datetime.fromisoformat(cooldown_str.replace("Z", "+00:00"))
            if cd_dt.tzinfo is None:
                cd_dt = cd_dt.replace(tzinfo=timezone.utc)
            if cd_dt > datetime.now(timezone.utc):
                reasons.append(
                    f"cooldown_active - {streak} loss beruntun, tunggu sampai "
                    f"{cd_dt.strftime('%H:%M')} UTC"
                )
        except ValueError:
            pass

    # Correlation check (audit-fix Sprint 1 #6)
    if (new_symbol and new_direction and open_positions is not None):
        corr = check_correlation(new_symbol, new_direction, open_positions)
        if not corr["allowed"]:
            reasons.append(corr["reason"])

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
    "KellySizer", "KellyResult",
    "enforce_max_positions", "enforce_max_daily_trades",
    "check_kill_switch", "lock_bot", "unlock_bot",
    "engage_kill_switch", "release_kill_switch",
    "evaluate_risk_gate", "check_correlation",
]
