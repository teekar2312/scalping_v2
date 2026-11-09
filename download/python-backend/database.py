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
from datetime import datetime, timedelta, timezone
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
from sqlalchemy.types import Enum as SAEnum

from config import settings

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Sprint 5 #2: optional SQLCipher encryption at rest
# --------------------------------------------------------------------------- #

try:
    import sqlcipher3  # noqa: F401  (only the import side-effect matters)
    _SQLCIPHER_AVAILABLE = True
except ImportError:  # pragma: no cover
    _SQLCIPHER_AVAILABLE = False


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
    # ---- V2 stage tracking (audit fixes) ---- #
    stage = Column(String(20), default="OPEN")   # OPEN|TP1_HIT|TP2_HIT|TRAILING|CLOSED
    tp1_hit = Column(Boolean, default=False)
    tp2_hit = Column(Boolean, default=False)
    trailing_active = Column(Boolean, default=False)
    remaining_volume = Column(Float, nullable=True)            # residual after partial
    original_volume = Column(Float, nullable=True)              # initial volume
    emotional_state = Column(String(32), nullable=True)         # post-trade log
    emotional_note = Column(Text, nullable=True)
    strategy_version = Column(String(16), default="v2.0")
    is_paper = Column(Boolean, default=False)                   # paper-mode flag
    # ---- Sprint 7 #17: slippage + latency ---- #
    slippage_actual = Column(Float, nullable=True)             # pips (fill - req)
    execution_latency_ms = Column(Integer, nullable=True)      # order ack latency


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
    # ---- Streak + cooldown (audit fixes) ---- #
    consecutive_loss_count = Column(Integer, default=0)
    consecutive_win_count = Column(Integer, default=0)
    last_loss_time = Column(DateTime, nullable=True)
    last_win_time = Column(DateTime, nullable=True)
    cooldown_until = Column(DateTime, nullable=True)
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
    # ---- audit fixes: paper / dry-run mode ---- #
    is_paper = Column(Boolean, default=False)
    is_dry_run = Column(Boolean, default=False)
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
# Audit-fix models (Sprint 1-3)
# --------------------------------------------------------------------------- #

class AuditLog(Base):
    """Immutable audit trail of every important engine event.

    Rows are written by :class:`trading_engine.EventBus.publish` so that
    every WebSocket-pushed event also persists.

    Sprint 6 #10: hash-chained immutability
    ---------------------------------------
    Each row stores ``prev_hash`` (the ``hash`` of the immediately preceding
    row) and ``hash`` (SHA-256 of ``prev_hash + event_type + timestamp +
    detail_json``).  SQLite triggers prevent UPDATE/DELETE on the table so
    rows are tamper-evident.  Use :func:`verify_audit_chain` to validate the
    chain at any time.
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                       index=True)
    event_type = Column(String(32), index=True, nullable=False)
    symbol = Column(String(20), nullable=True)
    ticket = Column(Integer, nullable=True)
    detail_json = Column(Text, nullable=True)
    severity = Column(String(10), default="INFO")  # INFO|WARN|ERROR|CRITICAL
    # ---- Sprint 6 #10: hash chain ---- #
    prev_hash = Column(String(64), nullable=True)
    hash = Column(String(64), nullable=True, index=True)
    signature = Column(Text, nullable=True)  # reserved for future HMAC sign


class EquityCurve(Base):
    """Equity curve sample - one row per ~60s during the trading loop."""
    __tablename__ = "equity_curve"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                       index=True)
    balance = Column(Float, default=0.0)
    equity = Column(Float, default=0.0)
    floating_pnl = Column(Float, default=0.0)
    daily_pnl_pct = Column(Float, default=0.0)
    drawdown_pct = Column(Float, default=0.0)
    peak_equity = Column(Float, default=0.0)


class BacktestResult(Base):
    """Saved backtest results (Sprint 2 #11)."""
    __tablename__ = "backtest_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(20), index=True, nullable=False)
    timeframe = Column(String(8), nullable=False)
    start_date = Column(String(20), nullable=False)
    end_date = Column(String(20), nullable=False)
    initial_balance = Column(Float, default=10_000.0)
    final_balance = Column(Float, default=0.0)
    total_trades = Column(Integer, default=0)
    wins = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    win_rate_pct = Column(Float, default=0.0)
    r_net_avg = Column(Float, default=0.0)
    profit_factor = Column(Float, default=0.0)
    max_drawdown_pct = Column(Float, default=0.0)
    compliance_score_pct = Column(Float, default=0.0)
    trades_json = Column(Text, nullable=True)        # list of trade dicts
    metrics_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        index=True)


# --------------------------------------------------------------------------- #
# Sprint 5 #3: encrypted secrets table
# --------------------------------------------------------------------------- #

class Secret(Base):
    """Encrypted secret stored at rest (Fernet token in ``encrypted_value``)."""
    __tablename__ = "secrets"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), unique=True, nullable=False, index=True)
    encrypted_value = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


# --------------------------------------------------------------------------- #
# Sprint 5 #6: users + roles for NextAuth integration
# --------------------------------------------------------------------------- #

