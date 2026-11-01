"""Every table in backend-spec 7. Millimetres are SMALLINT and no column holds binary data."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, CITEXT, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def one_of(column: str, *values: str, name: str | None = None) -> CheckConstraint:
    allowed = ", ".join(f"'{value}'" for value in values)
    return CheckConstraint(f"{column} IN ({allowed})", name=name or f"{column}_allowed")


SITES = ("stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck")
GARMENTS = ("shirt", "dress", "trousers", "suit_jacket", "skirt", "other")
ORDER_STATUSES = ("new", "cutting", "fitting", "ready", "collected")


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def fk(target: str, *, nullable: bool = False, ondelete: str | None = None) -> Mapped[Any]:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable
    )


def now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def stamp(nullable: bool = True) -> Mapped[Any]:
    return mapped_column(DateTime(timezone=True), nullable=nullable)


class UserAccount(Base):
    __tablename__ = "user_account"
    __table_args__ = (
        one_of("role", "tailor", "admin", "measurer"),
        one_of("status", "pending", "active", "disabled", "rejected"),
        one_of("locale", "en", "sw"),
        one_of("unit_pref", "cm", "in"),
    )
    user_id: Mapped[uuid.UUID] = pk()
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10))
    locale: Mapped[str] = mapped_column(String(2), server_default="en")
    unit_pref: Mapped[str] = mapped_column(String(2), server_default="cm")
    token_version: Mapped[int] = mapped_column(Integer, server_default="0")
    failed_logins: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    locked_until: Mapped[datetime | None] = stamp()
    created_at: Mapped[datetime] = now()
    last_login_at: Mapped[datetime | None] = stamp()


SPECIALTIES = (
    "kitenge",
    "suits",
    "dresses",
    "modest",
    "uniforms",
    "alterations",
    "traditional",
    "casual",
)
_SPECIALTY_ARRAY = ", ".join(f"'{item}'" for item in SPECIALTIES)


class Tailor(Base):
    __tablename__ = "tailor"
    __table_args__ = (
        CheckConstraint(
            f"directory_specialties <@ ARRAY[{_SPECIALTY_ARRAY}]::varchar[]",
            name="directory_specialties_allowed",
        ),
    )
    tailor_id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_account.user_id"), unique=True
    )
    business_name: Mapped[str] = mapped_column(String(120))
    phone_e164: Mapped[str] = mapped_column(String(16))
    area: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = now()
    # The public directory (D27). listing_id is the only identifier a listing shows.
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), unique=True, server_default=func.gen_random_uuid()
    )
    directory_listed: Mapped[bool] = mapped_column(Boolean, server_default="false")
    directory_show_phone: Mapped[bool] = mapped_column(Boolean, server_default="false")
    directory_specialties: Mapped[list[str]] = mapped_column(ARRAY(String(20)), server_default="{}")
    directory_description: Mapped[str | None] = mapped_column(String(240))


class Measurer(Base):
    __tablename__ = "measurer"
    measurer_id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_account.user_id"), unique=True
    )
    measurer_code: Mapped[str] = mapped_column(String(4), unique=True)
    trained_on: Mapped[date] = mapped_column(Date)


class Client(Base):
    __tablename__ = "client"
    __table_args__ = (
        CheckConstraint("client_code ~ '^[A-Z]{2}[0-9]{4}$'", name="client_code_format"),
        CheckConstraint("height_mm BETWEEN 1200 AND 2200", name="height_range"),
        one_of("source", "tailor", "directory"),
        Index("ix_client_tailor_deleted", "tailor_id", "deleted_at"),
        Index(
            "ix_client_display_name_trgm",
            "display_name",
            postgresql_using="gin",
            postgresql_ops={"display_name": "gin_trgm_ops"},
        ),
    )
    client_id: Mapped[uuid.UUID] = pk()
    client_code: Mapped[str] = mapped_column(String(6), unique=True)
    tailor_id: Mapped[uuid.UUID] = fk("tailor.tailor_id")
    display_name: Mapped[str | None] = mapped_column(String(60))
    height_mm: Mapped[int | None] = mapped_column(SmallInteger)
    sex: Mapped[str | None] = mapped_column(String(12))
    clothing_fit: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = now()
    # The hash of the phone's secret, set by the first accepted upload (D45).
    secret_hash: Mapped[str | None] = mapped_column(String(64))
    # Goes up each time a tailor frees the code. A phone reaches only its own round (D45).
    claim_round: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    deleted_at: Mapped[datetime | None] = stamp()
    previous_code: Mapped[str | None] = mapped_column(String(6))
    source: Mapped[str] = mapped_column(String(10), server_default="tailor")


class Consent(Base):
    __tablename__ = "consent"
    __table_args__ = (one_of("source", "app", "study_paper"),)
    consent_id: Mapped[uuid.UUID] = pk()
    client_id: Mapped[uuid.UUID] = fk("client.client_id", ondelete="CASCADE")
    consent_version: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(2))
    scope: Mapped[list[str]] = mapped_column(ARRAY(Text))
    source: Mapped[str] = mapped_column(String(12), server_default="app")
    given_at: Mapped[datetime] = stamp(nullable=False)
    withdrawn_at: Mapped[datetime | None] = stamp()
    claim_round: Mapped[int] = mapped_column(Integer, server_default="0", default=0)


class Participant(Base):
    __tablename__ = "participant"
    __table_args__ = (
        CheckConstraint("participant_code ~ '^P[0-9]{3}$'", name="participant_code_format"),
        one_of("cohort", "pilot", "calibration", "test"),
    )
    participant_id: Mapped[uuid.UUID] = pk()
    participant_code: Mapped[str] = mapped_column(String(4), unique=True)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("client.client_id"), unique=True
    )
    sex: Mapped[str] = mapped_column(String(12))
    age_band: Mapped[str] = mapped_column(String(10))
    venue: Mapped[str] = mapped_column(String(120))
    cohort: Mapped[str] = mapped_column(String(12))
    cohort_assigned_at: Mapped[datetime] = now()
    enrolled_at: Mapped[datetime] = now()


class CaptureSession(Base):
    __tablename__ = "capture_session"
    __table_args__ = (
        one_of("capture_mode", "self", "assisted"),
        one_of("camera_facing", "environment", "user"),
        one_of("guidance_mode", "voice", "visual"),
        one_of("free_arm", "left", "right"),
        one_of("model_variant", "lite", "full", "heavy"),
        one_of("still_source", "imagecapture", "canvas", "file"),
        CheckConstraint("set_no BETWEEN 1 AND 3", name="set_no_range"),
    )
    session_id: Mapped[uuid.UUID] = pk()
    client_id: Mapped[uuid.UUID] = fk("client.client_id", ondelete="CASCADE")
    started_at: Mapped[datetime] = stamp(nullable=False)
    capture_mode: Mapped[str] = mapped_column(String(10))
    camera_facing: Mapped[str] = mapped_column(String(12))
    guidance_mode: Mapped[str] = mapped_column(String(8))
    free_arm: Mapped[str | None] = mapped_column(String(5))
    device_model: Mapped[str] = mapped_column(String(64))
    os: Mapped[str] = mapped_column(String(64))
    browser: Mapped[str] = mapped_column(String(64))
    memory_gb: Mapped[float | None] = mapped_column(Numeric(4, 1))
    model_variant: Mapped[str] = mapped_column(String(8))
    stream_w: Mapped[int] = mapped_column(Integer)
    stream_h: Mapped[int] = mapped_column(Integer)
    still_source: Mapped[str] = mapped_column(String(14))
    level_unchecked: Mapped[bool] = mapped_column(Boolean)
    capture_fallback: Mapped[bool] = mapped_column(Boolean)
    front_checks: Mapped[dict[str, Any]] = mapped_column(JSONB)
    side_checks: Mapped[dict[str, Any]] = mapped_column(JSONB)
    scale_front_mm_px: Mapped[float | None] = mapped_column(Numeric(8, 5))
    scale_side_mm_px: Mapped[float | None] = mapped_column(Numeric(8, 5))
    scale_stature_mm_px: Mapped[float | None] = mapped_column(Numeric(8, 5))
    scale_disagreement_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))
    processing_ms: Mapped[int] = mapped_column(Integer)
    retake_count: Mapped[int] = mapped_column(SmallInteger)
    config_hash: Mapped[str] = mapped_column(String(80))
    app_version: Mapped[str] = mapped_column(String(20))
    participant_id: Mapped[uuid.UUID | None] = fk("participant.participant_id", nullable=True)
    set_no: Mapped[int | None] = mapped_column(SmallInteger)
    lighting: Mapped[str | None] = mapped_column(String(20))
    distance_m: Mapped[float | None] = mapped_column(Numeric(3, 1))
    clothing_fit_observed: Mapped[str | None] = mapped_column(String(10))
    lux: Mapped[int | None] = mapped_column(Integer)


class MeasurementProfile(Base):
    __tablename__ = "measurement_profile"
    __table_args__ = (
        CheckConstraint("version > 0", name="version_positive"),
        one_of("status", "final", "conflict", "superseded", "deleted"),
        Index(
            "uq_profile_final_version",
            "client_id",
            "version",
            unique=True,
            postgresql_where=text("status = 'final'"),
        ),
        Index("ix_profile_client_captured", "client_id", text("captured_at DESC")),
    )
    profile_id: Mapped[uuid.UUID] = pk()
    client_id: Mapped[uuid.UUID] = fk("client.client_id", ondelete="CASCADE")
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("capture_session.session_id"), unique=True
    )
    version: Mapped[int] = mapped_column(Integer)
    captured_at: Mapped[datetime] = stamp(nullable=False)
    status: Mapped[str] = mapped_column(String(10))
    landmarks_front: Mapped[Any] = mapped_column(JSONB)
    landmarks_side: Mapped[Any] = mapped_column(JSONB)
    marker_front: Mapped[Any] = mapped_column(JSONB)
    marker_side: Mapped[Any] = mapped_column(JSONB)
    silhouette_front: Mapped[Any | None] = mapped_column(JSONB)
    silhouette_side: Mapped[Any | None] = mapped_column(JSONB)
    rules_version: Mapped[str] = mapped_column(String(40))
    covariates: Mapped[dict[str, Any]] = mapped_column(JSONB)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    received_at: Mapped[datetime] = now()
    claim_round: Mapped[int] = mapped_column(Integer, server_default="0", default=0)


class Measurement(Base):
    __tablename__ = "measurement"
    __table_args__ = (
        UniqueConstraint("profile_id", "site_code"),
        one_of("site_code", *SITES),
        one_of("method", "auto", "override"),
        one_of("confidence_flag", "pass", "check", "fail"),
        CheckConstraint("value_mm IS NOT NULL OR confidence_flag = 'fail'", name="value_or_fail"),
    )
    measurement_id: Mapped[uuid.UUID] = pk()
    profile_id: Mapped[uuid.UUID] = fk("measurement_profile.profile_id", ondelete="CASCADE")
    site_code: Mapped[str] = mapped_column(String(10))
    value_mm: Mapped[int | None] = mapped_column(SmallInteger)
    method: Mapped[str] = mapped_column(String(10))
    confidence_flag: Mapped[str] = mapped_column(String(5))
    flag_reasons: Mapped[list[str]] = mapped_column(ARRAY(Text))
    correction_factor: Mapped[float | None] = mapped_column(Numeric(5, 4))
    level_fraction: Mapped[float | None] = mapped_column(Numeric(4, 3))
    half_width_mm: Mapped[float | None] = mapped_column(Numeric(6, 1))
    half_depth_mm: Mapped[float | None] = mapped_column(Numeric(6, 1))


class ServerCheck(Base):
    __tablename__ = "server_check"
    __table_args__ = (
        one_of(
            "kind",
            "unusual_proportion",
            "outlier_profile",
            "change_since_last",
            "client_server_mismatch",
            "rules_version_unknown",
            "stale_rules",
            "height_mismatch",
            "rederive_failed",
        ),
        one_of("severity", "info", "check"),
    )
    check_id: Mapped[uuid.UUID] = pk()
    profile_id: Mapped[uuid.UUID] = fk("measurement_profile.profile_id", ondelete="CASCADE")
    site_code: Mapped[str | None] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(24))
    severity: Mapped[str] = mapped_column(String(5))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = now()


class MeasurementDerivation(Base):
    __tablename__ = "measurement_derivation"
    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("measurement_profile.profile_id", ondelete="CASCADE"),
        primary_key=True,
    )
    rules_version: Mapped[str] = mapped_column(String(40), primary_key=True)
    site_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    value_mm: Mapped[int | None] = mapped_column(SmallInteger)
    confidence_flag: Mapped[str] = mapped_column(String(5))
    derived_at: Mapped[datetime] = now()


class RulesVersion(Base):
    __tablename__ = "rules_version"
    __table_args__ = (one_of("status", "draft", "frozen", "retired"),)
    rules_version: Mapped[str] = mapped_column(String(40), primary_key=True)
    status: Mapped[str] = mapped_column(String(8))
    artifact: Mapped[dict[str, Any]] = mapped_column(JSONB)
    checksum: Mapped[str] = mapped_column(String(80))
    parent: Mapped[str | None] = mapped_column(String(40))
    fitted_cohort_hash: Mapped[str | None] = mapped_column(String(80))
    frozen_at: Mapped[datetime | None] = stamp()
    created_by: Mapped[uuid.UUID | None] = fk("user_account.user_id", nullable=True)
    created_at: Mapped[datetime] = now()


class Order(Base):
    __tablename__ = "order"
    __table_args__ = (
        UniqueConstraint("tailor_id", "order_no"),
        one_of("garment_type", *GARMENTS),
        one_of("status", *ORDER_STATUSES),
        CheckConstraint("char_length(notes) <= 1000", name="notes_length"),
        Index("ix_order_tailor_status_due", "tailor_id", "status", "due_date"),
    )
    order_id: Mapped[uuid.UUID] = pk()
    order_no: Mapped[str] = mapped_column(String(16))
    tailor_id: Mapped[uuid.UUID] = fk("tailor.tailor_id")
    client_id: Mapped[uuid.UUID] = fk("client.client_id")
    profile_id: Mapped[uuid.UUID] = fk("measurement_profile.profile_id", ondelete="RESTRICT")
    garment_type: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(10))
    due_date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, server_default="")
    created_at: Mapped[datetime] = now()
    updated_at: Mapped[datetime] = now()


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"
    __table_args__ = (one_of("status", *ORDER_STATUSES),)
    history_id: Mapped[uuid.UUID] = pk()
    order_id: Mapped[uuid.UUID] = fk("order.order_id", ondelete="CASCADE")
    status: Mapped[str] = mapped_column(String(10))
    changed_at: Mapped[datetime] = now()
    user_id: Mapped[uuid.UUID | None] = fk("user_account.user_id", nullable=True)


class OrderItem(Base):
    __tablename__ = "order_item"
    __table_args__ = (
        UniqueConstraint("order_id", "site_code"),
        one_of("site_code", *SITES),
        one_of("confidence_flag", "pass", "check", "fail"),
        CheckConstraint("ease_mm BETWEEN 0 AND 300", name="ease_range"),
    )
    item_id: Mapped[uuid.UUID] = pk()
    order_id: Mapped[uuid.UUID] = fk("order.order_id", ondelete="CASCADE")
    site_code: Mapped[str] = mapped_column(String(10))
    body_mm: Mapped[int | None] = mapped_column(SmallInteger)
    ease_mm: Mapped[int] = mapped_column(SmallInteger)
    finished_mm: Mapped[int | None] = mapped_column(SmallInteger)
    overridden: Mapped[bool] = mapped_column(Boolean, server_default="false")
    override_reason: Mapped[str | None] = mapped_column(String(256))
    flag_confirmed: Mapped[bool] = mapped_column(Boolean, server_default="false")
    pending_fitting: Mapped[bool] = mapped_column(Boolean, server_default="false")
    confidence_flag: Mapped[str] = mapped_column(String(5))


class EasePreset(Base):
    __tablename__ = "ease_preset"
    __table_args__ = (one_of("garment_type", *GARMENTS), one_of("site_code", *SITES))
    tailor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tailor.tailor_id"), primary_key=True
    )
    garment_type: Mapped[str] = mapped_column(String(12), primary_key=True)
    site_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    ease_mm: Mapped[int] = mapped_column(SmallInteger)


class SpecSheet(Base):
    __tablename__ = "spec_sheet"
    sheet_id: Mapped[uuid.UUID] = pk()
    order_id: Mapped[uuid.UUID] = fk("order.order_id", ondelete="CASCADE")
    generated_at: Mapped[datetime] = now()
    include_name: Mapped[bool] = mapped_column(Boolean)
    locale: Mapped[str] = mapped_column(String(2))
    unit: Mapped[str] = mapped_column(String(2))
    png_sha256: Mapped[str] = mapped_column(String(64))
    pdf_sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime] = stamp(nullable=False)


class SheetShare(Base):
    __tablename__ = "sheet_share"
    __table_args__ = (one_of("via", "whatsapp_share", "wa_link", "download", "print"),)
    share_id: Mapped[uuid.UUID] = pk()
    sheet_id: Mapped[uuid.UUID] = fk("spec_sheet.sheet_id", ondelete="CASCADE")
    via: Mapped[str] = mapped_column(String(16))
    shared_at: Mapped[datetime] = now()
    user_id: Mapped[uuid.UUID | None] = fk("user_account.user_id", nullable=True)


class DeletedProfile(Base):
    """Identifiers only, so a phone's replay cannot bring back what a client deleted (D45)."""

    __tablename__ = "deleted_profile"
    profile_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    deleted_at: Mapped[datetime] = now()
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("client.client_id", ondelete="CASCADE")
    )


