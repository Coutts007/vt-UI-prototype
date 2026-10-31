from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-jwt-secret-change-me-0123456789"
DEV_IP_PEPPER = "dev-only-ip-pepper"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+asyncpg://vt_app:vt-app-dev-only@localhost:5432/vt"
    migration_database_url: str | None = None
    vt_app_db_password: str = "vt-app-dev-only"
    jwt_secret: str = DEV_JWT_SECRET
    ip_pepper: str = DEV_IP_PEPPER
    trusted_proxies: str = ""
    token_hours: int = 24

    @model_validator(mode="after")
    def refuse_default_secrets(self) -> "Settings":
        if self.env == "production" and (
            self.jwt_secret == DEV_JWT_SECRET
            or self.ip_pepper == DEV_IP_PEPPER
            or self.vt_app_db_password == "vt-app-dev-only"
            or len(self.jwt_secret) < 32
        ):
            raise ValueError("Production needs its own secrets")
        return self
