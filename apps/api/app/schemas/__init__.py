"""Pydantic shapes mirroring packages/contracts/openapi.yaml."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Email = Annotated[
    str, StringConstraints(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", to_lower=True)
]
Phone = Annotated[
    str, StringConstraints(pattern=r"^\+2547[0-9]{8}$|^\+2541[0-9]{8}$|^0[17][0-9]{8}$")
]
Locale = Literal["en", "sw"]
Unit = Literal["cm", "in"]
Role = Literal["tailor", "admin", "measurer"]
AccountStatus = Literal["pending", "active", "disabled", "rejected"]


def _has_nul(value: Any) -> bool:
    if isinstance(value, str):
        return "\x00" in value
    if isinstance(value, dict):
        return any(_has_nul(key) or _has_nul(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_has_nul(item) for item in value)
    return False


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def refuse_nul_characters(cls, value: Any) -> Any:
        # PostgreSQL cannot store NUL, so it must stop here and not surface as a server error.
        if _has_nul(value):
            raise ValueError("NUL characters are not allowed")
        return value


class Status(BaseModel):
    status: Literal["ok", "unavailable"]


class PublicSettings(BaseModel):
    study_mode: bool
    consent_version: str
    min_app_version: str
    current_rules_version: str


class LoginInput(Input):
    email: Email
    password: str = Field(max_length=256)


class RegisterInput(Input):
    email: Email
    password: str = Field(min_length=10, max_length=256)
    business_name: str = Field(min_length=1, max_length=120)
    phone: Phone
    area: str = Field(max_length=120)
    locale: Locale


class RegisterResult(BaseModel):
    status: Literal["pending"]


class User(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=False)

    user_id: str
    email: str
    role: Role
    status: AccountStatus
    locale: Locale
    unit_pref: Unit
    business_name: str | None = None
    phone: str | None = None
    area: str | None = None
    measurer_code: str | None = None


class LoginResult(BaseModel):
    access_token: str
    expires_at: datetime
    user: User


class UserUpdate(Input):
    business_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: Phone | None = None
    area: str | None = Field(default=None, max_length=120)
    locale: Locale | None = None
    unit_pref: Unit | None = None


class PasswordChange(Input):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=10, max_length=256)
