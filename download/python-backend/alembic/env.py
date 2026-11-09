"""Alembic env.py for the Forex Scalping Backend (BACKEND-100 #14).

Reads the database URL from ``config.settings`` (which honours the
``ALEMBIC_DATABASE_URL`` env var or falls back to ``DB_PATH``), imports
the SQLAlchemy declarative ``Base`` from :mod:`database`, and configures
online + offline migration modes.
"""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Add the backend directory to sys.path so we can import config + database.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Import config + Base.
try:
    import config as cfg  # noqa: F401
    from config import settings
    from database import Base
    # Importing the modules below ensures their models are registered on
    # Base.metadata before autogenerate runs.
    import database  # noqa: F401
except Exception as exc:  # pragma: no cover
    print(f"[alembic env.py] backend import failed: {exc}")
    raise

# this is the Alembic Config object.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject the runtime DB URL.
target_metadata = Base.metadata
db_url = os.environ.get("ALEMBIC_DATABASE_URL") or str(
    settings.paths.db_path).replace("\\", "/")
if not db_url.startswith("sqlite"):
    # If db_path was returned as a filesystem path, prefix with sqlite:///
    db_url = f"sqlite:///{db_url}"
config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to a script)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (connect to DB and apply)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section) or {},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
