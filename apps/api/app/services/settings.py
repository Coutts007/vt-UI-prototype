from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting

DEFAULTS: dict[str, Any] = {
    "study_mode": False,
    "consent_version": "1.0",
    "min_app_version": "0.1.0",
    "current_rules_version": "0.1-uncalibrated",
    "retention_months": 24,
    "audit_retention_months": 24,
    "study_collection_end": None,
    "approvals": {
        "ierc_ref": None,
        "nacosti_licence_no": None,
        "dpia_submitted_on": None,
        "approvals_confirmed_by": None,
        "confirmed_at": None,
        "odpc_response_on": None,
        "odpc_response_ref": None,
    },
}


async def read_settings(session: AsyncSession) -> dict[str, Any]:
    rows = await session.execute(select(AppSetting.key, AppSetting.value))
    return {**DEFAULTS, **{key: value for key, value in rows}}
