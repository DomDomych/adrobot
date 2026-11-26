"""Persist stream editor drafts and offer history."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_editor_state"
down_revision = "0001_campaign_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_editor_states",
        sa.Column("stream_id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("baseline", postgresql.JSONB(), nullable=False),
        sa.Column("published", postgresql.JSONB(), nullable=False),
        sa.Column("draft", postgresql.JSONB(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("stream_id"),
    )
    op.create_index(
        "ix_stream_editor_states_campaign_id", "stream_editor_states", ["campaign_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_stream_editor_states_campaign_id", table_name="stream_editor_states"
    )
    op.drop_table("stream_editor_states")
