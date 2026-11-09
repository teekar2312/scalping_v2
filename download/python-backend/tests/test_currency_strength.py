"""
test_currency_strength.py
=========================
Unit tests for ``market_analysis.currency_strength`` (BACKEND-100 #3).
"""
from __future__ import annotations

from indicators import Candle
from market_analysis import (
    MAJOR_CURRENCIES, currency_strength,
)


def test_currency_strength_empty_returns_all_majors_ranked():
    out = currency_strength({})
    assert len(out) == len(MAJOR_CURRENCIES)
    # All strengths zero, ranks 1..N
    for i, row in enumerate(out):
        assert row.rank == i + 1
        assert row.strength == 0.0


def test_currency_strength_usd_stronger_when_eurusd_drops():
    """If EURUSD falls (EUR weak vs USD), USD should rank stronger than EUR."""
    pairs = {
        # EURUSD open=1.10 close=1.00 -> -9.09% -> EUR weaker / USD stronger
        "EURUSD": Candle(time=0, open=1.10, high=1.11, low=1.09,
                         close=1.00, volume=100),
        # GBPUSD open=1.20 close=1.20 -> 0% (neutral)
        "GBPUSD": Candle(time=0, open=1.20, high=1.21, low=1.19,
                         close=1.20, volume=100),
        # USDJPY open=100 close=100 -> 0% (neutral)
        "USDJPY": Candle(time=0, open=100.0, high=100.5, low=99.5,
                         close=100.0, volume=100),
    }
    out = currency_strength(pairs)
    by_ccy = {row.currency: row for row in out}
    assert "USD" in by_ccy
    assert "EUR" in by_ccy
    # USD strength > EUR strength (since EUR fell vs USD)
    assert by_ccy["USD"].strength > by_ccy["EUR"].strength
    # USD should rank higher (lower number) than EUR
    assert by_ccy["USD"].rank < by_ccy["EUR"].rank


def test_currency_strength_returns_change_pct():
    """Each row should carry a change_pct matching the pair move."""
    pairs = {
        "EURUSD": Candle(time=0, open=1.10, high=1.11, low=1.09,
                         close=1.155, volume=100),  # +5%
    }
    out = currency_strength(pairs)
    by_ccy = {row.currency: row for row in out}
    # EURUSD rose 5% -> EUR up, USD down
    assert by_ccy["EUR"].change_pct > 0
    assert by_ccy["USD"].change_pct < 0


def test_currency_strength_handles_short_pair_names():
    """Non-6-letter pairs should be skipped, not crash."""
    pairs = {
        "EURUSD": Candle(time=0, open=1.10, high=1.11, low=1.09,
                         close=1.00, volume=100),
        "BAD": Candle(time=0, open=1.0, high=2.0, low=0.5,
                      close=1.5, volume=100),  # too short, skip
    }
    out = currency_strength(pairs)
    assert all(row.currency in MAJOR_CURRENCIES or row.currency in {"EUR", "USD"}
               for row in out)


def test_currency_strength_zero_volume_candle_still_processes():
    """A candle with zero volume should still produce a % change."""
    pairs = {
        "EURUSD": Candle(time=0, open=1.10, high=1.11, low=1.09,
                         close=1.00, volume=0),
    }
    out = currency_strength(pairs)
    assert len(out) >= 2  # at least EUR and USD
    by_ccy = {row.currency: row for row in out}
    assert by_ccy["USD"].strength > by_ccy["EUR"].strength
