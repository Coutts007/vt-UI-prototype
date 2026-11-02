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
    # Null means every round: an admin carried the request out after checking it (D45).
    op.add_column("deletion_request", sa.Column("claim_round", sa.Integer(), nullable=True))
    # The job removes profiles 30 days after collection, and a tombstone stops a replay (D45).
    op.execute("GRANT INSERT ON deleted_profile TO vt_retention")


def downgrade() -> None:
    op.execute("REVOKE INSERT ON deleted_profile FROM vt_retention")
    op.drop_column("deletion_request", "claim_round")
