"""
holidays.py
===========
Holiday calendar for Forex markets (2026-2027).

The FX market is closed (or severely illiquid) on a small set of global bank
holidays.  On those days the V2 strategy should refuse to open new positions
even if a session window is technically active.

The list below is a curated superset of:
    * US federal holidays (USD pairs)
    * UK bank holidays (GBP pairs)
    * Eurozone TARGET closing days (EUR pairs)
    * Japan bank holidays (JPY pairs)

For dates that fall on a weekend, the observed market closure is usually the
nearest preceding Friday or following Monday - this module returns the
*calendar* date so the caller can decide whether to skip the surrounding
window.

Usage:
    from holidays import is_holiday, get_holidays
    if is_holiday(date(2026, 1, 1)):
        ...
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Final

logger = logging.getLogger(__name__)


# Hardcoded holiday list (YYYY-MM-DD).  Updated 2026-2027.
# Sources: NY Fed, ECB TARGET2, BOE, Bank of Japan public calendars.

_HOLIDAYS_2026: Final[list[date]] = [
    # New Year's Day
    date(2026, 1, 1),
    # Epiphany (EUR - some Eurozone)
    date(2026, 1, 6),
    # MLK Day (USD)
    date(2026, 1, 19),
    # Presidents Day (USD)
    date(2026, 2, 16),
    # Washington's Birthday observed
    # Good Friday (Christian - global)
    date(2026, 4, 3),
    # Easter Monday (EUR / UK)
    date(2026, 4, 6),
    # Labour Day (global)
    date(2026, 5, 1),
    # Early May Bank Holiday (UK)
    date(2026, 5, 4),
    # Ascension Day (EUR)
    date(2026, 5, 14),
    # Memorial Day (USD)
    date(2026, 5, 25),
    # Whit Monday / Pentecost Monday (EUR)
    date(2026, 5, 25),
    # Spring Bank Holiday (UK)
    date(2026, 5, 25),
    # US Independence Day observed (Saturday 4th -> Friday 3rd)
    date(2026, 7, 3),
    # Summer Bank Holiday (UK - Scotland)
    date(2026, 8, 3),
    # Summer Bank Holiday (UK - England/Wales)
    date(2026, 8, 31),
    # Labour Day (US/Canada)
    date(2026, 9, 7),
    # Columbus Day (USD)
    date(2026, 10, 12),
    # Veterans Day (USD)
    date(2026, 11, 11),
    # Thanksgiving (USD)
    date(2026, 11, 26),
    # Christmas Day (global)
    date(2026, 12, 25),
    # Boxing Day (UK / EUR / Japan)
    date(2026, 12, 28),
    # Japan: Emperor's Birthday
    date(2026, 2, 23),
    # Japan: Golden Week - Greenery Day
    date(2026, 5, 4),
    # Japan: Children's Day
    date(2026, 5, 5),
    # Japan: Health-Sports Day
    date(2026, 10, 12),
    # Japan: Culture Day
    date(2026, 11, 3),
    # Japan: Labour Thanksgiving
    date(2026, 11, 23),
]

_HOLIDAYS_2027: Final[list[date]] = [
    date(2027, 1, 1),    # New Year's
    date(2027, 1, 6),    # Epiphany (EUR)
    date(2027, 1, 18),   # MLK Day (USD)
    date(2027, 2, 22),   # Washington's Birthday observed (Monday)
    date(2027, 3, 26),   # Good Friday
    date(2027, 3, 29),   # Easter Monday
    date(2027, 5, 3),    # Constitution Day (Japan)
    date(2027, 5, 4),    # Greenery Day (Japan)
    date(2027, 5, 5),    # Children's Day (Japan) + Europe Day
    date(2027, 5, 31),   # Memorial Day (USD) / Spring Bank Holiday (UK) / Whit Monday
    date(2027, 7, 4),    # US Independence Day (Sunday) -> observed Monday
    date(2027, 7, 5),
    date(2027, 8, 30),   # Summer Bank Holiday (UK)
    date(2027, 9, 6),    # Labour Day (US/Canada)
    date(2027, 10, 11),  # Columbus Day / Sports Day (Japan)
    date(2027, 11, 11),  # Veterans Day
    date(2027, 11, 25),  # Thanksgiving
    date(2027, 12, 24),  # Christmas Eve (early close)
    date(2027, 12, 25),  # Christmas (Saturday - observed Friday)
    date(2027, 12, 27),  # Christmas observed
    date(2027, 12, 28),  # Boxing Day observed
    date(2027, 11, 23),  # Japan Labour Thanksgiving
    date(2027, 11, 3),   # Japan Culture Day
    date(2027, 2, 23),   # Japan Emperor's Birthday (observed Tuesday if Sun)
    date(2027, 2, 11),   # Japan National Foundation Day
]

_HOLIDAYS: Final[dict[int, list[date]]] = {
    2026: _HOLIDAYS_2026,
    2027: _HOLIDAYS_2027,
}


def _normalise(d: date | datetime) -> date:
    if isinstance(d, datetime):
        return d.date()
    return d


def is_holiday(d: date | datetime) -> bool:
    """Return ``True`` if ``d`` falls on a known FX holiday."""
    d = _normalise(d)
    return d in set(_HOLIDAYS.get(d.year, []))


def get_holidays(year: int) -> list[date]:
    """Return the list of holidays for the given ``year`` (empty if unknown)."""
    return list(_HOLIDAYS.get(year, []))


def list_holidays(year: int | None = None) -> list[dict[str, str]]:
    """Return holidays for a year as ISO strings."""
    if year is None:
        year = datetime.now(timezone.utc).year
    return [{"date": d.isoformat()} for d in get_holidays(year)]


__all__ = ["is_holiday", "get_holidays", "list_holidays"]
