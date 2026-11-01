"""Stored profiles and their rows as contract JSON. Optional fields are left out, never null."""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CaptureSession,
    Client,
    Consent,
    Measurement,
    MeasurementProfile,
    Participant,
    ServerCheck,
)

SESSION_TEXT = (
    "capture_mode", "camera_facing", "guidance_mode", "free_arm", "app_version", "device_model",
    "os", "browser", "model_variant", "still_source", "config_hash", "stream_w", "stream_h",
    "level_unchecked", "capture_fallback", "front_checks", "side_checks", "processing_ms",
    "retake_count",
)  # fmt: skip
SESSION_NUMBERS = (
    "scale_front_mm_px", "scale_side_mm_px", "scale_stature_mm_px", "scale_disagreement_pct",
)  # fmt: skip
ROW_NUMBERS = ("correction_factor", "level_fraction", "half_width_mm", "half_depth_mm")


async def checks_of(session: AsyncSession, profile_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await session.scalars(
        select(ServerCheck)
        .where(ServerCheck.profile_id == profile_id)
        .order_by(ServerCheck.kind, ServerCheck.site_code)
    )
    return [
        {"kind": r.kind, "severity": r.severity, "site_code": r.site_code, "detail": r.detail}
        for r in rows
    ]


def consent_json(row: Consent) -> dict[str, Any]:
    body = {
        "consent_version": row.consent_version,
        "language": row.language,
        "scope": row.scope,
        "given_at": row.given_at.isoformat(),
    }
    return body | ({"withdrawn_at": row.withdrawn_at.isoformat()} if row.withdrawn_at else {})


def _measurement_json(row: Measurement) -> dict[str, Any]:
    body: dict[str, Any] = {
        "site_code": row.site_code,
        "value_mm": row.value_mm,
        "method": row.method,
        "confidence_flag": row.confidence_flag,
        "flag_reasons": row.flag_reasons,
    }
    for name in ROW_NUMBERS:
        if (value := getattr(row, name)) is not None:
            body[name] = float(value)
    return body


def _session_json(row: CaptureSession, participant_code: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "session_id": str(row.session_id),
        "started_at": row.started_at.isoformat(),
        "memory_gb": None if row.memory_gb is None else float(row.memory_gb),
    }
    body |= {name: getattr(row, name) for name in SESSION_TEXT}
    body |= {name: float(getattr(row, name)) for name in SESSION_NUMBERS}
    if participant_code:
        study = {
            "participant_code": participant_code,
            "set_no": row.set_no,
            "lighting": row.lighting,
            "distance_m": float(row.distance_m or 0),
            "clothing_fit_observed": row.clothing_fit_observed,
        }
        body["study"] = study | ({"lux": row.lux} if row.lux is not None else {})
    return body


def _consent_for(captured_at: datetime, consents: Sequence[Consent]) -> Consent:
    given = [c for c in consents if c.given_at <= captured_at]
    return max(given or consents, key=lambda c: c.given_at)


async def profile_json(
    session: AsyncSession, client: Client, row: MeasurementProfile, consents: Sequence[Consent]
) -> dict[str, Any]:
    capture = await session.get(CaptureSession, row.session_id)
    assert capture is not None
    code = None
    if capture.participant_id:
        code = await session.scalar(
            select(Participant.participant_code).where(
                Participant.participant_id == capture.participant_id
            )
        )
    rows = await session.scalars(
        select(Measurement)
        .where(Measurement.profile_id == row.profile_id)
        .order_by(Measurement.site_code)
    )
    return {
        "profile_id": str(row.profile_id),
        "client_id": str(client.client_id),
        "client_code": client.client_code,
        "version": row.version,
        "captured_at": row.captured_at.isoformat(),
        "received_at": row.received_at.isoformat(),
        "status": row.status,
        "rules_version": row.rules_version,
        "covariates": row.covariates,
        "consent": consent_json(_consent_for(row.captured_at, consents)),
        "session": _session_json(capture, code),
        "landmarks_front": row.landmarks_front,
        "landmarks_side": row.landmarks_side,
        "marker_front": row.marker_front,
        "marker_side": row.marker_side,
        "silhouette_front": row.silhouette_front,
        "silhouette_side": row.silhouette_side,
        "measurements": [_measurement_json(m) for m in rows],
        "server_checks": await checks_of(session, row.profile_id),
    }
