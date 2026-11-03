"""The administrator: accounts, settings, the audit export and held deletions (backend-spec 8)."""

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.errors import ApiError
from app.models import (
    AuditLog,
    CaptureSession,
    Client,
    Consent,
    DeletionRequest,
    Measurer,
    RulesVersion,
    Tailor,
    UserAccount,
)
from app.schemas import (
    Account,
    AccountPage,
    AccountStatus,
    AdminSettings,
    AdminSettingsInput,
    Approvals,
    CaptureModeStats,
    CaptureStats,
    MeasurerInput,
    RederiveResult,
    RejectInput,
    RulesArtifact,
    RulesSummary,
)
from app.schemas import DeletionRequest as DeletionRequestView
from app.security.deps import CurrentPrincipal, Session, require_role
from app.security.ip_hash import ip_hash
from app.security.passwords import hash_password
from app.services import audit
from app.services.approvals import earliest_collection, missing, problems
from app.services.csvout import csv_response, to_csv
from app.services.data_requests import STUDY_KEPT, withdraw_participant
from app.services.derivation import rederive
from app.services.erasure import erase_profiles
from app.services.ingest import invalid
from app.services.rules import (
    all_rules,
    freeze_row,
    known_versions,
    lookup_rules,
    registration_problems,
    row_intact,
    rules_status,
    summary,
)
from app.services.settings import read_settings, write_setting

from .directory import Page, PageSize
from .orders import summary_of

router = APIRouter(prefix="/admin", tags=["admin"])
ADMIN = Depends(require_role("admin"))
HELD = ("received", "partially_done")


async def _account(session: AsyncSession, user: UserAccount) -> Account:
    tailor = await session.scalar(select(Tailor).where(Tailor.user_id == user.user_id))
    measurer = await session.scalar(select(Measurer).where(Measurer.user_id == user.user_id))
    return Account(
        user_id=str(user.user_id),
        email=user.email,
        role=user.role,  # type: ignore[arg-type]
        status=user.status,  # type: ignore[arg-type]
        created_at=user.created_at,
        business_name=tailor.business_name if tailor else None,
        phone=tailor.phone_e164 if tailor else None,
        area=tailor.area if tailor else None,
        measurer_code=measurer.measurer_code if measurer else None,
        trained_on=measurer.trained_on if measurer else None,
    )


@router.get("/accounts", operation_id="listAccounts", response_model=AccountPage,
            response_model_exclude_none=True, dependencies=[ADMIN])  # fmt: skip
