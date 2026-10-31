from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.schemas import PublicSettings, Status
from app.security.deps import Session
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
