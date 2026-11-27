from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.error_handlers import register_error_handlers
from app.api.router import api_router
from app.core.config import Settings
from app.db.session import Database
from app.integrations.keitaro.client import KeitaroClient


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings()
    database = Database(settings.database_url)
    try:
        async with httpx.AsyncClient(
            base_url=settings.keitaro_api_url.rstrip("/") + "/",
            headers={"Api-Key": settings.keitaro_api_key.get_secret_value()},
            timeout=httpx.Timeout(settings.keitaro_timeout_seconds, connect=5.0),
        ) as http:
            app.state.settings = settings
            app.state.database = database
            app.state.keitaro = KeitaroClient(http)
            yield
    finally:
        await database.close()


app = FastAPI(title="Adrobot API", version="0.1.0", lifespan=lifespan)

# During local development Vite and FastAPI run on different ports.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)
app.include_router(api_router, prefix="/api/v1")

register_error_handlers(app)
