"""
indicators.py
=============
Pure-Python implementations of every technical indicator required by the V2
scalping strategy.  No external TA library is used so that the math is fully
auditable and behaves identically on Windows and Linux.

Implemented:
    * EMA  (ema, ema_series)
    * VWAP (vwap) - intraday / daily reset aware
    * ATR  (atr) - Wilder's smoothing
    * ADX  (adx) - ADX, +DI, -DI
    * Bollinger Bands
    * RSI  (Wilder)
    * swing_high_low
    * candle_pattern_detection - engulfing, pin bar, inside bar

All functions accept either plain Python lists of floats or pandas Series.
They return floats (latest value) or lists (full series) where indicated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

Number = float

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _to_list(values: Sequence[Number] | Sequence[float]) -> list[float]:
    """Coerce a sequence to a list of floats, validating contents."""
    out: list[float] = []
    for v in values:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            out.append(float("nan"))
        else:
            out.append(float(v))
    return out


def _is_finite(x: float) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


# --------------------------------------------------------------------------- #
# EMA
# --------------------------------------------------------------------------- #

def ema(values: Sequence[Number], period: int) -> float:
    """Return the latest EMA value for the given series.

    Uses the standard multiplier ``k = 2 / (period + 1)``.  The first
    ``period`` samples seed the EMA with a simple moving average.

    Parameters
    ----------
    values : sequence of float
        Close (or any) prices, oldest first.
    period : int
        EMA period (e.g. 9 or 21).

    Returns
    -------
    float
        Latest EMA value, or ``nan`` if insufficient data.
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    vals = _to_list(values)
    n = len(vals)
    if n < period:
        return float("nan")
    # Seed with SMA of first `period` values
    seed = sum(vals[:period]) / period
    k = 2.0 / (period + 1)
    ema_prev = seed
    for i in range(period, n):
        ema_prev = vals[i] * k + ema_prev * (1 - k)
    return ema_prev


def ema_series(values: Sequence[Number], period: int) -> list[float]:
    """Return the full EMA series aligned to ``values``.

    The first ``period - 1`` entries are ``nan`` (insufficient data).
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    vals = _to_list(values)
    n = len(vals)
    out = [float("nan")] * n
    if n < period:
        return out
    k = 2.0 / (period + 1)
    ema_prev = sum(vals[:period]) / period
    out[period - 1] = ema_prev
    for i in range(period, n):
        ema_prev = vals[i] * k + ema_prev * (1 - k)
        out[i] = ema_prev
    return out


# --------------------------------------------------------------------------- #
# VWAP - daily reset
# --------------------------------------------------------------------------- #

@dataclass
class Candle:
    """Minimal OHLCV candle representation used by indicators."""
    time: float
    open: float
    high: float
    low: float
    close: float
    volume: float
    day: str | None = None   # YYYY-MM-DD bucket, optional


def vwap(candles: Sequence[Candle]) -> float:
    """Compute the latest VWAP across the supplied candles.

    The caller is responsible for passing only candles belonging to the
    same trading day (the strategy resets VWAP daily).  If a ``day`` field
    is present on each candle, the function will only sum the most recent
    day bucket.

    VWAP = sum(typical_price * volume) / sum(volume)
    where typical_price = (high + low + close) / 3.

    Returns
    -------
    float
        Latest VWAP, or ``nan`` if no volume.
    """
    if not candles:
        return float("nan")
    # Determine the active day if available
    last_day = getattr(candles[-1], "day", None)
    bucket: list[Candle] = []
    if last_day:
        for c in reversed(candles):
            if getattr(c, "day", None) == last_day:
                bucket.append(c)
            else:
                break
        bucket.reverse()
    else:
        bucket = list(candles)

    pv = 0.0
    vol = 0.0
    for c in bucket:
        if c.volume <= 0:
            continue
        typical = (c.high + c.low + c.close) / 3.0
        pv += typical * c.volume
        vol += c.volume
    if vol <= 0:
        return float("nan")
    return pv / vol


def vwap_series(candles: Sequence[Candle]) -> list[float]:
    """Return the full VWAP series aligned to ``candles`` (daily reset)."""
    out: list[float] = []
    # Group by day
    cur_day: str | None = None
    pv = 0.0
    vol = 0.0
    for c in candles:
        day = getattr(c, "day", None)
        if day != cur_day:
            cur_day = day
            pv = 0.0
            vol = 0.0
        if c.volume > 0:
            typical = (c.high + c.low + c.close) / 3.0
            pv += typical * c.volume
            vol += c.volume
        out.append(pv / vol if vol > 0 else float("nan"))
    return out


# --------------------------------------------------------------------------- #
# ATR - Wilder's smoothing
# --------------------------------------------------------------------------- #

def atr(high: Sequence[Number],
        low: Sequence[Number],
        close: Sequence[Number],
        period: int = 14) -> float:
    """Compute the latest ATR using Wilder's smoothing.

    Parameters
    ----------
    high, low, close : sequence of float
        Same length, oldest first.
    period : int
        ATR period (default 14).

    Returns
    -------
    float
        Latest ATR, or ``nan`` if insufficient data.
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    h = _to_list(high)
    l = _to_list(low)
    c = _to_list(close)
    n = len(c)
    if n < period + 1:
        return float("nan")

    trs: list[float] = []
    for i in range(n):
        if i == 0:
            trs.append(h[i] - l[i])
        else:
            tr = max(
                h[i] - l[i],
                abs(h[i] - c[i - 1]),
                abs(l[i] - c[i - 1]),
            )
            trs.append(tr)

    # Seed = SMA of first `period` TRs (starting index 1)
    seed = sum(trs[1:period + 1]) / period
    atr_prev = seed
    for i in range(period + 1, n):
        atr_prev = (atr_prev * (period - 1) + trs[i]) / period
    return atr_prev


