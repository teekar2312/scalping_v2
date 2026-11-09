"""
auth.py
=======
API authentication, role-based access control and session management for
the Forex scalping backend (Sprint 5 #1, #6).

Features
--------
* Bearer-token middleware - validates ``Authorization: Bearer <key>`` headers
  against a comma-separated list of keys loaded from the ``API_KEYS`` env var.
* WebSocket token via ``?token=`` query parameter.
* If ``API_KEYS`` is empty -> auth DISABLED with WARNING log (localhost dev mode).
* Role-based access control (VIEWER / TRADER / ADMIN) backed by the ``users``
  table (see :mod:`database`).
* Password hashing with bcrypt.
* ``POST /api/auth/login`` - exchange username + password for an API key.
* ``GET  /api/auth/me``    - return current user info from API key.
* Default admin user auto-created on first run from ``ADMIN_PASSWORD`` env.

This module is intentionally side-effect free at import time; the singleton
``APIKeyAuth`` instance is created lazily by :func:`get_auth`.
"""

import logging
import secrets as _secrets
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import config as cfg
from database import (
    get_db, User, UserRole, get_user_by_api_key, get_user_by_username,
    create_user, ensure_default_admin,
)

logger = logging.getLogger(__name__)

# Bearer token scheme (auto-swaggerUI friendly)
_bearer_scheme = HTTPBearer(auto_error=False)


# --------------------------------------------------------------------------- #
# APIKeyAuth
# --------------------------------------------------------------------------- #

class APIKeyAuth:
    """Validate Bearer API keys loaded from the ``API_KEYS`` env var.

    When ``API_KEYS`` is empty, auth is **disabled** (with a WARNING log) to
    keep localhost dev mode frictionless.  In production, set ``API_KEYS``
    to a comma-separated list of opaque tokens (e.g. 32-byte hex).
    """

    def __init__(self, valid_keys: list[str] | None = None) -> None:
        self.valid_keys: list[str] = [k.strip() for k in (valid_keys or []) if k.strip()]
        self.enabled: bool = bool(self.valid_keys)
        if not self.enabled:
            logger.warning(
                "API_KEYS env var is empty - AUTH DISABLED.  This is fine for "
                "localhost dev but MUST be set in production (Sprint 5 #1).",
            )

    # ---- pure checks ------------------------------------------------------ #

    def verify(self, request: Request) -> dict[str, Any]:
        """Validate the request's Authorization header.

        Returns a dict ``{"authenticated": bool, "user": dict|None, "key": str|None}``.
        Never raises - the caller decides whether to abort based on ``enabled``
        + ``authenticated``.
        """
        if not self.enabled:
            return {"authenticated": True, "user": None, "key": None,
                    "auth_disabled": True}

        header = request.headers.get("Authorization", "")
        token: str | None = None
        if header.lower().startswith("bearer "):
            token = header[7:].strip()
        # Also accept a raw X-API-Key header (curl-friendly)
        if not token:
            token = request.headers.get("X-API-Key", "").strip() or None

        if not token:
            return {"authenticated": False, "user": None, "key": None}

        # 1) Static API key (admin-issued via env)
        if token in self.valid_keys:
            return {"authenticated": True, "user": {"role": "ADMIN",
                                                    "username": "_static_key"},
                    "key": token, "auth_disabled": False}

        # 2) User API key from DB (login-issued)
        user = get_user_by_api_key(token)
        if user is not None:
            return {"authenticated": True, "user": user, "key": token,
                    "auth_disabled": False}
        return {"authenticated": False, "user": None, "key": token}

    def verify_websocket_token(self, token: str | None) -> dict[str, Any]:
        """Validate a ``?token=`` query parameter for the WebSocket endpoint."""
        if not self.enabled:
            return {"authenticated": True, "user": None, "auth_disabled": True}
        if not token:
            return {"authenticated": False, "user": None}
        if token in self.valid_keys:
            return {"authenticated": True,
                    "user": {"role": "ADMIN", "username": "_static_key"}}
        user = get_user_by_api_key(token)
        if user is not None:
            return {"authenticated": True, "user": user}
        return {"authenticated": False, "user": None}


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_auth: APIKeyAuth | None = None


def get_auth() -> APIKeyAuth:
    """Return (and lazily create) the singleton APIKeyAuth instance."""
    global _auth
    if _auth is None:
        raw = cfg._get("API_KEYS", "") if hasattr(cfg, "_get") else ""
        if not raw:
            # fall back to os.environ directly (config.py doesn't expose _get)
            import os as _os
            raw = _os.environ.get("API_KEYS", "")
        keys = [k.strip() for k in raw.split(",") if k.strip()]
        _auth = APIKeyAuth(valid_keys=keys)
        # Make sure the default admin user exists (for /api/auth/login)
        try:
            ensure_default_admin()
        except Exception as exc:  # pragma: no cover
            logger.warning("ensure_default_admin failed: %s", exc)
    return _auth


