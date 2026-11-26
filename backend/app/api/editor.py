from typing import Annotated

from fastapi import APIRouter, Path

from app.api.dependencies import EditorServiceDep
from app.schemas.editor import (
    CampaignEditor,
    EditorAction,
    EditorStream,
    FetchRequest,
    RevisionRequest,
)

router = APIRouter(prefix="/campaigns/{campaign_id}/editor", tags=["editor"])
EntityId = Annotated[int, Path(gt=0, le=2147483647)]


@router.get("")
async def get_editor(
    campaign_id: EntityId, service: EditorServiceDep
) -> CampaignEditor:
    return await service.get(campaign_id)


@router.post("/fetch")
async def fetch_editor(
    campaign_id: EntityId, data: FetchRequest, service: EditorServiceDep
) -> CampaignEditor:
    return await service.fetch(campaign_id, data)


@router.post("/streams/{stream_id}/actions")
async def change_stream(
    campaign_id: EntityId,
    stream_id: EntityId,
    data: EditorAction,
    service: EditorServiceDep,
) -> EditorStream:
    return await service.change(campaign_id, stream_id, data)


@router.post("/streams/{stream_id}/cancel")
async def cancel_stream(
    campaign_id: EntityId,
    stream_id: EntityId,
    data: RevisionRequest,
    service: EditorServiceDep,
) -> EditorStream:
    return await service.cancel(campaign_id, stream_id, data.revision)


@router.post("/streams/{stream_id}/publish")
async def publish_stream(
    campaign_id: EntityId,
    stream_id: EntityId,
    data: RevisionRequest,
    service: EditorServiceDep,
) -> EditorStream:
    return await service.publish(campaign_id, stream_id, data.revision)