def atr_series(high: Sequence[Number],
               low: Sequence[Number],
               close: Sequence[Number],
               period: int = 14) -> list[float]:
    """Full ATR series (Wilder's smoothing) aligned to inputs."""
    if period < 1:
        raise ValueError("period must be >= 1")
    h = _to_list(high)
    l = _to_list(low)
    c = _to_list(close)
    n = len(c)
    out = [float("nan")] * n
    if n < period + 1:
        return out

    trs: list[float] = [h[0] - l[0]]
    for i in range(1, n):
        tr = max(
            h[i] - l[i],
            abs(h[i] - c[i - 1]),
            abs(l[i] - c[i - 1]),
        )
        trs.append(tr)

    seed = sum(trs[1:period + 1]) / period
    out[period] = seed
    atr_prev = seed
    for i in range(period + 1, n):
        atr_prev = (atr_prev * (period - 1) + trs[i]) / period
        out[i] = atr_prev
    return out


# --------------------------------------------------------------------------- #
# ADX (+DI / -DI)
# --------------------------------------------------------------------------- #

@dataclass
class ADXResult:
    """Result of an ADX computation."""
    adx: float
    plus_di: float
    minus_di: float


def adx(high: Sequence[Number],
        low: Sequence[Number],
        close: Sequence[Number],
        period: int = 14) -> ADXResult:
    """Compute latest ADX, +DI and -DI (Wilder's method).

    Returns an :class:`ADXResult` with ``nan`` values if there is
    insufficient data (need at least ``2 * period`` samples).
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    h = _to_list(high)
    l = _to_list(low)
    c = _to_list(close)
    n = len(c)
    nan_res = ADXResult(float("nan"), float("nan"), float("nan"))
    if n < 2 * period:
        return nan_res

    # True range, +DM, -DM
    tr = [h[0] - l[0]]
    plus_dm = [0.0]
    minus_dm = [0.0]
    for i in range(1, n):
        up = h[i] - h[i - 1]
        down = l[i - 1] - l[i]
        plus_dm.append(up if (up > down and up > 0) else 0.0)
        minus_dm.append(down if (down > up and down > 0) else 0.0)
        tr.append(max(
            h[i] - l[i],
            abs(h[i] - c[i - 1]),
            abs(l[i] - c[i - 1]),
        ))

    # Wilder smoothing of TR, +DM, -DM
    def smooth(arr: list[float]) -> list[float]:
        out = [float("nan")] * len(arr)
        if len(arr) <= period:
            return out
        s = sum(arr[1:period + 1])
        out[period] = s
        for i in range(period + 1, len(arr)):
            s = s - s / period + arr[i]
            out[i] = s
        return out

    tr_s = smooth(tr)
    pdm_s = smooth(plus_dm)
    mdm_s = smooth(minus_dm)

    # +DI / -DI series
    plus_di = [float("nan")] * n
    minus_di = [float("nan")] * n
    dx = [float("nan")] * n
    for i in range(period, n):
        if tr_s[i] and tr_s[i] > 0:
            plus_di[i] = 100.0 * pdm_s[i] / tr_s[i]
            minus_di[i] = 100.0 * mdm_s[i] / tr_s[i]
            di_sum = plus_di[i] + minus_di[i]
            if di_sum > 0:
                dx[i] = 100.0 * abs(plus_di[i] - minus_di[i]) / di_sum

    # ADX = Wilder smoothing of DX over `period`
    # Find the first valid DX window
    dx_vals: list[float] = []
    start_idx = -1
    for i in range(period, n):
        if _is_finite(dx[i]):
            if start_idx == -1:
                start_idx = i
            dx_vals.append(dx[i])

    if len(dx_vals) < period:
        return nan_res

    adx_seed = sum(dx_vals[:period]) / period
    adx_val = adx_seed
    for i in range(period, len(dx_vals)):
        adx_val = (adx_val * (period - 1) + dx_vals[i]) / period

    return ADXResult(
        adx=adx_val,
        plus_di=plus_di[-1] if _is_finite(plus_di[-1]) else float("nan"),
        minus_di=minus_di[-1] if _is_finite(minus_di[-1]) else float("nan"),
    )


# --------------------------------------------------------------------------- #
# Bollinger Bands
# --------------------------------------------------------------------------- #

@dataclass
class BollingerResult:
    upper: float
    middle: float
    lower: float


def bollinger_bands(close: Sequence[Number],
                    period: int = 20,
                    std: float = 2.0) -> BollingerResult:
    """Return the latest Bollinger Bands (upper, middle, lower)."""
    if period < 2:
        raise ValueError("period must be >= 2")
    c = _to_list(close)
    n = len(c)
    if n < period:
        return BollingerResult(float("nan"), float("nan"), float("nan"))
    window = c[-period:]
    mean = sum(window) / period
    var = sum((x - mean) ** 2 for x in window) / period
    sd = math.sqrt(var)
    return BollingerResult(
        upper=mean + std * sd,
        middle=mean,
        lower=mean - std * sd,
    )


# --------------------------------------------------------------------------- #
# RSI - Wilder
# --------------------------------------------------------------------------- #

def rsi(close: Sequence[Number], period: int = 14) -> float:
    """Return the latest RSI value (Wilder's smoothing)."""
    if period < 1:
        raise ValueError("period must be >= 1")
    c = _to_list(close)
    n = len(c)
    if n < period + 1:
        return float("nan")
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        diff = c[i] - c[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, n):
        diff = c[i] - c[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def rsi_series(close: Sequence[Number], period: int = 14) -> list[float]:
    """Full RSI series aligned to ``close``."""
    if period < 1:
        raise ValueError("period must be >= 1")
    c = _to_list(close)
    n = len(c)
    out = [float("nan")] * n
    if n < period + 1:
        return out
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        diff = c[i] - c[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        out[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        out[period] = 100.0 - (100.0 / (1.0 + rs))
    for i in range(period + 1, n):
        diff = c[i] - c[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - (100.0 / (1.0 + rs))
    return out


# --------------------------------------------------------------------------- #
# Swing High / Low
# --------------------------------------------------------------------------- #

@dataclass
class SwingLevels:
    high: float
    low: float
    high_idx: int
    low_idx: int


def swing_high_low(candles: Sequence[Candle], lookback: int = 20) -> SwingLevels:
    """Find the highest high and lowest low over the last ``lookback`` candles.

    Returns ``nan`` levels if the input is empty.
    """
    if not candles:
        return SwingLevels(float("nan"), float("nan"), -1, -1)
    window = list(candles[-lookback:]) if len(candles) >= lookback else list(candles)
    hi = window[0].high
    lo = window[0].low
    hi_idx = 0
    lo_idx = 0
    for i, c in enumerate(window):
        if c.high > hi:
            hi = c.high
            hi_idx = i
        if c.low < lo:
            lo = c.low
            lo_idx = i
    base = len(candles) - len(window)
    return SwingLevels(
        high=hi,
        low=lo,
        high_idx=base + hi_idx,
        low_idx=base + lo_idx,
    )


# --------------------------------------------------------------------------- #
# Candle pattern detection
# --------------------------------------------------------------------------- #

@dataclass
class CandlePattern:
    """Result of candlestick pattern detection."""
    name: str               # "bullish_engulfing" | "bearish_engulfing"
                            # | "bullish_pin_bar" | "bearish_pin_bar"
                            # | "inside_bar" | "none"
    confidence: float       # 0.0 - 1.0
    index: int              # index of the pattern candle (last)


def _body(c: Candle) -> float:
    return abs(c.close - c.open)


def _range(c: Candle) -> float:
    return c.high - c.low if c.high > c.low else 0.0


def _upper_wick(c: Candle) -> float:
    return c.high - max(c.open, c.close)


def _lower_wick(c: Candle) -> float:
    return min(c.open, c.close) - c.low


def candle_pattern_detection(candles: Sequence[Candle]) -> CandlePattern:
    """Detect a candlestick pattern in the last 2-3 candles.

    Recognised patterns:
        * bullish_engulfing
        * bearish_engulfing
        * bullish_pin_bar   (hammer-like, lower wick >= 2x body)
        * bearish_pin_bar   (shooting-star-like, upper wick >= 2x body)
        * inside_bar        (last candle fully inside previous range)

    Returns
    -------
    CandlePattern
        ``name="none"`` if no recognised pattern is found.
    """
    n = len(candles)
    if n < 2:
        return CandlePattern(name="none", confidence=0.0, index=max(0, n - 1))

    prev = candles[-2]
    cur = candles[-1]
    idx = n - 1
    body_prev = _body(prev)
    body_cur = _body(cur)
    rng_cur = _range(cur)
    rng_prev = _range(prev)

    # ---- Engulfing ----
    if (prev.close < prev.open and cur.close > cur.open   # prev red, cur green
            and body_cur > body_prev
            and cur.close >= prev.open
            and cur.open <= prev.close):
        return CandlePattern(
            name="bullish_engulfing",
            confidence=min(1.0, body_cur / (body_prev + 1e-9) / 3.0),
            index=idx,
        )
    if (prev.close > prev.open and cur.close < cur.open   # prev green, cur red
            and body_cur > body_prev
            and cur.open >= prev.close
            and cur.close <= prev.open):
        return CandlePattern(
            name="bearish_engulfing",
            confidence=min(1.0, body_cur / (body_prev + 1e-9) / 3.0),
            index=idx,
        )

    # ---- Pin bar ----
    if rng_cur > 0 and body_cur > 0:
        lower = _lower_wick(cur)
        upper = _upper_wick(cur)
        if lower >= 2.0 * body_cur and cur.close > cur.open:
            conf = min(1.0, lower / rng_cur)
            return CandlePattern(name="bullish_pin_bar", confidence=conf, index=idx)
        if upper >= 2.0 * body_cur and cur.close < cur.open:
            conf = min(1.0, upper / rng_cur)
            return CandlePattern(name="bearish_pin_bar", confidence=conf, index=idx)

    # ---- Inside bar ----
    if (cur.high <= prev.high and cur.low >= prev.low and rng_prev > 0):
        conf = 1.0 - (rng_cur / rng_prev) if rng_prev > 0 else 0.0
        return CandlePattern(name="inside_bar", confidence=max(0.0, conf), index=idx)

    return CandlePattern(name="none", confidence=0.0, index=idx)


# --------------------------------------------------------------------------- #
# BACKEND-100 #2: Volume profile (POC / VAH / VAL)
# --------------------------------------------------------------------------- #

@dataclass
class VolumeProfile:
    """Result of a volume-profile computation.

    * ``poc_price``  - Point of Control: the price level with the highest
      traded volume over the lookback window.
    * ``vah``        - Value Area High: the upper price containing 70% of
      the total volume (above + at POC).
    * ``val``        - Value Area Low: the lower price containing 70% of
      the total volume (below + at POC).
    * ``bins``       - number of price bins used to histogram volume.
    * ``histogram``  - list of ``(price, volume)`` tuples sorted ascending
      by price.
    """
    poc_price: float
    vah: float
    val: float
    bins: int
    histogram: list[tuple[float, float]]


def volume_profile(candles: Sequence[Candle],
                   lookback: int = 70,
                   bins: int = 50) -> VolumeProfile:
    """Compute the volume profile (POC / VAH / VAL) over the lookback.

    The function bins each candle's traded volume by its typical price
    ``(high + low + close) / 3`` and finds the price level with the highest
    total volume (POC).  The "value area" is the price range around POC
    containing 70% of total volume - VAH is the upper bound, VAL the lower.

    Parameters
    ----------
    candles : sequence of :class:`Candle`
        OHLCV candles, oldest first.
    lookback : int
        Number of most-recent candles to consider (default 70).
    bins : int
        Number of price bins to use for the histogram (default 50).

    Returns
    -------
    VolumeProfile
        With ``nan`` POC/VAH/VAL when the input is empty or has zero volume.
    """
    if not candles:
        return VolumeProfile(float("nan"), float("nan"), float("nan"),
                             0, [])
    window = list(candles[-lookback:]) if len(candles) >= lookback \
        else list(candles)
    # Build (price, volume) samples keyed on typical price.
    samples: list[tuple[float, float]] = []
    for c in window:
        if c.volume <= 0:
            continue
        typical = (c.high + c.low + c.close) / 3.0
        samples.append((typical, float(c.volume)))
    if not samples:
        return VolumeProfile(float("nan"), float("nan"), float("nan"),
                             0, [])
    prices = [p for p, _ in samples]
    p_lo = min(prices)
    p_hi = max(prices)
    if p_hi <= p_lo:
        # All trades at one price -> POC == VAH == VAL == that price.
        total_vol = sum(v for _, v in samples)
        return VolumeProfile(p_lo, p_lo, p_lo, 1, [(p_lo, total_vol)])
    n_bins = max(1, int(bins))
    bin_width = (p_hi - p_lo) / n_bins
    # Bucket volume into bins.
    bin_vol: list[float] = [0.0] * n_bins
    for price, vol in samples:
        idx = int((price - p_lo) / bin_width)
        if idx >= n_bins:
            idx = n_bins - 1
        bin_vol[idx] += vol
    # POC = bin with highest volume
    poc_idx = max(range(n_bins), key=lambda i: bin_vol[i])
    poc_price = p_lo + (poc_idx + 0.5) * bin_width
    total_vol = sum(bin_vol)
    target = 0.70 * total_vol
    # Walk outward from POC, accumulating volume, until we have 70%.
    accumulated = bin_vol[poc_idx]
    vah_idx = poc_idx
    val_idx = poc_idx
    while accumulated < target and (val_idx > 0 or vah_idx < n_bins - 1):
        # Expand to whichever side has more volume next.
        below = bin_vol[val_idx - 1] if val_idx > 0 else 0.0
        above = bin_vol[vah_idx + 1] if vah_idx < n_bins - 1 else 0.0
        if below >= above and val_idx > 0:
            val_idx -= 1
            accumulated += below
        elif vah_idx < n_bins - 1:
            vah_idx += 1
            accumulated += above
        else:
            val_idx -= 1
            accumulated += below
    vah = p_lo + (vah_idx + 1) * bin_width
    val = p_lo + val_idx * bin_width
    histogram = [(p_lo + (i + 0.5) * bin_width, bin_vol[i])
                 for i in range(n_bins)]
    return VolumeProfile(
        poc_price=round(poc_price, 8),
        vah=round(vah, 8),
        val=round(val, 8),
        bins=n_bins,
        histogram=histogram,
    )


__all__ = [
    "Candle", "CandlePattern", "SwingLevels", "ADXResult", "BollingerResult",
    "ema", "ema_series",
    "vwap", "vwap_series",
    "atr", "atr_series",
    "adx",
    "bollinger_bands",
    "rsi", "rsi_series",
    "swing_high_low",
    "candle_pattern_detection",
    # BACKEND-100 #2
    "volume_profile", "VolumeProfile",
]
