import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.api.dependencies import KeitaroDep
from app.integrations.keitaro.exceptions import KeitaroError
from app.integrations.keitaro.schemas import Reference

router = APIRouter(tags=["references"])


class References(BaseModel):
    domains: list[Reference] = Field(default_factory=list)
    groups: list[Reference] = Field(default_factory=list)
    traffic_sources: list[Reference] = Field(default_factory=list)
    unavailable: list[str] = Field(default_factory=list)
    admin_url: str


@router.get("/references")
async def references(client: KeitaroDep, request: Request) -> References:
    result = References(admin_url=request.app.state.settings.keitaro_admin_url)
    names = ("domains", "groups", "traffic_sources")
    responses = await asyncio.gather(
        client.list_domains(),
        client.list_groups(),
        client.list_traffic_sources(),
        return_exceptions=True,
    )
    for name, response in zip(names, responses, strict=True):
        if isinstance(response, KeitaroError):
            result.unavailable.append(name)
        elif isinstance(response, BaseException):
            raise response
        else:
            setattr(result, name, response)
    return result
