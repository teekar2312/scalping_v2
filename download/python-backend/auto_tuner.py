"""
auto_tuner.py
=============
Auto-parameter optimisation for the V2 strategy.

Performs an exhaustive grid search over key strategy parameters and replays
historical trades to find the configuration with the best profit factor.

Persists each optimisation run to the ``optimization_results`` table.

Endpoints exposed by main.py:
    POST /api/auto-tune/optimize   — trigger optimisation
    GET  /api/auto-tune/current    — current optimal params
    GET  /api/auto-tune/history    — past optimisation runs

Config:
    AUTO_TUNE_ENABLED=false
    AUTO_TUNE_INTERVAL_DAYS=7
"""

from __future__ import annotations

import itertools
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import (
    Column, DateTime, Float, Index, Integer, String, Text, select,
)

import database as db
from database import Base, get_db
import config as cfg

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Model — registered on Base.metadata so create_all() picks it up.
# --------------------------------------------------------------------------- #

class OptimizationResult(Base):
    """Saved auto-tuner optimisation result."""
    __tablename__ = "optimization_results"
    id = Column(Integer, primary_key=True, autoincrement=True)
    params_json = Column(Text, nullable=False)
    profit_factor = Column(Float, default=0.0)
    win_rate = Column(Float, default=0.0)
    max_dd = Column(Float, default=0.0)
    total_trades = Column(Integer, default=0)
    improvement_pct = Column(Float, default=0.0)
    optimized_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                          index=True)


Index("ix_opt_results_at", OptimizationResult.optimized_at)


# --------------------------------------------------------------------------- #
# Default parameter grid
# --------------------------------------------------------------------------- #

DEFAULT_PARAM_GRID: dict[str, list[Any]] = {
    "adx_threshold": [20.0, 22.0, 25.0, 28.0, 30.0],
    "atr_mult": [1.0, 1.25, 1.5, 1.75, 2.0],
    "ema_fast": [7, 8, 9, 10, 12],
    "ema_slow": [18, 20, 21, 23, 25],
}


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass
class OptimizationOutcome:
    """Result of a single parameter combination."""
    params: dict[str, Any]
    profit_factor: float
    win_rate: float
    max_dd: float
    total_trades: int
    pnl: float = 0.0


@dataclass
class OptimizationReport:
    """Final optimisation report returned by optimize_parameters()."""
    best: OptimizationOutcome
    baseline: OptimizationOutcome
    improvement_pct: float
    grid_size: int
    all_results: list[OptimizationOutcome] = field(default_factory=list)
    optimized_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _parse_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _profit_factor(returns: list[float]) -> float:
    if not returns:
        return 0.0
    gross_profit = sum(r for r in returns if r > 0)
    gross_loss = abs(sum(r for r in returns if r < 0))
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def _max_drawdown(returns: list[float]) -> float:
    if not returns:
        return 0.0
    balance = 10_000.0
    peak = balance
    max_dd = 0.0
    for r in returns:
        balance += r
        if balance > peak:
            peak = balance
        if peak > 0:
            dd = (peak - balance) / peak
            if dd > max_dd:
                max_dd = dd
    return max_dd


# --------------------------------------------------------------------------- #
# AutoTuner
# --------------------------------------------------------------------------- #

