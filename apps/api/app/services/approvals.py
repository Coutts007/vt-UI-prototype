"""The A9 guard: no real participant data before the ethics and data-protection approvals."""

from datetime import date, timedelta
from typing import Any

from app.errors import ApiError

REQUIRED = (
    "ierc_ref",
    "nacosti_licence_no",
    "dpia_submitted_on",
    "approvals_confirmed_by",
    "confirmed_at",
)
DPIA_WAIT = timedelta(days=60)


def missing(approvals: dict[str, Any]) -> list[str]:
    return [key for key in REQUIRED if not approvals.get(key)]


def earliest_collection(approvals: dict[str, Any]) -> date | None:
    """60 days after the DPIA went in, unless the ODPC has already answered (A9)."""
    submitted = approvals.get("dpia_submitted_on")
    if not submitted:
        return None
    if approvals.get("odpc_response_on"):
        return date.fromisoformat(str(approvals["odpc_response_on"]))
    return date.fromisoformat(str(submitted)) + DPIA_WAIT


def require_approvals(env: str, settings: dict[str, Any], today: date) -> None:
    """Study writes in production wait for every approval and for the DPIA date (A9).

    Development and staging hold seed and synthetic data only, which the guard does not cover.
    """
    if env != "production":
        return
    approvals = settings.get("approvals") or {}
    earliest = earliest_collection(approvals)
    if missing(approvals) or earliest is None or today < earliest:
        raise ApiError("approvals_missing")
