"""
risk_analytics.py
=================
Advanced risk analytics (Sprint 7 #13).

Provides:
    * ``calculate_var``         - historical + parametric VaR at a given
                                  confidence level (e.g. 95%, 99%)
    * ``calculate_cvar``        - Conditional VaR (Expected Shortfall)
    * ``calculate_portfolio_var`` - multi-asset VaR using correlation matrix
    * ``get_returns_from_trades`` - extract R-multiples as returns from DB trades

VaR conventions
---------------
* Input ``returns`` is a list of period returns (e.g. daily R-multiples,
  daily PnL %, etc.) expressed as **fractions** (e.g. -0.012 = -1.2%).
* VaR is returned as a **positive number representing the loss** at the
  given confidence level (e.g. VaR_95 = 0.025 means "with 95% confidence
  the worst daily loss will not exceed 2.5% of capital").
"""

import logging
import math
from typing import Any, Sequence

logger = logging.getLogger(__name__)

# scipy is optional at runtime - we fall back to a hand-rolled percentile
# implementation if it isn't installed.
try:
    import numpy as np
    from scipy.stats import norm
    _SCIPY_AVAILABLE = True
except ImportError:  # pragma: no cover
    _SCIPY_AVAILABLE = False
    np = None  # type: ignore
    norm = None  # type: ignore


def _percentile(sorted_values: Sequence[float], p: float) -> float:
    """Linear-interpolation percentile of an already-sorted sequence."""
    n = len(sorted_values)
    if n == 0:
        return 0.0
    if n == 1:
        return float(sorted_values[0])
    rank = p / 100.0 * (n - 1)
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return float(sorted_values[lo])
    weight = rank - lo
    return float(sorted_values[lo] * (1 - weight) + sorted_values[hi] * weight)


def calculate_var(returns: Sequence[float],
                  confidence: float = 0.95,
                  method: str = "historical") -> dict[str, Any]:
    """Compute Value-at-Risk at the given confidence level.

    Parameters
    ----------
    returns : sequence of float
        Period returns as fractions (e.g. -0.012 = -1.2%).
    confidence : float
        Confidence level in (0, 1), e.g. 0.95 or 0.99.
    method : str
        ``"historical"`` (default) or ``"parametric"``.

    Returns
    -------
    dict
        ``{var_value, confidence, method, samples}`` - ``var_value`` is the
        loss as a positive fraction.
    """
    if not returns or len(returns) < 2:
        return {"var_value": 0.0, "confidence": confidence,
                "method": method, "samples": len(returns)}
    if not 0 < confidence < 1:
        raise ValueError("confidence must be in (0, 1)")
    pct = (1 - confidence) * 100  # e.g. 5 for 95% confidence

    if method == "parametric":
        if _SCIPY_AVAILABLE:
            arr = np.asarray(returns, dtype=float)
            mean = float(arr.mean())
            std = float(arr.std(ddof=1)) if len(arr) > 1 else 0.0
            z = norm.ppf(1 - confidence)  # negative for left tail
            var = -(mean + z * std)       # convert loss to positive number
        else:
            # Fallback: t-distribution-less, normal approximate via percentile
            sorted_r = sorted(returns)
            var = -_percentile(sorted_r, pct)
            method = "parametric (no-scipy fallback)"
    else:
        sorted_r = sorted(returns)
        var = -_percentile(sorted_r, pct)
    if var < 0:
        # VaR can be negative if returns are mostly positive (no loss expected)
        # but we still report it as a positive number per convention.
        var = abs(var)
    return {
        "var_value": round(var, 6),
        "var_pct": round(var * 100, 4),
        "confidence": confidence,
        "method": method,
        "samples": len(returns),
    }


def calculate_cvar(returns: Sequence[float],
                   confidence: float = 0.95) -> dict[str, Any]:
    """Compute Conditional VaR (Expected Shortfall).

    CVaR is the **average loss** of all returns that fall below the VaR
    threshold at the given confidence level.
    """
    if not returns or len(returns) < 2:
        return {"cvar_value": 0.0, "confidence": confidence,
                "samples": len(returns)}
    if not 0 < confidence < 1:
        raise ValueError("confidence must be in (0, 1)")
    pct = (1 - confidence) * 100
    sorted_r = sorted(returns)
    var = -_percentile(sorted_r, pct)
    # Tail = returns <= -VaR (i.e. worse than or equal to VaR loss)
    tail = [r for r in sorted_r if r <= -var]
    if not tail:
        # No observations worse than VaR - CVaR equals VaR
        cvar = var
    else:
        cvar = -sum(tail) / len(tail)
    if cvar < 0:
        cvar = abs(cvar)
    return {
        "cvar_value": round(cvar, 6),
        "cvar_pct": round(cvar * 100, 4),
        "confidence": confidence,
        "samples": len(returns),
        "tail_observations": len(tail),
    }


