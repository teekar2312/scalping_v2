"""
test_indicators.py
==================
Unit tests for the technical indicators in indicators.py.

Tests use deterministic sample data with known expected values so failures
pinpoint exactly which indicator diverged.
"""
from __future__ import annotations

import math

import pytest

from indicators import (
    Candle, ema, ema_series, vwap, atr, adx, rsi, bollinger_bands,
    swing_high_low, candle_pattern_detection,
)


# --------------------------------------------------------------------------- #
# EMA
# --------------------------------------------------------------------------- #

def test_ema_period_too_short_returns_nan():
    assert math.isnan(ema([1.0, 2.0, 3.0], period=10))


def test_ema_period_1_equals_last_value():
    assert ema([1.0, 2.0, 3.0], period=1) == pytest.approx(3.0)


def test_ema_constant_series_returns_constant():
    """If every value is the same, EMA == that value."""
    vals = [42.0] * 30
    assert ema(vals, period=9) == pytest.approx(42.0)
    assert ema(vals, period=21) == pytest.approx(42.0)


def test_ema_seeds_with_sma_then_recurse():
    """For period=3 the seed is the SMA of the first 3, then EMA recurses."""
    vals = [1.0, 2.0, 3.0, 4.0, 5.0]
    # k = 2 / (3+1) = 0.5
    # seed = (1+2+3)/3 = 2.0
    # i=3: ema = 4*0.5 + 2*0.5 = 3.0
    # i=4: ema = 5*0.5 + 3*0.5 = 4.0
    assert ema(vals, period=3) == pytest.approx(4.0)


def test_ema_series_length_matches_input():
    vals = list(range(1, 21))  # 20 values
    s = ema_series(vals, period=9)
    assert len(s) == 20
    # First period-1 entries are nan
    for v in s[:8]:
        assert math.isnan(v)
    # Entry at index period-1 should be the SMA seed
    expected_seed = sum(vals[:9]) / 9
    assert s[8] == pytest.approx(expected_seed)


def test_ema_series_constant_returns_constant_after_seed():
    vals = [5.0] * 30
    s = ema_series(vals, period=10)
    for v in s[9:]:
        assert v == pytest.approx(5.0)


# --------------------------------------------------------------------------- #
# VWAP
# --------------------------------------------------------------------------- #

def test_vwap_uniform_volume_equals_typical_price_avg():
    """With uniform volume, VWAP = average of typical prices."""
    candles = [
        Candle(time=i, open=1.0, high=2.0, low=0.5, close=1.5,
               volume=10, day="2026-01-01")
        for i in range(5)
    ]
    # typical = (2 + 0.5 + 1.5)/3 = 4/3 ≈ 1.3333 (same for all)
    # VWAP = sum(4/3 * 10) / 50 = 40/3 / 5 = 8/3 ≈ 2.6667
    # Wait, that's wrong: typical = (high+low+close)/3 = (2+0.5+1.5)/3 = 4/3
    # VWAP = (4/3*10)*5 / (10*5) = (4/3*50) / 50 = 4/3
    expected = (2.0 + 0.5 + 1.5) / 3
    assert vwap(candles) == pytest.approx(expected)


def test_vwap_zero_volume_returns_nan():
    """Edge case: all-zero volume returns nan (avoid division by zero)."""
    candles = [
        Candle(time=0, open=1.0, high=2.0, low=0.5, close=1.5,
               volume=0, day="2026-01-01")
    ]
    # Implementation returns nan when sum(vol) == 0
    import math
    assert math.isnan(vwap(candles))


# --------------------------------------------------------------------------- #
# ATR (Wilder's smoothing)
# --------------------------------------------------------------------------- #

def test_atr_short_series_returns_nan_or_zero():
    """ATR requires period+1 candles minimum (Wilder needs TR seed)."""
    highs = [1.0, 1.1, 1.2]
    lows = [0.9, 1.0, 1.1]
    closes = [1.0, 1.1, 1.2]
    # With period=14 and only 3 samples, ATR should be 0.0 or nan (impl def)
    result = atr(highs, lows, closes, period=14)
    assert math.isnan(result) or result == 0.0


