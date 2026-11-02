"""which claim of a code each profile and consent came under (D45)

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

TABLES = ("client", "measurement_profile", "consent")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table, sa.Column("claim_round", sa.Integer(), server_default="0", nullable=False)
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "claim_round")
