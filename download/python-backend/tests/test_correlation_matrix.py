"""
test_correlation_matrix.py
==========================
Unit tests for ``risk_analytics.correlation_matrix`` +
``rolling_correlation`` + ``volatility_surface`` (BACKEND-100 #5, #6).
"""
from __future__ import annotations

import math

import pytest

from risk_analytics import (
    correlation_matrix, realized_volatility, rolling_correlation,
    volatility_surface,
)


def test_realized_volatility_short_series_returns_zero():
    assert realized_volatility([], window=10) == 0.0
    assert realized_volatility([0.01], window=10) == 0.0


def test_realized_volatility_constant_series_zero():
    """A constant return series has zero variance -> zero vol."""
    returns = [0.001] * 30
    vol = realized_volatility(returns, window=20, annualize=False)
    assert vol == pytest.approx(0.0, abs=1e-12)


def test_realized_volatility_annualized_scales_correctly():
    """Annualised vol = sample_std * sqrt(periods_per_year)."""
    returns = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01,
               0.02, -0.02, 0.01, -0.01] * 3
    vol_annual = realized_volatility(returns, window=30,
                                     annualize=True, periods_per_year=252)
    vol_raw = realized_volatility(returns, window=30,
                                  annualize=False, periods_per_year=252)
    assert vol_annual == pytest.approx(vol_raw * math.sqrt(252), rel=1e-6)


def test_volatility_surface_returns_one_entry_per_tenor():
    candles = [{"close": 1.0 + i * 0.001} for i in range(100)]
    surface = volatility_surface(candles, tenors=[1, 5, 10, 20, 60])
    assert len(surface) == 5
    tenors = [row["tenor_days"] for row in surface]
    assert tenors == [1, 5, 10, 20, 60]
    # All vol_pct values are non-negative
    for row in surface:
        assert row["vol_pct"] >= 0.0
        assert row["samples"] >= 0


def test_volatility_surface_short_series_returns_zeros():
    surface = volatility_surface([], tenors=[5, 10])
    assert len(surface) == 2
    for row in surface:
        assert row["vol_pct"] == 0.0
        assert row["samples"] == 0


def test_rolling_correlation_identical_series_is_one():
    """Two identical return series should have correlation 1.0 at each
    window position."""
    returns = [0.01, -0.01, 0.02, -0.02, 0.03, -0.03,
               0.01, -0.01, 0.02, -0.02]
    rc = rolling_correlation(returns, returns, window=5)
    assert len(rc) == len(returns)
    # First window-1 entries are 0 (insufficient data)
    for v in rc[:4]:
        assert v == 0.0
    # Subsequent entries should be 1.0 (identical series)
    for v in rc[4:]:
        assert v == pytest.approx(1.0, abs=1e-3)


def test_rolling_correlation_opposite_series_is_minus_one():
    """Two opposite return series should have correlation -1.0."""
    a = [0.01, -0.01, 0.02, -0.02, 0.03, -0.03, 0.01]
    b = [-x for x in a]
    rc = rolling_correlation(a, b, window=4)
    for v in rc[3:]:
        assert v == pytest.approx(-1.0, abs=1e-3)


def test_correlation_matrix_diagonal_is_one():
    """Self-correlation on the diagonal should be 1.0."""
    pairs = {
        "A": [0.01, -0.01, 0.02, -0.02, 0.03, -0.03,
              0.01, -0.01, 0.02, -0.02],
        "B": [0.02, -0.02, 0.03, -0.03, 0.01, -0.01,
              0.02, -0.02, 0.03, -0.03],
    }
    result = correlation_matrix(pairs, window=5)
    assert result["pairs"] == ["A", "B"]
    for p in ("A", "B"):
        assert result["latest"][p][p] == pytest.approx(1.0, abs=1e-3)


def test_correlation_matrix_returns_pairs_and_window():
    pairs = {
        "EURUSD": [0.001 * i for i in range(40)],
        "GBPUSD": [0.002 * i for i in range(40)],
    }
    result = correlation_matrix(pairs, window=10)
    assert set(result["pairs"]) == {"EURUSD", "GBPUSD"}
    assert result["window"] == 10
    assert result["samples"] == 40


def test_correlation_matrix_empty_returns_empty_structure():
    result = correlation_matrix({}, window=10)
    assert result["pairs"] == []
    assert result["latest"] == {}
    assert result["matrix"] == {}


def test_correlation_matrix_symmetric_off_diagonal():
    """corr(A, B) == corr(B, A) for any pair."""
    pairs = {
        "A": [0.01, -0.02, 0.03, -0.01, 0.02, -0.03,
              0.01, 0.02, -0.01, -0.02, 0.03, 0.01],
        "B": [0.02, 0.01, -0.03, 0.01, -0.02, 0.03,
              -0.01, 0.02, 0.01, -0.03, 0.02, 0.01],
    }
    result = correlation_matrix(pairs, window=6)
    assert result["latest"]["A"]["B"] == pytest.approx(
        result["latest"]["B"]["A"], abs=1e-4)
