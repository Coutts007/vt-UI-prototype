"""POST /profiles after schema validation: backend-spec 9.2 steps 6 to 9, 9.3 and 9.5."""

import hashlib
import json
import uuid
from datetime import timedelta
from typing import Any

import structlog
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import exists, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError, problem_response
from app.models import (
    CaptureSession,
    Client,
    Conflict,
    Consent,
    Measurement,
    MeasurementProfile,
    Participant,
    ServerCheck,
)
from app.schemas import MeasurementProfilePayload
from app.security.ip_hash import ip_hash
from app.services import audit
from app.services.profile_checks import (
    Check,
    change_since_last,
    check,
    height_mismatch,
    rederive_checks,
    static_bounds,
)
from app.services.profiles import checks_of
from app.services.rules import lookup_rules
from app.services.settings import read_settings

log = structlog.get_logger()
HOUR = 3600
CODE_LIMIT = 10
KNOWN_CONSENT_VERSIONS = frozenset({"1.0"})
CHANGE_WINDOW = timedelta(days=90)


def invalid(field: str, code: str) -> ApiError:
    return ApiError("validation_failed", errors=[{"field": field, "code": code}])


def canonical_hash(raw: Any) -> str:
    text = json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()


def older_app(version: str, minimum: str) -> bool:
    """A version that cannot be read counts as too old, so that it is told to update."""

    def parts(text: str) -> tuple[int, ...]:
        return tuple(int(part) for part in text.split("."))

    try:
        return parts(version) < parts(minimum)
    except ValueError:
        return True


async def _reply(session: AsyncSession, row: MeasurementProfile) -> JSONResponse:
    conflict = await session.scalar(
        select(Conflict).where(
            Conflict.incoming_profile_id == row.profile_id, Conflict.resolved_at.is_(None)
        )
    )
    if conflict:
        server_version = await session.scalar(
            select(MeasurementProfile.version).where(
                MeasurementProfile.profile_id == conflict.server_profile_id
            )
        )
        return problem_response(
            "profile_version_conflict",
            server_version=server_version,
            conflict_id=str(conflict.conflict_id),
        )
    body = {
        "profile_id": str(row.profile_id),
        "version": row.version,
        "server_checks": await checks_of(session, row.profile_id),
    }
    return JSONResponse(body, status_code=201)


async def _check_consent(
    session: AsyncSession, body: MeasurementProfilePayload, client: Client, current: str
) -> None:
    consent = body.consent
    known = consent.consent_version == current or consent.consent_version in KNOWN_CONSENT_VERSIONS
    withdrawn = await session.scalar(
        select(
            exists().where(Consent.client_id == client.client_id, Consent.withdrawn_at.isnot(None))
        )
    )
    if "measure" not in consent.scope or not known or consent.withdrawn_at or withdrawn:
        raise ApiError("consent_missing")


async def _participant_for(
    session: AsyncSession, body: MeasurementProfilePayload, client: Client, study_mode: bool
) -> uuid.UUID | None:
    study = body.session.study
    if not study:
        return None
    participant = await session.scalar(
        select(Participant.participant_id).where(
            Participant.participant_code == study.participant_code,
            Participant.client_id == client.client_id,
        )
    )
    if not study_mode or not participant:
        raise invalid("session.study", "study_not_allowed")
    return participant


def _capture_session(
    body: MeasurementProfilePayload, client: Client, participant: uuid.UUID | None
) -> CaptureSession:
    s, study = body.session, body.session.study
    return CaptureSession(
        session_id=s.session_id,
        client_id=client.client_id,
        started_at=s.started_at,
        capture_mode=s.capture_mode,
        camera_facing=s.camera_facing,
        guidance_mode=s.guidance_mode,
        free_arm=s.free_arm,
        device_model=s.device_model,
        os=s.os,
        browser=s.browser,
        memory_gb=s.memory_gb,
        model_variant=s.model_variant,
        stream_w=s.stream_w,
        stream_h=s.stream_h,
        still_source=s.still_source,
        level_unchecked=s.level_unchecked,
        capture_fallback=s.capture_fallback,
        front_checks=s.front_checks.model_dump(),
        side_checks=s.side_checks.model_dump(),
        scale_front_mm_px=s.scale_front_mm_px,
        scale_side_mm_px=s.scale_side_mm_px,
        scale_stature_mm_px=s.scale_stature_mm_px,
        scale_disagreement_pct=s.scale_disagreement_pct,
        processing_ms=s.processing_ms,
        retake_count=s.retake_count,
        config_hash=s.config_hash,
        app_version=s.app_version,
        participant_id=participant,
        set_no=study.set_no if study else None,
        lighting=study.lighting if study else None,
        distance_m=study.distance_m if study else None,
        clothing_fit_observed=study.clothing_fit_observed if study else None,
        lux=study.lux if study else None,
    )


async def _stored_values(session: AsyncSession, profile_id: uuid.UUID) -> dict[str, int | None]:
    rows = await session.execute(
        select(Measurement.site_code, Measurement.value_mm).where(
            Measurement.profile_id == profile_id
        )
    )
    return {site: value for site, value in rows}


