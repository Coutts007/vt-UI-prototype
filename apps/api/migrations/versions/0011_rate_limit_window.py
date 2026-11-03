"""rate-limit windows in the database, shared by every API worker (M16, M12-13)

The limiter kept its counts in process memory, so a second Uvicorn worker allowed its own
sign-in attempts. One row per bucket and key now holds the window. Keys are hashes (addresses,
emails) or identifiers (users, client codes), never personal data in clear. The nightly job
removes ended windows as vt_retention.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_window",
        sa.Column("bucket", sa.String(32), primary_key=True),
        sa.Column("bucket_key", sa.String(128), primary_key=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer, nullable=False),
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_window TO vt_app")
    op.execute("GRANT SELECT, DELETE ON rate_limit_window TO vt_retention")


def downgrade() -> None:
    op.drop_table("rate_limit_window")
