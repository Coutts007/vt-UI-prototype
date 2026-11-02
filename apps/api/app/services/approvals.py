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


def _day(value: Any) -> date | None:
    return date.fromisoformat(str(value)[:10]) if value else None


def problems(approvals: dict[str, Any], today: date) -> list[tuple[str, str]]:
    """What makes recorded approvals unbelievable (review of PR #14). Empty when they hold."""
    found: list[tuple[str, str]] = []
    dpia, odpc = _day(approvals.get("dpia_submitted_on")), _day(approvals.get("odpc_response_on"))
    if dpia and dpia > today:
        found.append(("approvals.dpia_submitted_on", "in_future"))
    if bool(odpc) != bool(approvals.get("odpc_response_ref")):
        found.append(("approvals.odpc_response_ref", "needs_date_and_reference"))
    if odpc and odpc > today:
        found.append(("approvals.odpc_response_on", "in_future"))
    if odpc and (dpia is None or odpc < dpia):
        found.append(("approvals.odpc_response_on", "before_dpia"))
    return found


def earliest_collection(approvals: dict[str, Any]) -> date | None:
    """60 days after the DPIA went in, unless the ODPC has already answered (A9). An ODPC answer
    counts only with its reference and on or after the DPIA date."""
    submitted = _day(approvals.get("dpia_submitted_on"))
    if not submitted:
        return None
    answered = _day(approvals.get("odpc_response_on"))
    if answered and approvals.get("odpc_response_ref") and answered >= submitted:
        return answered
    return submitted + DPIA_WAIT


def require_approvals(env: str, settings: dict[str, Any], today: date) -> None:
    """Study writes in production wait for every approval and for the DPIA date (A9).

    Development and staging hold seed and synthetic data only, which the guard does not cover.
    """
    if env != "production":
        return
    approvals = settings.get("approvals") or {}
    earliest = earliest_collection(approvals)
    if missing(approvals) or problems(approvals, today) or earliest is None or today < earliest:
        raise ApiError("approvals_missing")
