"""
database.py
===========
SQLite persistence layer for the Forex scalping backend.

Models mirror the Prisma schema used by the Next.js frontend so that the two
services can share the same database file (``data/trading.db``) when running
on the same Windows host.

Tables:
    * trades         - one row per closed trade
    * signals        - strategy signals (may not always execute)
    * news_events    - economic calendar events
    * daily_risk     - daily PnL / trade count tracking
    * bot_state      - bot run-state singleton
    * chat_messages  - Ollama chat history
    * settings       - key/value overrides

The module exposes a thin CRUD facade so callers don't need to touch
SQLAlchemy session internals directly.
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text, Index,
    create_engine, select,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    DeclarativeBase, Session, sessionmaker,
)

from config import settings

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Base
# --------------------------------------------------------------------------- #

class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #

class Trade(Base):
    """A closed (or open) trade record."""
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticket = Column(Integer, index=True, nullable=True)        # MT5 ticket
    symbol = Column(String(20), index=True, nullable=False)
    direction = Column(String(10), nullable=False)             # buy | sell
    volume = Column(Float, nullable=False)
    open_price = Column(Float, nullable=False)
    close_price = Column(Float, nullable=True)
    sl = Column(Float, nullable=True)
    tp = Column(Float, nullable=True)
    profit = Column(Float, default=0.0)
    pips = Column(Float, default=0.0)
    commission = Column(Float, default=0.0)
    swap = Column(Float, default=0.0)
    rr_net = Column(Float, nullable=True)
    status = Column(String(20), default="open")                # open|closed|cancelled
    open_time = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    close_time = Column(DateTime, nullable=True)
    session_name = Column(String(20), nullable=True)
    strategy = Column(String(20), default="v2")
    entry_reason = Column(Text, nullable=True)
    exit_reason = Column(Text, nullable=True)
    checklist_json = Column(Text, nullable=True)               # 8-pt checklist
    ai_verdict = Column(Text, nullable=True)
    comment = Column(String(64), default="")


class Signal(Base):
    """A strategy signal - may or may not become a trade."""
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), index=True, nullable=False)
    direction = Column(String(10), nullable=False)
    entry_price = Column(Float, nullable=False)
    sl = Column(Float, nullable=True)
    tp1 = Column(Float, nullable=True)
    tp2 = Column(Float, nullable=True)
    atr = Column(Float, nullable=True)
    adx = Column(Float, nullable=True)
    rr_net = Column(Float, nullable=True)
    regime = Column(String(20), nullable=True)
    session = Column(String(20), nullable=True)
    checklist_json = Column(Text, nullable=True)
    executed = Column(Boolean, default=False)
    trade_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        index=True)


class NewsEvent(Base):
    """Economic calendar event cached from Tiingo."""
    __tablename__ = "news_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), index=True)         # currency e.g. USD / EUR
    title = Column(String(255), nullable=False)
    impact = Column(String(10), nullable=False)     # HIGH | MEDIUM | LOW
    event_time = Column(DateTime, nullable=False, index=True)
    country = Column(String(10), nullable=True)
    actual = Column(String(50), nullable=True)
    forecast = Column(String(50), nullable=True)
    previous = Column(String(50), nullable=True)
    fetched_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DailyRisk(Base):
    """Daily risk tracker (PnL, trade count, win/loss)."""
    __tablename__ = "daily_risk"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(10), nullable=False, unique=True, index=True)  # YYYY-MM-DD
    starting_balance = Column(Float, nullable=False)
    current_balance = Column(Float, nullable=False)
    realized_pnl = Column(Float, default=0.0)
    trade_count = Column(Integer, default=0)
    win_count = Column(Integer, default=0)
    loss_count = Column(Integer, default=0)
    soft_stop_hit = Column(Boolean, default=False)
    hard_stop_hit = Column(Boolean, default=False)
    max_drawdown_pct = Column(Float, default=0.0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class WeeklyRisk(Base):
    """Weekly risk tracker."""
    __tablename__ = "weekly_risk"

    id = Column(Integer, primary_key=True, autoincrement=True)
    week_start = Column(String(10), nullable=False, unique=True, index=True)
    starting_balance = Column(Float, nullable=False)
    realized_pnl = Column(Float, default=0.0)
    weekly_stop_hit = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class BotState(Base):
    """Singleton row holding bot run-state."""
    __tablename__ = "bot_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    is_running = Column(Boolean, default=False)
    is_locked = Column(Boolean, default=False)
    lock_reason = Column(String(255), nullable=True)
    kill_switch = Column(Boolean, default=False)
    last_loop_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class ChatMessage(Base):
    """Ollama chat history."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    role = Column(String(20), nullable=False)        # user | assistant | system
    content = Column(Text, nullable=False)
    context_json = Column(Text, nullable=True)       # optional signal/trade context
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        index=True)


