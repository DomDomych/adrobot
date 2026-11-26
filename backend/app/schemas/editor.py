from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.integrations.keitaro.schemas import Campaign, Stream


class EditorOffer(BaseModel):
    offer_id: int = Field(gt=0)
    name: str
    share: float = Field(ge=0, le=100, allow_inf_nan=False)
    active: bool = True
    pinned: bool = False


class EditorStream(BaseModel):
    stream: Stream
    editable: bool
    offers: list[EditorOffer] = Field(default_factory=list)
    published_offers: list[EditorOffer] = Field(default_factory=list)
    dirty: bool = False
    revision: int | None = None
    total_share: float = 0
    validation_error: str | None = None
    missing: bool = False


class CampaignEditor(BaseModel):
    campaign: Campaign
    streams: list[EditorStream]


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1, strict=True)


class AddOffer(RevisionRequest):
    action: Literal["add"]
    offer_id: int = Field(gt=0, strict=True)


class ToggleOffer(RevisionRequest):
    action: Literal["remove", "restore", "pin", "unpin"]
    offer_id: int = Field(gt=0, strict=True)


class EditShare(RevisionRequest):
    action: Literal["share"]
    offer_id: int = Field(gt=0, strict=True)
    share: int = Field(ge=0, le=100, strict=True)


EditorAction = Annotated[
    AddOffer | ToggleOffer | EditShare, Field(discriminator="action")
]


class FetchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    discard_drafts: bool = False
    revisions: dict[int, int] = Field(default_factory=dict)