# --------------------------------------------------------------------------- #
# FastAPI dependencies
# --------------------------------------------------------------------------- #

def _extract_token(
    creds: HTTPAuthorizationCredentials | None,
) -> str | None:
    if creds is None or not creds.credentials:
        return None
    return creds.credentials.strip()


async def get_api_key(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> dict[str, Any]:
    """FastAPI dependency: require a valid Bearer token.

    Returns the auth context dict.  If ``API_KEYS`` is empty the dependency
    is effectively a no-op (auth disabled).
    """
    auth = get_auth()
    if not auth.enabled:
        return {"authenticated": True, "user": None, "auth_disabled": True}
    token = _extract_token(creds)
    if token is None:
        # also accept X-API-Key header
        token = request.headers.get("X-API-Key", "").strip() or None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header (Bearer <key>)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if token in auth.valid_keys:
        return {"authenticated": True,
                "user": {"role": "ADMIN", "username": "_static_key"},
                "key": token, "auth_disabled": False}
    user = get_user_by_api_key(token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"authenticated": True, "user": user, "key": token,
            "auth_disabled": False}


# ---- Role helpers --------------------------------------------------------- #

def _role_rank(role: str) -> int:
    return {"VIEWER": 1, "TRADER": 2, "ADMIN": 3}.get((role or "").upper(), 0)


def require_role(min_role: str):
    """Return a FastAPI dependency that enforces ``min_role`` (VIEWER/TRADER/ADMIN).

    Usage::

        @app.post("/api/restore", dependencies=[Depends(require_role("ADMIN"))])
        async def restore(...): ...
    """
    async def _dep(ctx: dict = Depends(get_api_key)) -> dict:
        # When auth is disabled (dev mode), all roles are allowed.
        if ctx.get("auth_disabled"):
            return ctx
        user = ctx.get("user")
        role = (user or {}).get("role", "VIEWER")
        if _role_rank(role) < _role_rank(min_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"requires role >= {min_role} (current: {role})",
            )
        return ctx
    return _dep


# Convenience pre-baked dependencies (importable from main.py)
require_viewer = require_role("VIEWER")
require_trader = require_role("TRADER")
require_admin = require_role("ADMIN")


# --------------------------------------------------------------------------- #
# Password hashing (bcrypt)
# --------------------------------------------------------------------------- #

try:
    import bcrypt as _bcrypt
    _BCRYPT_AVAILABLE = True
except ImportError:  # pragma: no cover
    _bcrypt = None  # type: ignore
    _BCRYPT_AVAILABLE = False
    logger.warning("bcrypt is not installed - password hashing will use a "
                   "weak fallback.  Run: pip install bcrypt")


def hash_password(plaintext: str) -> str:
    """Return a bcrypt hash of ``plaintext`` (or a weak fallback)."""
    if not plaintext:
        raise ValueError("password cannot be empty")
    if _BCRYPT_AVAILABLE:
        return _bcrypt.hashpw(plaintext.encode("utf-8"),
                              _bcrypt.gensalt(rounds=12)).decode("utf-8")
    # weak fallback (do NOT use in production)
    import hashlib as _h
    return "weak$" + _h.sha256(plaintext.encode("utf-8")).hexdigest()


def verify_password(plaintext: str, hashed: str) -> bool:
    """Return True if ``plaintext`` matches the bcrypt ``hashed`` value."""
    if not hashed:
        return False
    if hashed.startswith("weak$"):
        import hashlib as _h
        return _h.sha256(plaintext.encode("utf-8")).hexdigest() == hashed[5:]
    if not _BCRYPT_AVAILABLE:
        return False
    try:
        return _bcrypt.checkpw(plaintext.encode("utf-8"),
                               hashed.encode("utf-8"))
    except Exception:
        return False


def generate_api_key() -> str:
    """Generate a new opaque API key (32 bytes hex)."""
    return "sk_" + _secrets.token_hex(32)


# --------------------------------------------------------------------------- #
# Login / me helpers
# --------------------------------------------------------------------------- #

@dataclass
class LoginResult:
    ok: bool
    api_key: str | None
    username: str | None
    role: str | None
    message: str


def login(username: str, password: str) -> LoginResult:
    """Validate username + password; return a fresh API key if successful.

    The API key is persisted on the user row (replacing any previous key) so
    that subsequent Bearer requests authenticate as that user.
    """
    user = get_user_by_username(username)
    if user is None:
        return LoginResult(False, None, None, None, "invalid credentials")
    if not verify_password(password, user.get("password_hash", "")):
        return LoginResult(False, None, None, None, "invalid credentials")
    new_key = generate_api_key()
    from database import update_user_api_key
    update_user_api_key(int(user["id"]), new_key)
    return LoginResult(True, new_key, user["username"], user["role"], "ok")


__all__ = [
    "APIKeyAuth", "get_auth", "get_api_key",
    "require_role", "require_viewer", "require_trader", "require_admin",
    "hash_password", "verify_password", "generate_api_key",
    "login", "LoginResult",
]
