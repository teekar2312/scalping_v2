"""
tiingo_calendar.py
==================
Economic calendar client for Tiingo.

Tiingo publishes a fundamentals calendar endpoint.  This module:
    * Fetches upcoming events (default 7 days)
    * Filters HIGH / MEDIUM impact
    * Caches results in-process (1 hour TTL) and in SQLite
    * Exposes a helper to compute blackout windows for a symbol

If ``TIINGO_API_KEY`` is missing the client degrades gracefully and returns
an empty list (the strategy treats this as "no known blackout events").
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)


@dataclass
class CachedCalendar:
    """In-memory cache entry."""
    events: list[dict[str, Any]]
    fetched_at: float


class TiingoCalendar:
    """Async Tiingo economic calendar client with caching."""

    def __init__(self,
                 api_key: str | None = None,
                 base_url: str | None = None,
                 cache_ttl_s: int | None = None) -> None:
        self.api_key = api_key if api_key is not None else settings.tiingo.api_key
        self.base_url = base_url or settings.tiingo.base_url
        self.cache_ttl_s = cache_ttl_s or settings.tiingo.cache_ttl_s
        self._cache: CachedCalendar | None = None
        self._client: httpx.AsyncClient | None = None

    # ---- HTTP lifecycle ---------------------------------------------------- #

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(20.0),
                headers=self._headers(),
            )
        return self._client

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Token {self.api_key}"
        return h

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ---- Fetching ---------------------------------------------------------- #

    async def fetch_calendar(self,
                             days_ahead: int = 7,
                             impact: str | None = "HIGH"
                             ) -> list[dict[str, Any]]:
        """Fetch economic calendar events for the next ``days_ahead`` days.

        Returns the cached result if the cache is still valid.

        Parameters
        ----------
        days_ahead : int
            How many days of events to fetch.
        impact : str | None
            Filter by impact level: ``"HIGH"``, ``"MEDIUM"``, ``"LOW"`` or
            ``None`` for all.
        """
        if not self.api_key:
            logger.warning("Tiingo API key not set - returning empty calendar.")
            return []

        # Cache hit?
        now = time.time()
        if (self._cache is not None
                and (now - self._cache.fetched_at) < self.cache_ttl_s):
            events = self._cache.events
        else:
            events = await self._fetch_remote(days_ahead)
            self._cache = CachedCalendar(events=events, fetched_at=now)
            # Persist to DB
            try:
                from database import upsert_news_events
                upsert_news_events(events)
            except Exception as exc:  # pragma: no cover
                logger.warning("DB upsert of news events failed: %s", exc)

        # Filter
        if impact:
            return [e for e in events if e.get("impact", "").upper() == impact.upper()]
        return events

    async def _fetch_remote(self, days_ahead: int) -> list[dict[str, Any]]:
        """Call the Tiingo calendar endpoint."""
        client = await self._get_client()
        start_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        end_date = (datetime.now(timezone.utc)
                    + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
        endpoint = settings.tiingo.calendar_endpoint
        params = {
            "startDate": start_date,
            "endDate": end_date,
        }
        try:
            resp = await client.get(endpoint, params=params)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("Tiingo HTTP error %s: %s",
                         exc.response.status_code, exc.response.text[:500])
            return []
        except Exception as exc:  # pragma: no cover
            logger.exception("Tiingo fetch failed: %s", exc)
            return []

        # Tiingo returns either a list or {"results": [...]}
        rows: list[Any] = data if isinstance(data, list) else data.get("results", [])
        events: list[dict[str, Any]] = []
        for r in rows:
            ev = self._normalize(r)
            if ev:
                events.append(ev)
        return events

    @staticmethod
    def _normalize(raw: dict[str, Any]) -> dict[str, Any] | None:
        """Normalize a Tiingo calendar row to our schema."""
        try:
            # Tiingo news-calendar fields
            event_time_raw = raw.get("date") or raw.get("event_date") or raw.get("timestamp")
            if event_time_raw is None:
                return None
            # Parse ISO date/time
            if isinstance(event_time_raw, (int, float)):
                et = datetime.fromtimestamp(float(event_time_raw), tz=timezone.utc)
            else:
                s = str(event_time_raw).replace("Z", "+00:00")
                try:
                    et = datetime.fromisoformat(s)
                except ValueError:
                    # Try date only
                    et = datetime.strptime(str(event_time_raw)[:10], "%Y-%m-%d")
                if et.tzinfo is None:
                    et = et.replace(tzinfo=timezone.utc)

            impact_raw = (raw.get("importance") or raw.get("impact")
                          or raw.get("priority") or "MEDIUM")
            impact = str(impact_raw).upper()
            if impact not in ("HIGH", "MEDIUM", "LOW"):
                impact = "MEDIUM"
            symbol = (raw.get("currency") or raw.get("symbol")
                      or raw.get("country") or "").upper()
            return {
                "symbol": symbol,
                "title": raw.get("title") or raw.get("name") or "Calendar event",
                "impact": impact,
                "event_time": et,
                "country": raw.get("country") or raw.get("currency"),
                "actual": raw.get("actual"),
                "forecast": raw.get("forecast") or raw.get("forecastValue"),
                "previous": raw.get("previous") or raw.get("previousValue"),
            }
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to normalize Tiingo row: %s", exc)
            return None

    # ---- Blackout helper --------------------------------------------------- #

    async def get_blackout_symbols(self, now: datetime | None = None,
                                   minutes: int = 30) -> set[str]:
        """Return the set of currencies currently in a +-``minutes`` window
        around a HIGH impact event.
        """
        if now is None:
            now = datetime.now(timezone.utc)
        events = await self.fetch_calendar(impact="HIGH")
        out: set[str] = set()
        window = timedelta(minutes=minutes)
        for ev in events:
            et = ev.get("event_time")
            if isinstance(et, str):
                try:
                    et = datetime.fromisoformat(et.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if et is None or et.tzinfo is None:
                continue
            if abs(now - et) <= window:
                ccy = (ev.get("symbol") or "").upper()
                if ccy:
                    out.add(ccy)
        return out

    async def get_upcoming_high_news(self,
                                     minutes_ahead: int = 30,
                                     now: datetime | None = None
                                     ) -> list[dict[str, Any]]:
        """Return HIGH-impact events firing within the next ``minutes_ahead``.

        Used by the trading engine's pre-news position reduction logic.
        """
        if now is None:
            now = datetime.now(timezone.utc)
        events = await self.fetch_calendar(impact="HIGH")
        window = timedelta(minutes=minutes_ahead)
        upcoming: list[dict[str, Any]] = []
        for ev in events:
            et = ev.get("event_time")
            if isinstance(et, str):
                try:
                    et = datetime.fromisoformat(et.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if et is None or et.tzinfo is None:
                continue
            delta = et - now
            if timedelta(0) <= delta <= window:
                upcoming.append({
                    "symbol": ev.get("symbol"),
                    "title": ev.get("title"),
                    "event_time": et.isoformat(),
                    "minutes_until": int(delta.total_seconds() // 60),
                    "country": ev.get("country"),
                })
        upcoming.sort(key=lambda e: e["minutes_until"])
        return upcoming

    # ---- Sync wrapper ------------------------------------------------------ #

    def fetch_calendar_sync(self, days_ahead: int = 7,
                            impact: str | None = "HIGH") -> list[dict[str, Any]]:
        """Synchronous wrapper around :meth:`fetch_calendar`."""
        return asyncio.run(self.fetch_calendar(days_ahead, impact))


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_client: TiingoCalendar | None = None


def get_calendar() -> TiingoCalendar:
    """Return the module-level Tiingo calendar client."""
    global _default_client
    if _default_client is None:
        _default_client = TiingoCalendar()
    return _default_client


async def close_default_client() -> None:
    global _default_client
    if _default_client is not None:
        await _default_client.close()
        _default_client = None


__all__ = [
    "TiingoCalendar", "CachedCalendar",
    "get_calendar", "close_default_client",
]
