import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.session import STORAGE_ERRORS

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def readiness(request: Request) -> JSONResponse:
    try:
        async with asyncio.timeout(3):
            async with request.app.state.database.engine.connect() as connection:
                # Verify migrated tables as well as DB connectivity, without Keitaro.
                await connection.execute(
                    text("SELECT 1 FROM stream_editor_states LIMIT 0")
                )
                await connection.execute(
                    text("SELECT 1 FROM campaign_operations LIMIT 0")
                )
    except STORAGE_ERRORS:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ready"})
