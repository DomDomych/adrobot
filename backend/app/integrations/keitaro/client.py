import logging
from typing import TypeVar

import httpx
from pydantic import TypeAdapter, ValidationError

from app.integrations.keitaro.exceptions import (
    KeitaroContractError,
    KeitaroError,
    KeitaroTimeout,
    KeitaroUnavailable,
)
from app.integrations.keitaro.schemas import (
    Campaign,
    CampaignCreate,
    Offer,
    Reference,
    Stream,
    StreamCreate,
    StreamOffer,
)

T = TypeVar("T")
logger = logging.getLogger(__name__)


class KeitaroClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http

    async def _send(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        params: dict[str, str | int] | None = None,
    ) -> httpx.Response:
        try:
            response = await self._http.request(
                method, path, json=payload, params=params
            )
        except httpx.TimeoutException as exc:
            logger.warning("Keitaro timeout: %s %s", method, path)
            raise KeitaroTimeout("Keitaro request timed out") from exc
        except httpx.RequestError as exc:
            logger.warning("Keitaro connection failure: %s %s", method, path)
            raise KeitaroUnavailable("Keitaro is unavailable") from exc

        if not response.is_success:
            logger.warning(
                "Keitaro rejected %s %s: %s", method, path, response.status_code
            )
            raise KeitaroError(
                "Keitaro returned an unsuccessful response",
                upstream_status=response.status_code,
            )
        return response

    async def _request(
        self,
        method: str,
        path: str,
        adapter: TypeAdapter[T],
        *,
        payload: dict[str, object] | None = None,
        params: dict[str, str | int] | None = None,
    ) -> T:
        response = await self._send(method, path, payload=payload, params=params)
        try:
            return adapter.validate_json(response.content)
        except ValidationError as exc:
            logger.error("Unexpected Keitaro response: %s %s", method, path)
            raise KeitaroContractError("Unexpected Keitaro response format") from exc

    async def list_campaigns(self, offset: int = 0, limit: int = 100) -> list[Campaign]:
        return await self._request(
            "GET",
            "campaigns",
            TypeAdapter(list[Campaign]),
            params={"offset": offset, "limit": limit},
        )

    async def get_campaign(self, campaign_id: int) -> Campaign:
        return await self._request(
            "GET", f"campaigns/{campaign_id}", TypeAdapter(Campaign)
        )

    async def create_campaign(self, data: CampaignCreate) -> Campaign:
        return await self._request(
            "POST",
            "campaigns",
            TypeAdapter(Campaign),
            payload=data.model_dump(mode="json"),
        )

    async def delete_campaign(self, campaign_id: int) -> None:
        await self._send("DELETE", f"campaigns/{campaign_id}")

    async def list_streams(self, campaign_id: int) -> list[Stream]:
        return await self._request(
            "GET", f"campaigns/{campaign_id}/streams", TypeAdapter(list[Stream])
        )

    async def get_stream(self, stream_id: int) -> Stream:
        return await self._request("GET", f"streams/{stream_id}", TypeAdapter(Stream))

    async def create_stream(self, data: StreamCreate) -> Stream:
        return await self._request(
            "POST",
            "streams",
            TypeAdapter(Stream),
            payload=data.model_dump(mode="json", by_alias=True, exclude_none=True),
        )

    async def replace_stream_offers(
        self, stream_id: int, offers: list[StreamOffer]
    ) -> Stream:
        return await self._request(
            "PUT",
            f"streams/{stream_id}",
            TypeAdapter(Stream),
            payload={"offers": [offer.model_dump(mode="json") for offer in offers]},
        )

    async def list_offers(self) -> list[Offer]:
        return await self._request("GET", "offers", TypeAdapter(list[Offer]))

    async def get_offer(self, offer_id: int) -> Offer:
        return await self._request("GET", f"offers/{offer_id}", TypeAdapter(Offer))

    async def list_domains(self) -> list[Reference]:
        return await self._request("GET", "domains", TypeAdapter(list[Reference]))

    async def list_groups(self) -> list[Reference]:
        return await self._request(
            "GET", "groups", TypeAdapter(list[Reference]), params={"type": "campaigns"}
        )

    async def list_traffic_sources(self) -> list[Reference]:
        return await self._request(
            "GET", "traffic_sources", TypeAdapter(list[Reference])
        )
