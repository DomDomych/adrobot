from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_campaign_service, get_keitaro
from app.api.error_handlers import register_error_handlers
from app.api.router import api_router
from app.core.errors import CampaignCreationError
from app.integrations.keitaro.client import KeitaroClient
from app.integrations.keitaro.schemas import Campaign, Offer
from app.schemas.campaigns import CampaignDetails
from app.services.campaigns import CampaignService


def test_campaign_and_offer_routes() -> None:
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")
    register_error_handlers(app)
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
    with TestClient(app) as client:
        response = client.get("/api/v1/offers", params={"q": "18001"})
        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [18001]
        response = client.post(
            "/api/v1/campaigns",
            json={
                "name": "demo",
                "geo": "au",
                "offer_id": 18001,
            },
        )
        assert response.status_code == 201
        assert service.create_campaign.await_args.args[0].geo == "AU"
        response = client.post(
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
        response = client.post(
            "/api/v1/campaigns",
            json={
                "name": "demo",
                "geo": "AU",
                "offer_id": 18001,
            },
        )
        assert response.status_code == 502
        assert response.json()["campaign_id"] == 123
