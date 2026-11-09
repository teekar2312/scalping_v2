"""
secrets.py
=========
Encrypted secrets manager (Sprint 5 #3).

Stores sensitive credentials (MT5 password, Tiingo API key, Telegram bot
token, broker API keys, etc.) encrypted at rest in the ``secrets`` SQLite
table rather than as plaintext env vars.

Encryption uses Fernet (symmetric authenticated AES-128-CBC + HMAC-SHA256)
from the ``cryptography`` package.  The master key is read from the
``SECRETS_MASTER_KEY`` env var (a Fernet token - generate one with::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If ``SECRETS_MASTER_KEY`` is unset, the module falls back to a no-op
(insecure) mode that stores plaintext and logs a WARNING - useful for local
dev only.

REST API
--------
* ``POST /api/secrets/{name}``  - store (encrypt) a secret value (admin only)
* ``GET  /api/secrets/{name}``  - retrieve (decrypt) a secret value (admin only)
* ``GET  /api/secrets``         - list secret names (values NOT returned)
* ``DELETE /api/secrets/{name}``- delete a secret (admin only)

NOTE: This module's name shadows the stdlib ``secrets`` for the project.
To stay compatible with libraries that do ``from secrets import token_hex``,
the stdlib helpers are loaded directly from the stdlib path and re-exported
at the top of this file.
"""
from __future__ import annotations

# --------------------------------------------------------------------------- #
# Bootstrap: load the *real* stdlib secrets module and re-export its helpers,
# because our local file shadows it on sys.path.  We use importlib to load it
# from the absolute stdlib path so we don't recurse into ourselves.
# --------------------------------------------------------------------------- #
import importlib.util as _ilu
import sys as _sys

def _load_stdlib_secrets():
    """Return the stdlib ``secrets`` module object (loaded from file)."""
    # Try fetching from sys.modules under a private alias first
    if "_stdlib_secrets" in _sys.modules:
        return _sys.modules["_stdlib_secrets"]
    # Locate the stdlib secrets.py via the os module (always available)
    import os as _os
    stdlib_dir = _os.path.dirname(_os.__file__)  # .../python3.X/lib
    candidate = _os.path.join(stdlib_dir, "secrets.py")
    if not _os.path.exists(candidate):
        # Fallback: look in sys.path entries
        for entry in _sys.path:
            if not entry or not _os.path.isdir(entry):
                continue
            c = _os.path.join(entry, "secrets.py")
            if _os.path.exists(c):
                candidate = c
                break
    spec = _ilu.spec_from_file_location("_stdlib_secrets", candidate)
    if spec is None or spec.loader is None:
        raise ImportError("Could not locate stdlib secrets.py")
    mod = _ilu.module_from_spec(spec)
    _sys.modules["_stdlib_secrets"] = mod
    spec.loader.exec_module(mod)
    return mod

_stdlib_secrets = _load_stdlib_secrets()
token_hex = _stdlib_secrets.token_hex
token_urlsafe = _stdlib_secrets.token_urlsafe
token_bytes = _stdlib_secrets.token_bytes
choice = _stdlib_secrets.choice
compare_digest = _stdlib_secrets.compare_digest
SystemRandom = _stdlib_secrets.SystemRandom

import base64
import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Fernet is in the cryptography package
try:
    from cryptography.fernet import Fernet, InvalidToken
    _CRYPTO_AVAILABLE = True
except ImportError:  # pragma: no cover
    Fernet = None  # type: ignore
    InvalidToken = Exception  # type: ignore
    _CRYPTO_AVAILABLE = False
    logger.warning("cryptography is not installed - secrets will be stored "
                   "unencrypted (NOT for production).  Run: pip install cryptography")