class UserRole:
    """String constants for user roles (stored as plain VARCHAR)."""
    ADMIN = "ADMIN"
    TRADER = "TRADER"
    VIEWER = "VIEWER"


class User(Base):
    """User account with role-based access.  Password is bcrypt-hashed."""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    api_key = Column(String(128), unique=True, nullable=True, index=True)
    role = Column(String(16), default=UserRole.VIEWER, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


# --------------------------------------------------------------------------- #
# Sprint 6 #9: signed risk-disclosure acknowledgments
# --------------------------------------------------------------------------- #

class RiskAcknowledgment(Base):
    """Signed risk disclosure - one row per user / version / acknowledgement."""
    __tablename__ = "risk_acknowledgments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=True, index=True)  # nullable for static-key mode
    version = Column(String(32), nullable=False, index=True)
    acknowledged_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                             nullable=False, index=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)


# --------------------------------------------------------------------------- #
# Sprint 6 #12: trade reconstruction tick-level events
# --------------------------------------------------------------------------- #

class TradeEvent(Base):
    """Tick-level event for a single trade (entry, SL move, TP hits, ...)."""
    __tablename__ = "trade_events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    trade_id = Column(Integer, nullable=False, index=True)
    ticket = Column(Integer, nullable=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                       nullable=False, index=True)
    event_type = Column(String(20), nullable=False)
    # ENTRY | SL_MOVE | TP1_HIT | TP2_HIT | PARTIAL_CLOSE |
    # TRAILING_UPDATE | SL_HIT | MANUAL_CLOSE | INVALID_EXIT
    price = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    sl = Column(Float, nullable=True)
    tp = Column(Float, nullable=True)
    detail_json = Column(Text, nullable=True)
    ms_precision = Column(Integer, nullable=True)  # extra ms offset for sub-second events


# --------------------------------------------------------------------------- #
# Sprint 7 #17: latency sampling
# --------------------------------------------------------------------------- #

class LatencySample(Base):
    """Endpoint / operation latency sample with percentile rollup."""
    __tablename__ = "latency_samples"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                       nullable=False, index=True)
    endpoint = Column(String(64), nullable=False, index=True)
    latency_ms = Column(Float, nullable=False)
    percentile_p50 = Column(Float, nullable=True)
    percentile_p95 = Column(Float, nullable=True)
    percentile_p99 = Column(Float, nullable=True)


# --------------------------------------------------------------------------- #
# Sprint 8 #20: stress-test results persistence (so /results/{id} can fetch)
# --------------------------------------------------------------------------- #

class StressTestResult(Base):
    """Saved stress-test run result."""
    __tablename__ = "stress_test_results"
    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        index=True)
    trades_period_days = Column(Integer, nullable=True)
    balance = Column(Float, nullable=True)
    results_json = Column(Text, nullable=False)


# --------------------------------------------------------------------------- #
# Indices
# --------------------------------------------------------------------------- #

