"""
stress_test.py
==============
Stress testing for the V2 strategy (Sprint 7 #14).

Runs the most catastrophic historical market scenarios against a list of
trades (or a recent trade window) to see whether the strategy would have
survived if 3-4 of its worst trades had happened simultaneously.

Scenarios
---------
* ``SNB_UNPEG_2015``     - EURCHF -30% in minutes (15 Jan 2015)
* ``BREXIT_2016``        - GBP -10% overnight (24 Jun 2016)
* ``COVID_CRASH_2020``   - S&P -30%, USD vol spike (Mar 2020)
* ``GFC_2008``           - Lehman collapse, EURUSD -12% (Sep-Nov 2008)

Each scenario multiplies the magnitude of the worst N trades by a stress
factor (typically 2x-3.5x) and re-computes the resulting max drawdown and
whether the account would still have positive equity.
"""

import logging
import math
from dataclasses import dataclass
from typing import Any, Sequence

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Scenarios
# --------------------------------------------------------------------------- #

STRESS_SCENARIOS: dict[str, dict[str, Any]] = {
    "SNB_UNPEG_2015": {
        "date": "2015-01-15",
        "description": "EURCHF unpegged - ~30% move in 20 minutes.  "
                       "Worst-ever retail broker blow-ups (Alpari, FXCM).",
        "multiplier": 3.5,
        "n_worst": 4,
    },
    "BREXIT_2016": {
        "date": "2016-06-24",
        "description": "GBP -10% overnight on Brexit referendum result.",
        "multiplier": 2.5,
        "n_worst": 3,
    },
    "COVID_CRASH_2020": {
        "date": "2020-03-01 to 2020-03-23",
        "description": "S&P -30%, USD vol spike, GBPUSD -7% in 3 weeks.",
        "multiplier": 2.0,
        "n_worst": 4,
    },
    "GFC_2008": {
        "date": "2008-09-15 to 2008-11-20",
        "description": "Lehman collapse, EURUSD -12%, carry unwind massive.",
        "multiplier": 2.8,
        "n_worst": 4,
    },
}


# --------------------------------------------------------------------------- #
# Result type
# --------------------------------------------------------------------------- #

@dataclass
class ScenarioResult:
    scenario: str
    description: str
    multiplier: float
    original_max_dd_pct: float
    stressed_max_dd_pct: float
    survival: bool       # balance > 0 after the stress
    balance_after: float
    detail: list[dict[str, Any]]


# --------------------------------------------------------------------------- #
# Engine
# --------------------------------------------------------------------------- #

class StressTester:
    """Run historical stress scenarios against a list of trades."""

    def __init__(self, scenarios: dict[str, dict[str, Any]] | None = None) -> None:
        self.scenarios = scenarios or dict(STRESS_SCENARIOS)

    # ---- single scenario -------------------------------------------------- #

    def run_scenario(self, scenario_name: str,
                     trades: Sequence[dict[str, Any]],
                     account_balance: float,
                     window_size: int | None = None) -> ScenarioResult:
        """Apply ``scenario_name``'s stress multiplier to the worst trades.

        Parameters
        ----------
        trades : sequence of trade dicts
            Each trade must have a ``profit`` (or ``pnl``) float field.
        account_balance : float
            Starting balance for the stress simulation.
        window_size : int, optional
            Limit the stress to the worst ``window_size`` trades
            (overrides the scenario's ``n_worst``).
        """
        if scenario_name not in self.scenarios:
            raise KeyError(f"Unknown stress scenario: {scenario_name}")
        sc = self.scenarios[scenario_name]
        mult = float(sc["multiplier"])
        n_worst = int(window_size or sc.get("n_worst", 4))

        # Sort trades by profit ascending (worst first)
        pnls = []
        for t in trades:
            try:
                p = float(t.get("profit") or t.get("pnl") or 0.0)
            except (TypeError, ValueError):
                p = 0.0
            pnls.append((p, t))
        pnls_sorted = sorted(pnls, key=lambda x: x[0])  # worst first

        # Original max DD: cumulative PnL trough
        original_max_dd_pct = _max_drawdown_pct([p for p, _ in pnls],
                                                account_balance)
        # Apply stress: magnify the worst N trades by `mult`
        worst_n = pnls_sorted[:n_worst]
        stressed_pnls = [p for p, _ in pnls]
        detail: list[dict[str, Any]] = []
        # Mutate the worst-N trades in-place
        for original_p, t in worst_n:
            stressed_p = original_p * mult
            idx = None
            try:
                idx = stressed_pnls.index(original_p)
            except ValueError:
                pass
            if idx is not None:
                stressed_pnls[idx] = stressed_p
            detail.append({
                "ticket": t.get("ticket") or t.get("id"),
                "symbol": t.get("symbol"),
                "original_profit": round(original_p, 2),
                "stressed_profit": round(stressed_p, 2),
                "multiplier": mult,
            })
        stressed_max_dd_pct = _max_drawdown_pct(stressed_pnls,
                                                account_balance)
        balance_after = account_balance + sum(stressed_pnls)
        survival = balance_after > 0
        return ScenarioResult(
            scenario=scenario_name,
            description=sc["description"],
            multiplier=mult,
            original_max_dd_pct=round(original_max_dd_pct, 4),
            stressed_max_dd_pct=round(stressed_max_dd_pct, 4),
            survival=survival,
            balance_after=round(balance_after, 2),
            detail=detail,
        )

    # ---- all scenarios ---------------------------------------------------- #

    def run_all_scenarios(self, trades: Sequence[dict[str, Any]],
                          account_balance: float,
                          window_size: int | None = None
                          ) -> list[dict[str, Any]]:
        """Run every configured scenario.  Returns a list of dicts."""
        out: list[dict[str, Any]] = []
        for name in self.scenarios:
            r = self.run_scenario(name, trades, account_balance, window_size)
            out.append({
                "scenario": r.scenario,
                "description": r.description,
                "multiplier": r.multiplier,
                "original_max_dd_pct": r.original_max_dd_pct,
                "stressed_max_dd_pct": r.stressed_max_dd_pct,
                "survival": r.survival,
                "balance_after": r.balance_after,
                "detail": r.detail,
            })
        return out


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _max_drawdown_pct(pnls: Sequence[float],
                      starting_balance: float) -> float:
    """Compute max drawdown % from a list of per-trade PnL values."""
    if not pnls or starting_balance <= 0:
        return 0.0
    equity = starting_balance
    peak = equity
    max_dd = 0.0
    for p in pnls:
        equity += p
        if equity > peak:
            peak = equity
        dd_pct = (equity - peak) / peak if peak > 0 else 0.0
        if dd_pct < max_dd:
            max_dd = dd_pct
    # Return as a positive percentage (e.g. -0.10 -> 0.10 = 10%)
    return abs(max_dd)


__all__ = [
    "STRESS_SCENARIOS", "ScenarioResult", "StressTester",
]
