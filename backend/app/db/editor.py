from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import EditorError
from app.db.models import StreamEditorState


class EditorRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    @asynccontextmanager
    async def locked(self, campaign_id: int) -> AsyncIterator["EditorTransaction"]:
        # Serialize all editor mutations for a campaign, including across workers.
        # The transaction releases the advisory lock on commit or rollback.
        try:
            async with self._sessions.begin() as session:
                await session.execute(text("SET LOCAL lock_timeout = '5s'"))
                await session.execute(
                    text("SELECT pg_advisory_xact_lock(:namespace, :campaign_id)"),
                    {"namespace": 193730, "campaign_id": campaign_id},
                )
                yield EditorTransaction(session)
        except SQLAlchemyError as exc:
            raise EditorError(
                "editor_storage_unavailable",
                "Editor storage unavailable or busy; reload before retrying",
                503,
            ) from exc


class EditorTransaction:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(self, campaign_id: int) -> list[StreamEditorState]:
        result = await self._session.scalars(
            select(StreamEditorState).where(
                StreamEditorState.campaign_id == campaign_id
            )
        )
        return list(result)

    def add(self, state: StreamEditorState) -> None:
        self._session.add(state)
