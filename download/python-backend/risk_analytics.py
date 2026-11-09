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
from __future__ import annotations

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


__all__ = [
    "calculate_var", "calculate_cvar", "calculate_portfolio_var",
    "get_returns_from_trades",
]
