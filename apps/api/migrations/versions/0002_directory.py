"""tailor directory listing and client source (D27)

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SPECIALTIES = (
    "'kitenge', 'suits', 'dresses', 'modest', 'uniforms', 'alterations', 'traditional', 'casual'"  # noqa: E501
)


def upgrade() -> None:
    op.add_column(
        "tailor",
        sa.Column(
            "listing_id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
    )
    op.create_unique_constraint("uq_tailor_listing_id", "tailor", ["listing_id"])
    op.add_column(
        "tailor",
        sa.Column("directory_listed", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "tailor",
        sa.Column("directory_show_phone", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "tailor",
        sa.Column(
            "directory_specialties",
            postgresql.ARRAY(sa.String(length=20)),
            server_default="{}",
            nullable=False,
        ),
    )
    op.add_column(
        "tailor", sa.Column("directory_description", sa.String(length=240), nullable=True)
    )
    op.create_check_constraint(
        "directory_specialties_allowed",
        "tailor",
        f"directory_specialties <@ ARRAY[{SPECIALTIES}]::varchar[]",
    )
    op.add_column(
        "client", sa.Column("source", sa.String(length=10), server_default="tailor", nullable=False)
    )
    op.create_check_constraint("source_allowed", "client", "source IN ('tailor', 'directory')")


def downgrade() -> None:
    op.drop_constraint("source_allowed", "client", type_="check")
    op.drop_column("client", "source")
    op.drop_constraint("directory_specialties_allowed", "tailor", type_="check")
    op.drop_column("tailor", "directory_description")
    op.drop_column("tailor", "directory_specialties")
    op.drop_column("tailor", "directory_show_phone")
    op.drop_column("tailor", "directory_listed")
    op.drop_constraint("uq_tailor_listing_id", "tailor", type_="unique")
    op.drop_column("tailor", "listing_id")
