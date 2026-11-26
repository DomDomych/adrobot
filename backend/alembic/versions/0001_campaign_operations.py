"""Create campaign operations table."""

import sqlalchemy as sa

from alembic import op

revision = "0001_campaign_operations"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaign_operations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=True),
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_campaign_operations_campaign_id", "campaign_operations", ["campaign_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_campaign_operations_campaign_id", table_name="campaign_operations"
    )
    op.drop_table("campaign_operations")
