from typing import Annotated

from fastapi import Depends, Request

from app.db.editor import EditorRepository
from app.db.operations import OperationJournal
from app.integrations.keitaro.client import KeitaroClient
from app.services.campaigns import CampaignService
from app.services.editor import EditorService


def get_keitaro(request: Request) -> KeitaroClient:
    return request.app.state.keitaro


def get_campaign_service(request: Request) -> CampaignService:
    state = request.app.state
    return CampaignService(
        state.keitaro, state.settings, OperationJournal(state.database.journal_sessions)
    )


KeitaroDep = Annotated[KeitaroClient, Depends(get_keitaro)]
CampaignServiceDep = Annotated[CampaignService, Depends(get_campaign_service)]


def get_editor_service(request: Request) -> EditorService:
    state = request.app.state
    return EditorService(
        state.keitaro,
        EditorRepository(state.database.sessions),
        OperationJournal(state.database.journal_sessions),
    )


EditorServiceDep = Annotated[EditorService, Depends(get_editor_service)]
