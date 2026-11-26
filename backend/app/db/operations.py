import logging

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import JournalUnavailable
from app.db.models import CampaignOperation

logger = logging.getLogger(__name__)


class OperationJournal:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def start(self, operation: str, detail: str) -> int:
        try:
            async with self._sessions.begin() as session:
                entry = CampaignOperation(
                    operation=operation, status="pending", detail=detail
                )
                session.add(entry)
                await session.flush()
                return entry.id
        except SQLAlchemyError as exc:
            logger.error("Could not initialize operation journal")
            raise JournalUnavailable("Operation journal is unavailable") from exc

    async def finish(
        self, operation_id: int, status: str, campaign_id: int | None, detail: str
    ) -> None:
        # Do not turn a successful remote write into a retryable failure if
        # PostgreSQL becomes unavailable afterwards. The pending row is retained.
        try:
            async with self._sessions.begin() as session:
                entry = await session.get(CampaignOperation, operation_id)
                if entry is None:
                    logger.error("Missing operation journal row: %s", operation_id)
                    return
                entry.status = status
                entry.campaign_id = campaign_id
                entry.detail = detail
        except SQLAlchemyError:
            logger.error(
                "Could not finalize operation %s: status=%s campaign_id=%s",
                operation_id,
                status,
                campaign_id,
            )