async def list_accounts(
    session: Session,
    status: AccountStatus | None = None,
    page: Page = 1,
    page_size: PageSize = 25,
) -> AccountPage:
    conditions = [UserAccount.status == status] if status else []
    total = await session.scalar(select(func.count()).select_from(UserAccount).where(*conditions))
    users = await session.scalars(
        select(UserAccount)
        .where(*conditions)
        .order_by(UserAccount.created_at.desc(), UserAccount.user_id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [await _account(session, user) for user in users]
    return AccountPage(items=items, page=page, page_size=page_size, total=total or 0)


async def _change_status(
    request: Request,
    session: AsyncSession,
    principal: CurrentPrincipal,
    user_id: uuid.UUID,
    *,
    allowed_from: tuple[str, ...],
    to: str,
    action: str,
    detail: dict[str, Any] | None = None,
) -> Account:
    user = await session.get(UserAccount, user_id, with_for_update=True)
    if user is None:
        raise ApiError("not_found")
    if user.user_id == principal.user.user_id:
        # An admin cannot lock themself out or approve themself.
        raise ApiError("forbidden")
    if user.status != to:
        if user.status not in allowed_from:
            raise ApiError("forbidden")
        user.status = to
        if to != "active":
            # Every token this account holds stops working at once.
            user.token_version += 1
        audit.record(
            session,
            actor_type="user",
            action=action,
            entity_type="user_account",
            entity_id=user.user_id,
            user_id=principal.user.user_id,
            ip_hash=ip_hash(request),
            detail={"role": user.role, **(detail or {})},
        )
    await session.commit()
    return await _account(session, user)


@router.post("/accounts/{user_id}/approve", operation_id="approveAccount",
             response_model=Account, response_model_exclude_none=True,
             dependencies=[ADMIN])  # fmt: skip
async def approve(
    user_id: uuid.UUID, request: Request, session: Session, principal: CurrentPrincipal
) -> Account:
    return await _change_status(
        request, session, principal, user_id,
        allowed_from=("pending", "rejected"), to="active", action="approve",
    )  # fmt: skip


@router.post("/accounts/{user_id}/reject", operation_id="rejectAccount",
             response_model=Account, response_model_exclude_none=True,
             dependencies=[ADMIN])  # fmt: skip
async def reject(
    user_id: uuid.UUID,
    body: RejectInput,
    request: Request,
    session: Session,
    principal: CurrentPrincipal,
) -> Account:
    # The reason is free text and may name someone, so only its presence is recorded.
    return await _change_status(
        request, session, principal, user_id,
        allowed_from=("pending",), to="rejected", action="account_reject",
        detail={"reason_given": bool(body.reason.strip())},
    )  # fmt: skip


@router.post("/accounts/{user_id}/disable", operation_id="disableAccount",
             response_model=Account, response_model_exclude_none=True,
             dependencies=[ADMIN])  # fmt: skip
async def disable(
    user_id: uuid.UUID, request: Request, session: Session, principal: CurrentPrincipal
) -> Account:
    return await _change_status(
        request, session, principal, user_id,
        allowed_from=("active",), to="disabled", action="account_disable",
    )  # fmt: skip


@router.post("/accounts/{user_id}/enable", operation_id="enableAccount",
             response_model=Account, response_model_exclude_none=True,
             dependencies=[ADMIN])  # fmt: skip
async def enable(
    user_id: uuid.UUID, request: Request, session: Session, principal: CurrentPrincipal
) -> Account:
    return await _change_status(
        request, session, principal, user_id,
        allowed_from=("disabled",), to="active", action="account_enable",
    )  # fmt: skip


@router.post("/measurers", operation_id="createMeasurer", status_code=201,
             response_model=Account, response_model_exclude_none=True,
             dependencies=[ADMIN])  # fmt: skip
async def create_measurer(
    body: MeasurerInput, request: Request, session: Session, principal: CurrentPrincipal
) -> Account:
    if await session.scalar(select(UserAccount).where(UserAccount.email == body.email)):
        raise invalid("email", "taken")
    if await session.scalar(select(Measurer).where(Measurer.measurer_code == body.measurer_code)):
        raise invalid("measurer_code", "taken")
    password_hash = await run_in_threadpool(hash_password, body.password)
    user = UserAccount(
        email=body.email, password_hash=password_hash, role="measurer", status="active"
    )
    session.add(user)
    await session.flush()
    session.add(
        Measurer(user_id=user.user_id, measurer_code=body.measurer_code, trained_on=body.trained_on)
    )
    audit.record(
        session,
        actor_type="user",
        action="account_create",
        entity_type="user_account",
        entity_id=user.user_id,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={"role": "measurer", "measurer_code": body.measurer_code},
    )
    await session.commit()
    await session.refresh(user)
    return await _account(session, user)


def _settings_view(values: dict[str, Any]) -> AdminSettings:
    approvals = values["approvals"] or {}
    return AdminSettings(
        retention_months=values["retention_months"],
        audit_retention_months=values["audit_retention_months"],
        study_mode=values["study_mode"],
        study_collection_end=values["study_collection_end"],
        current_rules_version=values["current_rules_version"],
        min_app_version=values["min_app_version"],
        consent_version=values["consent_version"],
        approvals=Approvals(**approvals),
        approvals_missing=missing(approvals),
        earliest_collection_date=earliest_collection(approvals),
    )


@router.get("/settings", operation_id="getAdminSettings", response_model=AdminSettings,
            dependencies=[ADMIN])  # fmt: skip
async def get_settings(session: Session) -> AdminSettings:
    return _settings_view(await read_settings(session))


SUBSTANCE = ("ierc_ref", "nacosti_licence_no", "dpia_submitted_on", "odpc_response_on",
             "odpc_response_ref")  # fmt: skip


def _approvals(
    new: dict[str, Any], old: dict[str, Any], email: str, moment: datetime
) -> dict[str, Any]:
    """Who confirmed and when are the server's to record, from the signed-in admin (A9)."""
    if all(new.get(k) == old.get(k) for k in SUBSTANCE):
        return {**new, "approvals_confirmed_by": old.get("approvals_confirmed_by"),
                "confirmed_at": old.get("confirmed_at")}  # fmt: skip
    filled = all(new.get(k) for k in ("ierc_ref", "nacosti_licence_no", "dpia_submitted_on"))
    return {
        **new,
        "approvals_confirmed_by": email if filled else None,
        "confirmed_at": moment.isoformat() if filled else None,
    }


@router.put("/settings", operation_id="putAdminSettings", response_model=AdminSettings,
            dependencies=[ADMIN])  # fmt: skip
async def put_settings(
    body: AdminSettingsInput, request: Request, session: Session, principal: CurrentPrincipal
) -> AdminSettings:
    changes = body.model_dump(mode="json", exclude_unset=True)
    confirmed = bool(changes.pop("confirm_study_deletion", False))
    current = await read_settings(session)
    moment = datetime.now(UTC)
    today = moment.date()
    version = changes.get("current_rules_version")
    if version:
        status = await rules_status(request.app.state.rules, session, version)
        if status is None:
            raise invalid("current_rules_version", "unknown")
        # A registered version becomes current only once frozen (11.3.7). The files in
        # packages/rules stay usable as drafts until the owner freezes one (D31).
        if version not in request.app.state.rules and status != "frozen":
            raise invalid("current_rules_version", "not_frozen")
    detail: dict[str, Any] = {}
    if "study_collection_end" in changes:
        end = changes["study_collection_end"]
        if end != current.get("study_collection_end") and end is not None:
            # A past end while the study runs would delete its records at the next run.
            if changes.get("study_mode", current["study_mode"]) and date.fromisoformat(end) < today:
                raise invalid("study_collection_end", "in_past")
            if not confirmed:
                raise invalid("confirm_study_deletion", "required")
        detail["study_collection_end"] = {"old": current.get("study_collection_end"), "new": end}
    if "approvals" in changes:
        approvals = _approvals(
            changes["approvals"], current.get("approvals") or {}, principal.user.email, moment
        )
        found = problems(approvals, today)
        if found:
            raise ApiError("validation_failed", errors=[{"field": f, "code": c} for f, c in found])
        changes["approvals"] = approvals
        # The approval references are the evidence the A9 guard rests on, so the row keeps them.
        detail["approvals"] = approvals
    for key, value in changes.items():
        await write_setting(session, key, value, principal.user.user_id)
    if changes:
        audit.record(
            session,
            actor_type="user",
            action="settings_change",
            entity_type="app_setting",
            entity_id="admin",
            user_id=principal.user.user_id,
            ip_hash=ip_hash(request),
            detail={"changed": sorted(changes), **detail},
        )
    await session.commit()
    return _settings_view(await read_settings(session))


# ---- the rules registry (backend-spec 10.6, 11.7; M13) ----

RULES_PATTERN = r"^[0-9]+\.[0-9]+-[a-z0-9-]+$"
RulesName = Annotated[str, Path(pattern=RULES_PATTERN, max_length=40)]


@router.get("/capture-stats", operation_id="getCaptureStats", response_model=CaptureStats,
            dependencies=[ADMIN])  # fmt: skip
async def capture_stats(session: Session) -> CaptureStats:
    """Completion per mode for NFR-07 (M15): sessions are stored only once a profile was saved,
    so "within three attempts" is a saved profile after at most two retakes. Counts only."""
    within = func.sum(case((CaptureSession.retake_count <= 2, 1), else_=0))
    unchecked = func.sum(case((CaptureSession.level_unchecked.is_(True), 1), else_=0))
    fallback = func.sum(case((CaptureSession.capture_fallback.is_(True), 1), else_=0))
    rows = (
        await session.execute(
            select(
                CaptureSession.capture_mode,
                CaptureSession.camera_facing,
                CaptureSession.guidance_mode,
                func.count().label("sessions"),
                within.label("within"),
                func.avg(CaptureSession.retake_count).label("mean_retakes"),
                unchecked.label("unchecked"),
                fallback.label("fallback"),
            )
            .group_by(
                CaptureSession.capture_mode,
                CaptureSession.camera_facing,
                CaptureSession.guidance_mode,
            )
            .order_by(
                CaptureSession.capture_mode,
                CaptureSession.camera_facing,
                CaptureSession.guidance_mode,
            )
        )
    ).all()
    modes = [
        CaptureModeStats(
            capture_mode=row.capture_mode,
            camera_facing=row.camera_facing,
            guidance_mode=row.guidance_mode,
            sessions=row.sessions,
            within_three_attempts=int(row.within),
            within_three_attempts_pct=round(100 * int(row.within) / row.sessions, 1),
            mean_retake_count=round(float(row.mean_retakes), 2),
            level_unchecked=int(row.unchecked),
            capture_fallback=int(row.fallback),
        )
        for row in rows
    ]
    return CaptureStats(sessions=sum(m.sessions for m in modes), modes=modes)


@router.get("/rules", operation_id="listRules", response_model=list[RulesSummary],
            dependencies=[ADMIN])  # fmt: skip
async def list_rules(request: Request, session: Session) -> list[dict[str, Any]]:
    current = (await read_settings(session))["current_rules_version"]
    return await all_rules(request.app.state.rules, session, current)


@router.post("/rules", operation_id="registerRules", status_code=201, response_model=RulesSummary,
             dependencies=[ADMIN])  # fmt: skip
async def register_rules(
    body: RulesArtifact, request: Request, session: Session, principal: CurrentPrincipal
) -> dict[str, Any]:
    """Registers a draft. Freezing is a separate, deliberate step that only the owner takes."""
    artifact = body.model_dump(mode="json")
    problems = registration_problems(
        artifact, await known_versions(request.app.state.rules, session)
    )
    if problems:
        raise ApiError("validation_failed", errors=problems)
    fit = artifact.get("fit") or {}
    row = RulesVersion(
        rules_version=artifact["rules_version"],
        status="draft",
        artifact=artifact,
        checksum=artifact["checksum"],
        parent=artifact.get("parent"),
        fitted_cohort_hash=fit.get("cohort_hash"),
        created_by=principal.user.user_id,
    )
    session.add(row)
    await session.flush()
    audit.record(
        session,
        actor_type="user",
        action="rules_register",
        entity_type="rules_version",
        entity_id=row.rules_version,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={
            "checksum": row.checksum,
            "parent": row.parent,
            "n_participants": fit.get("n_participants"),
        },  # fmt: skip
    )
    await session.commit()
    current = (await read_settings(session))["current_rules_version"]
    return summary(row.rules_version, row.status, row.checksum, row.parent, row.frozen_at,
                   row.created_at, current)  # fmt: skip


@router.post("/rules/{version}/freeze", operation_id="freezeRules", response_model=RulesSummary,
             dependencies=[ADMIN])  # fmt: skip
async def freeze_rules(
    version: RulesName, request: Request, session: Session, principal: CurrentPrincipal
) -> dict[str, Any]:
    """One way. A version shipped as a file is entered in the registry as it is frozen."""
    row = await session.get(RulesVersion, version)
    if row is None:
        artifact = await lookup_rules(request.app.state.rules, session, version)
        if artifact is None:
            raise ApiError("rules_version_unknown")
        row = RulesVersion(
            rules_version=version,
            status="draft",
            artifact=artifact,
            checksum=artifact["checksum"],
            parent=artifact.get("parent"),
            fitted_cohort_hash=(artifact.get("fit") or {}).get("cohort_hash"),
            created_by=principal.user.user_id,
        )
        session.add(row)
        await session.flush()
    if row.status == "draft":
        # Never freeze a record the server would then refuse everywhere.
        if not row_intact(row):
            raise ApiError("rules_version_unknown")
        freeze_row(row, datetime.now(UTC))
        audit.record(
            session,
            actor_type="user",
            action="rules_freeze",
            entity_type="rules_version",
            entity_id=version,
            user_id=principal.user.user_id,
            ip_hash=ip_hash(request),
            detail={"checksum": row.checksum},
        )
        await session.commit()
    current = (await read_settings(session))["current_rules_version"]
    return summary(row.rules_version, row.status, row.checksum, row.parent, row.frozen_at,
                   row.created_at, current)  # fmt: skip


@router.post("/rederive", operation_id="rederive", response_model=RederiveResult,
             dependencies=[ADMIN])  # fmt: skip
async def rederive_cohort(
    request: Request,
    session: Session,
    principal: CurrentPrincipal,
    rules_version: Annotated[str, Query(pattern=RULES_PATTERN, max_length=40)],
    cohort: Annotated[Literal["pilot", "calibration", "test"], Query()],
) -> dict[str, Any]:
    """Recomputes a cohort under a frozen version into measurement_derivation (2.3.3)."""
    artifact = await lookup_rules(request.app.state.rules, session, rules_version)
    if artifact is None:
        raise ApiError("rules_version_unknown")
    if artifact["status"] != "frozen":
        raise ApiError("rules_not_frozen")
    processed = await rederive(session, artifact, cohort)
    audit.record(
        session,
        actor_type="user",
        action="rederive",
        entity_type="rules_version",
        entity_id=rules_version,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={"cohort": cohort, "profiles_processed": processed},
    )
    await session.commit()
    return {"rules_version": rules_version, "cohort": cohort, "profiles_processed": processed}


async def _request_view(session: AsyncSession, row: DeletionRequest) -> DeletionRequestView:
    code = None
    if row.client_id:
        client = await session.get(Client, row.client_id)
        code = client.client_code if client else None
    return DeletionRequestView(
        request_id=row.request_id,
        reason=row.reason,  # type: ignore[arg-type]
        received_at=row.received_at,
        status=row.status,  # type: ignore[arg-type]
        completed_at=row.completed_at,
        client_code=code,
        # Left unset when empty: the contract allows no null note, and completed_at stays as null.
        **({"note": row.note} if row.note else {}),
    )


@router.get("/deletion-requests", operation_id="listDeletionRequests",
            response_model=list[DeletionRequestView], response_model_exclude_unset=True,
            dependencies=[ADMIN])  # fmt: skip
async def list_deletion_requests(session: Session) -> list[DeletionRequestView]:
    rows = await session.scalars(
        select(DeletionRequest).order_by(DeletionRequest.received_at.desc()).limit(500)
    )
    return [await _request_view(session, row) for row in rows]


@router.post("/deletion-requests/{request_id}/honour", operation_id="honourDeletionRequest",
             response_model=DeletionRequestView, response_model_exclude_unset=True,
             dependencies=[ADMIN])  # fmt: skip
async def honour_deletion_request(
    request_id: uuid.UUID, request: Request, session: Session, principal: CurrentPrincipal
) -> DeletionRequestView:
    row = await session.get(DeletionRequest, request_id, with_for_update=True)
    if row is None:
        raise ApiError("not_found")
    if row.status not in HELD or row.client_id is None:
        raise ApiError("forbidden")
    client = await session.get(Client, row.client_id, with_for_update=True)
    if client is None:
        raise ApiError("not_found")
    moment = datetime.now(UTC)
    participant = await withdraw_participant(session, client.client_id, moment)
    if row.reason == "withdraw_consent":
        await session.execute(
            update(Consent)
            .where(Consent.client_id == client.client_id, Consent.withdrawn_at.is_(None))
            .values(withdrawn_at=moment)
        )
    # The admin has checked the request, so it covers every claim round of the code (D45).
    # Study sets stay, unused (D44 default), so they never hold a request open.
    erased = await erase_profiles(session, client.client_id, None)
    details_cleared = client.display_name is not None or client.height_mm is not None
    client.display_name = None
    client.height_mm = None
    row.all_rounds = True
    if participant:
        row.note = ((row.note or "") + STUDY_KEPT)[:256]
    row.status = "partially_done" if erased.retained else "done"
    row.completed_at = None if erased.retained else moment
    audit.record(
        session,
        actor_type="user",
        action="deletion",
        entity_type="deletion_request",
        entity_id=row.request_id,
        user_id=principal.user.user_id,
        client_id=client.client_id,
        ip_hash=ip_hash(request),
        detail={
            "status": row.status,
            "deleted": erased.deleted,
            "retained": erased.retained,
            "details_cleared": details_cleared,
            "all_rounds": True,
            "study_kept": erased.study_kept,
            "participant_withdrawn": participant,
        },
    )
    await session.commit()
    return await _request_view(session, row)


AUDIT_COLUMNS = (
    "log_id", "occurred_at", "actor_type", "user_email", "role",
    "action", "entity_type", "entity_id", "summary",
)  # fmt: skip
MAX_AUDIT_ROWS = 50_000


@router.get("/audit.csv", operation_id="exportAudit", dependencies=[ADMIN],
            responses={200: {"content": {"text/csv": {}}}})  # fmt: skip
async def export_audit(
    request: Request,
    session: Session,
    principal: CurrentPrincipal,
    user: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=24)] = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
) -> Response:
    conditions: list[Any] = []
    if user:
        conditions.append(AuditLog.user_id == user)
    if action:
        conditions.append(AuditLog.action == action)
    if from_:
        conditions.append(AuditLog.occurred_at >= from_)
    if to:
        conditions.append(AuditLog.occurred_at <= to)
    rows = await session.execute(
        select(AuditLog, UserAccount.email, UserAccount.role)
        .outerjoin(UserAccount, UserAccount.user_id == AuditLog.user_id)
        .where(*conditions)
        .order_by(AuditLog.occurred_at.desc(), AuditLog.log_id.desc())
        .limit(MAX_AUDIT_ROWS)
    )
    body = to_csv(
        AUDIT_COLUMNS,
        (
            (
                row.AuditLog.log_id,
                row.AuditLog.occurred_at.isoformat(),
                row.AuditLog.actor_type,
                row.email,
                row.role,
                row.AuditLog.action,
                row.AuditLog.entity_type,
                row.AuditLog.entity_id,
                summary_of(row.AuditLog),
            )  # fmt: skip
            for row in rows
        ),
    )
    audit.record(
        session,
        actor_type="user",
        action="export",
        entity_type="audit_log",
        entity_id="audit.csv",
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={"file": "audit.csv", "filtered": bool(conditions)},
    )
    await session.commit()
    return csv_response(body, f"audit-{date.today().isoformat()}.csv")