Index("ix_trades_status_open_time", Trade.status, Trade.open_time)
Index("ix_signals_symbol_created", Signal.symbol, Signal.created_at)
Index("ix_news_event_time_impact", NewsEvent.event_time, NewsEvent.impact)
Index("ix_audit_log_event_ts", AuditLog.event_type, AuditLog.timestamp)
Index("ix_trades_stage_status", Trade.stage, Trade.status)
Index("ix_trade_events_trade_ts", TradeEvent.trade_id, TradeEvent.timestamp)
Index("ix_risk_ack_user_version", RiskAcknowledgment.user_id,
      RiskAcknowledgment.version)


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
        encryption_key = self._get_encryption_key()
        self.engine: Engine = self._create_engine(db_path, encryption_key)
        Base.metadata.create_all(self.engine)
        # Migrate any pre-existing tables by issuing additive ALTER TABLE
        # statements (SQLite supports ADD COLUMN only).  Wrapped in try/except
        # because the columns may already exist on a fresh DB.
        self._migrate_additive_columns()
        # Sprint 6 #10: install immutability triggers on audit_log
        self._install_audit_immutability_triggers()
        self.SessionLocal = sessionmaker(
            bind=self.engine, expire_on_commit=False, class_=Session,
        )
        if encryption_key and _SQLCIPHER_AVAILABLE:
            logger.info("Database initialised at %s (SQLCipher encrypted)",
                        db_path)
        else:
            mode = "plaintext (SQLCipher not available)" if encryption_key \
                else "plaintext"
            logger.info("Database initialised at %s (%s)",
                        db_path, mode)

    # ---- Sprint 5 #2: encryption at rest ---------------------------------- #

    @staticmethod
    def _get_encryption_key() -> str | None:
        """Read DB_ENCRYPTION_KEY env var (32-byte hex).  Returns None if unset."""
        import os as _os
        key = _os.environ.get("DB_ENCRYPTION_KEY", "").strip()
        if not key:
            return None
        # The key may be a 64-char hex string (32 bytes).  sqlcipher3 wants
        # the raw passphrase via PRAGMA key; hex form is fine.
        return key

    @staticmethod
    def _create_engine(db_path: Path, encryption_key: str | None) -> Engine:
        """Create a SQLAlchemy engine - SQLCipher if key+package are available,
        plain SQLite otherwise.
        """
        connect_args: dict[str, Any] = {"check_same_thread": False}
        url = f"sqlite:///{db_path.as_posix()}"

        if encryption_key and _SQLCIPHER_AVAILABLE:
            # Use the pysqlcipher dialect if installed; otherwise fall back to
            # the sqlite dialect with a post-connect PRAGMA via an event hook.
            # The simplest portable approach: use sqlite dialect + a listener.
            from sqlalchemy import event

            @event.listens_for("connect", named=True)
            def _on_connect(**kw: Any) -> None:
                conn = kw.get("connection")
                if conn is None:
                    return
                cur = conn.cursor()
                cur.execute(f"PRAGMA key='{encryption_key}'")
                # also enforce cipher page size for compatibility
                cur.execute("PRAGMA cipher_page_size = 4096")

            engine = create_engine(
                url, echo=False, future=True, connect_args=connect_args,
            )
            return engine

        if encryption_key and not _SQLCIPHER_AVAILABLE:
            logger.warning(
                "DB_ENCRYPTION_KEY is set but sqlcipher3 is not installed - "
                "falling back to PLAINTEXT SQLite.  Run: "
                "pip install sqlcipher3-binary  (Sprint 5 #2)",
            )
        return create_engine(
            url, echo=False, future=True, connect_args=connect_args,
        )

    # ---- Sprint 6 #10: immutability triggers ------------------------------ #

    def _install_audit_immutability_triggers(self) -> None:
        """Install BEFORE UPDATE / BEFORE DELETE triggers on audit_log that
        abort the operation, making the table truly append-only.
        """
        from sqlalchemy import text, inspect
        insp = inspect(self.engine)
        if not insp.has_table("audit_log"):
            return
        with self.engine.begin() as conn:
            for name, body in (
                ("audit_log_no_update",
                 "BEGIN SELECT RAISE(ABORT, 'audit_log is immutable'); END;"),
                ("audit_log_no_delete",
                 "BEGIN SELECT RAISE(ABORT, 'audit_log is immutable'); END;"),
            ):
                # SQLite trig IF NOT EXISTS isn't supported prior to 3.33;
                # instead try to drop silently.
                try:
                    conn.execute(text(f"DROP TRIGGER IF EXISTS {name}"))
                except Exception:  # pragma: no cover
                    pass
                try:
                    stmt = (f"CREATE TRIGGER {name} "
                            f"BEFORE {'UPDATE' if 'update' in name else 'DELETE'} "
                            f"ON audit_log {body}")
                    conn.execute(text(stmt))
                except Exception as exc:  # pragma: no cover
                    logger.warning("Failed to install trigger %s: %s", name, exc)

    # ---- Lightweight additive migration ---------------------------------- #

    _ADDITIVE_COLUMNS: dict[str, list[tuple[str, str, str]]] = {
        # table -> list of (column, sql_type, default_literal)
        "trades": [
            ("stage", "VARCHAR(20)", "'OPEN'"),
            ("tp1_hit", "BOOLEAN", "0"),
            ("tp2_hit", "BOOLEAN", "0"),
            ("trailing_active", "BOOLEAN", "0"),
            ("remaining_volume", "FLOAT", "NULL"),
            ("original_volume", "FLOAT", "NULL"),
            ("emotional_state", "VARCHAR(32)", "NULL"),
            ("emotional_note", "TEXT", "NULL"),
            ("strategy_version", "VARCHAR(16)", "'v2.0'"),
            ("is_paper", "BOOLEAN", "0"),
            # Sprint 7 #17
            ("slippage_actual", "FLOAT", "NULL"),
            ("execution_latency_ms", "INTEGER", "NULL"),
        ],
        "daily_risk": [
            ("consecutive_loss_count", "INTEGER", "0"),
            ("consecutive_win_count", "INTEGER", "0"),
            ("last_loss_time", "DATETIME", "NULL"),
            ("last_win_time", "DATETIME", "NULL"),
            ("cooldown_until", "DATETIME", "NULL"),
        ],
        "bot_state": [
            ("is_paper", "BOOLEAN", "0"),
            ("is_dry_run", "BOOLEAN", "0"),
        ],
        "audit_log": [
            # Sprint 6 #10
            ("prev_hash", "VARCHAR(64)", "NULL"),
            ("hash", "VARCHAR(64)", "NULL"),
            ("signature", "TEXT", "NULL"),
        ],
    }

    def _migrate_additive_columns(self) -> None:
        """Add new columns to legacy SQLite tables (idempotent)."""
        from sqlalchemy import text, inspect
        insp = inspect(self.engine)
        for table, cols in self._ADDITIVE_COLUMNS.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            with self.engine.begin() as conn:
                for col, sql_type, default in cols:
                    if col in existing:
                        continue
                    stmt = (f"ALTER TABLE {table} ADD COLUMN {col} "
                            f"{sql_type} DEFAULT {default}")
                    try:
                        conn.execute(text(stmt))
                    except Exception as exc:  # pragma: no cover
                        logger.warning(
                            "Additive migration %s.%s skipped: %s",
                            table, col, exc,
                        )

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
        # ---- new V2 fields ---- #
        "stage": getattr(t, "stage", None),
        "tp1_hit": getattr(t, "tp1_hit", None),
        "tp2_hit": getattr(t, "tp2_hit", None),
        "trailing_active": getattr(t, "trailing_active", None),
        "remaining_volume": getattr(t, "remaining_volume", None),
        "original_volume": getattr(t, "original_volume", None),
        "emotional_state": getattr(t, "emotional_state", None),
        "emotional_note": getattr(t, "emotional_note", None),
        "strategy_version": getattr(t, "strategy_version", None),
        "is_paper": getattr(t, "is_paper", None),
        # Sprint 7 #17
        "slippage_actual": getattr(t, "slippage_actual", None),
        "execution_latency_ms": getattr(t, "execution_latency_ms", None),
    }