class Conflict(Base):
    __tablename__ = "conflict"
    __table_args__ = (
        CheckConstraint("resolution IN ('newer', 'server')", name="resolution_allowed"),
    )
    conflict_id: Mapped[uuid.UUID] = pk()
    client_id: Mapped[uuid.UUID] = fk("client.client_id", ondelete="CASCADE")
    server_profile_id: Mapped[uuid.UUID] = fk("measurement_profile.profile_id", ondelete="CASCADE")
    incoming_profile_id: Mapped[uuid.UUID] = fk(
        "measurement_profile.profile_id", ondelete="CASCADE"
    )
    created_at: Mapped[datetime] = now()
    resolved_at: Mapped[datetime | None] = stamp()
    resolution: Mapped[str | None] = mapped_column(String(6))
    resolved_by: Mapped[uuid.UUID | None] = fk("user_account.user_id", nullable=True)


class DeletionRequest(Base):
    __tablename__ = "deletion_request"
    __table_args__ = (
        one_of("reason", "delete", "withdraw_consent"),
        one_of("status", "received", "partially_done", "done", "rejected"),
    )
    request_id: Mapped[uuid.UUID] = pk()
    client_id: Mapped[uuid.UUID | None] = fk("client.client_id", nullable=True, ondelete="SET NULL")
    client_code_hash: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(String(16))
    received_at: Mapped[datetime] = now()
    status: Mapped[str] = mapped_column(String(14))
    completed_at: Mapped[datetime | None] = stamp()
    note: Mapped[str | None] = mapped_column(String(256))


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        one_of("actor_type", "user", "client", "system"),
        CheckConstraint("pg_column_size(detail) <= 1024", name="detail_size"),
        Index("ix_audit_entity", "entity_type", "entity_id", "occurred_at"),
        Index("ix_audit_user", "user_id", "occurred_at"),
    )
    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = now()
    actor_type: Mapped[str] = mapped_column(String(6))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(24))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(64))
    ip_hash: Mapped[str | None] = mapped_column(String(16))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")


