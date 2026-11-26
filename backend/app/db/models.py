from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CampaignOperation(Base):
    __tablename__ = "campaign_operations"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int | None] = mapped_column(index=True)
    operation: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StreamEditorState(Base):
    __tablename__ = "stream_editor_states"

    stream_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    campaign_id: Mapped[int] = mapped_column(index=True)
    baseline: Mapped[dict[str, object]] = mapped_column(JSONB)
    published: Mapped[list[dict[str, object]]] = mapped_column(JSONB)
    draft: Mapped[list[dict[str, object]] | None] = mapped_column(JSONB, nullable=True)
    revision: Mapped[int] = mapped_column(default=1)
