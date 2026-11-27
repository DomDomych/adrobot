from unittest.mock import AsyncMock

import httpx
import pytest

from app.api.dependencies import get_campaign_service, get_keitaro
from app.core.errors import CampaignCreationError
from app.integrations.keitaro.client import KeitaroClient
from app.integrations.keitaro.schemas import Campaign, Offer
from app.main import app
from app.schemas.campaigns import CampaignDetails
from app.services.campaigns import CampaignService


@pytest.mark.asyncio
async def test_campaign_and_offer_routes() -> None:
    service = AsyncMock(spec=CampaignService)
    service.create_campaign.return_value = CampaignDetails(
        campaign=Campaign(id=123, name="test_panesh_demo"), streams=[]
    )
    keitaro = AsyncMock(spec=KeitaroClient)
    keitaro.list_offers.return_value = [
        Offer(
            id=18001,
            name="Example offer",
            country=["CL"],
            state="active",
            payout_value=30,
            payout_currency="USD",
        ),
        Offer(
            id=18002,
            name="Disabled offer",
            country=["CL"],
            state="disabled",
            payout_value=30,
            payout_currency="USD",
        ),
    ]
    app.dependency_overrides[get_campaign_service] = lambda: service
    app.dependency_overrides[get_keitaro] = lambda: keitaro
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/offers", params={"q": "18001"})
        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [18001]
        response = await client.post(
            "/api/v1/campaigns",
            json={
                "name": "demo",
                "geo": "au",
                "offer_id": 18001,
            },
        )
        assert response.status_code == 201
        assert service.create_campaign.await_args.args[0].geo == "AU"
        response = await client.post(
            "/api/v1/campaigns",
            json={
                "name": "demo",
                "geo": "USA",
                "offer_id": 18001,
            },
        )
        assert response.status_code == 422
        service.create_campaign.side_effect = CampaignCreationError(
            "cleanup_failed",
            "Check Keitaro",
            campaign_id=123,
        )
        response = await client.post(
            "/api/v1/campaigns",
            json={
                "name": "demo",
                "geo": "AU",
                "offer_id": 18001,
            },
        )
        assert response.status_code == 502
        assert response.json()["campaign_id"] == 123

    app.dependency_overrides.clear()