class Setting(Base):
    """Key/value overrides (modifiable via /api/settings)."""
    __tablename__ = "settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


# --------------------------------------------------------------------------- #
# Indices
# --------------------------------------------------------------------------- #

Index("ix_trades_status_open_time", Trade.status, Trade.open_time)
Index("ix_signals_symbol_created", Signal.symbol, Signal.created_at)
Index("ix_news_event_time_impact", NewsEvent.event_time, NewsEvent.impact)


# --------------------------------------------------------------------------- #
# Engine + session factory
# --------------------------------------------------------------------------- #

class Database:
    """Database facade - engine + sessionmaker + helpers."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        if db_path is None:
            db_path = settings.paths.db_path
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False because FastAPI runs across threads
        self.engine: Engine = create_engine(
            f"sqlite:///{db_path.as_posix()}",
            echo=False,
            future=True,
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(
            bind=self.engine, expire_on_commit=False, class_=Session,
        )
        logger.info("Database initialised at %s", db_path)

    @contextmanager
    def session(self) -> Iterator[Session]:
        """Context manager yielding a transactional session."""
        s = self.SessionLocal()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_db: Database | None = None


def get_db() -> Database:
    """Return (and lazily create) the singleton Database instance."""
    global _db
    if _db is None:
        _db = Database()
    return _db


# --------------------------------------------------------------------------- #
# CRUD helpers
# --------------------------------------------------------------------------- #

def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- Trades ----------------------------------------------------------------- #

def insert_trade(**kwargs: Any) -> int:
    """Insert a trade row. Returns the new id."""
    db = get_db()
    with db.session() as s:
        t = Trade(**kwargs)
        s.add(t)
        s.flush()
        return int(t.id)


def update_trade(trade_id: int, **fields: Any) -> bool:
    db = get_db()
    with db.session() as s:
        t = s.get(Trade, trade_id)
        if t is None:
            return False
        for k, v in fields.items():
            if hasattr(t, k):
                setattr(t, k, v)
        return True


def get_trade(trade_id: int) -> dict[str, Any] | None:
    db = get_db()
    with db.session() as s:
        t = s.get(Trade, trade_id)
        return _trade_to_dict(t) if t else None


def list_trades(limit: int = 100, offset: int = 0,
                status: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    with db.session() as s:
        stmt = select(Trade).order_by(Trade.id.desc()).limit(limit).offset(offset)
        if status:
            stmt = stmt.where(Trade.status == status)
        rows = s.execute(stmt).scalars().all()
        return [_trade_to_dict(t) for t in rows]


def _trade_to_dict(t: Trade) -> dict[str, Any]:
    return {
        "id": t.id,
        "ticket": t.ticket,
        "symbol": t.symbol,
        "direction": t.direction,
        "volume": t.volume,
        "open_price": t.open_price,
        "close_price": t.close_price,
        "sl": t.sl,
        "tp": t.tp,
        "profit": t.profit,
        "pips": t.pips,
        "commission": t.commission,
        "swap": t.swap,
        "rr_net": t.rr_net,
        "status": t.status,
        "open_time": t.open_time.isoformat() if t.open_time else None,
        "close_time": t.close_time.isoformat() if t.close_time else None,
        "session_name": t.session_name,
        "strategy": t.strategy,
        "entry_reason": t.entry_reason,
        "exit_reason": t.exit_reason,
        "checklist": json.loads(t.checklist_json) if t.checklist_json else None,
        "ai_verdict": t.ai_verdict,
        "comment": t.comment,
    }


# --- Signals ---------------------------------------------------------------- #

def insert_signal(**kwargs: Any) -> int:
    db = get_db()
    with db.session() as s:
        sig = Signal(**kwargs)
        s.add(sig)
        s.flush()
        return int(sig.id)


def list_signals(limit: int = 50, symbol: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    with db.session() as s:
        stmt = select(Signal).order_by(Signal.created_at.desc()).limit(limit)
        if symbol:
            stmt = stmt.where(Signal.symbol == symbol)
        rows = s.execute(stmt).scalars().all()
        return [{
            "id": r.id,
            "symbol": r.symbol,
            "direction": r.direction,
            "entry_price": r.entry_price,
            "sl": r.sl,
            "tp1": r.tp1,
            "tp2": r.tp2,
            "atr": r.atr,
            "adx": r.adx,
            "rr_net": r.rr_net,
            "regime": r.regime,
            "session": r.session,
            "checklist": json.loads(r.checklist_json) if r.checklist_json else None,
            "executed": r.executed,
            "trade_id": r.trade_id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]


# --- News events ------------------------------------------------------------ #

def upsert_news_events(events: list[dict[str, Any]]) -> int:
    """Replace all cached news events. Returns count inserted."""
    db = get_db()
    with db.session() as s:
        s.query(NewsEvent).delete()
        for ev in events:
            s.add(NewsEvent(
                symbol=ev.get("symbol"),
                title=ev["title"],
                impact=ev.get("impact", "MEDIUM"),
                event_time=ev["event_time"],
                country=ev.get("country"),
                actual=ev.get("actual"),
                forecast=ev.get("forecast"),
                previous=ev.get("previous"),
            ))
        return len(events)


def list_news(start: datetime | None = None,
              end: datetime | None = None,
              impact: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    with db.session() as s:
        stmt = select(NewsEvent).order_by(NewsEvent.event_time.asc())
        if start:
            stmt = stmt.where(NewsEvent.event_time >= start)
        if end:
            stmt = stmt.where(NewsEvent.event_time <= end)
        if impact:
            stmt = stmt.where(NewsEvent.impact == impact)
        rows = s.execute(stmt).scalars().all()
        return [{
            "id": r.id,
            "symbol": r.symbol,
            "title": r.title,
            "impact": r.impact,
            "event_time": r.event_time.isoformat() if r.event_time else None,
            "country": r.country,
            "actual": r.actual,
            "forecast": r.forecast,
            "previous": r.previous,
        } for r in rows]


# --- Daily risk ------------------------------------------------------------- #

def get_or_create_daily(date_str: str, starting_balance: float) -> dict[str, Any]:
    db = get_db()
    with db.session() as s:
        d = s.execute(
            select(DailyRisk).where(DailyRisk.date == date_str)
        ).scalar_one_or_none()
        if d is None:
            d = DailyRisk(
                date=date_str,
                starting_balance=starting_balance,
                current_balance=starting_balance,
            )
            s.add(d)
            s.flush()
        return {
            "id": d.id,
            "date": d.date,
            "starting_balance": d.starting_balance,
            "current_balance": d.current_balance,
            "realized_pnl": d.realized_pnl,
            "trade_count": d.trade_count,
            "win_count": d.win_count,
            "loss_count": d.loss_count,
            "soft_stop_hit": d.soft_stop_hit,
            "hard_stop_hit": d.hard_stop_hit,
            "max_drawdown_pct": d.max_drawdown_pct,
        }


def update_daily(date_str: str, **fields: Any) -> bool:
    db = get_db()
    with db.session() as s:
        d = s.execute(
            select(DailyRisk).where(DailyRisk.date == date_str)
        ).scalar_one_or_none()
        if d is None:
            return False
        for k, v in fields.items():
            if hasattr(d, k):
                setattr(d, k, v)
        return True


# --- Bot state -------------------------------------------------------------- #

def get_bot_state() -> dict[str, Any]:
    db = get_db()
    with db.session() as s:
        st = s.execute(select(BotState)).scalars().first()
        if st is None:
            st = BotState()
            s.add(st)
            s.flush()
        return {
            "id": st.id,
            "is_running": st.is_running,
            "is_locked": st.is_locked,
            "lock_reason": st.lock_reason,
            "kill_switch": st.kill_switch,
            "last_loop_at": st.last_loop_at.isoformat() if st.last_loop_at else None,
            "last_error": st.last_error,
            "updated_at": st.updated_at.isoformat() if st.updated_at else None,
        }


def update_bot_state(**fields: Any) -> dict[str, Any]:
    db = get_db()
    with db.session() as s:
        st = s.execute(select(BotState)).scalars().first()
        if st is None:
            st = BotState()
            s.add(st)
        for k, v in fields.items():
            if hasattr(st, k):
                setattr(st, k, v)
        s.flush()
        return {
            "id": st.id,
            "is_running": st.is_running,
            "is_locked": st.is_locked,
            "lock_reason": st.lock_reason,
            "kill_switch": st.kill_switch,
            "last_loop_at": st.last_loop_at.isoformat() if st.last_loop_at else None,
            "last_error": st.last_error,
            "updated_at": st.updated_at.isoformat() if st.updated_at else None,
        }


# --- Chat messages ---------------------------------------------------------- #

def insert_chat(role: str, content: str,
                context: dict[str, Any] | None = None) -> int:
    db = get_db()
    with db.session() as s:
        m = ChatMessage(
            role=role,
            content=content,
            context_json=json.dumps(context) if context else None,
        )
        s.add(m)
        s.flush()
        return int(m.id)


def list_chat(limit: int = 50) -> list[dict[str, Any]]:
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(ChatMessage).order_by(ChatMessage.id.desc()).limit(limit)
        ).scalars().all()
        rows = list(reversed(rows))
        return [{
            "id": r.id,
            "role": r.role,
            "content": r.content,
            "context": json.loads(r.context_json) if r.context_json else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]


# --- Settings --------------------------------------------------------------- #

def get_setting(key: str, default: str | None = None) -> str | None:
    db = get_db()
    with db.session() as s:
        row = s.execute(
            select(Setting).where(Setting.key == key)
        ).scalar_one_or_none()
        return row.value if row else default


def set_setting(key: str, value: str) -> None:
    db = get_db()
    with db.session() as s:
        row = s.execute(
            select(Setting).where(Setting.key == key)
        ).scalar_one_or_none()
        if row is None:
            s.add(Setting(key=key, value=value))
        else:
            row.value = value


def get_all_settings() -> dict[str, str]:
    db = get_db()
    with db.session() as s:
        rows = s.execute(select(Setting)).scalars().all()
        return {r.key: r.value for r in rows}


__all__ = [
    "Base", "Database", "get_db",
    "Trade", "Signal", "NewsEvent", "DailyRisk", "WeeklyRisk",
    "BotState", "ChatMessage", "Setting",
    # CRUD
    "insert_trade", "update_trade", "get_trade", "list_trades",
    "insert_signal", "list_signals",
    "upsert_news_events", "list_news",
    "get_or_create_daily", "update_daily",
    "get_bot_state", "update_bot_state",
    "insert_chat", "list_chat",
    "get_setting", "set_setting", "get_all_settings",
]
