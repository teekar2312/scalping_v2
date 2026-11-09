"""
test_risk_analytics.py
======================
Unit tests for VaR / CVaR / portfolio VaR (Sprint 7 #13).
"""
from __future__ import annotations

import math

import pytest

from risk_analytics import (
    calculate_var, calculate_cvar, calculate_portfolio_var,
    get_returns_from_trades,
)


# --------------------------------------------------------------------------- #
# calculate_var
# --------------------------------------------------------------------------- #

class TestVaR:
    def test_empty_returns_zero(self):
        res = calculate_var([], confidence=0.95)
        assert res["var_value"] == 0.0

    def test_invalid_confidence_raises(self):
        with pytest.raises(ValueError):
            calculate_var([0.01, -0.02], confidence=0.0)
        with pytest.raises(ValueError):
            calculate_var([0.01, -0.02], confidence=1.0)

    def test_historical_var_positive(self):
        """Returns with losses should produce a positive VaR."""
        returns = [-0.02, -0.01, 0.005, -0.03, 0.015, -0.025, 0.01, -0.005]
        res = calculate_var(returns, confidence=0.95, method="historical")
        assert res["var_value"] > 0
        assert res["confidence"] == 0.95
        assert res["samples"] == 8

    def test_var_99_greater_than_var_95(self):
        """VaR at 99% must be >= VaR at 95% (more extreme tail)."""
        returns = [-0.05, -0.04, -0.03, -0.02, -0.01, 0.0, 0.01, 0.02]
        v95 = calculate_var(returns, confidence=0.95)
        v99 = calculate_var(returns, confidence=0.99)
        assert v99["var_value"] >= v95["var_value"]


# --------------------------------------------------------------------------- #
# calculate_cvar
# --------------------------------------------------------------------------- #

class TestCVaR:
    def test_empty_returns_zero(self):
        res = calculate_cvar([], confidence=0.95)
        assert res["cvar_value"] == 0.0

    def test_cvar_gte_var(self):
        """CVaR is the average of the tail beyond VaR, so it must be >= VaR."""
        returns = [-0.05, -0.04, -0.03, -0.02, -0.01, 0.0, 0.01, 0.02]
        var = calculate_var(returns, confidence=0.95)
        cvar = calculate_cvar(returns, confidence=0.95)
        assert cvar["cvar_value"] >= var["var_value"]

    def test_cvar_returns_tail_count(self):
        returns = [-0.05, -0.04, -0.03, -0.02, -0.01, 0.0, 0.01, 0.02]
        res = calculate_cvar(returns, confidence=0.95)
        assert "tail_observations" in res
        assert res["tail_observations"] >= 0


# --------------------------------------------------------------------------- #
# calculate_portfolio_var
# --------------------------------------------------------------------------- #

class TestPortfolioVaR:
    def test_empty_positions_returns_zero(self):
        res = calculate_portfolio_var([], correlation_matrix=None,
                                       confidence=0.95)
        assert res["var_value"] == 0.0

    def test_single_asset_matches_parametric(self):
        """A single-asset portfolio VaR should equal z * vol * weight."""
        positions = [{"symbol": "EURUSD", "weight": 1.0, "volatility": 0.01}]
        res = calculate_portfolio_var(positions, correlation_matrix=None,
                                       confidence=0.95)
        # z_95 ~= 1.645, vol=0.01, weight=1.0 => VaR ≈ 0.01645
        assert res["var_value"] == pytest.approx(0.01645, abs=0.005)

    def test_two_uncorrelated_assets_reduces_var(self):
        """Two uncorrelated assets should have lower portfolio vol than
        the sum of individual volatilities (diversification)."""
        positions = [
            {"symbol": "EURUSD", "weight": 0.5, "volatility": 0.01},
            {"symbol": "GBPUSD", "weight": 0.5, "volatility": 0.01},
        ]
        # 2x2 zero correlation matrix
        corr = [[1.0, 0.0], [0.0, 1.0]]
        res = calculate_portfolio_var(positions, correlation_matrix=corr,
                                       confidence=0.95)
        # Portfolio vol = sqrt(0.5^2*0.01^2 + 0.5^2*0.01^2) = sqrt(0.00005) ≈ 0.00707
        # VaR ≈ 1.645 * 0.00707 ≈ 0.01164
        assert res["var_value"] < 0.01645  # less than single-asset 1.645*0.01


# --------------------------------------------------------------------------- #
# get_returns_from_trades
# --------------------------------------------------------------------------- #

def test_returns_from_trades_uses_rr_net():
    """Each trade's rr_net is converted to a fraction via * 0.01 (1% risk)."""
    trades = [
        {"rr_net": 2.0},   # 0.02
        {"rr_net": -1.0},  # -0.01
        {"rr_net": 3.0},   # 0.03
    ]
    out = get_returns_from_trades(trades)
    assert out == pytest.approx([0.02, -0.01, 0.03])

    def test_empty_trades_returns_empty(self):
        assert get_returns_from_trades([]) == []


def test_returns_skip_invalid_rr():
    """Trades with non-numeric rr_net should be skipped."""
    trades = [
        {"rr_net": 1.0},
        {"rr_net": "garbage"},  # invalid
        {"rr_net": None},        # invalid
        {"rr_net": -0.5},
    ]
    out = get_returns_from_trades(trades)
    # Only 2 valid entries should remain
    assert len(out) == 2
