"""
benchmark.py
============
Performance benchmarking for the bot vs. baselines (Buy & Hold, random entries)
and standard risk-adjusted ratios (Sharpe / Sortino / Calmar / Information /
Alpha / Beta).

Pure-Python implementation (uses numpy + scipy where available, degrades
gracefully if scipy is missing).

Endpoints exposed by main.py:
    GET /api/analytics/benchmark?start=&end=  — all benchmarks in one call
    GET /api/analytics/ratios                 — Sharpe/Sortino/Alpha/Beta/Calmar
"""

from __future__ import annotations

import logging
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

try:
    from scipy import stats as sp_stats  # for percentile + significance tests
    _SCIPY_AVAILABLE = True
except ImportError:  # pragma: no cover
    sp_stats = None  # type: ignore
    _SCIPY_AVAILABLE = False

logger = logging.getLogger(__name__)

# Risk-free rate (annualised, default 2% — Indonesian 10Y SBN yield proxy).
RISK_FREE_ANNUAL: float = 0.02
# Approx trading days per year for Forex (24x5) — used to annualise.
TRADING_DAYS_PER_YEAR: int = 252


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
    # Try ISO formats
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:len(fmt) + 6 if "%" not in fmt else len(s)],
                                     fmt)
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------- #
# PerformanceBenchmark
# --------------------------------------------------------------------------- #

