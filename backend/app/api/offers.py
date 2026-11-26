from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import KeitaroDep
from app.integrations.keitaro.schemas import Offer

router = APIRouter(prefix="/offers", tags=["offers"])


@router.get("")
async def list_offers(
    client: KeitaroDep,
    q: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=170)] = 20,
) -> list[Offer]:
    query = q.strip().casefold()
    offers = await client.list_offers()
    return [
        offer
        for offer in offers
        if offer.state == "active"
        and (query in offer.name.casefold() or query in str(offer.id))
    ][:limit]
