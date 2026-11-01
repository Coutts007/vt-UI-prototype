from typing import Annotated, Any

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.errors import ApiError
from app.schemas import PublicSettings, RulesArtifact, Status
from app.security.deps import Session
from app.services.rules import find_rules
from app.services.settings import read_settings

router = APIRouter(tags=["public"])


@router.get("/health", operation_id="getHealth", response_model=Status)
async def health() -> Status:
    return Status(status="ok")


@router.get(
    "/ready", operation_id="getReady", response_model=Status, responses={503: {"model": Status}}
)
async def ready(request: Request) -> Status | JSONResponse:
    try:
        async with request.app.state.sessions() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return Status(status="ok")


@router.get("/settings/public", operation_id="getPublicSettings", response_model=PublicSettings)
async def public_settings(session: Session) -> PublicSettings:
    values = await read_settings(session)
    return PublicSettings(
        study_mode=values["study_mode"],
        consent_version=values["consent_version"],
        min_app_version=values["min_app_version"],
        current_rules_version=values["current_rules_version"],
    )


@router.get("/rules/current", operation_id="getCurrentRules", response_model=RulesArtifact)
async def current_rules(request: Request, session: Session) -> dict[str, Any]:
    values = await read_settings(session)
    return await find_rules(request.app.state.rules, session, values["current_rules_version"])


@router.get("/rules/{version}", operation_id="getRules", response_model=RulesArtifact)
async def rules_by_version(
    version: Annotated[str, Path(pattern=r"^[0-9]+\.[0-9]+-[a-z0-9-]+$", max_length=40)],
    request: Request,
    session: Session,
) -> dict[str, Any]:
    # Spec 8 serves frozen artifacts. The current one stays readable while it is still a draft.
    artifact = await find_rules(request.app.state.rules, session, version)
    current = (await read_settings(session))["current_rules_version"]
    if artifact.get("status") != "frozen" and version != current:
        raise ApiError("rules_version_unknown")
    return artifact