def get_trade_by_ticket(ticket: int) -> dict[str, Any] | None:
    """Fetch a single trade row by MT5 ticket (or None)."""
    db = get_db()
    with db.session() as s:
        t = s.execute(
            select(Trade).where(Trade.ticket == int(ticket))
        ).scalar_one_or_none()
        return _trade_to_dict(t) if t else None


def get_trade_orm_by_ticket(ticket: int) -> Trade | None:
    """Return the ORM object for ``ticket`` so callers can mutate fields."""
    db = get_db()
    s = db.SessionLocal()
    try:
        t = s.execute(
            select(Trade).where(Trade.ticket == int(ticket))
        ).scalar_one_or_none()
        if t is not None:
            s.expunge(t)   # detach so caller can hand it back via update_trade
        return t
    finally:
        s.close()


def list_open_trades() -> list[dict[str, Any]]:
    """Return all trades that are still ``status='open'``."""
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(Trade)
            .where(Trade.status == "open")
            .order_by(Trade.open_time.desc())
        ).scalars().all()
        return [_trade_to_dict(t) for t in rows]


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
            "consecutive_loss_count": getattr(d, "consecutive_loss_count", 0),
            "consecutive_win_count": getattr(d, "consecutive_win_count", 0),
            "last_loss_time": (d.last_loss_time.isoformat()
                               if getattr(d, "last_loss_time", None) else None),
            "last_win_time": (d.last_win_time.isoformat()
                              if getattr(d, "last_win_time", None) else None),
            "cooldown_until": (d.cooldown_until.isoformat()
                               if getattr(d, "cooldown_until", None) else None),
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
            "is_paper": getattr(st, "is_paper", False),
            "is_dry_run": getattr(st, "is_dry_run", False),
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
            "is_paper": getattr(st, "is_paper", False),
            "is_dry_run": getattr(st, "is_dry_run", False),
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


# --------------------------------------------------------------------------- #
# AuditLog (Sprint 1 #3 + #10)
# --------------------------------------------------------------------------- #

def insert_audit_log(event_type: str,
                     symbol: str | None = None,
                     ticket: int | None = None,
                     detail: dict[str, Any] | None = None,
                     severity: str = "INFO") -> int:
    """Insert an audit log row.

    Sprint 6 #10: also computes the hash chain (prev_hash + event_type +
    timestamp + detail_json) so the table is tamper-evident.
    """
    import hashlib as _hashlib
    db = get_db()
    now = _now()
    # SQLAlchemy + SQLite store the timestamp as a naive ISO string (tzinfo
    # is stripped from the column value).  Compute the hash from the *naive*
    # ISO form so verify_audit_chain() can recompute deterministically.
    now_naive = now.replace(tzinfo=None) if now.tzinfo else now
    now_iso = now_naive.isoformat()
    detail_str = json.dumps(detail, default=str) if detail else ""
    # fetch the last row's hash
    with db.session() as s:
        last = s.execute(
            select(AuditLog).order_by(AuditLog.id.desc()).limit(1)
        ).scalar_one_or_none()
        prev_hash = (last.hash if last is not None and getattr(last, "hash", None)
                     else "")
        chain_input = f"{prev_hash}|{event_type}|{now_iso}|{detail_str}"
        row_hash = _hashlib.sha256(chain_input.encode("utf-8")).hexdigest()
        row = AuditLog(
            event_type=event_type,
            symbol=symbol,
            ticket=ticket,
            detail_json=detail_str or None,
            severity=severity,
            # Use the SAME `now_naive` value for both the hash and the column
            # so verify_audit_chain() can recompute the hash deterministically.
            timestamp=now_naive,
            prev_hash=prev_hash or None,
            hash=row_hash,
        )
        s.add(row)
        s.flush()
        return int(row.id)


def list_audit_log(limit: int = 200,
                   offset: int = 0,
                   event_type: str | None = None,
                   severity: str | None = None,
                   start: datetime | None = None,
                   end: datetime | None = None) -> list[dict[str, Any]]:
    """Query audit log rows with optional filters."""
    db = get_db()
    with db.session() as s:
        stmt = (select(AuditLog)
                .order_by(AuditLog.id.desc())
                .limit(limit).offset(offset))
        if event_type:
            stmt = stmt.where(AuditLog.event_type == event_type)
        if severity:
            stmt = stmt.where(AuditLog.severity == severity)
        if start:
            stmt = stmt.where(AuditLog.timestamp >= start)
        if end:
            stmt = stmt.where(AuditLog.timestamp <= end)
        rows = s.execute(stmt).scalars().all()
        return [{
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "event_type": r.event_type,
            "symbol": r.symbol,
            "ticket": r.ticket,
            "detail": json.loads(r.detail_json) if r.detail_json else None,
            "severity": r.severity,
            "prev_hash": getattr(r, "prev_hash", None),
            "hash": getattr(r, "hash", None),
        } for r in rows]


