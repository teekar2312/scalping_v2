"""
conftest.py
===========
Shared pytest fixtures: mock MT5, isolated DB, sample candles.

Every test runs against a fresh in-memory-ish SQLite file in /tmp so the
production data dir is never touched.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import pytest

# Make the backend importable.  We add the parent dir to sys.path BEFORE
# importing any backend modules.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Ensure minimal env vars are set BEFORE importing config (which is eagerly
# evaluated at import time).
os.environ.setdefault("MT5_LOGIN", "12345678")
os.environ.setdefault("MT5_PASSWORD", "test_dummy")
os.environ.setdefault("MT5_SERVER", "FinexECN-MT5-Demo")
os.environ.setdefault("PAIRS", "EURUSD,GBPUSD,USDJPY")
os.environ.setdefault("PAPER_MODE", "true")
os.environ.setdefault("API_KEYS", "")  # auth disabled in tests
os.environ.setdefault("ADMIN_PASSWORD", "test123")


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture()
def tmp_db_path(tmp_path: Path) -> Path:
    """Return a fresh DB path inside the tmp_path."""
    return tmp_path / "test_trading.db"


@pytest.fixture()
def isolated_db(tmp_db_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Reset the database singleton and point it at a fresh path."""
    # Patch DB_PATH before get_db() is called
    monkeypatch.setenv("DB_PATH", str(tmp_db_path))
    import database as db_module
    # Drop the singleton
    db_module._db = None
    # Force get_db() to use our path via the env var we just set
    # (config.py reads DB_PATH at import, so we reload)
    import importlib
    import config
    # Update the cached settings.paths.db_path
    config.settings.paths.db_path.__init__(tmp_db_path)  # type: ignore[attr-defined]
    db = db_module.get_db()
    yield db
    db_module._db = None


@pytest.fixture()
def sample_candles() -> list[Any]:
    """Return 30 synthetic M5 candles for indicator tests."""
    from indicators import Candle
    candles: list[Candle] = []
    base_price = 1.0850
    # Monotonically rising closes so EMA / ADX behave predictably
    for i in range(30):
        p = base_price + i * 0.0005
        candles.append(Candle(
            time=i * 300,  # 5-min increments
            open=p - 0.0002,
            high=p + 0.0008,
            low=p - 0.0008,
            close=p,
            volume=100 + i,
            day=i // 288,
        ))
    return candles


@pytest.fixture()
def sample_closes(sample_candles: list[Any]) -> list[float]:
    return [c.close for c in sample_candles]


@pytest.fixture()
def sample_highs(sample_candles: list[Any]) -> list[float]:
    return [c.high for c in sample_candles]


@pytest.fixture()
def sample_lows(sample_candles: list[Any]) -> list[float]:
    return [c.low for c in sample_candles]


@pytest.fixture()
def sample_trades() -> list[dict[str, Any]]:
    """20 synthetic closed trades (alternating wins/losses)."""
    out: list[dict[str, Any]] = []
    for i in range(20):
        profit = 50.0 if i % 2 == 0 else -30.0
        out.append({
            "id": i + 1,
            "ticket": 10_000 + i,
            "symbol": "EURUSD",
            "direction": "buy" if i % 2 == 0 else "sell",
            "volume": 0.1,
            "open_price": 1.0850,
            "close_price": 1.0860,
            "profit": profit,
            "rr_net": 2.0 if profit > 0 else -1.0,
            "status": "closed",
            "open_time": "2026-01-01T00:00:00+00:00",
            "close_time": "2026-01-01T01:00:00+00:00",
            "adx": 25.0,
        })
    return out