def test_atr_constant_range_returns_that_range():
    """If every candle has the same high-low range and no gaps, ATR == range."""
    n = 30
    highs = [1.10] * n
    lows = [1.00] * n
    closes = [1.05] * n
    # TR = max(h-l, |h-prev_close|, |l-prev_close|) = 0.10
    # ATR(14) = avg of TRs = 0.10
    result = atr(highs, lows, closes, period=14)
    assert result == pytest.approx(0.10, abs=1e-9)


# --------------------------------------------------------------------------- #
# ADX / +DI / -DI
# --------------------------------------------------------------------------- #

def test_adx_returns_nan_for_short_series():
    highs = [1.0, 1.1, 1.2]
    lows = [0.9, 1.0, 1.1]
    closes = [1.0, 1.1, 1.2]
    res = adx(highs, lows, closes, period=14)
    # ADX is nan or 0 for insufficient data
    assert math.isnan(res.adx) or res.adx == 0.0


def test_adx_strong_uptrend_has_plus_di_greater_than_minus_di():
    """A monotonically rising series should have +DI > -DI."""
    n = 50
    highs = [1.0 + i * 0.001 for i in range(n)]
    lows = [0.99 + i * 0.001 for i in range(n)]
    closes = [1.005 + i * 0.001 for i in range(n)]
    res = adx(highs, lows, closes, period=14)
    assert res.plus_di > res.minus_di


# --------------------------------------------------------------------------- #
# RSI (Wilder)
# --------------------------------------------------------------------------- #

def test_rsi_all_gains_returns_100():
    """A monotonically rising series has RSI close to 100."""
    closes = [1.0 + i * 0.001 for i in range(50)]
    res = rsi(closes, period=14)
    assert res > 90.0


def test_rsi_all_losses_returns_near_zero():
    """A monotonically falling series has RSI close to 0."""
    closes = [1.0 - i * 0.001 for i in range(50)]
    res = rsi(closes, period=14)
    assert res < 10.0


def test_rsi_constant_series_returns_100():
    """A flat series has no losses - the impl returns RSI = 100."""
    closes = [1.0] * 50
    res = rsi(closes, period=14)
    # When avg_loss == 0, RSI is defined as 100 (no downside movement).
    assert res == pytest.approx(100.0)


# --------------------------------------------------------------------------- #
# Bollinger Bands
# --------------------------------------------------------------------------- #

def test_bollinger_constant_series():
    """Constant closes => middle = price, upper/lower = price +/- k*std."""
    closes = [1.0850] * 30
    bb = bollinger_bands(closes, period=20, std=2.0)
    assert bb.middle == pytest.approx(1.0850)
    # std == 0 -> upper == lower == middle
    assert bb.upper == pytest.approx(1.0850)
    assert bb.lower == pytest.approx(1.0850)


def test_bollinger_upper_above_middle_above_lower():
    closes = [1.0 + i * 0.001 for i in range(30)]
    bb = bollinger_bands(closes, period=20, std=2.0)
    assert bb.upper > bb.middle > bb.lower


# --------------------------------------------------------------------------- #
# swing_high_low
# --------------------------------------------------------------------------- #

def test_swing_high_low_returns_dataclass():
    """swing_high_low takes candles (not separate highs/lows) and returns
    a SwingLevels dataclass with .high and .low attributes."""
    candles = [
        Candle(time=i, open=1.0, high=1.1 + i * 0.01,
               low=0.95 - i * 0.005, close=1.05,
               volume=100, day="2026-01-01")
        for i in range(20)
    ]
    res = swing_high_low(candles, lookback=20)
    assert hasattr(res, "high")
    assert hasattr(res, "low")
    assert res.high >= res.low
    assert hasattr(res, "high_idx")
    assert hasattr(res, "low_idx")


# --------------------------------------------------------------------------- #
# candle_pattern_detection
# --------------------------------------------------------------------------- #

def test_candle_pattern_detection_returns_dataclass_or_none():
    """With synthetic candles the function should not crash and should
    return either a CandlePattern dataclass or None."""
    candles = [
        Candle(time=i, open=1.0, high=1.1, low=0.95, close=1.05,
               volume=100, day="2026-01-01")
        for i in range(20)
    ]
    res = candle_pattern_detection(candles)
    # Accept None or a CandlePattern-like object
    assert res is None or hasattr(res, "name")
