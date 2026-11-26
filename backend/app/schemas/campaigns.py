from pydantic import BaseModel, Field, field_validator

from app.integrations.keitaro.schemas import Campaign, Stream


class CreateCampaignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    geo: str = Field(pattern=r"^[A-Z]{2}$")
    offer_id: int = Field(gt=0)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        if isinstance(value, str):
            name = value.strip()
            if name and not name.startswith("test_panesh_"):
                name = f"test_panesh_{name}"
            if name == "test_panesh_":
                raise ValueError("Campaign name must not be empty")
            return name
        return value

    @field_validator("geo", mode="before")
    @classmethod
    def normalize_geo(cls, value: object) -> object:
        return value.strip().upper() if isinstance(value, str) else value


class CampaignDetails(BaseModel):
    campaign: Campaign
    streams: list[Stream]