# --------------------------------------------------------------------------- #
# Sprint 6 #10: audit chain verification
# --------------------------------------------------------------------------- #

def verify_audit_chain() -> dict[str, Any]:
    """Recompute every audit_log row's hash and compare to the stored value.

    Returns ``{"valid": bool, "checked": int, "broken_at": int|None}``.
    """
    import hashlib as _hashlib
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(AuditLog).order_by(AuditLog.id.asc())
        ).scalars().all()
    prev_hash = ""
    checked = 0
    broken_at: int | None = None
    for r in rows:
        detail_str = r.detail_json or ""
        ts = r.timestamp
        # Normalise the timestamp to a naive ISO string (drop tzinfo) so the
        # recompute matches what SQLAlchemy stored in the DB (SQLite strips
        # tzinfo from the column value).
        if ts is not None:
            ts_naive = ts.replace(tzinfo=None) if ts.tzinfo else ts
            ts_iso = ts_naive.isoformat()
        else:
            ts_iso = ""
        chain_input = f"{prev_hash}|{r.event_type}|{ts_iso}|{detail_str}"
        expected = _hashlib.sha256(chain_input.encode("utf-8")).hexdigest()
        stored = getattr(r, "hash", None) or ""
        prev_stored = getattr(r, "prev_hash", None) or ""
        if expected != stored or prev_stored != prev_hash:
            broken_at = r.id
            break
        prev_hash = stored
        checked += 1
    return {
        "valid": broken_at is None,
        "checked": checked,
        "total": len(rows),
        "broken_at": broken_at,
    }


# --------------------------------------------------------------------------- #
# EquityCurve (Sprint 3 #19)
# --------------------------------------------------------------------------- #

def insert_equity_sample(balance: float, equity: float,
                         floating_pnl: float,
                         daily_pnl_pct: float,
                         drawdown_pct: float,
                         peak_equity: float) -> int:
    db = get_db()
    with db.session() as s:
        row = EquityCurve(
            balance=balance, equity=equity,
            floating_pnl=floating_pnl,
            daily_pnl_pct=daily_pnl_pct,
            drawdown_pct=drawdown_pct,
            peak_equity=peak_equity,
        )
        s.add(row)
        s.flush()
        return int(row.id)


def list_equity_curve(hours: float = 24.0) -> list[dict[str, Any]]:
    """Return equity samples from the last ``hours`` hours."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    with db.session() as s:
        rows = s.execute(
            select(EquityCurve)
            .where(EquityCurve.timestamp >= cutoff)
            .order_by(EquityCurve.timestamp.asc())
        ).scalars().all()
        return [{
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "balance": r.balance,
            "equity": r.equity,
            "floating_pnl": r.floating_pnl,
            "daily_pnl_pct": r.daily_pnl_pct,
            "drawdown_pct": r.drawdown_pct,
            "peak_equity": r.peak_equity,
        } for r in rows]


# --------------------------------------------------------------------------- #
# BacktestResult (Sprint 2 #11)
# --------------------------------------------------------------------------- #

def insert_backtest_result(**kwargs: Any) -> int:
    db = get_db()
    with db.session() as s:
        row = BacktestResult(**kwargs)
        s.add(row)
        s.flush()
        return int(row.id)


def get_backtest_result(result_id: int) -> dict[str, Any] | None:
    db = get_db()
    with db.session() as s:
        r = s.get(BacktestResult, int(result_id))
        if r is None:
            return None
        return {
            "id": r.id,
            "symbol": r.symbol,
            "timeframe": r.timeframe,
            "start_date": r.start_date,
            "end_date": r.end_date,
            "initial_balance": r.initial_balance,
            "final_balance": r.final_balance,
            "total_trades": r.total_trades,
            "wins": r.wins,
            "losses": r.losses,
            "win_rate_pct": r.win_rate_pct,
            "r_net_avg": r.r_net_avg,
            "profit_factor": r.profit_factor,
            "max_drawdown_pct": r.max_drawdown_pct,
            "compliance_score_pct": r.compliance_score_pct,
            "trades": json.loads(r.trades_json) if r.trades_json else [],
            "metrics": json.loads(r.metrics_json) if r.metrics_json else {},
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }


# --------------------------------------------------------------------------- #
# Performance attribution + compliance (Sprint 3 #20-#21)
# --------------------------------------------------------------------------- #

def _bucket_trade(t: Trade,
                  bucket_dict: dict[str, dict[str, Any]],
                  key: str) -> None:
    """Accumulate one trade's stats into bucket_dict[key]."""
    bucket = bucket_dict.setdefault(key, {
        "trades": 0, "wins": 0, "losses": 0,
        "r_net_sum": 0.0, "profit_sum": 0.0,
    })
    bucket["trades"] += 1
    pnl = float(t.profit or 0.0)
    if pnl > 0:
        bucket["wins"] += 1
    elif pnl < 0:
        bucket["losses"] += 1
    bucket["profit_sum"] += pnl
    bucket["r_net_sum"] += float(t.rr_net or 0.0)


