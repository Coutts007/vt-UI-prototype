"""which claim round a deletion request covers, and what the retention job may write (M11)

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The round a phone's request covers (D45). Older requests take their client's round now,
    # so a missing round never widens a request; only an admin's check covers every round.
    op.add_column("deletion_request", sa.Column("claim_round", sa.Integer(), nullable=True))
    op.add_column(
        "deletion_request",
        sa.Column("all_rounds", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        "UPDATE deletion_request AS r SET claim_round = c.claim_round FROM client AS c"
        " WHERE r.client_id = c.client_id AND r.claim_round IS NULL"
    )
    # The job removes profiles 30 days after collection, and a tombstone stops a replay (D45).
    op.execute("GRANT INSERT ON deleted_profile TO vt_retention")


def downgrade() -> None:
    op.execute("REVOKE INSERT ON deleted_profile FROM vt_retention")
    op.drop_column("deletion_request", "all_rounds")
    op.drop_column("deletion_request", "claim_round")
