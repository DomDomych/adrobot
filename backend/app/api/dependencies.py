from typing import Annotated

from fastapi import Depends, Request

from app.db.operations import OperationJournal
from app.integrations.keitaro.client import KeitaroClient
from app.services.campaigns import CampaignService


def get_keitaro(request: Request) -> KeitaroClient:
    return request.app.state.keitaro


def get_campaign_service(request: Request) -> CampaignService:
    state = request.app.state
    return CampaignService(
        state.keitaro, state.settings, OperationJournal(state.database.sessions)
    )


KeitaroDep = Annotated[KeitaroClient, Depends(get_keitaro)]
CampaignServiceDep = Annotated[CampaignService, Depends(get_campaign_service)]
