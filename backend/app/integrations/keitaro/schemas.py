from pydantic import BaseModel, Field


class Reference(BaseModel):
    id: int
    name: str


class Offer(Reference):
    country: list[str]
    state: str
    payout_value: float
    payout_currency: str


class Campaign(Reference):
    alias: str | None = None
    domain_id: int | None = None
    group_id: int | None = None
    traffic_source_id: int | None = None
    state: str | None = None


class CampaignCreate(BaseModel):
    name: str
    domain_id: int
    group_id: int
    traffic_source_id: int
    type: str = "position"


class StreamOffer(BaseModel):
    offer_id: int
    share: float
    state: str = "active"


class StreamFilter(BaseModel):
    name: str
    mode: str
    payload: list[str]


class Stream(Reference):
    campaign_id: int
    type: str
    schema_type: str = Field(alias="schema")
    position: int | None = None
    action_type: str | None = None
    action_payload: str | None = None
    filters: list[StreamFilter] = Field(default_factory=list)
    offers: list[StreamOffer] = Field(default_factory=list)


class StreamCreate(BaseModel):
    campaign_id: int
    name: str
    type: str
    schema_type: str = Field(alias="schema")
    action_type: str | None = None
    action_payload: str | None = None
    filters: list[StreamFilter] | None = None
    offers: list[StreamOffer] | None = None
