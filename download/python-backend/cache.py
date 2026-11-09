"""
cache.py
========
Lightweight LRU+TTL cache for candle data.

Why a separate module?
    * MT5's ``copy_rates_*`` is expensive when called for every pair on every
      tick.  A 60-second TTL cache keeps the strategy + scanner happy without
      re-fetching.
    * The cache is intentionally tiny and dependency-free (no redis / disk).

Thread-safety: the cache uses a single ``threading.Lock`` - good enough for
the read-heavy pattern of the trading loop.
"""


import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, TypeVar

from config import CANDLE_CACHE_TTL_S

logger = logging.getLogger(__name__)

K = TypeVar("K")
V = TypeVar("V")


class TTLCache:
    """A simple LRU cache with per-entry TTL.

    Parameters
    ----------
    maxsize : int
        Maximum entries before oldest is evicted.
    ttl_s : float
        Default TTL for entries (seconds).
    """

    def __init__(self, maxsize: int = 256, ttl_s: float | None = None) -> None:
        self.maxsize = maxsize
        self.ttl_s = ttl_s if ttl_s is not None else float(CANDLE_CACHE_TTL_S)
        self._store: OrderedDict[Any, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Any, now: float | None = None) -> Any | None:
        """Return cached value if present and not expired, else None."""
        if now is None:
            now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            ts, val = entry
            if (now - ts) > self.ttl_s:
                # expired
                self._store.pop(key, None)
                return None
            # LRU: move to end
            self._store.move_to_end(key)
            return val

    def set(self, key: Any, value: Any, now: float | None = None) -> None:
        if now is None:
            now = time.monotonic()
        with self._lock:
            self._store[key] = (now, value)
            self._store.move_to_end(key)
            while len(self._store) > self.maxsize:
                self._store.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def __contains__(self, key: Any) -> bool:
        return self.get(key) is not None


# --------------------------------------------------------------------------- #
# Module-level singleton candle cache
# --------------------------------------------------------------------------- #

_candle_cache: TTLCache = TTLCache(maxsize=128, ttl_s=float(CANDLE_CACHE_TTL_S))


def get_candle_cache() -> TTLCache:
    """Return the module-level candle cache."""
    return _candle_cache


def candle_cache_key(symbol: str, timeframe: str, count: int) -> str:
    """Build the cache key for a candle request."""
    return f"{symbol}:{timeframe}:{count}"


def get_candles_cached(symbol: str, timeframe: str, count: int,
                       fetcher: Callable[[str, str, int], list[Any]]
                       ) -> list[Any]:
    """Return candles from the cache, fetching via ``fetcher`` on miss.

    Parameters
    ----------
    symbol, timeframe, count : cache key components
    fetcher : callable(symbol, timeframe, count) -> list[CandleBar]
        The underlying MT5 fetch routine.
    """
    key = candle_cache_key(symbol, timeframe, count)
    cached = _candle_cache.get(key)
    if cached is not None:
        logger.debug("candle cache HIT %s", key)
        return cached
    logger.debug("candle cache MISS %s", key)
    bars = fetcher(symbol, timeframe, count)
    if bars:
        _candle_cache.set(key, bars)
    return bars


def invalidate_candles(symbol: str | None = None) -> None:
    """Drop cached candles (all, or for one symbol)."""
    if symbol is None:
        _candle_cache.clear()
        return
    # TTLCache doesn't expose prefix iteration; just rebuild.
    new_store: OrderedDict[Any, tuple[float, Any]] = OrderedDict()
    with _candle_cache._lock:  # noqa: SLF001
        for k, v in _candle_cache._store.items():  # noqa: SLF001
            if not str(k).startswith(f"{symbol}:"):
                new_store[k] = v
        _candle_cache._store = new_store


__all__ = [
    "TTLCache", "get_candle_cache",
    "candle_cache_key", "get_candles_cached", "invalidate_candles",
]