def calculate_portfolio_var(positions: Sequence[dict[str, Any]],
                            correlation_matrix: list[list[float]] | None,
                            confidence: float = 0.95) -> dict[str, Any]:
    """Multi-asset parametric VaR using a correlation matrix.

    ``positions`` is a list of ``{"symbol": str, "weight": float,
    "volatility": float}`` where weight is the fraction of capital allocated
    and volatility is the asset's return volatility (e.g. daily std-dev).

    Returns ``{var_value, confidence, method}``.
    """
    if not positions:
        return {"var_value": 0.0, "confidence": confidence,
                "method": "portfolio_parametric", "positions": 0}
    weights = [float(p.get("weight", 0.0)) for p in positions]
    vols = [float(p.get("volatility", 0.0)) for p in positions]
    n = len(positions)
    if correlation_matrix is None:
        # Assume zero correlation - conservative diagonal
        corr = [[0.0] * n for _ in range(n)]
        for i in range(n):
            corr[i][i] = 1.0
    else:
        corr = correlation_matrix
    if _SCIPY_AVAILABLE:
        import numpy as _np
        W = _np.array(weights)
        V = _np.array(vols)
        C = _np.array(corr)
        # Portfolio variance = sum_ij w_i * v_i * w_j * v_j * C_ij
        portfolio_var = float(W @ V @ C @ V @ W)
        portfolio_vol = math.sqrt(max(0.0, portfolio_var))
        z = norm.ppf(1 - confidence)
        var = abs(z) * portfolio_vol
    else:
        # Hand-rolled
        portfolio_var = 0.0
        for i in range(n):
            for j in range(n):
                portfolio_var += (weights[i] * vols[i] *
                                  weights[j] * vols[j] * corr[i][j])
        portfolio_vol = math.sqrt(max(0.0, portfolio_var))
        # Approx z for common confidences
        z_map = {0.90: 1.282, 0.95: 1.645, 0.99: 2.326}
        z = z_map.get(confidence, 1.645)
        var = z * portfolio_vol
    return {
        "var_value": round(var, 6),
        "var_pct": round(var * 100, 4),
        "confidence": confidence,
        "method": "portfolio_parametric",
        "positions": n,
        "portfolio_volatility": round(portfolio_vol, 6),
    }


def get_returns_from_trades(trades: Sequence[dict[str, Any]]
                            ) -> list[float]:
    """Extract per-trade returns as fractions of risk.

    Uses the trade's R-multiple (``rr_net`` field) when available so that
    returns reflect risk-adjusted P&L.  Falls back to ``profit / balance``
    using a nominal 1% risk reference if ``rr_net`` is missing.
    """
    out: list[float] = []
    for t in trades:
        raw = t.get("rr_net")
        if raw is None:
            continue
        try:
            r = float(raw)
        except (TypeError, ValueError):
            continue
        # Convert R-multiple to fraction-of-balance using 1% risk per trade
        out.append(r * 0.01)
    return out


# --------------------------------------------------------------------------- #
# BACKEND-100 #5: volatility surface
# --------------------------------------------------------------------------- #

def realized_volatility(returns: Sequence[float],
                        window: int = 20,
                        annualize: bool = True,
                        periods_per_year: int = 252) -> float:
    """Compute the realized volatility of a return series.

    Parameters
    ----------
    returns : sequence of float
        Period returns as fractions (e.g. 0.0012 = 0.12%).
    window : int
        Trailing window over which to compute the standard deviation.
        The most recent ``window`` observations are used.
    annualize : bool
        If True, scale the per-period std-dev by ``sqrt(periods_per_year)``
        to annualise.
    periods_per_year : int
        Annualisation factor (252 for daily, 252*6*24 for hourly, ...).

    Returns
    -------
    float
        Realized volatility as a fraction (e.g. 0.15 = 15%).  Returns 0.0
        if the series is too short.
    """
    if not returns or len(returns) < 2 or window < 2:
        return 0.0
    r = list(returns[-window:]) if len(returns) >= window else list(returns)
    if len(r) < 2:
        return 0.0
    mean = sum(r) / len(r)
    var = sum((x - mean) ** 2 for x in r) / (len(r) - 1)
    sd = math.sqrt(var)
    if annualize:
        sd *= math.sqrt(periods_per_year)
    return sd