def _summarise(buckets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, b in buckets.items():
        trades = b["trades"]
        win_rate = (b["wins"] / trades * 100.0) if trades else 0.0
        r_net_avg = (b["r_net_sum"] / trades) if trades else 0.0
        out[k] = {
            "trades": trades,
            "wins": b["wins"],
            "losses": b["losses"],
            "win_rate_pct": round(win_rate, 2),
            "r_net_avg": round(r_net_avg, 3),
            "total_profit": round(b["profit_sum"], 2),
        }
    return out


def get_performance_attribution(start_date: datetime,
                                end_date: datetime) -> dict[str, Any]:
    """Group closed trades by session / setup / regime / hour / day / pair."""
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(Trade)
            .where(Trade.status == "closed")
            .where(Trade.close_time >= start_date)
            .where(Trade.close_time <= end_date)
        ).scalars().all()

    by_session: dict[str, dict[str, Any]] = {}
    by_setup: dict[str, dict[str, Any]] = {}
    by_pair: dict[str, dict[str, Any]] = {}
    by_hour: dict[str, dict[str, Any]] = {}
    by_day: dict[str, dict[str, Any]] = {}

    day_names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

    for t in rows:
        # session
        _bucket_trade(t, by_session, t.session_name or "UNKNOWN")
        # setup (entry_reason is comma-joined keys of checklist)
        setup_key = (t.entry_reason or "UNKNOWN").split(",")[0] or "UNKNOWN"
        _bucket_trade(t, by_setup, setup_key)
        # pair
        _bucket_trade(t, by_pair, t.symbol or "UNKNOWN")
        # hour / day from close_time (UTC)
        ct = t.close_time or t.open_time
        if ct:
            hour_key = f"{ct.hour:02d}"
            _bucket_trade(t, by_hour, hour_key)
            day_key = day_names[ct.weekday()] if ct.weekday() < 7 else "UNKNOWN"
            _bucket_trade(t, by_day, day_key)

    # Regime is buried in checklist_json under "regime"
    by_regime: dict[str, dict[str, Any]] = {}
    for t in rows:
        try:
            chk = json.loads(t.checklist_json) if t.checklist_json else {}
        except Exception:
            chk = {}
        regime = chk.get("regime") or chk.get("adx_regime") or "UNKNOWN"
        _bucket_trade(t, by_regime, regime)

    return {
        "by_session": _summarise(by_session),
        "by_setup": _summarise(by_setup),
        "by_regime": _summarise(by_regime),
        "by_hour": _summarise(by_hour),
        "by_day": _summarise(by_day),
        "by_pair": _summarise(by_pair),
        "total_trades": len(rows),
    }


def get_compliance_score(start_date: datetime,
                         end_date: datetime) -> dict[str, Any]:
    """Compute V2 compliance metrics across closed trades in [start, end]."""
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(Trade)
            .where(Trade.status == "closed")
            .where(Trade.close_time >= start_date)
            .where(Trade.close_time <= end_date)
        ).scalars().all()
    total = len(rows)
    if total == 0:
        return {
            "overall_pct": 0.0, "checklist_pass_rate": 0.0,
            "rr_compliance_rate": 0.0, "ai_compliance_rate": 0.0,
            "total_trades": 0,
        }
    checklist_pass = 0
    rr_ok = 0
    ai_ok = 0
    for t in rows:
        try:
            chk = json.loads(t.checklist_json) if t.checklist_json else {}
        except Exception:
            chk = {}
        # Checklist pass = all 8 points true
        if chk and all(v for v in chk.values()):
            checklist_pass += 1
        # RR Net >= 2.0
        if (t.rr_net or 0) >= 2.0:
            rr_ok += 1
        # AI compliance (ai_verdict starts with "compliant")
        verdict = (t.ai_verdict or "").lower()
        if verdict.startswith("compliant") or "true" in verdict:
            ai_ok += 1
    overall_pct = (checklist_pass / total) * 100.0
    return {
        "overall_pct": round(overall_pct, 2),
        "checklist_pass_rate": round((checklist_pass / total) * 100.0, 2),
        "rr_compliance_rate": round((rr_ok / total) * 100.0, 2),
        "ai_compliance_rate": round((ai_ok / total) * 100.0, 2),
        "total_trades": total,
    }


# --------------------------------------------------------------------------- #
# Emotional-state logging (Sprint 3 #22)
# --------------------------------------------------------------------------- #

def set_trade_emotional_state(trade_id: int,
                              state: str,
                              note: str | None = None) -> bool:
    db = get_db()
    with db.session() as s:
        t = s.get(Trade, int(trade_id))
        if t is None:
            return False
        t.emotional_state = state
        if note is not None:
            t.emotional_note = note
        return True


