"""the phone's secret for a client code, deleted profile ids, and a new server check (D45)

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

KINDS = (
    "'unusual_proportion', 'outlier_profile', 'change_since_last', 'client_server_mismatch', "
    "'rules_version_unknown', 'stale_rules', 'height_mismatch'"
)


def upgrade() -> None:
    op.add_column("client", sa.Column("secret_hash", sa.String(length=64), nullable=True))
    op.create_table(
        "deleted_profile",
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "deleted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute("GRANT SELECT, INSERT ON deleted_profile TO vt_app")
    op.execute("GRANT SELECT, DELETE ON deleted_profile TO vt_retention")
    op.execute("GRANT SELECT ON deleted_profile TO vt_readonly")
    op.drop_constraint("kind_allowed", "server_check", type_="check")
    op.create_check_constraint(
        "kind_allowed", "server_check", f"kind IN ({KINDS}, 'rederive_failed')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM server_check WHERE kind = 'rederive_failed'")
    op.drop_constraint("kind_allowed", "server_check", type_="check")
    op.create_check_constraint("kind_allowed", "server_check", f"kind IN ({KINDS})")
    op.drop_table("deleted_profile")
    op.drop_column("client", "secret_hash")
