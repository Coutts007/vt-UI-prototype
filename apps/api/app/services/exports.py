"""The two study exports, column for column as backend-spec 12.1 lists them.

Codes only: no name, phone, email or client code leaves in them. A participant who withdrew
is left out (D44 default, open for the owner). Centimetres to one decimal; a missing
value is an empty cell.
"""

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    SITES,
    CaptureSession,
    Consent,
    Measurement,
    MeasurementDerivation,
    MeasurementProfile,
    Measurer,
    Participant,
    ReferenceCorrection,
    ReferenceMeasurement,
    ServerCheck,
)
from app.services.csvout import to_csv

CHECKS = ("level", "frame", "distance", "symmetry", "arms", "marker", "light", "sharpness")
CAPTURE_HEAD = (
    "participant_code", "cohort", "set_no", "capture_mode", "camera_facing", "captured_at",
    "device_model", "os", "browser", "model_variant", "rules_version_used",
    "rederived_rules_version", "lighting", "distance_m", "clothing_fit_observed", "lux",
)  # fmt: skip
SCALE_TAIL = (
    "scale_front_mm_px", "scale_side_mm_px", "scale_stature_mm_px", "scale_disagreement_pct",
    "processing_ms", "retake_count",
)  # fmt: skip
CAPTURE_COLUMNS = (
    *CAPTURE_HEAD,
    *(f"front_{name}" for name in CHECKS),
    *(f"side_{name}" for name in CHECKS),
    *SCALE_TAIL,
    *(column for site in SITES for column in (f"{site}_cm", f"{site}_flag")),
    "server_checks",
)
REFERENCE_COLUMNS = (
    "participant_code", "cohort", "site_code", "measurer_code", "reading_no", "value_cm",
    "taken_at",
)  # fmt: skip


def cm(value_mm: int | None) -> str:
    return "" if value_mm is None else f"{value_mm / 10:.1f}"


def _number(value: Any) -> str:
    return "" if value is None else str(value)


def _kept() -> Any:
    """Participants still in the study: no withdrawal on the row and none through consent (D44)."""
    consent_withdrawn = select(Consent.client_id).where(Consent.withdrawn_at.isnot(None))
    return (Participant.withdrawn_at.is_(None)) & Participant.client_id.not_in(consent_withdrawn)


async def captures_csv(session: AsyncSession, rules_version: str | None) -> tuple[str, int]:
    found = await session.execute(
        select(CaptureSession, MeasurementProfile, Participant)
        .join(MeasurementProfile, MeasurementProfile.session_id == CaptureSession.session_id)
        .join(Participant, Participant.participant_id == CaptureSession.participant_id)
        .where(
            MeasurementProfile.status != "deleted",
            _kept(),
        )
        .order_by(
            Participant.participant_code, CaptureSession.set_no, MeasurementProfile.captured_at
        )
    )
    sets = found.all()
    ids = [row.MeasurementProfile.profile_id for row in sets]
    values: dict[Any, dict[str, tuple[int | None, str]]] = defaultdict(dict)
    if rules_version is None:
        for m in await session.scalars(select(Measurement).where(Measurement.profile_id.in_(ids))):
            values[m.profile_id][m.site_code] = (m.value_mm, m.confidence_flag)
    else:
        derived = await session.scalars(
            select(MeasurementDerivation).where(
                MeasurementDerivation.profile_id.in_(ids),
                MeasurementDerivation.rules_version == rules_version,
            )
        )
        for d in derived:
            values[d.profile_id][d.site_code] = (d.value_mm, d.confidence_flag)
    checks: dict[Any, list[str]] = defaultdict(list)
    for check in await session.scalars(
        select(ServerCheck)
        .where(ServerCheck.profile_id.in_(ids))
        .order_by(ServerCheck.kind, ServerCheck.site_code)
    ):
        checks[check.profile_id].append(
            f"{check.site_code}:{check.kind}" if check.site_code else check.kind
        )

    def line(s: CaptureSession, p: MeasurementProfile, person: Participant) -> list[Any]:
        sites = values.get(p.profile_id, {})
        rederived = rules_version if rules_version and sites else ""
        out: list[Any] = [
            person.participant_code, person.cohort, _number(s.set_no), s.capture_mode,
            s.camera_facing, p.captured_at.isoformat(), s.device_model, s.os, s.browser,
            s.model_variant, p.rules_version, rederived, s.lighting or "",
            _number(s.distance_m), s.clothing_fit_observed or "", _number(s.lux),
        ]  # fmt: skip
        out += [(s.front_checks or {}).get(name, "") for name in CHECKS]
        out += [(s.side_checks or {}).get(name, "") for name in CHECKS]
        out += [
            _number(s.scale_front_mm_px), _number(s.scale_side_mm_px),
            _number(s.scale_stature_mm_px), _number(s.scale_disagreement_pct),
            _number(s.processing_ms), _number(s.retake_count),
        ]  # fmt: skip
        for site in SITES:
            value, flag = sites.get(site, (None, ""))
            out += [cm(value), flag]
        out.append(";".join(checks.get(p.profile_id, [])))
        return out

    body = [line(row.CaptureSession, row.MeasurementProfile, row.Participant) for row in sets]
    return to_csv(CAPTURE_COLUMNS, body), len(body)


async def reference_csv(session: AsyncSession) -> tuple[str, int]:
    found = await session.execute(
        select(ReferenceMeasurement, Participant, Measurer)
        .join(Participant, Participant.participant_id == ReferenceMeasurement.participant_id)
        .join(Measurer, Measurer.measurer_id == ReferenceMeasurement.measurer_id)
        .where(_kept())
        .order_by(
            Participant.participant_code,
            ReferenceMeasurement.site_code,
            Measurer.measurer_code,
            ReferenceMeasurement.reading_no,
        )
    )
    readings = found.all()
    latest: dict[Any, int] = {}
    corrections = await session.scalars(
        select(ReferenceCorrection)
        .where(ReferenceCorrection.ref_id.in_([r.ReferenceMeasurement.ref_id for r in readings]))
        .order_by(ReferenceCorrection.corrected_at, ReferenceCorrection.correction_id)
    )
    for correction in corrections:
        latest[correction.ref_id] = correction.value_mm  # the newest one wins
    body = [
        [
            row.Participant.participant_code,
            row.Participant.cohort,
            row.ReferenceMeasurement.site_code,
            row.Measurer.measurer_code,
            row.ReferenceMeasurement.reading_no,
            cm(latest.get(row.ReferenceMeasurement.ref_id, row.ReferenceMeasurement.value_mm)),
            row.ReferenceMeasurement.taken_at.isoformat(),
        ]
        for row in readings
    ]
    return to_csv(REFERENCE_COLUMNS, body), len(body)
