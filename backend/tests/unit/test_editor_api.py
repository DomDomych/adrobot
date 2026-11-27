from unittest.mock import AsyncMock

import httpx
import pytest

from app.api.dependencies import get_editor_service
from app.core.errors import EditorError
from app.integrations.keitaro.schemas import Campaign, Stream
from app.main import app
from app.schemas.editor import CampaignEditor, EditorStream
from app.services.editor import EditorService


@pytest.mark.asyncio
async def test_editor_api_contract() -> None:
    service = AsyncMock(spec=EditorService)
    stream = EditorStream(
        stream=Stream(
            id=12, name="Offers", campaign_id=5, type="default", schema="landings"
        ),
        editable=True,
        revision=2,
    )
    service.get.return_value = CampaignEditor(
        campaign=Campaign(id=5, name="Demo"), streams=[stream]
    )
    service.change.return_value = stream
    app.dependency_overrides[get_editor_service] = lambda: service
    root = "/api/v1/campaigns/5/editor"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get(root)
        assert result.status_code == 200
        assert result.json()["streams"][0]["stream"]["schema"] == "landings"
        action = {"revision": 1, "action": "share", "offer_id": 1, "share": 30}
        result = await client.post(f"{root}/streams/12/actions", json=action)
        assert result.status_code == 200
        assert service.change.await_args.args[2].share == 30
        action["share"] = 101
        assert (
            await client.post(f"{root}/streams/12/actions", json=action)
        ).status_code == 422
        service.publish.side_effect = EditorError("upstream_conflict", "Changed", 409)
        result = await client.post(f"{root}/streams/12/publish", json={"revision": 2})
        assert result.status_code == 409
        assert result.json()["code"] == "upstream_conflict"

    app.dependency_overrides.clear()
