from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.errors import (
    CampaignCreationError,
    EditorError,
    InactiveOfferError,
    JournalUnavailable,
)
from app.integrations.keitaro.exceptions import (
    KeitaroError,
    KeitaroTimeout,
    KeitaroUnavailable,
)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(KeitaroError)
    async def keitaro_error(request: Request, exc: KeitaroError) -> JSONResponse:
        if isinstance(exc, KeitaroTimeout):
            status, code = 504, "keitaro_timeout"
        elif isinstance(exc, KeitaroUnavailable):
            status, code = 503, "keitaro_unavailable"
        elif exc.upstream_status == 404 and request.method == "GET":
            status, code = 404, "not_found"
        else:
            status, code = 502, "keitaro_error"
        return JSONResponse(
            status_code=status, content={"code": code, "detail": str(exc)}
        )

    @app.exception_handler(CampaignCreationError)
    async def creation_error(
        request: Request, exc: CampaignCreationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=502,
            content={
                "code": exc.code,
                "detail": str(exc),
                "campaign_id": exc.campaign_id,
            },
        )

    @app.exception_handler(InactiveOfferError)
    async def inactive_offer(request: Request, exc: InactiveOfferError) -> JSONResponse:
        return JSONResponse(
            status_code=422, content={"code": "inactive_offer", "detail": str(exc)}
        )

    @app.exception_handler(JournalUnavailable)
    async def journal_error(request: Request, exc: JournalUnavailable) -> JSONResponse:
        return JSONResponse(
            status_code=503, content={"code": "journal_unavailable", "detail": str(exc)}
        )

    @app.exception_handler(EditorError)
    async def editor_error(request: Request, exc: EditorError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status, content={"code": exc.code, "detail": str(exc)}
        )
