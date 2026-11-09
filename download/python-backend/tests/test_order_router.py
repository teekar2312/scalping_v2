"""
test_order_router.py
====================
Unit tests for ``mt5_connector.OrderRouter`` (BACKEND-100 #10).

Uses a fake MT5Connector that returns deterministic responses so the
router's retry / split-on-slippage logic can be exercised without a
live MT5 terminal.
"""
from __future__ import annotations

from dataclasses import dataclass

import pytest

from mt5_connector import (
    MT5Connector, OrderRouter, OrderResult,
)


# --------------------------------------------------------------------------- #
# Fake connector
# --------------------------------------------------------------------------- #

@dataclass
class _FakeSymbolInfo:
    name: str = "EURUSD"
    digits: int = 5
    point: float = 0.00001
    pip_size: float = 0.0001
    pip_value_per_lot: float = 10.0
    spread: float = 10.0  # 1 pip
    bid: float = 1.0850
    ask: float = 1.0851
    volume_min: float = 0.01
    volume_max: float = 100.0
    volume_step: float = 0.01
    trade_mode: str = "full"


class _FakeConnector(MT5Connector):
    """Stand-in connector that doesn't touch MT5."""

    def __init__(self, *, spread_points: float = 10.0,
                 fill_ok: bool = True,
                 fill_price: float | None = None,
                 retcode: int = 10009,
                 fail_first_then_ok: bool = False) -> None:
        # Skip MT5Connector.__init__ - we don't want _check() to fire.
        self.config = None  # type: ignore[assignment]
        self._connected = True
        self._spread_points = spread_points
        self._fill_ok = fill_ok
        self._fill_price = fill_price
        self._retcode = retcode
        self._fail_first = fail_first_then_ok
        self._call_count = 0

    @property
    def connected(self) -> bool:
        return self._connected

    def get_symbol_info(self, symbol: str):
        return _FakeSymbolInfo(spread=self._spread_points,
                               bid=1.0850, ask=1.0851)

    def place_order(self, symbol, direction, volume, sl, tp,
                    comment="", deviation=None):
        self._call_count += 1
        if self._fail_first and self._call_count == 1:
            # Slippage rejection on the first attempt.
            return {"ok": False, "ticket": 0, "retcode": 10016,
                    "comment": "requote", "fill_price": None,
                    "slippage_actual_pips": 0.0}
        return {
            "ok": self._fill_ok,
            "ticket": 12345,
            "retcode": self._retcode,
            "comment": comment or "ok",
            "fill_price": self._fill_price or 1.0851,
            "slippage_actual_pips": 0.2,
            "requested_price": 1.0850,
            "execution_latency_ms": 50.0,
        }


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #

def test_order_result_dataclass_defaults():
    r = OrderResult(success=False, filled_price=None, slippage_pips=0.0,
                    latency_ms=0.0, attempts=0, ticket=0, retcode=0,
                    comment="", child_orders=[])
    assert r.success is False
    assert r.child_orders == []


def test_order_router_success_first_try():
    conn = _FakeConnector(spread_points=10.0, fill_ok=True)
    router = OrderRouter(conn, normal_spread_points=20.0, max_retries=2)
    result = router.place_order_optimized(
        symbol="EURUSD", direction="buy", volume=0.10,
        sl=1.0800, tp=1.0900, comment="test")
    assert result.success is True
    assert result.ticket == 12345
    # One symbol_info check + one place_order call = 2 attempts.
    assert result.attempts >= 1
    assert result.filled_price == 1.0851
    assert result.slippage_pips == pytest.approx(0.2)


def test_order_router_waits_for_wide_spread():
    """When spread > 2x normal, the router waits + retries (max_retries=1)."""
    conn = _FakeConnector(spread_points=80.0, fill_ok=True)  # 8 pips
    router = OrderRouter(conn, normal_spread_points=10.0, max_retries=1)
    # The router should still attempt the order (after 1 wait/retry).
    result = router.place_order_optimized(
        symbol="EURUSD", direction="buy", volume=0.10,
        sl=1.0800, tp=1.0900, comment="wide")
    # After max_retries wait loops, it sends anyway.
    assert result.attempts >= 1
    assert result.success is True


def test_order_router_splits_on_slippage_rejection():
    """When the broker rejects with retcode 10016 and volume >= 0.02,
    the router splits the order into 2 halves."""
    conn = _FakeConnector(spread_points=10.0, fill_ok=True,
                          fail_first_then_ok=True)
    router = OrderRouter(conn, normal_spread_points=20.0, max_retries=2)
    result = router.place_order_optimized(
        symbol="EURUSD", direction="buy", volume=0.10,
        sl=1.0800, tp=1.0900, comment="split")
    assert result.success is True
    # The router made 3 calls: initial + 2 split halves.
    assert conn._call_count == 3
    assert len(result.child_orders) == 2
    assert result.comment == "split_fill"


def test_order_router_returns_failure_when_volume_below_split_threshold():
    """Volume < 0.02 lot cannot be split - on retcode 10016 the router
    returns the original failure unchanged (no split attempted)."""
    conn = _FakeConnector(spread_points=10.0, fill_ok=False,
                          fail_first_then_ok=True, retcode=10016)
    router = OrderRouter(conn, normal_spread_points=20.0, max_retries=1)
    result = router.place_order_optimized(
        symbol="EURUSD", direction="buy", volume=0.01,  # below split threshold
        sl=1.0800, tp=1.0900, comment="tiny")
    assert result.success is False
    # Split path was NOT entered (volume < 0.02), so the original comment
    # is preserved.
    assert result.retcode == 10016
    assert result.child_orders == []


def test_order_router_handles_symbol_info_exception():
    """If get_symbol_info raises, the router returns a failure result."""
    class _BadConn(_FakeConnector):
        def get_symbol_info(self, symbol: str):
            raise RuntimeError("no symbol")
    conn = _BadConn()
    router = OrderRouter(conn, normal_spread_points=20.0, max_retries=1)
    result = router.place_order_optimized(
        symbol="EURUSD", direction="buy", volume=0.10,
        sl=1.0, tp=1.1, comment="bad")
    assert result.success is False
    assert "symbol_info_error" in result.comment


def test_order_router_handles_place_order_exception():
    """If place_order raises, the router returns a failure result."""
    class _BadConn(_FakeConnector):
        def place_order(self, *a, **kw):
            raise RuntimeError("mt5 died")
    conn = _BadConn(spread_points=10.0)
    router = OrderRouter(conn, normal_spread_points=20.0, max_retries=1)
    result = router.place_order_optimized(
        symbol="EURUSD", direction="buy", volume=0.10,
        sl=1.0, tp=1.1, comment="exc")
    assert result.success is False
    assert "exception" in result.comment