class SecretManager:
    """Encrypt / decrypt / persist named secrets in the SQLite ``secrets`` table.

    Parameters
    ----------
    master_key : str
        A Fernet key (44-char base64 URL-safe string).  If empty, the manager
        runs in insecure plaintext mode (WARNING logged).
    """

    def __init__(self, master_key: str | None = None) -> None:
        self.master_key: str = master_key or os.environ.get("SECRETS_MASTER_KEY", "")
        if self.master_key and _CRYPTO_AVAILABLE:
            try:
                self._fernet: Any = Fernet(self.master_key.encode("utf-8"))
                self.enabled = True
            except Exception as exc:
                logger.warning("Invalid SECRETS_MASTER_KEY (%s) - falling back "
                               "to plaintext mode.", exc)
                self._fernet = None
                self.enabled = False
        else:
            self._fernet = None
            self.enabled = False
            if not _CRYPTO_AVAILABLE:
                logger.warning("cryptography package not available - SecretManager "
                               "is in plaintext mode (NOT for production).")
            elif not self.master_key:
                logger.warning("SECRETS_MASTER_KEY env var not set - SecretManager "
                               "is in plaintext mode.  Generate one with: "
                               "python -c \"from cryptography.fernet import Fernet; "
                               "print(Fernet.generate_key().decode())\"")

    # ---- low-level encrypt / decrypt -------------------------------------- #

    def encrypt(self, plaintext: str) -> str:
        """Return a base64 Fernet token of ``plaintext`` (or plaintext if disabled)."""
        if not self.enabled:
            # Plaintext fallback - prefix so we can detect it on decrypt
            return "plain$" + plaintext
        token = self._fernet.encrypt(plaintext.encode("utf-8"))
        return token.decode("utf-8")

    def decrypt(self, token: str) -> str:
        """Decrypt a previously encrypted token.  Raises ValueError on tamper."""
        if not token:
            return ""
        if token.startswith("plain$"):
            return token[6:]
        if not self.enabled:
            # we stored as fernet but lost the key - cannot recover
            raise ValueError("Secret is encrypted but SECRETS_MASTER_KEY is not set")
        try:
            return self._fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise ValueError("Invalid or tampered secret token") from exc

    # ---- persistence helpers ---------------------------------------------- #

    def store_secret(self, name: str, value: str) -> None:
        """Encrypt ``value`` and persist as a row in the ``secrets`` table."""
        from database import get_db, Secret
        encrypted = self.encrypt(value)
        db = get_db()
        with db.session() as s:
            row = s.execute(
                __import__("sqlalchemy").select(Secret).where(Secret.name == name)
            ).scalar_one_or_none()
            now = datetime.now(timezone.utc)
            if row is None:
                s.add(Secret(name=name, encrypted_value=encrypted, created_at=now,
                             updated_at=now))
            else:
                row.encrypted_value = encrypted
                row.updated_at = now

    def get_secret(self, name: str) -> str | None:
        """Decrypt and return the named secret (or None if not stored)."""
        from database import get_db, Secret
        from sqlalchemy import select
        db = get_db()
        with db.session() as s:
            row = s.execute(
                select(Secret).where(Secret.name == name)
            ).scalar_one_or_none()
            if row is None:
                return None
            try:
                return self.decrypt(row.encrypted_value)
            except ValueError as exc:
                logger.error("Failed to decrypt secret '%s': %s", name, exc)
                return None

    def delete_secret(self, name: str) -> bool:
        """Delete a secret row. Returns True if a row was removed."""
        from database import get_db, Secret
        from sqlalchemy import select
        db = get_db()
        with db.session() as s:
            row = s.execute(
                select(Secret).where(Secret.name == name)
            ).scalar_one_or_none()
            if row is None:
                return False
            s.delete(row)
            return True

    def list_secret_names(self) -> list[str]:
        """Return all stored secret names (values NOT returned)."""
        from database import get_db, Secret
        from sqlalchemy import select
        db = get_db()
        with db.session() as s:
            rows = s.execute(select(Secret.name).order_by(Secret.name)).all()
            return [r[0] for r in rows]


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #

_sm: SecretManager | None = None


def get_secret_manager() -> SecretManager:
    """Return (and lazily create) the singleton SecretManager."""
    global _sm
    if _sm is None:
        _sm = SecretManager()
    return _sm


# --------------------------------------------------------------------------- #
# Convenience: load MT5 / Tiingo / Telegram from secrets table (with env fallback)
# --------------------------------------------------------------------------- #

def resolve_secret(name: str, env_fallback: str = "") -> str:
    """Return the decrypted secret ``name`` or fall back to ``env_fallback``."""
    sm = get_secret_manager()
    val = sm.get_secret(name)
    if val:
        return val
    return os.environ.get(env_fallback, "")


__all__ = [
    "SecretManager", "get_secret_manager", "resolve_secret",
]
