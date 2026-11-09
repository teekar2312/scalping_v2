"""
test_tick_backtest.py
=====================
Unit tests for ``backtest.TickBacktestEngine`` (BACKEND-100 #9).

Generates synthetic M5 candles + ticks and verifies the tick-driven
engine produces a sensible BacktestResult.  The engine imports the
strategy module so we run inside the existing pytest conftest that sets
the required env vars.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backtest import BacktestEngine, TickBacktestEngine


def _synth_candles(n: int = 120, base: float = 1.0850) -> list[dict]:
    """Build a deterministic rising series of M5 candles."""
    out: list[dict] = []
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
    for i in range(n):
        c = base + i * 0.0005
        out.append({
            "time": t0 + i * 300,
            "open": c - 0.0002,
            "high": c + 0.0008,
            "low": c - 0.0008,
            "close": c,
            "volume": 100 + i,
            "day": "2026-01-01",
        })
    return out


def test_ticks_from_candles_generates_one_per_frac():
    candles = _synth_candles(5)
    ticks = TickBacktestEngine.ticks_from_candles(
        candles, pip_size=0.0001, spread_pips=0.8, ticks_per_candle=4)
    # 5 candles * 4 ticks = 20 ticks
    assert len(ticks) == 20
    # Sorted by time
    times = [t["time"] for t in ticks]
    assert times == sorted(times)
    # Each tick has bid + ask, ask > bid (positive spread)
    for t in ticks:
        assert "bid" in t and "ask" in t
        assert t["ask"] > t["bid"]


def test_ticks_from_candles_empty_input():
    assert TickBacktestEngine.ticks_from_candles([]) == []


def test_ticks_from_candles_single_candle():
    """A single candle still produces ticks_per_candle ticks."""
    candles = [{"time": 0, "open": 1.0, "high": 1.1, "low": 0.9,
                "close": 1.05, "volume": 10, "day": "2026-01-01"}]
    ticks = TickBacktestEngine.ticks_from_candles(
        candles, ticks_per_candle=3)
    assert len(ticks) == 3


def test_tick_backtest_returns_result_object():
    """The engine should run end-to-end on synthetic candles."""
    candles = _synth_candles(120)
    engine = TickBacktestEngine(spread_pips=0.8, commission_pips=0.7)
    result = engine.run_tick_backtest(
        symbol="EURUSD",
        start_date="2026-01-01",
        end_date="2026-01-02",
        initial_balance=10_000.0,
        candles_m5=candles,
    )
    assert result.symbol == "EURUSD"
    assert result.timeframe == "TICK"
    assert result.initial_balance == 10_000.0
    # Final balance should be a finite number
    assert isinstance(result.final_balance, float)
    # No exceptions thrown, and result.to_dict() works
    d = result.to_dict()
    assert "trades" in d
    assert "engine" not in d  # that key is added by the FastAPI route only


def test_tick_backtest_no_candles_returns_empty_result():
    engine = TickBacktestEngine()
    result = engine.run_tick_backtest(
        symbol="EURUSD", start_date="2026-01-01",
        end_date="2026-01-02", initial_balance=10_000.0,
        candles_m5=None, ticks=None,
    )
    assert result.total_trades == 0
    assert result.final_balance == 10_000.0


def test_tick_backtest_with_supplied_ticks():
    """When ticks are supplied directly, candles are still needed for
    the strategy check (window slice) but ticks drive the trade fill."""
    candles = _synth_candles(120)
    engine = TickBacktestEngine()
    ticks = TickBacktestEngine.ticks_from_candles(candles, ticks_per_candle=6)
    result = engine.run_tick_backtest(
        symbol="EURUSD", start_date="2026-01-01",
        end_date="2026-01-02", initial_balance=10_000.0,
        candles_m5=candles, ticks=ticks,
    )
    # Should produce a valid result without raising.
    assert result.initial_balance == 10_000.0
    assert isinstance(result.to_dict()["trades"], list)


def test_tick_engine_inherits_from_backtest_engine():
    """TickBacktestEngine must be a subclass of BacktestEngine so the
    existing BacktestEngine helpers (_build_symbol_info, _partial_close,
    _finalize_trade) are reused."""
    assert issubclass(TickBacktestEngine, BacktestEngine)