def list_emotional_summary(limit: int = 200) -> dict[str, Any]:
    """Aggregate emotional state counts across recent trades."""
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(Trade)
            .where(Trade.emotional_state.is_not(None))
            .order_by(Trade.id.desc()).limit(limit)
        ).scalars().all()
    counts: dict[str, int] = {}
    for t in rows:
        if t.emotional_state:
            counts[t.emotional_state] = counts.get(t.emotional_state, 0) + 1
    return {
        "total_logged": sum(counts.values()),
        "by_state": counts,
        "trades": [{
            "id": t.id, "ticket": t.ticket, "symbol": t.symbol,
            "emotional_state": t.emotional_state,
            "emotional_note": t.emotional_note,
            "profit": t.profit,
        } for t in rows],
    }


# --------------------------------------------------------------------------- #
# Sprint 5 #6: user CRUD
# --------------------------------------------------------------------------- #

def get_user_by_username(username: str) -> dict[str, Any] | None:
    """Fetch a user row by username (or None)."""
    db = get_db()
    with db.session() as s:
        row = s.execute(
            select(User).where(User.username == username)
        ).scalar_one_or_none()
        return _user_to_dict(row) if row else None


def get_user_by_api_key(api_key: str) -> dict[str, Any] | None:
    """Fetch a user row by API key (or None)."""
    if not api_key:
        return None
    db = get_db()
    with db.session() as s:
        row = s.execute(
            select(User).where(User.api_key == api_key)
        ).scalar_one_or_none()
        return _user_to_dict(row) if row else None


def create_user(username: str, password_hash: str,
                role: str = UserRole.VIEWER,
                api_key: str | None = None) -> int:
    """Insert a new user. Returns the new id."""
    db = get_db()
    with db.session() as s:
        row = User(username=username, password_hash=password_hash,
                   role=role, api_key=api_key)
        s.add(row)
        s.flush()
        return int(row.id)


def update_user_api_key(user_id: int, api_key: str) -> bool:
    """Replace the API key on a user row (called by /api/auth/login)."""
    db = get_db()
    with db.session() as s:
        row = s.get(User, int(user_id))
        if row is None:
            return False
        row.api_key = api_key
        return True


def ensure_default_admin() -> dict[str, Any]:
    """Create a default ``admin`` user on first run if none exists.

    The password is read from the ``ADMIN_PASSWORD`` env var; if unset, a
    random one is generated and logged (so the operator can recover it).
    """
    import os as _os
    import secrets as _secrets
    db = get_db()
    with db.session() as s:
        existing = s.execute(
            select(User).where(User.username == "admin")
        ).scalar_one_or_none()
        if existing is not None:
            return _user_to_dict(existing)
        password = _os.environ.get("ADMIN_PASSWORD", "").strip()
        generated = False
        if not password:
            password = _secrets.token_urlsafe(18)
            generated = True
        # Late import to avoid a circular dependency at module load time
        from auth import hash_password, generate_api_key
        row = User(
            username="admin",
            password_hash=hash_password(password),
            role=UserRole.ADMIN,
            api_key=generate_api_key(),
        )
        s.add(row)
        s.flush()
        if generated:
            logger.warning(
                "ADMIN_PASSWORD env not set - generated random password for "
                "default admin user: %s  (set ADMIN_PASSWORD to override)",
                password,
            )
        return _user_to_dict(row)


def _user_to_dict(u: User | None) -> dict[str, Any] | None:
    if u is None:
        return None
    return {
        "id": u.id,
        "username": u.username,
        "password_hash": u.password_hash,
        "api_key": u.api_key,
        "role": u.role,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "updated_at": u.updated_at.isoformat() if u.updated_at else None,
    }


# --------------------------------------------------------------------------- #
# Sprint 6 #9: risk-disclosure acknowledgments
# --------------------------------------------------------------------------- #

