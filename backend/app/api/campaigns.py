from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from app.api.dependencies import CampaignServiceDep
from app.integrations.keitaro.schemas import Campaign
from app.schemas.campaigns import CampaignDetails, CreateCampaignRequest

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get("")
async def list_campaigns(
    service: CampaignServiceDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> list[Campaign]:
    return await service.list_campaigns(offset, limit)


@router.get("/{campaign_id}")
async def get_campaign(
    campaign_id: Annotated[int, Path(gt=0)], service: CampaignServiceDep
) -> CampaignDetails:
    return await service.get_campaign(campaign_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_campaign(
    data: CreateCampaignRequest, service: CampaignServiceDep
) -> CampaignDetails:
    return await service.create_campaign(data)