class ReferenceMeasurement(Base):
    __tablename__ = "reference_measurement"
    __table_args__ = (
        UniqueConstraint("participant_id", "measurer_id", "site_code", "reading_no"),
        one_of("site_code", *SITES),
        CheckConstraint("reading_no IN (1, 2)", name="reading_no_allowed"),
        Index("ix_reference_participant_site", "participant_id", "site_code"),
    )
    ref_id: Mapped[uuid.UUID] = pk()
    participant_id: Mapped[uuid.UUID] = fk("participant.participant_id")
    measurer_id: Mapped[uuid.UUID] = fk("measurer.measurer_id")
    site_code: Mapped[str] = mapped_column(String(10))
    reading_no: Mapped[int] = mapped_column(SmallInteger)
    value_mm: Mapped[int] = mapped_column(SmallInteger)
    taken_at: Mapped[datetime] = stamp(nullable=False)
    out_of_order: Mapped[bool] = mapped_column(Boolean, server_default="false")


class ReferenceCorrection(Base):
    """Readings never change, so a correction is a new row beside the original."""

    __tablename__ = "reference_correction"
    correction_id: Mapped[uuid.UUID] = pk()
    ref_id: Mapped[uuid.UUID] = fk("reference_measurement.ref_id")
    value_mm: Mapped[int] = mapped_column(SmallInteger)
    reason: Mapped[str] = mapped_column(String(256))
    corrected_by: Mapped[uuid.UUID] = fk("user_account.user_id")
    corrected_at: Mapped[datetime] = now()


class AppSetting(Base):
    __tablename__ = "app_setting"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = now()
    updated_by: Mapped[uuid.UUID | None] = fk("user_account.user_id", nullable=True)


class RevokedToken(Base):
    __tablename__ = "revoked_token"
    jti: Mapped[str] = mapped_column(String(36), primary_key=True)
    expires_at: Mapped[datetime] = stamp(nullable=False)