class AutoTuner:
    """Grid-search parameter optimiser.

    The replay is a *very* lightweight approximation of the strategy: it
    filters historical trades by checking whether each trade's ADX (read
    from the saved checklist_json) is above the candidate threshold, then
    computes profit factor / win rate / max DD over the filtered set.  A
    full backtest replay would require re-running ``check_setup`` for every
    candle; that is left to the dedicated ``backtest.py`` engine.
    """

    def __init__(self,
                 param_grid: dict[str, list[Any]] | None = None,
                 interval_days: int | None = None) -> None:
        self.param_grid = param_grid or DEFAULT_PARAM_GRID
        self.interval_days = int(
            interval_days or cfg.AUTO_TUNE_INTERVAL_DAYS
        )

    # ------------------------------------------------------------------ #
    # Optimisation
    # ------------------------------------------------------------------ #

    def optimize_parameters(self,
                            trades: list[dict[str, Any]],
                            candles_history: list[dict[str, Any]] | None = None,
                            param_grid: dict[str, list[Any]] | None = None
                            ) -> OptimizationReport:
        """Run the grid search and return the best outcome.

        Parameters
        ----------
        trades : list[dict]
            Historical closed trades (with ``checklist`` JSON parsed).
        candles_history : list[dict] | None
            Reserved for future candle-based replay (currently unused).
        param_grid : dict | None
            Override the default grid.
        """
        grid = param_grid or self.param_grid
        keys = list(grid.keys())
        value_lists = [grid[k] for k in keys]
        combos = list(itertools.product(*value_lists))
        logger.info("AutoTuner: evaluating %d parameter combinations",
                    len(combos))

        baseline_params = {
            "adx_threshold": cfg.ADX_TRENDING,
            "atr_mult": cfg.SL_ATR_MULT,
            "ema_fast": 9,
            "ema_slow": 21,
        }
        baseline = self._evaluate(baseline_params, trades)

        results: list[OptimizationOutcome] = []
        for combo in combos:
            params = dict(zip(keys, combo))
            outcome = self._evaluate(params, trades)
            results.append(outcome)

        # Sort by profit_factor (handle inf as a large finite number)
        def _pf_key(o: OptimizationOutcome) -> float:
            return o.profit_factor if o.profit_factor != float("inf") else 1e9
        results.sort(key=_pf_key, reverse=True)
        best = results[0] if results else baseline
        improvement_pct = 0.0
        if baseline.profit_factor > 0 and best.profit_factor != float("inf"):
            improvement_pct = ((best.profit_factor - baseline.profit_factor)
                               / baseline.profit_factor * 100.0)
        elif best.profit_factor == float("inf"):
            improvement_pct = 100.0

        report = OptimizationReport(
            best=best,
            baseline=baseline,
            improvement_pct=round(improvement_pct, 2),
            grid_size=len(combos),
            all_results=results,
        )
        # Persist
        self._persist(report)
        return report

    def _evaluate(self,
                  params: dict[str, Any],
                  trades: list[dict[str, Any]]) -> OptimizationOutcome:
        """Evaluate one parameter combination against the historical trades."""
        adx_threshold = _safe_float(params.get("adx_threshold"), 25.0)
        atr_mult = _safe_float(params.get("atr_mult"), 1.5)
        # ema_fast / ema_slow: filter trades by checklist ema cross state
        # (we can't re-compute without candles, so we accept all and rely on
        # the adx_threshold + atr_mult filters).
        filtered: list[dict[str, Any]] = []
        for t in trades:
            chk = t.get("checklist") or {}
            if isinstance(chk, str):
                try:
                    chk = json.loads(chk)
                except Exception:
                    chk = {}
            adx_val = _safe_float(t.get("adx"))
            if adx_val == 0:
                # Try checklist
                adx_chk = chk.get("adx_trending") or {}
                if isinstance(adx_chk, dict):
                    adx_val = _safe_float(adx_chk.get("adx_value"))
                else:
                    adx_val = _safe_float(chk.get("adx_value"))
            # Apply ADX threshold filter
            if adx_val > 0 and adx_val < adx_threshold:
                continue
            # Apply ATR mult filter on R/R net (looser for higher mult)
            rr_net = _safe_float(t.get("rr_net"))
            if rr_net != 0:
                # Higher ATR mult → wider stops → lower RR bar
                min_rr = max(0.5, cfg.RR_NET_MIN - (atr_mult - 1.5))
                if rr_net < min_rr:
                    continue
            filtered.append(t)

        returns = [_safe_float(t.get("profit")) for t in filtered]
        pf = _profit_factor(returns)
        wins = sum(1 for r in returns if r > 0)
        total = len(returns)
        win_rate = (wins / total * 100.0) if total else 0.0
        max_dd = _max_drawdown(returns)
        pnl = sum(returns)
        return OptimizationOutcome(
            params=params,
            profit_factor=pf,
            win_rate=round(win_rate, 2),
            max_dd=round(max_dd, 4),
            total_trades=total,
            pnl=round(pnl, 2),
        )

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #

    def _persist(self, report: OptimizationReport) -> int:
        """Persist an OptimizationReport row."""
        db_obj = get_db()
        with db_obj.session() as s:
            row = OptimizationResult(
                params_json=json.dumps(report.best.params, default=str),
                profit_factor=float(report.best.profit_factor)
                    if report.best.profit_factor != float("inf") else 9999.0,
                win_rate=float(report.best.win_rate),
                max_dd=float(report.best.max_dd),
                total_trades=int(report.best.total_trades),
                improvement_pct=float(report.improvement_pct),
            )
            s.add(row)
            s.flush()
            return int(row.id)

    # ------------------------------------------------------------------ #
    # Accessors
    # ------------------------------------------------------------------ #

    def get_current_optimal(self) -> dict[str, Any] | None:
        """Return the most recent optimised parameters (or None if never run)."""
        db_obj = get_db()
        with db_obj.session() as s:
            row = s.execute(
                select(OptimizationResult)
                .order_by(OptimizationResult.optimized_at.desc())
                .limit(1)
            ).scalar_one_or_none()
        if row is None:
            return None
        return {
            "id": row.id,
            "params": json.loads(row.params_json) if row.params_json else {},
            "profit_factor": round(row.profit_factor, 4),
            "win_rate": round(row.win_rate, 2),
            "max_dd": round(row.max_dd, 4),
            "total_trades": row.total_trades,
            "improvement_pct": round(row.improvement_pct, 2),
            "optimized_at": row.optimized_at.isoformat() if row.optimized_at else None,
        }

    def get_optimization_history(self,
                                 limit: int = 20) -> list[dict[str, Any]]:
        """Return past optimisation runs (newest first)."""
        db_obj = get_db()
        with db_obj.session() as s:
            rows = s.execute(
                select(OptimizationResult)
                .order_by(OptimizationResult.optimized_at.desc())
                .limit(int(limit))
            ).scalars().all()
        return [{
            "id": r.id,
            "params": json.loads(r.params_json) if r.params_json else {},
            "profit_factor": round(r.profit_factor, 4),
            "win_rate": round(r.win_rate, 2),
            "max_dd": round(r.max_dd, 4),
            "total_trades": r.total_trades,
            "improvement_pct": round(r.improvement_pct, 2),
            "optimized_at": r.optimized_at.isoformat() if r.optimized_at else None,
        } for r in rows]

    # ------------------------------------------------------------------ #
    # Retraining checks
    # ------------------------------------------------------------------ #

    def should_retrain(self,
                       last_optimize_date: datetime | None = None) -> bool:
        """Return True if the last optimisation is older than ``interval_days``."""
        if last_optimize_date is None:
            current = self.get_current_optimal()
            if current is None:
                return True
            ts = current.get("optimized_at")
            last_optimize_date = _parse_dt(ts) if ts else None
            if last_optimize_date is None:
                return True
        # Make naive UTC if tzinfo is missing
        if last_optimize_date.tzinfo is None:
            last_optimize_date = last_optimize_date.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.interval_days)
        return last_optimize_date < cutoff

    def apply_optimized_parameters(self,
                                   params: dict[str, Any]) -> dict[str, Any]:
        """Apply optimised parameters as runtime settings (DB settings table).

        The strategy + risk manager read these on the next tick.
        """
        applied: dict[str, Any] = {}
        if "adx_threshold" in params:
            db.set_setting("adx_trending", str(params["adx_threshold"]))
            applied["adx_trending"] = params["adx_threshold"]
        if "atr_mult" in params:
            db.set_setting("sl_atr_mult", str(params["atr_mult"]))
            applied["sl_atr_mult"] = params["atr_mult"]
        if "ema_fast" in params:
            db.set_setting("ema_fast", str(params["ema_fast"]))
            applied["ema_fast"] = params["ema_fast"]
        if "ema_slow" in params:
            db.set_setting("ema_slow", str(params["ema_slow"]))
            applied["ema_slow"] = params["ema_slow"]
        logger.info("Applied optimised parameters: %s", applied)
        return applied


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_tuner: AutoTuner | None = None


def get_auto_tuner() -> AutoTuner:
    """Return the module-level AutoTuner singleton."""
    global _default_tuner
    if _default_tuner is None:
        _default_tuner = AutoTuner()
    return _default_tuner


__all__ = [
    "AutoTuner",
    "OptimizationOutcome",
    "OptimizationReport",
    "OptimizationResult",
    "get_auto_tuner",
    "DEFAULT_PARAM_GRID",
]
