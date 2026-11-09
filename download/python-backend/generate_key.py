#!/usr/bin/env python3
"""
generate_key.py
==============
Standalone helper for Sprint 5 #2 / #3.

Generates the two long-lived secrets the backend uses for encryption-at-rest
and secret-storage:

* ``DB_ENCRYPTION_KEY``     - 32-byte hex string used by SQLCipher
* ``SECRETS_MASTER_KEY``    - Fernet key used by secrets.SecretManager

Run::

    python generate_key.py            # print both
    python generate_key.py db         # print only DB_ENCRYPTION_KEY
    python generate_key.py secrets    # print only SECRETS_MASTER_KEY

The script never writes anywhere except stdout so you can paste the output
into your ``.env`` file.
"""

import argparse
import secrets


def gen_db_encryption_key() -> str:
    """Return a fresh 32-byte hex string for SQLCipher PRAGMA key."""
    return secrets.token_hex(32)


def gen_fernet_key() -> str:
    """Return a fresh Fernet key (44-char URL-safe base64)."""
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "cryptography package not installed.  Run: pip install cryptography"
        ) from exc
    return Fernet.generate_key().decode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate DB_ENCRYPTION_KEY and SECRETS_MASTER_KEY "
                    "for the Forex scalping backend.",
    )
    parser.add_argument(
        "which", nargs="?", choices=["db", "secrets", "all"], default="all",
        help="Which key to generate (default: all)",
    )
    args = parser.parse_args()
    if args.which in ("db", "all"):
        print(f"# Add this to your .env (do NOT commit):")
        print(f"DB_ENCRYPTION_KEY={gen_db_encryption_key()}")
    if args.which in ("secrets", "all"):
        print(f"# Add this to your .env (do NOT commit):")
        print(f"SECRETS_MASTER_KEY={gen_fernet_key()}")


if __name__ == "__main__":
    main()
