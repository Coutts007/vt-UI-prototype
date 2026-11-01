"""let the API role delete a client's profiles for a deletion request (backend-spec 14.5)

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT DELETE ON measurement_profile TO vt_app")


def downgrade() -> None:
    op.execute("REVOKE DELETE ON measurement_profile FROM vt_app")
