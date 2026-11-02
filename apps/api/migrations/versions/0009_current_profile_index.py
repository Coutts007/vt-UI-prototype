"""index for each client's current profile (M12 load test)

The tailor's client list finds each client's latest non-superseded profile, final first.
Without this index that lookup read every version of every client (about 200 ms for 5,000
clients); with it each lookup is one index entry.

Revision ID: 0009
Revises: 0008
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX ix_profile_current ON measurement_profile "
        "(client_id, (status <> 'final'), captured_at DESC) INCLUDE (profile_id) "
        "WHERE status <> 'superseded'"
    )


def downgrade() -> None:
    op.drop_index("ix_profile_current", table_name="measurement_profile")
