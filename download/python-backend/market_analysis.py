"""
market_analysis.py
==================
Cross-pair market analysis utilities (BACKEND-100 Sprint 9, feature #3).

Currently provides:

    * ``currency_strength(pairs_data)``  - rank the 8 FX majors (USD, EUR,
      GBP, JPY, CHF, AUD, CAD, NZD) by their relative % change today,
      decomposed from the supplied pair candles.

Algorithm
---------
Given a dict of ``{pair_symbol: Candle}`` for the *latest* candle of each
pair (e.g. ``{"EURUSD": <latest candle>, "GBPUSD": ..., ...}``), the
function:

  1. Computes the % change of each pair from the candle's open to close
     (normalised, signed).
  2. Builds a sparse linear system: for each pair ``AB``, the % change
     equals ``strength[A] - strength[B]`` (a common FX strength-meter
     formulation).  This is solved as a least-squares problem with the
     constraint ``sum(strength) == 0`` (so the values are relative, not
     absolute).
  3. Z-scores the strengths so the strongest currency gets +N and the
     weakest -N.
  4. Returns a ranked list of ``{currency, strength, rank, change_pct}``.

The implementation uses only :mod:`numpy` if available, with a pure-Python
fallback so the module is importable even without numpy installed.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any, Sequence

from indicators import Candle

logger = logging.getLogger(__name__)

try:
    import numpy as _np
    _NP_AVAILABLE = True
except ImportError:  # pragma: no cover
    _NP_AVAILABLE = False
    _np = None  # type: ignore


# The 8 FX majors that the strength meter ranks.
MAJOR_CURRENCIES: tuple[str, ...] = (
    "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD",
)


@dataclass
class CurrencyStrength:
    """One row of the currency-strength ranking."""
    currency: str
    strength: float
    rank: int
    change_pct: float


def _pair_change_pct(c: Candle) -> float:
    """% change of a pair from its open to its close (signed)."""
    if not c or c.open <= 0:
        return 0.0
    return ((c.close - c.open) / c.open) * 100.0


def _split_pair(pair: str) -> tuple[str, str]:
    """Split ``"EURUSD"`` -> ``("EUR", "USD")``.

    Handles 6-char FX pairs and a few common edge cases (e.g. ``USDSGD``
    6-char, ``EURUSD`` 6-char).  Returns ``("", "")`` if the input isn't
    a 6-letter alphabetic code.
    """
    p = pair.upper().replace("/", "").strip()
    if len(p) != 6 or not p.isalpha():
        return ("", "")
    return (p[:3], p[3:])


def _least_squares_solve(A: list[list[float]],
                         b: list[float]) -> list[float]:
    """Tiny least-squares solver used when numpy isn't available.

    Solves the normal equations ``(A^T A) x = A^T b`` via Gaussian
    elimination.  Designed for small systems (<= 9 unknowns).
    """
    n = len(b)
    if n == 0 or len(A) != n:
        return []
    cols = len(A[0]) if A else 0
    # Build A^T A (cols x cols) and A^T b (cols).
    ata: list[list[float]] = [[0.0] * cols for _ in range(cols)]
    atb: list[float] = [0.0] * cols
    for r in range(n):
        for c1 in range(cols):
            atb[c1] += A[r][c1] * b[r]
            for c2 in range(cols):
                ata[c1][c2] += A[r][c1] * A[r][c2]
    # Add a tiny ridge for numerical stability / to make the system full rank.
    for i in range(cols):
        ata[i][i] += 1e-8
    # Gaussian elimination with partial pivoting.
    aug = [row[:] + [atb[i]] for i, row in enumerate(ata)]
    for col in range(cols):
        # Find pivot.
        pivot = max(range(col, cols), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            continue
        if pivot != col:
            aug[col], aug[pivot] = aug[pivot], aug[col]
        # Eliminate below.
        pivot_val = aug[col][col]
        for r in range(col + 1, cols):
            factor = aug[r][col] / pivot_val
            for c in range(col, cols + 1):
                aug[r][c] -= factor * aug[col][c]
    # Back-substitute.
    x = [0.0] * cols
    for c in range(cols - 1, -1, -1):
        s = aug[c][cols]
        for k in range(c + 1, cols):
            s -= aug[c][k] * x[k]
        x[c] = s / aug[c][c] if abs(aug[c][c]) > 1e-12 else 0.0
    return x


def currency_strength(pairs_data: dict[str, Candle | Any]
                      ) -> list[CurrencyStrength]:
    """Rank the 8 FX majors by relative % change today.

    Parameters
    ----------
    pairs_data : dict[str, Candle]
        Mapping of pair symbol -> latest candle (or any object with ``open``
        and ``close`` numeric attributes).  Pairs not in the standard
        6-letter FX form are skipped.

    Returns
    -------
    list[CurrencyStrength]
        Ranked strongest -> weakest.  Currencies that don't appear in any
        of the supplied pairs still appear in the output with strength=0
        and the lowest ranks.
    """
    # Collect observed currencies and their pair changes.
    seen_currencies: list[str] = []
    seen_set: set[str] = set()
    rows: list[tuple[str, str, float]] = []  # (base, quote, change_pct)
    for pair, candle in pairs_data.items():
        base, quote = _split_pair(pair)
        if not base or not quote:
            continue
        try:
            chg = _pair_change_pct(candle)
        except Exception as exc:  # pragma: no cover
            logger.debug("currency_strength: skipping %s (%s)", pair, exc)
            continue
        rows.append((base, quote, chg))
        for c in (base, quote):
            if c not in seen_set:
                seen_set.add(c)
                seen_currencies.append(c)

    if not rows:
        # No usable pairs - return all majors ranked equally at 0.
        return [CurrencyStrength(currency=c, strength=0.0, rank=i + 1,
                                 change_pct=0.0)
                for i, c in enumerate(MAJOR_CURRENCIES)]

    # Sort the seen currencies so column indices are deterministic.
    seen_currencies.sort()
    idx_map = {c: i for i, c in enumerate(seen_currencies)}
    n_cols = len(seen_currencies)
    # Build A (n_rows x n_cols) and b (n_rows).
    # For pair AB with change X: strength[A] - strength[B] = X.
    A: list[list[float]] = []
    b: list[float] = []
    for base, quote, chg in rows:
        row = [0.0] * n_cols
        row[idx_map[base]] = 1.0
        row[idx_map[quote]] = -1.0
        A.append(row)
        b.append(chg)

    if _NP_AVAILABLE:
        try:
            mat = _np.array(A, dtype=float)
            rhs = _np.array(b, dtype=float)
            # lstsq returns (solution, residuals, rank, singular_values).
            sol, *_ = _np.linalg.lstsq(mat, rhs, rcond=None)
            strengths = sol.tolist()
        except Exception as exc:  # pragma: no cover
            logger.debug("currency_strength: numpy lstsq failed: %s", exc)
            strengths = _least_squares_solve(A, b)
    else:
        strengths = _least_squares_solve(A, b)
    # Normalise so sum(strength) == 0 (relative, not absolute).
    if strengths:
        mean = sum(strengths) / len(strengths)
        strengths = [s - mean for s in strengths]
    # Z-score for nicer +/- scale.
    if strengths:
        mean_sq = sum(strengths) / len(strengths)
        var = sum((s - mean_sq) ** 2 for s in strengths) / len(strengths)
        sd = math.sqrt(var)
        if sd > 1e-9:
            strengths = [s / sd for s in strengths]
    # Build per-currency change_pct (average of all pairs containing it).
    change_per_ccy: dict[str, list[float]] = {c: [] for c in seen_currencies}
    for base, quote, chg in rows:
        change_per_ccy[base].append(chg)
        change_per_ccy[quote].append(-chg)  # quote change is inverse
    avg_change: dict[str, float] = {}
    for c, vals in change_per_ccy.items():
        avg_change[c] = (sum(vals) / len(vals)) if vals else 0.0

    # Build the result list, also including majors that didn't appear.
    out: list[CurrencyStrength] = []
    for c in seen_currencies:
        out.append(CurrencyStrength(
            currency=c,
            strength=round(strengths[idx_map[c]], 4)
            if strengths else 0.0,
            rank=0,
            change_pct=round(avg_change.get(c, 0.0), 4),
        ))
    # Append unseen majors at strength 0.
    for c in MAJOR_CURRENCIES:
        if c not in seen_set:
            out.append(CurrencyStrength(
                currency=c, strength=0.0, rank=0, change_pct=0.0,
            ))
    # Sort strongest -> weakest and assign ranks.
    out.sort(key=lambda r: r.strength, reverse=True)
    for i, row in enumerate(out):
        row.rank = i + 1
    return out


__all__ = [
    "MAJOR_CURRENCIES", "CurrencyStrength", "currency_strength",
]
