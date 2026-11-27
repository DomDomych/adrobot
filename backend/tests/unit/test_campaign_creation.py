import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import CampaignCreationError
from app.db.operations import OperationJournal
from app.integrations.keitaro.client import KeitaroClient
from app.schemas.campaigns import CreateCampaignRequest
from app.services.campaigns import CampaignService


@pytest.mark.parametrize(
    ("failure", "expected_status"),
    [
        (None, "success"),
        ("stream", "rolled_back"),
        ("cleanup", "cleanup_failed"),
        ("campaign_timeout", "unknown"),
        ("campaign_500", "unknown"),
        ("campaign_invalid_json", "unknown"),
        ("campaign_incomplete", "unknown"),
        ("cleanup_404", "rolled_back"),
    ],
)
def test_campaign_creation(failure: str | None, expected_status: str) -> None:
    requests: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/admin_api/v1/")
        data = json.loads(request.content) if request.content else {}
        requests.append((request.method, path, data))
        if path == "offers/18001":
            return httpx.Response(
                200,
                json={
                    "id": 18001,
                    "name": "Offer",
                    "country": ["CL"],
                    "state": "active",
                    "payout_value": 30,
                    "payout_currency": "USD",
                },
            )
        if path == "campaigns":
            if failure == "campaign_timeout":
                raise httpx.ReadTimeout("timeout", request=request)
            if failure == "campaign_500":
                return httpx.Response(500)
            if failure == "campaign_invalid_json":
                return httpx.Response(200, content=b"not json")
            if failure == "campaign_incomplete":
                return httpx.Response(200, json={"name": "missing ID"})
            return httpx.Response(201, json={"id": 123, **data})
        if path == "streams":
            if data["type"] == "default" and failure in {
                "stream",
                "cleanup",
                "cleanup_404",
            }:
                return httpx.Response(500)
            return httpx.Response(201, json={"id": len(requests), **data})
        if path == "campaigns/123" and request.method == "DELETE":
            return httpx.Response(
                500
                if failure == "cleanup"
                else 404
                if failure == "cleanup_404"
                else 204
            )
        raise AssertionError(path)

    async def run() -> None:
        journal = AsyncMock(spec=OperationJournal)
        journal.start.return_value = 7
        settings = Settings(
            database_url="postgresql+asyncpg://unused",
            keitaro_api_key="test-key",
            _env_file=None,
        )
        async with httpx.AsyncClient(
            base_url="https://example.test/admin_api/v1/",
            transport=httpx.MockTransport(handler),
        ) as http:
            service = CampaignService(KeitaroClient(http), settings, journal)
            data = CreateCampaignRequest(name="demo", geo="au", offer_id=18001)
            if failure:
                with pytest.raises(CampaignCreationError):
                    await service.create_campaign(data)
            else:
                result = await service.create_campaign(data)
                assert result.campaign.id == 123
                assert len(result.streams) == 2
        journal.start.assert_awaited_once()
        journal.finish.assert_awaited_once()
        assert journal.finish.await_args.args[1] == expected_status

    asyncio.run(run())
    assert requests[1][2] == {
        "name": "test_panesh_demo",
        "domain_id": 1813,
        "group_id": 10332,
        "traffic_source_id": 836,
        "type": "position",
    }
    if failure and failure.startswith("campaign_"):
        assert len(requests) == 2
        return
    assert requests[2][2]["filters"] == [
        {"name": "country", "mode": "accept", "payload": ["AU"]}
    ]
    assert requests[2][2]["action_payload"] == "https://google.com"
    assert requests[3][2]["offers"] == [
        {"offer_id": 18001, "share": 100, "state": "active"}
    ]
    if failure:
        assert requests[-1][:2] == ("DELETE", "campaigns/123")
