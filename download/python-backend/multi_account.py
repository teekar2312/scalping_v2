"""
multi_account.py
================
Multi-account MT5 management.

Each account has its own :class:`MT5Connector` instance and risk profile
(conservative 0.5% / standard 1% / aggressive 2%).  The bot can run
independently per account.

Persists accounts to the ``mt5_accounts`` DB table (password encrypted via
the secrets.SecretManager when available).

Endpoints exposed by main.py:
    POST   /api/accounts              — add account
    GET    /api/accounts              — list accounts
    DELETE /api/accounts/{name}       — remove
    POST   /api/accounts/{name}/start — start bot for account
    POST   /api/accounts/{name}/stop  — stop bot for account
    GET    /api/accounts/aggregate    — aggregated stats across all accounts

Config:
    MULTI_ACCOUNT_ENABLED=false
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Index, Integer, String, Text, select,
)

import database as db
from database import Base, get_db
import config as cfg

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Model — registered on Base.metadata
# --------------------------------------------------------------------------- #

class MT5Account(Base):
    """Persisted MT5 account record (multi-account management)."""
    __tablename__ = "mt5_accounts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), unique=True, nullable=False, index=True)
    login = Column(Integer, nullable=False)
    password_encrypted = Column(Text, nullable=True)   # Fernet token (or None)
    password_plain = Column(Text, nullable=True)        # fallback when no key
    server = Column(String(128), nullable=False)
    risk_profile = Column(String(20), default="standard", nullable=False)
    active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


Index("ix_mt5_accounts_active", MT5Account.active)


# --------------------------------------------------------------------------- #
# Risk profiles
# --------------------------------------------------------------------------- #

RISK_PROFILES: dict[str, float] = {
    "conservative": 0.005,   # 0.5%
    "standard": 0.010,       # 1.0%
    "aggressive": 0.020,     # 2.0%
}


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass
class AccountRuntime:
    """In-memory runtime state for an account (connector + bot task)."""
    name: str
    login: int
    server: str
    risk_profile: str
    connector: Any | None = None
    engine: Any | None = None
    is_running: bool = False
    last_balance: float = 0.0
    last_equity: float = 0.0
    last_pnl: float = 0.0
    errors: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _encrypt_password(password: str) -> tuple[str | None, str | None]:
    """Encrypt the password via secrets.SecretManager.

    Returns ``(encrypted_token, None)`` on success or ``(None, plain)`` if
    the master key isn't configured (fallback to plaintext storage).
    """
    if not password:
        return None, None
    try:
        from secrets import get_secret_manager
        mgr = get_secret_manager()
        token = mgr.encrypt(password)
        if token:
            return token, None
    except Exception as exc:  # pragma: no cover
        logger.debug("password encrypt failed: %s", exc)
    return None, password


def _decrypt_password(encrypted: str | None, plain: str | None) -> str:
    """Decrypt the password (or return the plaintext fallback)."""
    if encrypted:
        try:
            from secrets import get_secret_manager
            mgr = get_secret_manager()
            decrypted = mgr.decrypt(encrypted)
            if decrypted:
                return decrypted
        except Exception as exc:  # pragma: no cover
            logger.debug("password decrypt failed: %s", exc)
    return plain or ""


# --------------------------------------------------------------------------- #
# MultiAccountManager
# --------------------------------------------------------------------------- #

class MultiAccountManager:
    """Coordinate multiple MT5 accounts + their independent bot runtimes."""

    def __init__(self,
                 enabled: bool | None = None) -> None:
        self.enabled: bool = (bool(cfg.MULTI_ACCOUNT_ENABLED)
                              if enabled is None else bool(enabled))
        self._runtimes: dict[str, AccountRuntime] = {}

    # ------------------------------------------------------------------ #
    # Account CRUD
    # ------------------------------------------------------------------ #

    def add_account(self,
                    name: str,
                    login: int,
                    password: str,
                    server: str,
                    risk_profile: str = "standard",
                    active: bool = False) -> dict[str, Any]:
        """Persist a new MT5 account row.  Returns the row dict."""
        if risk_profile not in RISK_PROFILES:
            return {"ok": False,
                    "error": f"invalid risk_profile: {risk_profile}"}
        if not self.enabled:
            return {"ok": False, "error": "multi_account_disabled"}
        encrypted, plain = _encrypt_password(password)
        db_obj = get_db()
        with db_obj.session() as s:
            existing = s.execute(
                select(MT5Account).where(MT5Account.name == name)
            ).scalar_one_or_none()
            if existing is not None:
                return {"ok": False, "error": f"name '{name}' already exists"}
            row = MT5Account(
                name=name,
                login=int(login),
                password_encrypted=encrypted,
                password_plain=plain,
                server=server,
                risk_profile=risk_profile,
                active=bool(active),
            )
            s.add(row)
            s.flush()
            return {
                "ok": True,
                "id": int(row.id),
                "name": row.name,
                "login": row.login,
                "server": row.server,
                "risk_profile": row.risk_profile,
                "active": bool(row.active),
            }

    def remove_account(self, name: str) -> dict[str, Any]:
        """Delete an account row + stop its runtime."""
        if not self.enabled:
            return {"ok": False, "error": "multi_account_disabled"}
        # Stop runtime if running
        runtime = self._runtimes.pop(name, None)
        if runtime and runtime.is_running:
            try:
                asyncio.create_task(self.stop_bot(name))
            except RuntimeError:
                pass  # no event loop yet
        db_obj = get_db()
        with db_obj.session() as s:
            row = s.execute(
                select(MT5Account).where(MT5Account.name == name)
            ).scalar_one_or_none()
            if row is None:
                return {"ok": False, "error": "not_found"}
            s.delete(row)
            return {"ok": True, "removed": name}

    def list_accounts(self) -> list[dict[str, Any]]:
        """Return all account rows (password fields stripped)."""
        db_obj = get_db()
        with db_obj.session() as s:
            rows = s.execute(
                select(MT5Account).order_by(MT5Account.id.asc())
            ).scalars().all()
        return [{
            "id": r.id,
            "name": r.name,
            "login": r.login,
            "server": r.server,
            "risk_profile": r.risk_profile,
            "risk_pct": RISK_PROFILES.get(r.risk_profile, 0.01),
            "active": bool(r.active),
            "running": self._runtimes.get(r.name,
                                          AccountRuntime("", 0, "", "")
                                          ).is_running,
            "last_balance": self._runtimes.get(
                r.name, AccountRuntime("", 0, "", "")).last_balance,
            "last_equity": self._runtimes.get(
                r.name, AccountRuntime("", 0, "", "")).last_equity,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]

    def get_account_status(self, name: str) -> dict[str, Any]:
        """Return connection + balance + positions for one account."""
        if not self.enabled:
            return {"ok": False, "error": "multi_account_disabled"}
        db_obj = get_db()
        with db_obj.session() as s:
            row = s.execute(
                select(MT5Account).where(MT5Account.name == name)
            ).scalar_one_or_none()
            if row is None:
                return {"ok": False, "error": "not_found"}
        runtime = self._runtimes.get(name)
        if runtime is None or runtime.connector is None:
            return {
                "ok": True,
                "name": row.name,
                "login": row.login,
                "server": row.server,
                "connected": False,
                "running": False,
                "positions": [],
            }
        # Pull fresh data
        positions: list[dict[str, Any]] = []
        try:
            pos_list = runtime.connector.get_positions()
            positions = [
                {"ticket": p.ticket, "symbol": p.symbol,
                 "type": p.type, "volume": p.volume,
                 "profit": p.profit, "open_price": p.open_price}
                for p in pos_list
            ]
        except Exception as exc:  # pragma: no cover
            logger.warning("get_positions(%s): %s", name, exc)
        try:
            acc = runtime.connector.get_account_info()
            runtime.last_balance = float(acc.balance)
            runtime.last_equity = float(acc.equity)
        except Exception:
            pass
        return {
            "ok": True,
            "name": row.name,
            "login": row.login,
            "server": row.server,
            "connected": bool(runtime.connector.connected),
            "running": runtime.is_running,
            "balance": runtime.last_balance,
            "equity": runtime.last_equity,
            "last_pnl": runtime.last_pnl,
            "positions": positions,
            "errors": runtime.errors[-5:],
        }

    # ------------------------------------------------------------------ #
    # Bot lifecycle
    # ------------------------------------------------------------------ #

    def _ensure_runtime(self, name: str) -> AccountRuntime | None:
        """Build the AccountRuntime (connector + engine) for an account."""
        db_obj = get_db()
        with db_obj.session() as s:
            row = s.execute(
                select(MT5Account).where(MT5Account.name == name)
            ).scalar_one_or_none()
            if row is None:
                return None
            password = _decrypt_password(row.password_encrypted,
                                         row.password_plain)
        # Build a connector
        from mt5_connector import MT5Connector, MT5Config
        from config import settings as app_settings
        mt5_cfg = MT5Config(
            login=row.login,
            password=password,
            server=row.server,
            terminal_path=app_settings.mt5.terminal_path,
            timeout_ms=app_settings.mt5.timeout_ms,
            retry_attempts=app_settings.mt5.retry_attempts,
            retry_delay_s=app_settings.mt5.retry_delay_s,
        )
        connector = MT5Connector(config=type(app_settings)(
            mt5=mt5_cfg, mt5_secondary=None,
            ollama=app_settings.ollama, tiingo=app_settings.tiingo,
            risk=app_settings.risk, paths=app_settings.paths,
            server=app_settings.server, pairs=app_settings.pairs,
            mt5_symbols=app_settings.mt5_symbols,
            timezone=app_settings.timezone,
        ))
        runtime = AccountRuntime(
            name=name, login=row.login, server=row.server,
            risk_profile=row.risk_profile, connector=connector,
        )
        self._runtimes[name] = runtime
        return runtime

    async def start_bot(self, account_name: str) -> dict[str, Any]:
        """Start a TradingEngine bound to ``account_name``."""
        if not self.enabled:
            return {"ok": False, "error": "multi_account_disabled"}
        runtime = self._runtimes.get(account_name)
        if runtime is None:
            runtime = self._ensure_runtime(account_name)
            if runtime is None:
                return {"ok": False, "error": "account not found"}
        # Initialise MT5 connector
        try:
            ok = await asyncio.to_thread(runtime.connector.initialize)
            if not ok:
                return {"ok": False, "error": "MT5 init failed"}
        except Exception as exc:  # pragma: no cover
            return {"ok": False, "error": str(exc)}
        # Build an engine bound to this connector
        from trading_engine import TradingEngine
        engine = TradingEngine(connector=runtime.connector)
        runtime.engine = engine
        result = await engine.start()
        runtime.is_running = bool(result.get("ok"))
        return {
            "ok": runtime.is_running,
            "account": account_name,
            "message": result.get("message", ""),
        }

    async def stop_bot(self, account_name: str) -> dict[str, Any]:
        """Stop the bot for ``account_name``."""
        runtime = self._runtimes.get(account_name)
        if runtime is None or runtime.engine is None:
            return {"ok": False, "error": "not running"}
        result = await runtime.engine.stop(reason="multi_account_stop")
        runtime.is_running = False
        return {
            "ok": True,
            "account": account_name,
            "message": result.get("message", ""),
        }

    # ------------------------------------------------------------------ #
    # Aggregate stats
    # ------------------------------------------------------------------ #

    def get_aggregated_stats(self) -> dict[str, Any]:
        """Combined P&L + position count across all accounts."""
        accounts = self.list_accounts()
        total_balance = sum(_safe_float(a.get("last_balance")) for a in accounts)
        total_equity = sum(_safe_float(a.get("last_equity")) for a in accounts)
        running = sum(1 for a in accounts if a.get("running"))
        # Aggregate positions across runtimes
        total_positions = 0
        total_floating = 0.0
        for name in self._runtimes:
            runtime = self._runtimes[name]
            if runtime.connector is None or not runtime.connector.connected:
                continue
            try:
                pos_list = runtime.connector.get_positions()
                total_positions += len(pos_list)
                total_floating += sum(_safe_float(p.profit) for p in pos_list)
            except Exception:  # pragma: no cover
                pass
        return {
            "accounts": len(accounts),
            "running": running,
            "total_balance": round(total_balance, 2),
            "total_equity": round(total_equity, 2),
            "total_positions": total_positions,
            "total_floating_pnl": round(total_floating, 2),
            "per_account": accounts,
        }

    # ------------------------------------------------------------------ #
    # Status
    # ------------------------------------------------------------------ #

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "accounts": len(self.list_accounts()),
            "running": sum(
                1 for r in self._runtimes.values() if r.is_running
            ),
        }


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_default_manager: MultiAccountManager | None = None


def get_multi_account_manager() -> MultiAccountManager:
    """Return the module-level MultiAccountManager singleton."""
    global _default_manager
    if _default_manager is None:
        _default_manager = MultiAccountManager()
    return _default_manager


__all__ = [
    "MultiAccountManager",
    "MT5Account",
    "AccountRuntime",
    "RISK_PROFILES",
    "get_multi_account_manager",
]
