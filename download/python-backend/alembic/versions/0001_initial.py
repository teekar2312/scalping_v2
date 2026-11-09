"""Alembic single-database script template (BACKEND-100 #14)."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Initial schema baseline.

    All tables are created by ``database.Base.metadata.create_all`` on
    first backend startup; this migration is a no-op marker so that
    future migrations can be applied cleanly via ``alembic upgrade head``.
    """
    pass


def downgrade() -> None:
    """Downgrade to baseline (no-op for initial revision)."""
    pass
