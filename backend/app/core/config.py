from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    database_url: str = Field(repr=False)


class Settings(DatabaseSettings):
    keitaro_api_url: str = "https://keitaro-for-tests.etolegko.com/admin_api/v1"
    keitaro_admin_url: str = "https://keitaro-for-tests.etolegko.com/admin/"
    keitaro_api_key: SecretStr = Field(min_length=1)
    keitaro_domain_id: int = Field(default=1813, gt=0)
    keitaro_group_id: int = Field(default=10332, gt=0)
    keitaro_traffic_source_id: int = Field(default=836, gt=0)
    keitaro_timeout_seconds: float = Field(default=15, gt=0)

    @field_validator("keitaro_api_url", "keitaro_admin_url")
    @classmethod
    def safe_url(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
        ):
            raise ValueError(
                "Use an HTTP(S) URL without credentials, query or fragment"
            )
        return value.rstrip("/")