class PerformanceBenchmark:
    """Benchmark bot performance vs. baselines + compute risk-adjusted ratios.

    All methods are pure (no I/O) so they can be unit-tested without a DB.
    """

    def __init__(self, risk_free_rate: float = RISK_FREE_ANNUAL,
                 periods_per_year: int = TRADING_DAYS_PER_YEAR) -> None:
        self.risk_free_rate = float(risk_free_rate)
        self.periods_per_year = int(periods_per_year)
        # Daily risk-free rate for per-trade Sharpe calc
        self._rf_period = (self.risk_free_rate
                           / self.periods_per_year)

    # ------------------------------------------------------------------ #
    # Buy & Hold comparison
    # ------------------------------------------------------------------ #

    def calculate_vs_buy_hold(self,
                              trades: list[dict[str, Any]],
                              symbol: str,
                              start_date: datetime,
                              end_date: datetime,
                              price_series: list[dict[str, Any]] | None = None
                              ) -> dict[str, Any]:
        """Compare bot P&L vs. a buy-and-hold of ``symbol`` over the window.

        Parameters
        ----------
        trades : list[dict]
            Closed trade rows (must have ``profit``).
        symbol : str
            Pair to compare (e.g. "EURUSD").
        start_date, end_date : datetime
            Backtest window.
        price_series : list[dict] | None
            Optional list of ``{"time", "close"}`` candles for the symbol.
            If None, buy-hold P&L is estimated from the trade rows' open/close
            prices (less accurate).

        Returns
        -------
        dict
            ``bot_pnl``, ``buy_hold_pnl``, ``alpha``, ``outperformance_pct``.
        """
        bot_trades = [t for t in trades
                      if (t.get("symbol") or "").upper() == symbol.upper()
                      or symbol.upper() == "ALL"]
        bot_pnl = sum(_safe_float(t.get("profit")) for t in bot_trades)

        buy_hold_pnl = 0.0
        if price_series and len(price_series) >= 2:
            # Filter to window
            series = []
            for c in price_series:
                ct = _parse_dt(c.get("time") or c.get("datetime"))
                if ct is None:
                    continue
                if start_date <= ct <= end_date:
                    series.append(c)
            if len(series) >= 2:
                p_start = _safe_float(series[0].get("close"))
                p_end = _safe_float(series[-1].get("close"))
                if p_start > 0:
                    # Assume 1.0 lot notional = 100_000 * point_value, but to
                    # keep it normalised to bot scale we use a fraction: buy
                    # with the same notional as the first bot trade.
                    notional = 10_000.0  # default 10k USD
                    if bot_trades:
                        # Approximate lot * 100k for first trade
                        notional = (_safe_float(bot_trades[0].get("volume"))
                                    * 100_000.0) or 10_000.0
                    buy_hold_pnl = (p_end - p_start) / p_start * notional
        else:
            # Fallback: estimate from trade row prices (first trade)
            if bot_trades:
                first = bot_trades[0]
                p_open = _safe_float(first.get("open_price"))
                # Use last trade's close as a proxy for end-of-window price
                last = bot_trades[-1]
                p_close = _safe_float(last.get("close_price") or p_open)
                if p_open > 0:
                    notional = (_safe_float(first.get("volume")) * 100_000.0
                                or 10_000.0)
                    buy_hold_pnl = (p_close - p_open) / p_open * notional

        alpha = bot_pnl - buy_hold_pnl
        outperf_pct = ((alpha / abs(buy_hold_pnl)) * 100.0
                       if buy_hold_pnl != 0 else 0.0)
        return {
            "symbol": symbol,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "bot_pnl": round(bot_pnl, 2),
            "buy_hold_pnl": round(buy_hold_pnl, 2),
            "alpha": round(alpha, 2),
            "outperformance_pct": round(outperf_pct, 2),
            "bot_trade_count": len(bot_trades),
        }

    # ------------------------------------------------------------------ #
    # Random entries comparison
    # ------------------------------------------------------------------ #

    def calculate_vs_random(self,
                            trades: list[dict[str, Any]],
                            iterations: int = 1000,
                            seed: int | None = None
                            ) -> dict[str, Any]:
        """Compare bot profit factor vs. randomly-timed entries.

        For each iteration we generate ``len(trades)`` random entries drawn
        from the bot's profit distribution (with sign flips) and compute the
        profit factor.  We then compare the bot's actual profit factor to the
        random distribution.

        Returns
        -------
        dict
            ``bot_pf``, ``random_avg_pf``, ``random_p95_pf``,
            ``statistical_significance`` (p-value from a one-sample t-test
            of bot_pf vs. the random distribution).
        """
        if not trades:
            return {
                "bot_pf": 0.0, "random_avg_pf": 0.0,
                "random_p95_pf": 0.0, "statistical_significance": 1.0,
                "iterations": iterations, "bot_trade_count": 0,
            }
        bot_pnl = np.array(
            [_safe_float(t.get("profit")) for t in trades], dtype=float,
        )
        bot_pf = self._profit_factor(bot_pnl)

        rng = random.Random(seed)
        abs_returns = np.abs(bot_pnl)
        # Use the empirical return magnitudes, randomly sign them.
        random_pfs: list[float] = []
        n = len(bot_pnl)
        for _ in range(max(1, int(iterations))):
            sample = np.array(
                [abs_returns[rng.randrange(n)] * (1.0 if rng.random() >= 0.5
                                                  else -1.0)
                 for _ in range(n)],
                dtype=float,
            )
            random_pfs.append(self._profit_factor(sample))
        # Filter out inf values (they occur when a random sample has no
        # losing trades) so percentile + mean are finite.
        finite_pfs = [float(p) for p in random_pfs
                      if p != float("inf") and not (isinstance(p, float)
                                                    and p != p)]
        # If everything was inf, fall back to a large finite cap.
        if not finite_pfs:
            finite_pfs = [1e6] * len(random_pfs)
        random_pfs_arr = np.array(finite_pfs, dtype=float)
        random_avg = float(random_pfs_arr.mean()) if len(random_pfs_arr) else 0.0
        random_p95 = float(np.percentile(random_pfs_arr, 95)) \
            if len(random_pfs_arr) else 0.0

        # Statistical significance: one-sample t-test of bot_pf vs random dist
        # (skip if bot_pf is inf — those are untestable edge cases).
        p_value = 1.0
        if _SCIPY_AVAILABLE and len(random_pfs_arr) >= 2 \
                and bot_pf != float("inf"):
            try:
                t_stat, p_value = sp_stats.ttest_1samp(
                    random_pfs_arr, popmean=bot_pf,
                )
                p_value = float(p_value)
                # NaN p-values (e.g. zero variance) default to 1.0
                if p_value != p_value:
                    p_value = 1.0
            except Exception as exc:  # pragma: no cover
                logger.debug("t-test failed: %s", exc)
        return {
            "bot_pf": round(bot_pf, 4) if bot_pf != float("inf") else 9999.0,
            "random_avg_pf": round(random_avg, 4),
            "random_p95_pf": round(random_p95, 4),
            "statistical_significance": round(p_value, 4),
            "iterations": int(iterations),
            "bot_trade_count": int(n),
        }

    # ------------------------------------------------------------------ #
    # Risk-adjusted ratios
    # ------------------------------------------------------------------ #

    def calculate_ratios(self,
                         trades: list[dict[str, Any]],
                         balance_history: list[dict[str, Any]] | None = None
                         ) -> dict[str, Any]:
        """Compute Sharpe, Sortino, Calmar, Information ratios + max DD.

        Parameters
        ----------
        trades : list[dict]
            Closed trades (must have ``profit``).
        balance_history : list[dict] | None
            Optional list of ``{"timestamp", "balance"}`` samples for max-DD
            calc.  If None, max DD is approximated from trade cumulative P&L.
        """
        returns = np.array(
            [_safe_float(t.get("profit")) for t in trades], dtype=float,
        )
        if len(returns) == 0:
            return {
                "sharpe": 0.0, "sortino": 0.0,
                "information_ratio": 0.0,
                "max_drawdown": 0.0, "calmar": 0.0,
                "trade_count": 0,
            }
        mean_ret = float(returns.mean())
        std_ret = float(returns.std(ddof=1)) if len(returns) > 1 else 0.0

        # Downside deviation (only negative returns)
        downside = returns[returns < 0]
        downside_std = float(np.std(downside, ddof=1)) if len(downside) > 1 else 0.0

        # Annualisation factor (sqrt of periods per year)
        ann = math.sqrt(self.periods_per_year)

        sharpe = (((mean_ret - self._rf_period) / std_ret) * ann
                  if std_ret > 0 else 0.0)
        sortino = (((mean_ret - self._rf_period) / downside_std) * ann
                   if downside_std > 0 else 0.0)

        # Max drawdown
        if balance_history and len(balance_history) >= 2:
            balances = np.array(
                [_safe_float(b.get("balance")) for b in balance_history],
                dtype=float,
            )
        else:
            # Approximate cumulative balance from returns + initial 10k
            balances = np.cumsum(np.concatenate(
                ([10_000.0], returns)))
        running_max = np.maximum.accumulate(balances)
        drawdowns = (balances - running_max) / np.where(running_max > 0,
                                                        running_max, 1.0)
        max_dd = float(abs(drawdowns.min())) if len(drawdowns) else 0.0

        # Calmar = annualised return / max DD
        ann_return = mean_ret * self.periods_per_year
        calmar = (ann_return / max_dd) if max_dd > 0 else 0.0

        # Information ratio vs. buy-hold (zero baseline if not provided)
        information_ratio = (mean_ret / std_ret * ann) if std_ret > 0 else 0.0

        return {
            "sharpe": round(sharpe, 4),
            "sortino": round(sortino, 4),
            "information_ratio": round(information_ratio, 4),
            "max_drawdown": round(max_dd, 4),
            "calmar": round(calmar, 4),
            "trade_count": int(len(returns)),
            "mean_return": round(mean_ret, 4),
            "std_return": round(std_ret, 4),
            "downside_std": round(downside_std, 4),
        }

    # ------------------------------------------------------------------ #
    # Beta / Alpha vs market
    # ------------------------------------------------------------------ #

    def calculate_beta(self,
                       trades: list[dict[str, Any]],
                       market_returns: list[float]
                       ) -> dict[str, Any]:
        """Compute Beta + Alpha (CAPM) vs. a market returns benchmark.

        Parameters
        ----------
        trades : list[dict]
            Bot trades (must have ``profit``).
        market_returns : list[float]
            Market benchmark returns aligned with each trade (length should
            match ``len(trades)``).  Zero-padded if shorter.
        """
        bot_returns = np.array(
            [_safe_float(t.get("profit")) for t in trades], dtype=float,
        )
        n = len(bot_returns)
        if n == 0:
            return {"beta": 0.0, "alpha": 0.0, "correlation": 0.0,
                    "trade_count": 0}
        mkt = np.array(market_returns[:n] + [0.0] * max(0, n - len(market_returns)),
                       dtype=float)
        mkt_var = float(np.var(mkt, ddof=1)) if n > 1 else 0.0
        if mkt_var > 0:
            cov = float(np.cov(bot_returns, mkt, ddof=1)[0, 1]) if n > 1 else 0.0
            beta = cov / mkt_var
        else:
            beta = 0.0
        mean_bot = float(bot_returns.mean())
        mean_mkt = float(mkt.mean())
        alpha = (mean_bot - self._rf_period
                 - beta * (mean_mkt - self._rf_period))
        corr = float(np.corrcoef(bot_returns, mkt)[0, 1]) \
            if (n > 1 and mkt_var > 0) else 0.0
        return {
            "beta": round(beta, 4),
            "alpha": round(alpha, 4),
            "correlation": round(corr, 4),
            "trade_count": int(n),
        }

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _profit_factor(returns: np.ndarray) -> float:
        """Profit factor = sum(wins) / abs(sum(losses)).  Returns 0 if no losses."""
        if len(returns) == 0:
            return 0.0
        gross_profit = float(returns[returns > 0].sum())
        gross_loss = float(abs(returns[returns < 0].sum()))
        if gross_loss == 0:
            return float("inf") if gross_profit > 0 else 0.0
        return gross_profit / gross_loss

    # ------------------------------------------------------------------ #
    # All-in-one benchmark
    # ------------------------------------------------------------------ #

    def benchmark_all(self,
                      trades: list[dict[str, Any]],
                      start_date: datetime | None = None,
                      end_date: datetime | None = None,
                      symbol: str = "ALL",
                      price_series: list[dict[str, Any]] | None = None,
                      balance_history: list[dict[str, Any]] | None = None,
                      market_returns: list[float] | None = None,
                      random_iterations: int = 200,
                      ) -> dict[str, Any]:
        """One-call benchmark used by GET /api/analytics/benchmark."""
        if start_date is None:
            start_date = (datetime.now(timezone.utc) - timedelta(days=30))
        if end_date is None:
            end_date = datetime.now(timezone.utc)
        vs_bh = self.calculate_vs_buy_hold(
            trades, symbol, start_date, end_date, price_series,
        )
        vs_rand = self.calculate_vs_random(
            trades, iterations=random_iterations,
        )
        ratios = self.calculate_ratios(trades, balance_history)
        beta = self.calculate_beta(
            trades, market_returns or [],
        )
        return {
            "vs_buy_hold": vs_bh,
            "vs_random": vs_rand,
            "ratios": ratios,
            "beta_alpha": beta,
            "window": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
            },
        }


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_benchmark: PerformanceBenchmark | None = None


def get_benchmark() -> PerformanceBenchmark:
    """Return the module-level PerformanceBenchmark singleton."""
    global _default_benchmark
    if _default_benchmark is None:
        _default_benchmark = PerformanceBenchmark()
    return _default_benchmark


__all__ = [
    "PerformanceBenchmark",
    "get_benchmark",
    "RISK_FREE_ANNUAL",
]