async def _server_checks(
    session: AsyncSession,
    raw: dict[str, Any],
    body: MeasurementProfilePayload,
    client: Client,
    previous: MeasurementProfile | None,
    rules: dict[str, Any] | None,
    current_rules: str,
) -> list[Check]:
    found: list[Check] = []
    if rules is None:
        found.append(check("rules_version_unknown", "check", None))
    elif body.rules_version != current_rules:
        found.append(check("stale_rules", "info", None, current=current_rules))
    values: dict[str, int | None] = {row.site_code: row.value_mm for row in body.measurements}
    if rules is not None:
        found += rederive_checks(raw, rules)
        found += static_bounds(values, rules.get("anomaly", {}).get("static_ratio_bounds", {}))
    if previous is not None and abs(previous.captured_at - body.captured_at) <= CHANGE_WINDOW:
        found += change_since_last(values, await _stored_values(session, previous.profile_id))
    found += height_mismatch(values.get("stature"), client.height_mm)
    return found


async def ingest(
    request: Request, session: AsyncSession, raw: dict[str, Any], body: MeasurementProfilePayload
) -> JSONResponse:
    settings = await read_settings(session)
    if older_app(body.session.app_version, settings["min_app_version"]):
        raise ApiError("stale_app_version")

    # A row lock, so that two phones for one client cannot both become the newest version.
    client = await session.scalar(
        select(Client)
        .where(Client.client_code == body.client_code, Client.deleted_at.is_(None))
        .with_for_update(key_share=True)
    )
    if not client:
        raise ApiError("code_not_found")
    request.app.state.limiter.hit("profile-code", body.client_code, CODE_LIMIT, HOUR)
    await _check_consent(session, body, client, settings["consent_version"])
    participant = await _participant_for(session, body, client, settings["study_mode"])

    payload_hash = canonical_hash(raw)
    existing = await session.get(MeasurementProfile, body.profile_id)
    if existing:
        if existing.payload_sha256 != payload_hash:
            raise invalid("profile_id", "profile_id_reused")
        return await _reply(session, existing)
    if await session.get(CaptureSession, body.session.session_id):
        raise invalid("session.session_id", "session_id_reused")

    newest = await session.scalar(
        select(MeasurementProfile)
        .where(
            MeasurementProfile.client_id == client.client_id, MeasurementProfile.status == "final"
        )
        .order_by(MeasurementProfile.version.desc())
        .limit(1)
    )
    is_final = newest is None or body.version > newest.version
    covariates = {**raw["covariates"], "code_verified": True}
    try:
        session.add(_capture_session(body, client, participant))
        await session.flush()
        consent = body.consent
        seen = await session.scalar(
            select(
                exists().where(
                    Consent.client_id == client.client_id,
                    Consent.consent_version == consent.consent_version,
                    Consent.given_at == consent.given_at,
                )
            )
        )
        if not seen:
            session.add(
                Consent(
                    client_id=client.client_id,
                    consent_version=consent.consent_version,
                    language=consent.language,
                    scope=list(consent.scope),
                    given_at=consent.given_at,
                )
            )
        row = MeasurementProfile(
            profile_id=body.profile_id,
            client_id=client.client_id,
            session_id=body.session.session_id,
            version=body.version,
            captured_at=body.captured_at,
            status="final" if is_final else "conflict",
            landmarks_front=raw["landmarks_front"],
            landmarks_side=raw["landmarks_side"],
            marker_front=raw["marker_front"],
            marker_side=raw["marker_side"],
            silhouette_front=raw["silhouette_front"],
            silhouette_side=raw["silhouette_side"],
            rules_version=body.rules_version,
            covariates=covariates,
            payload_sha256=payload_hash,
        )
        session.add(row)
        await session.flush()
        for item in body.measurements:
            session.add(
                Measurement(
                    profile_id=row.profile_id,
                    site_code=item.site_code,
                    value_mm=item.value_mm,
                    method=item.method,
                    confidence_flag=item.confidence_flag,
                    flag_reasons=list(item.flag_reasons),
                    correction_factor=item.correction_factor,
                    level_fraction=item.level_fraction,
                    half_width_mm=item.half_width_mm,
                    half_depth_mm=item.half_depth_mm,
                )
            )
        if not is_final:
            assert newest is not None
            session.add(
                Conflict(
                    client_id=client.client_id,
                    server_profile_id=newest.profile_id,
                    incoming_profile_id=row.profile_id,
                )
            )
        audit.record(
            session,
            actor_type="client",
            action="profile_ingest",
            entity_type="measurement_profile",
            entity_id=row.profile_id,
            client_id=client.client_id,
            ip_hash=ip_hash(request),
            detail={"version": body.version, "status": row.status},
        )
        await session.flush()
    except DBAPIError as error:
        # A number the schema allows and the column cannot hold, or another client's identifier.
        log.warning("profile_refused_by_database", error_type=type(error).__name__)
        await session.rollback()
        raise invalid("body", "not_storable") from None

    await _store_checks(session, raw, body, client, row, newest, settings, request.app.state.rules)
    reply = await _reply(session, row)
    await session.commit()
    return reply


async def _store_checks(
    session: AsyncSession,
    raw: dict[str, Any],
    body: MeasurementProfilePayload,
    client: Client,
    row: MeasurementProfile,
    previous: MeasurementProfile | None,
    settings: dict[str, Any],
    files: dict[str, dict[str, Any]],
) -> None:
    """A failure here is logged by type and the profile is still kept (9.3)."""
    try:
        async with session.begin_nested():
            rules = await lookup_rules(files, session, body.rules_version)
            found = await _server_checks(
                session, raw, body, client, previous, rules, settings["current_rules_version"]
            )
            for item in found:
                session.add(ServerCheck(profile_id=row.profile_id, **item))
            await session.flush()
    except Exception as error:
        log.error("server_checks_failed", error_type=type(error).__name__)
