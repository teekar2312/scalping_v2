"""
test_volume_profile.py
======================
Unit tests for ``indicators.volume_profile`` (BACKEND-100 #2).
"""
from __future__ import annotations

import math

import pytest

from indicators import Candle, volume_profile


def test_volume_profile_empty_returns_nan():
    vp = volume_profile([])
    assert math.isnan(vp.poc_price)
    assert math.isnan(vp.vah)
    assert math.isnan(vp.val)
    assert vp.bins == 0
    assert vp.histogram == []


def test_volume_profile_zero_volume_returns_nan():
    candles = [Candle(time=i, open=1.0, high=1.1, low=0.9, close=1.05,
                      volume=0, day="2026-01-01") for i in range(10)]
    vp = volume_profile(candles)
    assert math.isnan(vp.poc_price)


def test_volume_profile_uniform_volume_poc_in_range():
    """With uniform volume, the POC should fall between min and max price."""
    candles = [
        Candle(time=i, open=1.0, high=1.10 + i * 0.01,
               low=0.95, close=1.05 + i * 0.01,
               volume=10, day="2026-01-01")
        for i in range(20)
    ]
    vp = volume_profile(candles, lookback=20, bins=10)
    assert vp.bins == 10
    # POC lies within the price range
    prices = [c.high for c in candles] + [c.low for c in candles]
    assert min(prices) <= vp.poc_price <= max(prices)
    # VAH >= POC >= VAL
    assert vp.vah >= vp.poc_price >= vp.val
    # Histogram has the right number of bins
    assert len(vp.histogram) == 10
    # Total volume preserved
    assert sum(v for _, v in vp.histogram) == pytest.approx(200.0)


def test_volume_profile_single_price_all_levels_equal():
    """All trades at one price -> POC == VAH == VAL == that price."""
    candles = [
        Candle(time=i, open=1.0850, high=1.0850, low=1.0850, close=1.0850,
               volume=10, day="2026-01-01")
        for i in range(5)
    ]
    vp = volume_profile(candles, bins=10)
    assert vp.poc_price == pytest.approx(1.0850)
    assert vp.vah == pytest.approx(1.0850)
    assert vp.val == pytest.approx(1.0850)


def test_volume_profile_poc_finds_high_volume_bin():
    """Bulk of the volume concentrated at one price -> POC near that price."""
    candles: list[Candle] = []
    # 5 candles at price ~1.10 with high volume
    for i in range(5):
        candles.append(Candle(
            time=i, open=1.095, high=1.105, low=1.090, close=1.100,
            volume=100, day="2026-01-01"))
    # 5 candles at price ~1.20 with low volume
    for i in range(5):
        candles.append(Candle(
            time=10 + i, open=1.195, high=1.205, low=1.190, close=1.200,
            volume=1, day="2026-01-01"))
    vp = volume_profile(candles, lookback=20, bins=20)
    # POC should be in the lower half (high-volume region)
    assert vp.poc_price < 1.15
    # Most volume contained in the value area
    total_vol = sum(v for _, v in vp.histogram)
    va_vol = sum(v for p, v in vp.histogram if vp.val <= p <= vp.vah)
    assert va_vol / total_vol >= 0.5  # at least half in the value area


def test_volume_profile_respects_lookback():
    """Only the last ``lookback`` candles should be used."""
    candles: list[Candle] = []
    # Old candles at low price
    for i in range(50):
        candles.append(Candle(
            time=i, open=0.90, high=0.91, low=0.89, close=0.905,
            volume=100, day="2026-01-01"))
    # Recent candles at higher price
    for i in range(30):
        candles.append(Candle(
            time=100 + i, open=1.10, high=1.11, low=1.09, close=1.105,
            volume=100, day="2026-01-02"))
    vp = volume_profile(candles, lookback=20, bins=10)
    # POC must reflect the recent high-price cluster, not the old low.
    assert vp.poc_price > 1.0
