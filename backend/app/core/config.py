from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(repr=False)


class Settings(DatabaseSettings):
    keitaro_api_url: str = "https://keitaro-for-tests.etolegko.com/admin_api/v1"
    keitaro_api_key: SecretStr = Field(min_length=1)
    keitaro_domain_id: int = Field(default=1813, gt=0)
    keitaro_group_id: int = Field(default=10332, gt=0)
    keitaro_traffic_source_id: int = Field(default=836, gt=0)
    keitaro_timeout_seconds: float = Field(default=15, gt=0)
