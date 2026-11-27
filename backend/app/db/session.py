from asyncpg import PostgresError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Connection establishment can raise driver/OS errors before SQLAlchemy wraps them.
STORAGE_ERRORS = (SQLAlchemyError, PostgresError, OSError)


class Database:
    def __init__(self, url: str) -> None:
        self.engine = create_async_engine(url, pool_pre_ping=True)
        self.journal_engine = create_async_engine(
            url, pool_pre_ping=True, pool_size=2, max_overflow=3, pool_timeout=5
        )
        self.journal_sessions = async_sessionmaker(
            self.journal_engine, class_=AsyncSession, expire_on_commit=False
        )
        self.sessions = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def close(self) -> None:
        await self.engine.dispose()
        await self.journal_engine.dispose()
