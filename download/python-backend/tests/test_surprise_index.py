"""
test_surprise_index.py
======================
Unit tests for ``tiingo_calendar.calculate_surprise`` and
``get_surprise_index`` (BACKEND-100 #8).

These tests stub out the network call (``fetch_calendar``) so they don't
require a running Tiingo API.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tiingo_calendar import TiingoCalendar


def test_calculate_surprise_basic():
    """Surprise = (actual - forecast) / sigma."""
    s = TiingoCalendar.calculate_surprise(2.5, 2.0, sigma=1.0)
    assert s == pytest.approx(0.5)


def test_calculate_surprise_negative():
    s = TiingoCalendar.calculate_surprise(1.0, 2.0, sigma=0.5)
    assert s == pytest.approx(-2.0)


def test_calculate_surprise_missing_actual_returns_none():
    assert TiingoCalendar.calculate_surprise(None, 2.0, sigma=1.0) is None
    assert TiingoCalendar.calculate_surprise("N/A", 2.0, sigma=1.0) is None
    assert TiingoCalendar.calculate_surprise("-", 2.0, sigma=1.0) is None


def test_calculate_surprise_missing_forecast_returns_none():
    assert TiingoCalendar.calculate_surprise(2.0, None, sigma=1.0) is None


def test_calculate_surprise_zero_sigma_returns_none():
    assert TiingoCalendar.calculate_surprise(2.0, 1.0, sigma=0.0) is None
    assert TiingoCalendar.calculate_surprise(2.0, 1.0, sigma=-1.0) is None


def test_calculate_surprise_parses_percent_string():
    """A trailing % suffix is stripped."""
    s = TiingoCalendar.calculate_surprise("3.0%", "2.0%", sigma=1.0)
    assert s == pytest.approx(1.0)


def test_calculate_surprise_parses_kmb_suffixes():
    """K / M / B suffixes are expanded."""
    assert TiingoCalendar.calculate_surprise("1.5K", "1.0K",
                                             sigma=500.0) == pytest.approx(1.0)
    assert TiingoCalendar.calculate_surprise("1.5M", "1.0M",
                                             sigma=500_000.0) == pytest.approx(1.0)
    assert TiingoCalendar.calculate_surprise("1.5B", "1.0B",
                                             sigma=500_000_000.0) == pytest.approx(1.0)


def test_calculate_surprise_parses_comma_thousands():
    s = TiingoCalendar.calculate_surprise("2,500", "2,000", sigma=500.0)
    assert s == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_get_surprise_index_aggregates_per_currency(monkeypatch):
    cal = TiingoCalendar(api_key="dummy")

    # Build a fake event list with USD + EUR events in the last 5 days.
    now = datetime.now(timezone.utc)
    events = [
        {"symbol": "USD", "title": "NFP",
         "event_time": now - timedelta(days=1),
         "actual": "250K", "forecast": "200K"},
        {"symbol": "USD", "title": "CPI",
         "event_time": now - timedelta(days=2),
         "actual": "3.0%", "forecast": "2.5%"},
        {"symbol": "EUR", "title": "GDP",
         "event_time": now - timedelta(days=3),
         "actual": "0.5%", "forecast": "0.4%"},
        {"symbol": "USD", "title": "no actual",
         "event_time": now - timedelta(days=4),
         "actual": None, "forecast": "1.0%"},
    ]

    async def _fake_fetch(impact=None, days_ahead=7):
        return list(events)

    monkeypatch.setattr(cal, "fetch_calendar", _fake_fetch)
    result = await cal.get_surprise_index(days=30, sigma=1.0)
    assert "currencies" in result
    assert "USD" in result["currencies"]
    usd = result["currencies"]["USD"]
    assert usd["samples"] == 2  # only USD events with both actual + forecast
    # Mean surprise = ((250000-200000)/1 + (3.0-2.5)/1) / 2 = 25000.25
    assert usd["mean_surprise"] == pytest.approx(
        ((250_000 - 200_000) + (3.0 - 2.5)) / 2, rel=1e-3)
    assert "EUR" in result["currencies"]


@pytest.mark.asyncio
async def test_get_surprise_index_filters_old_events(monkeypatch):
    """Events older than the ``days`` cutoff are excluded."""
    cal = TiingoCalendar(api_key="dummy")
    now = datetime.now(timezone.utc)
    events = [
        # recent (within 30d)
        {"symbol": "USD", "title": "recent",
         "event_time": now - timedelta(days=5),
         "actual": "2.5", "forecast": "2.0"},
        # too old (60d ago)
        {"symbol": "USD", "title": "old",
         "event_time": now - timedelta(days=60),
         "actual": "5.0", "forecast": "2.0"},
    ]

    async def _fake_fetch(impact=None, days_ahead=7):
        return list(events)

    monkeypatch.setattr(cal, "fetch_calendar", _fake_fetch)
    result = await cal.get_surprise_index(days=30, sigma=1.0)
    assert result["currencies"]["USD"]["samples"] == 1