def insert_risk_acknowledgment(version: str,
                               user_id: int | None = None,
                               ip_address: str | None = None,
                               user_agent: str | None = None) -> int:
    """Persist a signed risk disclosure acknowledgment row."""
    db = get_db()
    with db.session() as s:
        row = RiskAcknowledgment(
            user_id=user_id,
            version=version,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        s.add(row)
        s.flush()
        return int(row.id)


def get_latest_risk_acknowledgment(user_id: int | None = None
                                   ) -> dict[str, Any] | None:
    """Return the most recent acknowledgment (optionally for a user)."""
    db = get_db()
    with db.session() as s:
        stmt = select(RiskAcknowledgment).order_by(
            RiskAcknowledgment.acknowledged_at.desc()
        ).limit(1)
        if user_id is not None:
            stmt = stmt.where(RiskAcknowledgment.user_id == int(user_id))
        row = s.execute(stmt).scalar_one_or_none()
        if row is None:
            return None
        return {
            "id": row.id,
            "user_id": row.user_id,
            "version": row.version,
            "acknowledged_at": (row.acknowledged_at.isoformat()
                                if row.acknowledged_at else None),
            "ip_address": row.ip_address,
            "user_agent": row.user_agent,
        }


# --------------------------------------------------------------------------- #
# Sprint 6 #12: trade event (tick-level reconstruction)
# --------------------------------------------------------------------------- #

def insert_trade_event(trade_id: int,
                       event_type: str,
                       ticket: int | None = None,
                       price: float | None = None,
                       volume: float | None = None,
                       sl: float | None = None,
                       tp: float | None = None,
                       detail: dict[str, Any] | None = None,
                       ms_precision: int | None = None) -> int:
    """Persist a tick-level event for a trade (entry / SL move / TP hit / ...)."""
    db = get_db()
    with db.session() as s:
        row = TradeEvent(
            trade_id=int(trade_id),
            ticket=ticket,
            event_type=event_type,
            price=price,
            volume=volume,
            sl=sl,
            tp=tp,
            detail_json=json.dumps(detail, default=str) if detail else None,
            ms_precision=ms_precision,
        )
        s.add(row)
        s.flush()
        return int(row.id)


def list_trade_events(trade_id: int) -> list[dict[str, Any]]:
    """Return the full ordered event timeline for ``trade_id``."""
    db = get_db()
    with db.session() as s:
        rows = s.execute(
            select(TradeEvent)
            .where(TradeEvent.trade_id == int(trade_id))
            .order_by(TradeEvent.timestamp.asc(), TradeEvent.id.asc())
        ).scalars().all()
        return [{
            "id": r.id,
            "trade_id": r.trade_id,
            "ticket": r.ticket,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "event_type": r.event_type,
            "price": r.price,
            "volume": r.volume,
            "sl": r.sl,
            "tp": r.tp,
            "detail": json.loads(r.detail_json) if r.detail_json else None,
            "ms_precision": r.ms_precision,
        } for r in rows]


# --------------------------------------------------------------------------- #
# Sprint 7 #17: latency samples
# --------------------------------------------------------------------------- #

def insert_latency_sample(endpoint: str, latency_ms: float,
                          p50: float | None = None,
                          p95: float | None = None,
                          p99: float | None = None) -> int:
    db = get_db()
    with db.session() as s:
        row = LatencySample(
            endpoint=endpoint, latency_ms=float(latency_ms),
            percentile_p50=p50, percentile_p95=p95, percentile_p99=p99,
        )
        s.add(row)
        s.flush()
        return int(row.id)


def list_latency_samples(hours: float = 24.0,
                         endpoint: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    with db.session() as s:
        stmt = (select(LatencySample)
                .where(LatencySample.timestamp >= cutoff)
                .order_by(LatencySample.timestamp.asc()))
        if endpoint:
            stmt = stmt.where(LatencySample.endpoint == endpoint)
        rows = s.execute(stmt).scalars().all()
        return [{
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "endpoint": r.endpoint,
            "latency_ms": r.latency_ms,
            "p50": r.percentile_p50,
            "p95": r.percentile_p95,
            "p99": r.percentile_p99,
        } for r in rows]


# --------------------------------------------------------------------------- #
# Sprint 8 #20: stress-test results
# --------------------------------------------------------------------------- #

def insert_stress_test_result(trades_period_days: int | None,
                              balance: float | None,
                              results: list[dict[str, Any]]) -> int:
    db = get_db()
    with db.session() as s:
        row = StressTestResult(
            trades_period_days=trades_period_days,
            balance=balance,
            results_json=json.dumps(results, default=str),
        )
        s.add(row)
        s.flush()
        return int(row.id)


def get_stress_test_result(result_id: int) -> dict[str, Any] | None:
    db = get_db()
    with db.session() as s:
        r = s.get(StressTestResult, int(result_id))
        if r is None:
            return None
        return {
            "id": r.id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "trades_period_days": r.trades_period_days,
            "balance": r.balance,
            "results": json.loads(r.results_json) if r.results_json else [],
        }


__all__ = [
    "Base", "Database", "get_db",
    "Trade", "Signal", "NewsEvent", "DailyRisk", "WeeklyRisk",
    "BotState", "ChatMessage", "Setting",
    "AuditLog", "EquityCurve", "BacktestResult",
    # Sprint 5/6/7 models
    "Secret", "User", "UserRole",
    "RiskAcknowledgment", "TradeEvent", "LatencySample", "StressTestResult",
    # CRUD
    "insert_trade", "update_trade", "get_trade", "list_trades",
    "get_trade_by_ticket", "get_trade_orm_by_ticket", "list_open_trades",
    "insert_signal", "list_signals",
    "upsert_news_events", "list_news",
    "get_or_create_daily", "update_daily",
    "get_bot_state", "update_bot_state",
    "insert_chat", "list_chat",
    "get_setting", "set_setting", "get_all_settings",
    # Audit-fix CRUD
    "insert_audit_log", "list_audit_log", "verify_audit_chain",
    "insert_equity_sample", "list_equity_curve",
    "insert_backtest_result", "get_backtest_result",
    "get_performance_attribution", "get_compliance_score",
    "set_trade_emotional_state", "list_emotional_summary",
    # Sprint 5/6/7 CRUD
    "insert_trade_event", "list_trade_events",
    "insert_risk_acknowledgment", "get_latest_risk_acknowledgment",
    "insert_latency_sample", "list_latency_samples",
    "get_user_by_username", "get_user_by_api_key", "create_user",
    "update_user_api_key", "ensure_default_admin",
    "insert_stress_test_result", "get_stress_test_result",
]