def volatility_surface(candles: Sequence[dict[str, Any]],
                       tenors: Sequence[int] = (1, 5, 10, 20, 60),
                       price_key: str = "close"
                       ) -> list[dict[str, Any]]:
    """Build a volatility surface across multiple lookback tenors.

    Parameters
    ----------
    candles : sequence of dict
        OHLCV candles (or dicts with a ``close`` key), oldest first.
        May also be :class:`indicators.Candle` instances.
    tenors : sequence of int
        Lookback windows in candles (e.g. 1, 5, 10, 20, 60).
    price_key : str
        Dict key for the close price (ignored if candles are Candle objects).

    Returns
    -------
    list of dict
        ``[{tenor_days, vol_pct, samples}]`` per tenor, in the order of
        ``tenors``.  Tenors with insufficient data return ``vol_pct=0``.
    """
    closes: list[float] = []
    for c in candles:
        if hasattr(c, "close"):
            closes.append(float(getattr(c, "close")))
        elif isinstance(c, dict):
            closes.append(float(c.get(price_key, 0.0)))
        else:
            try:
                closes.append(float(c))
            except Exception:
                continue
    if len(closes) < 2:
        return [{"tenor_days": int(t), "vol_pct": 0.0, "samples": 0}
                for t in tenors]
    # Compute log returns: r_t = ln(P_t / P_{t-1}).
    returns: list[float] = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0 and closes[i] > 0:
            returns.append(math.log(closes[i] / closes[i - 1]))
    out: list[dict[str, Any]] = []
    for t in tenors:
        # For each tenor, we treat "1 candle = 1 day" for annualisation.
        # Caller may convert to the actual timeframe by re-computing
        # periods_per_year if needed.
        window = max(2, int(t))
        rv = realized_volatility(returns, window=window,
                                 annualize=True, periods_per_year=252)
        out.append({
            "tenor_days": int(t),
            "vol_pct": round(rv * 100.0, 4),
            "samples": min(window, len(returns)),
        })
    return out


# --------------------------------------------------------------------------- #
# BACKEND-100 #6: dynamic correlation matrix (rolling Pearson)
# --------------------------------------------------------------------------- #

def _pearson(x: list[float], y: list[float]) -> float:
    """Pearson correlation between two equal-length series."""
    n = min(len(x), len(y))
    if n < 2:
        return 0.0
    xs = x[-n:]
    ys = y[-n:]
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    dx = math.sqrt(sum((v - mx) ** 2 for v in xs))
    dy = math.sqrt(sum((v - my) ** 2 for v in ys))
    if dx == 0 or dy == 0:
        return 0.0
    return num / (dx * dy)


def rolling_correlation(returns_a: Sequence[float],
                        returns_b: Sequence[float],
                        window: int = 30) -> list[float]:
    """Compute the rolling Pearson correlation between two return series.

    Parameters
    ----------
    returns_a, returns_b : sequence of float
        Equal-length return series (oldest first).
    window : int
        Rolling window size.

    Returns
    -------
    list[float]
        One correlation per window position; the first ``window-1`` entries
        are 0.0 (insufficient data).  Length = ``len(returns_a)``.
    """
    a = list(returns_a)
    b = list(returns_b)
    n = min(len(a), len(b))
    if n < window or window < 2:
        return [0.0] * max(n, 0)
    out: list[float] = [0.0] * n
    for i in range(window - 1, n):
        window_a = a[i - window + 1: i + 1]
        window_b = b[i - window + 1: i + 1]
        out[i] = round(_pearson(window_a, window_b), 4)
    return out


def correlation_matrix(pairs_returns: dict[str, Sequence[float]],
                       window: int = 30) -> dict[str, Any]:
    """Build a rolling correlation matrix across multiple return series.

    Parameters
    ----------
    pairs_returns : dict[str, sequence of float]
        Mapping of pair name -> return series.  All series should be the
        same length (the function truncates to the shortest).
    window : int
        Rolling window for the correlation.

    Returns
    -------
    dict
        ``{"pairs": [...], "window": window, "matrix": {pair_a:
        {pair_b: corr}}, "latest": {pair_a: {pair_b: corr}}}``
        where ``latest`` is the correlation over the most recent
        ``window`` observations.
    """
    pairs = list(pairs_returns.keys())
    if not pairs:
        return {"pairs": [], "window": window, "matrix": {}, "latest": {}}
    # Truncate to equal length.
    min_len = min(len(pairs_returns[p]) for p in pairs)
    series = {p: list(pairs_returns[p])[-min_len:] for p in pairs}
    # Build full per-window matrix.
    matrix: dict[str, dict[str, list[float]]] = {
        p1: {p2: [] for p2 in pairs} for p1 in pairs
    }
    for p1 in pairs:
        for p2 in pairs:
            if p1 == p2:
                matrix[p1][p2] = [1.0] * max(0, min_len - window + 1)
            else:
                matrix[p1][p2] = rolling_correlation(
                    series[p1], series[p2], window=window)
    # Latest = last entry of each rolling series.
    latest: dict[str, dict[str, float]] = {
        p1: {} for p1 in pairs
    }
    for p1 in pairs:
        for p2 in pairs:
            row = matrix[p1][p2]
            latest[p1][p2] = row[-1] if row else 0.0
    # Trim matrix to the last 20 windows to keep payload small.
    trimmed: dict[str, dict[str, list[float]]] = {
        p1: {p2: matrix[p1][p2][-20:] for p2 in pairs} for p1 in pairs
    }
    return {
        "pairs": pairs,
        "window": window,
        "samples": min_len,
        "matrix": trimmed,
        "latest": latest,
    }


__all__ = [
    "calculate_var", "calculate_cvar", "calculate_portfolio_var",
    "get_returns_from_trades",
    # BACKEND-100 Sprint 9
    "realized_volatility", "volatility_surface",
    "rolling_correlation", "correlation_matrix",
]
