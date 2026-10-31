"""`vt seed demo`: loads packages/seed/seed.json through the application role."""

import json
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    AppSetting,
    AuditLog,
    CaptureSession,
    Client,
    Conflict,
    Consent,
    EasePreset,
    Measurement,
    MeasurementProfile,
    Measurer,
    Order,
    OrderItem,
    OrderStatusHistory,
    Participant,
    ReferenceMeasurement,
    RulesVersion,
    ServerCheck,
    Tailor,
    UserAccount,
)
from app.security.passwords import hash_password

PACKAGES = Path(__file__).parents[3] / "packages"
SEED_ADMIN = "admin@vt.test"
SETTING_KEYS = (
    "retention_months",
    "study_mode",
    "study_collection_end",
    "audit_retention_months",
    "current_rules_version",
    "min_app_version",
    "consent_version",
    "approvals",
)


class SeedRefused(Exception):
    pass


def when(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def stamp(value: str) -> datetime:
    parsed = when(value)
    assert parsed
    return parsed


def to_e164(phone: str) -> str:
    return f"+254{phone[1:]}" if phone.startswith("0") else phone


async def add_profile(
    session: AsyncSession, row: dict[str, Any], participants: dict[str, uuid.UUID]
) -> None:
    client_id = uuid.UUID(row["client_id"])
    s = row["session"]
    study = s.get("study") or {}
    session_id = uuid.UUID(s["session_id"])
    session.add(
        CaptureSession(
            session_id=session_id,
            client_id=client_id,
            started_at=stamp(s["started_at"]),
            capture_mode=s["capture_mode"],
            camera_facing=s["camera_facing"],
            guidance_mode=s["guidance_mode"],
            free_arm=s["free_arm"],
            device_model=s["device_model"],
            os=s["os"],
            browser=s["browser"],
            memory_gb=s["memory_gb"],
            model_variant=s["model_variant"],
            stream_w=s["stream_w"],
            stream_h=s["stream_h"],
            still_source=s["still_source"],
            level_unchecked=s["level_unchecked"],
            capture_fallback=s["capture_fallback"],
            front_checks=s["front_checks"],
            side_checks=s["side_checks"],
            scale_front_mm_px=s["scale_front_mm_px"],
            scale_side_mm_px=s["scale_side_mm_px"],
            scale_stature_mm_px=s["scale_stature_mm_px"],
            scale_disagreement_pct=s["scale_disagreement_pct"],
            processing_ms=s["processing_ms"],
            retake_count=s["retake_count"],
            config_hash=s["config_hash"],
            app_version=s["app_version"],
            participant_id=participants.get(study.get("participant_code", "")),
            set_no=study.get("set_no"),
            lighting=study.get("lighting"),
            distance_m=study.get("distance_m"),
            clothing_fit_observed=study.get("clothing_fit_observed"),
            lux=study.get("lux"),
        )
    )
    await session.flush()
    profile_id = uuid.UUID(row["profile_id"])
    session.add(
        MeasurementProfile(
            profile_id=profile_id,
            client_id=client_id,
            session_id=session_id,
            version=row["version"],
            captured_at=stamp(row["captured_at"]),
            status=row["status"],
            landmarks_front=row["landmarks_front"],
            landmarks_side=row["landmarks_side"],
            marker_front=row["marker_front"],
            marker_side=row["marker_side"],
            silhouette_front=row["silhouette_front"],
            silhouette_side=row["silhouette_side"],
            rules_version=row["rules_version"],
            covariates=row["covariates"],
            payload_sha256="0" * 64,
            received_at=stamp(row["received_at"]),
        )
    )
    await session.flush()
    for item in row["measurements"]:
        session.add(
            Measurement(
                profile_id=profile_id,
                site_code=item["site_code"],
                value_mm=item["value_mm"],
                method=item["method"],
                confidence_flag=item["confidence_flag"],
                flag_reasons=item["flag_reasons"],
                correction_factor=item.get("correction_factor"),
                level_fraction=item.get("level_fraction"),
                half_width_mm=item.get("half_width_mm"),
                half_depth_mm=item.get("half_depth_mm"),
            )
        )
    for check in row["server_checks"]:
        session.add(
            ServerCheck(
                profile_id=profile_id,
                site_code=check["site_code"],
                kind=check["kind"],
                severity=check["severity"],
                detail=check["detail"],
            )
        )
    consent = row["consent"]
    session.add(
        Consent(
            client_id=client_id,
            consent_version=consent["consent_version"],
            language=consent["language"],
            scope=consent["scope"],
            given_at=stamp(consent["given_at"]),
            withdrawn_at=when(consent.get("withdrawn_at")),
        )
    )


async def load_demo(session: AsyncSession, settings: Settings) -> bool:
    """Returns False if the demo data is already there."""
    if settings.env == "production":
        raise SeedRefused("The demo seed cannot be loaded in production")
    if await session.scalar(select(UserAccount).where(UserAccount.email == SEED_ADMIN)):
        return False
    seed = json.loads((PACKAGES / "seed/seed.json").read_text())
    password_hash = hash_password(seed["demo_password"])
    users = {row["email"]: row for row in seed["users"]}

    for row in seed["users"]:
        session.add(
            UserAccount(
                user_id=uuid.UUID(row["user_id"]),
                email=row["email"],
                password_hash=password_hash,
                role=row["role"],
                status=row["status"],
                locale=row["locale"],
                unit_pref=row["unit_pref"],
                created_at=stamp(row["created_at"]),
            )
        )
    await session.flush()
    measurers: dict[str, uuid.UUID] = {}
    for row in seed["users"]:
        user_id = uuid.UUID(row["user_id"])
        if row["role"] == "tailor":
            session.add(
                Tailor(
                    tailor_id=user_id,
                    user_id=user_id,
                    business_name=row["business_name"],
                    phone_e164=to_e164(row["phone"]),
                    area=row["area"],
                    created_at=stamp(row["created_at"]),
                )
            )
        if row["role"] == "measurer":
            measurers[row["measurer_code"]] = user_id
            session.add(
                Measurer(
                    measurer_id=user_id,
                    user_id=user_id,
                    measurer_code=row["measurer_code"],
                    trained_on=date.fromisoformat(row["trained_on"]),
                )
            )
    await session.flush()

    clients: dict[str, uuid.UUID] = {}
    for row in seed["clients"]:
        clients[row["client_code"]] = uuid.UUID(row["client_id"])
        session.add(
            Client(
                client_id=uuid.UUID(row["client_id"]),
                client_code=row["client_code"],
                tailor_id=uuid.UUID(row["tailor_id"]),
                display_name=row["display_name"],
                height_mm=row["height_mm"],
                created_at=stamp(row["created_at"]),
            )
        )
    await session.flush()

    participants: dict[str, uuid.UUID] = {}
    for row in seed["participants"]:
        participants[row["participant_code"]] = uuid.UUID(row["participant_id"])
        session.add(
            Participant(
                participant_id=uuid.UUID(row["participant_id"]),
                participant_code=row["participant_code"],
                client_id=clients[row["client_code"]],
                sex=row["sex"],
                age_band=row["age_band"],
                venue=row["venue"],
                cohort=row["cohort"],
                cohort_assigned_at=stamp(row["enrolled_at"]),
                enrolled_at=stamp(row["enrolled_at"]),
            )
        )
    await session.flush()

    for row in seed["profiles"]:
        await add_profile(session, row, participants)
    await session.flush()

    for row in seed["conflicts"]:
        session.add(
            Conflict(
                conflict_id=uuid.UUID(row["conflict_id"]),
                client_id=uuid.UUID(row["client_id"]),
                server_profile_id=uuid.UUID(row["server_profile"]["profile_id"]),
                incoming_profile_id=uuid.UUID(row["incoming_profile"]["profile_id"]),
                created_at=stamp(row["created_at"]),
                resolved_at=when(row["resolved_at"]),
                resolution=row["resolution"],
            )
        )

    owners = {row["client_id"]: row["tailor_id"] for row in seed["clients"]}
    for row in seed["orders"]:
        order_id = uuid.UUID(row["order_id"])
        session.add(
            Order(
                order_id=order_id,
                order_no=row["order_no"],
                tailor_id=uuid.UUID(owners[row["client_id"]]),
                client_id=uuid.UUID(row["client_id"]),
                profile_id=uuid.UUID(row["profile_id"]),
                garment_type=row["garment_type"],
                status=row["status"],
                due_date=date.fromisoformat(row["due_date"]),
                notes=row["notes"],
                created_at=stamp(row["created_at"]),
                updated_at=stamp(row["updated_at"]),
            )
        )
        await session.flush()
        for item in row["items"]:
            session.add(
                OrderItem(
                    order_id=order_id,
                    site_code=item["site_code"],
                    body_mm=item["body_mm"],
                    ease_mm=item["ease_mm"],
                    finished_mm=item["finished_mm"],
                    overridden=item["overridden"],
                    override_reason=item.get("override_reason"),
                    flag_confirmed=item.get("flag_confirmed", False),
                    pending_fitting=item.get("pending_fitting", False),
                    confidence_flag=item["confidence_flag"],
                )
            )
        for step in row["status_history"]:
            session.add(
                OrderStatusHistory(
                    order_id=order_id, status=step["status"], changed_at=stamp(step["at"])
                )
            )

    for entry in seed["ease_presets"]:
        for preset in entry["presets"]:
            session.add(EasePreset(tailor_id=uuid.UUID(entry["tailor_id"]), **preset))

    for row in seed["reference_readings"]:
        session.add(
            ReferenceMeasurement(
                ref_id=uuid.UUID(row["ref_id"]),
                participant_id=participants[row["participant_code"]],
                measurer_id=measurers[row["measurer_code"]],
                site_code=row["site_code"],
                reading_no=row["reading_no"],
                value_mm=row["value_mm"],
                taken_at=stamp(row["taken_at"]),
                out_of_order=row["out_of_order"],
            )
        )

    for row in seed["audit"]:
        actor = users.get(row["user_email"] or "")
        session.add(
            AuditLog(
                occurred_at=stamp(row["occurred_at"]),
                actor_type=row["actor_type"],
                user_id=uuid.UUID(actor["user_id"]) if actor else None,
                action=row["action"],
                entity_type=row["entity_type"],
                entity_id=row["entity_id"],
                detail={"summary": row["summary"]},
            )
        )

    rules_file = PACKAGES / "rules/rules-0.1-uncalibrated.json"
    artifact = json.loads(rules_file.read_text())
    session.add(
        RulesVersion(
            rules_version=artifact["rules_version"],
            status=artifact["status"],
            artifact=artifact,
            checksum=artifact["checksum"],
            parent=artifact.get("parent"),
        )
    )
    for key in SETTING_KEYS:
        session.add(AppSetting(key=key, value=seed["settings"][key]))
    await session.commit()
    return True
