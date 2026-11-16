"""
seasonality.py
==============
Trade seasonality analysis (by day-of-week, month, hour, session).

Persists aggregated stats to the ``seasonality_stats`` DB table so the
frontend can render heatmaps without re-querying the trades table each time.

Endpoints exposed by main.py:
    GET /api/analytics/seasonality          — return all analysis
    GET /api/analytics/seasonality/score    — seasonality score for a date
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Index, Integer, String, Text, select,
)

import database as db
from database import Base, get_db
from config import SESSIONS_WIB

logger = logging.getLogger(__name__)


# WIB timezone
try:
    from zoneinfo import ZoneInfo
    WIB_TZ = ZoneInfo("Asia/Jakarta")
except Exception:  # pragma: no cover
    WIB_TZ = timezone(timedelta(hours=7))


# --------------------------------------------------------------------------- #
# Model — registered on Base.metadata so create_all() picks it up.
# --------------------------------------------------------------------------- #

class SeasonalityStat(Base):
    """Aggregated seasonality stats per (period_type, period_value).

    period_type ∈ {"day_of_week", "month", "hour", "session"}
    period_value ∈ {"MON", "TUE", ...} | {"JAN", "FEB", ...} | {"00", "01", ...}
                    | {"tokyo", "london", "overlap", "off"}
    """
    __tablename__ = "seasonality_stats"
    id = Column(Integer, primary_key=True, autoincrement=True)
    period_type = Column(String(20), nullable=False, index=True)
    period_value = Column(String(20), nullable=False, index=True)
    trades = Column(Integer, default=0)
    wins = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    win_rate = Column(Float, default=0.0)
    r_net = Column(Float, default=0.0)        # cumulative R
    avg_profit = Column(Float, default=0.0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


Index("ix_seasonality_type_value",
      SeasonalityStat.period_type, SeasonalityStat.period_value)


# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

DAY_NAMES: list[str] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
MONTH_NAMES: list[str] = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _parse_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:len(fmt) + 6
                                      if "%" in fmt else len(s)], fmt)
        except ValueError:
            continue
    return None


def _classify_session(hour_wib: int) -> str:
    """Classify a WIB hour into a session name."""
    for name, (start, end) in SESSIONS_WIB.items():
        if start <= hour_wib < end:
            return name
    return "off"


def _win(t: dict[str, Any]) -> bool:
    return _safe_float(t.get("profit")) > 0


def _loss(t: dict[str, Any]) -> bool:
    return _safe_float(t.get("profit")) < 0


def _aggregate(trades: list[dict[str, Any]],
               key_fn) -> dict[str, dict[str, Any]]:
    """Aggregate trades into buckets keyed by ``key_fn(trade) -> str``."""
    buckets: dict[str, dict[str, Any]] = {}
    for t in trades:
        key = key_fn(t)
        if key is None:
            continue
        b = buckets.setdefault(key, {
            "trades": 0, "wins": 0, "losses": 0,
            "r_net_sum": 0.0, "profit_sum": 0.0,
        })
        b["trades"] += 1
        if _win(t):
            b["wins"] += 1
        elif _loss(t):
            b["losses"] += 1
        b["r_net_sum"] += _safe_float(t.get("rr_net"))
        b["profit_sum"] += _safe_float(t.get("profit"))
    return buckets


def _summarise(buckets: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for k, b in buckets.items():
        trades = b["trades"]
        win_rate = (b["wins"] / trades * 100.0) if trades else 0.0
        avg_profit = (b["profit_sum"] / trades) if trades else 0.0
        out[k] = {
            "trades": trades,
            "wins": b["wins"],
            "losses": b["losses"],
            "win_rate_pct": round(win_rate, 2),
            "r_net": round(b["r_net_sum"], 2),
            "avg_profit": round(avg_profit, 2),
        }
    return out


# --------------------------------------------------------------------------- #
# SeasonalityAnalyzer
# --------------------------------------------------------------------------- #

class SeasonalityAnalyzer:
    """Compute + persist seasonality stats across multiple dimensions."""

    # ------------------------------------------------------------------ #
    # Analysis methods
    # ------------------------------------------------------------------ #

    def analyze_by_day_of_week(self,
                               trades: list[dict[str, Any]]
                               ) -> dict[str, Any]:
        """Win rate per day-of-week (Senin-Sabtu, in WIB)."""
        def key_fn(t: dict[str, Any]) -> str | None:
            ct = _parse_dt(t.get("close_time") or t.get("open_time"))
            if ct is None:
                return None
            ct_wib = ct.astimezone(WIB_TZ)
            wd = ct_wib.weekday()
            return DAY_NAMES[wd] if wd < len(DAY_NAMES) else "UNKNOWN"
        return _summarise(_aggregate(trades, key_fn))

    def analyze_by_month(self,
                         trades: list[dict[str, Any]]
                         ) -> dict[str, Any]:
        """Win rate per month (Januari-Desember)."""
        def key_fn(t: dict[str, Any]) -> str | None:
            ct = _parse_dt(t.get("close_time") or t.get("open_time"))
            if ct is None:
                return None
            ct_wib = ct.astimezone(WIB_TZ)
            m = ct_wib.month - 1
            return MONTH_NAMES[m] if 0 <= m < 12 else "UNKNOWN"
        return _summarise(_aggregate(trades, key_fn))

    def analyze_by_hour(self,
                        trades: list[dict[str, Any]]
                        ) -> dict[str, Any]:
        """Win rate per hour (WIB)."""
        def key_fn(t: dict[str, Any]) -> str | None:
            ct = _parse_dt(t.get("close_time") or t.get("open_time"))
            if ct is None:
                return None
            ct_wib = ct.astimezone(WIB_TZ)
            return f"{ct_wib.hour:02d}"
        return _summarise(_aggregate(trades, key_fn))

    def analyze_by_session(self,
                           trades: list[dict[str, Any]]
                           ) -> dict[str, Any]:
        """Win rate per session (Tokyo / London / Overlap / Off)."""
        def key_fn(t: dict[str, Any]) -> str | None:
            ct = _parse_dt(t.get("close_time") or t.get("open_time"))
            if ct is None:
                return None
            ct_wib = ct.astimezone(WIB_TZ)
            return _classify_session(ct_wib.hour)
        return _summarise(_aggregate(trades, key_fn))

    # ------------------------------------------------------------------ #
    # Best / worst periods
    # ------------------------------------------------------------------ #

    def get_best_trading_days(self,
                              trades: list[dict[str, Any]],
                              top_n: int = 3) -> list[dict[str, Any]]:
        """Return top-N day-of-week buckets sorted by R-net (desc)."""
        buckets = self.analyze_by_day_of_week(trades)
        ranked = sorted(buckets.items(),
                        key=lambda kv: kv[1]["r_net"], reverse=True)
        return [{"period": k, **v} for k, v in ranked[:top_n]]

    def get_best_trading_months(self,
                                trades: list[dict[str, Any]],
                                top_n: int = 3) -> list[dict[str, Any]]:
        """Return top-N month buckets sorted by R-net (desc)."""
        buckets = self.analyze_by_month(trades)
        ranked = sorted(buckets.items(),
                        key=lambda kv: kv[1]["r_net"], reverse=True)
        return [{"period": k, **v} for k, v in ranked[:top_n]]

    # ------------------------------------------------------------------ #
    # Scoring
    # ------------------------------------------------------------------ #

    def get_seasonality_score(self,
                              target_date: date | datetime,
                              trades: list[dict[str, Any]] | None = None
                              ) -> float:
        """Return a 0-100 seasonality score for ``target_date``.

        The score is a weighted blend of:
          * day-of-week win rate
          * month win rate
          * day-of-week R-net (normalised)
          * month R-net (normalised)

        Higher = more favourable to trade.  Scores below 50 = below average.
        """
        if trades is None:
            trades = self._load_recent_trades(days=180)
        if not trades:
            return 50.0  # neutral

        if isinstance(target_date, datetime):
            dt = target_date.astimezone(WIB_TZ) if target_date.tzinfo \
                else target_date.replace(tzinfo=WIB_TZ)
        else:
            if target_date is None:
                target_date = datetime.now(WIB_TZ).date()
            dt = datetime.combine(target_date, datetime.min.time(),
                                  tzinfo=WIB_TZ)

        day_buckets = self.analyze_by_day_of_week(trades)
        month_buckets = self.analyze_by_month(trades)
        day_key = DAY_NAMES[dt.weekday()]
        month_key = MONTH_NAMES[dt.month - 1]
        day_b = day_buckets.get(day_key, {})
        month_b = month_buckets.get(month_key, {})

        day_wr = _safe_float(day_b.get("win_rate_pct"), 50.0)
        month_wr = _safe_float(month_b.get("win_rate_pct"), 50.0)

        # Normalise R-net to a 0-100 scale: cap at ±5R
        all_day_r = [b.get("r_net", 0.0) for b in day_buckets.values()]
        max_day_r = max([abs(v) for v in all_day_r] + [1.0])
        day_r_norm = 50.0 + 50.0 * (_safe_float(day_b.get("r_net"))
                                    / max_day_r)
        all_month_r = [b.get("r_net", 0.0) for b in month_buckets.values()]
        max_month_r = max([abs(v) for v in all_month_r] + [1.0])
        month_r_norm = 50.0 + 50.0 * (_safe_float(month_b.get("r_net"))
                                      / max_month_r)

        score = (day_wr * 0.30 + month_wr * 0.20
                 + day_r_norm * 0.30 + month_r_norm * 0.20)
        return max(0.0, min(100.0, round(score, 2)))

    def should_trade_today(self,
                           target_date: date | datetime | None = None,
                           trades: list[dict[str, Any]] | None = None,
                           threshold: float = 50.0) -> bool:
        """Return True if the seasonality score for ``target_date`` >= threshold."""
        if target_date is None:
            target_date = datetime.now(WIB_TZ).date()
        score = self.get_seasonality_score(target_date, trades=trades)
        return score >= threshold

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #

    def persist_all(self,
                    trades: list[dict[str, Any]] | None = None) -> int:
        """Recompute all dimensions + persist to ``seasonality_stats``.

        Returns the total number of rows upserted.
        """
        if trades is None:
            trades = self._load_recent_trades(days=365)
        if not trades:
            return 0
        all_buckets = {
            "day_of_week": self.analyze_by_day_of_week(trades),
            "month": self.analyze_by_month(trades),
            "hour": self.analyze_by_hour(trades),
            "session": self.analyze_by_session(trades),
        }
        count = 0
        db_obj = get_db()
        with db_obj.session() as s:
            # Clear existing
            s.query(SeasonalityStat).delete()
            for ptype, buckets in all_buckets.items():
                for pval, b in buckets.items():
                    s.add(SeasonalityStat(
                        period_type=ptype,
                        period_value=pval,
                        trades=int(b["trades"]),
                        wins=int(b["wins"]),
                        losses=int(b["losses"]),
                        win_rate=float(b["win_rate_pct"]),
                        r_net=float(b["r_net"]),
                        avg_profit=float(b["avg_profit"]),
                    ))
                    count += 1
        logger.info("Persisted %d seasonality rows", count)
        return count

    def load_persisted(self) -> dict[str, Any]:
        """Return the persisted seasonality stats grouped by period_type."""
        db_obj = get_db()
        with db_obj.session() as s:
            rows = s.execute(
                select(SeasonalityStat)
                .order_by(SeasonalityStat.period_type.asc(),
                          SeasonalityStat.period_value.asc())
            ).scalars().all()
        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            out.setdefault(r.period_type, {})[r.period_value] = {
                "trades": r.trades,
                "wins": r.wins,
                "losses": r.losses,
                "win_rate_pct": round(r.win_rate, 2),
                "r_net": round(r.r_net, 2),
                "avg_profit": round(r.avg_profit, 2),
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
        return out

    # ------------------------------------------------------------------ #
    # All-in-one
    # ------------------------------------------------------------------ #

    def analyze_all(self,
                    trades: list[dict[str, Any]] | None = None
                    ) -> dict[str, Any]:
        """Return every dimension in one dict (used by GET /api/analytics/seasonality)."""
        if trades is None:
            trades = self._load_recent_trades(days=365)
        if not trades:
            return {
                "by_day_of_week": {},
                "by_month": {},
                "by_hour": {},
                "by_session": {},
                "best_days": [],
                "best_months": [],
                "today_score": 0.0,
                "should_trade_today": True,
                "trade_count": 0,
            }
        today = datetime.now(WIB_TZ).date()
        return {
            "by_day_of_week": self.analyze_by_day_of_week(trades),
            "by_month": self.analyze_by_month(trades),
            "by_hour": self.analyze_by_hour(trades),
            "by_session": self.analyze_by_session(trades),
            "best_days": self.get_best_trading_days(trades),
            "best_months": self.get_best_trading_months(trades),
            "today_score": self.get_seasonality_score(today, trades),
            "should_trade_today": self.should_trade_today(today, trades),
            "trade_count": len(trades),
        }

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _load_recent_trades(days: int = 365) -> list[dict[str, Any]]:
        """Load closed trades from the last ``days`` days."""
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            rows = db.list_trades(limit=10_000)
            out = []
            for t in rows:
                if t.get("status") != "closed":
                    continue
                ct = _parse_dt(t.get("close_time") or t.get("open_time"))
                if ct is None or ct >= cutoff:
                    out.append(t)
            return out
        except Exception as exc:  # pragma: no cover
            logger.warning("load_recent_trades failed: %s", exc)
            return []


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_analyzer: SeasonalityAnalyzer | None = None


def get_seasonality_analyzer() -> SeasonalityAnalyzer:
    """Return the module-level SeasonalityAnalyzer singleton."""
    global _default_analyzer
    if _default_analyzer is None:
        _default_analyzer = SeasonalityAnalyzer()
    return _default_analyzer


__all__ = [
    "SeasonalityAnalyzer",
    "SeasonalityStat",
    "get_seasonality_analyzer",
    "DAY_NAMES", "MONTH_NAMES",
]
