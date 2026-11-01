"""A tailor's clients, their profiles, conflicts and who holds each code (backend-spec 8, D45)."""

import uuid
from collections import Counter
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, exists, func, select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import (
    CaptureSession,
    Client,
    Conflict,
    Consent,
    DeletionRequest,
    Measurement,
    MeasurementProfile,
    Order,
    ServerCheck,
    UserAccount,
)
from app.schemas import (
    ClaimReviewInput,
    ClientClaim,
    ClientCodeRotated,
    ClientCreated,
    ClientDetail,
    ClientInput,
    ClientPage,
    ClientSummary,
    ConflictResolution,
    FlagCounts,
    ProfileSummary,
)
from app.schemas import (
    Conflict as ConflictView,
)
from app.schemas import (
    MeasurementProfile as ProfileView,
)
from app.security.deps import CurrentPrincipal, Session, owned_client, require_role, tailor_of
from app.security.ip_hash import ip_hash
from app.services import audit
from app.services.claims import apply_review, claim_view, free_claim
from app.services.profiles import measurement_json, profile_json

from .directory import CODE_ATTEMPTS, Page, PageSize, new_code

router = APIRouter()
STAFF = Depends(require_role("tailor", "admin"))
TAILOR = Depends(require_role("tailor"))


async def reach_client(session: AsyncSession, user: UserAccount, client_id: uuid.UUID) -> Client:
    """Admins reach every client. A tailor reaches only their own."""
    if user.role != "admin":
        return await owned_client(session, user, client_id)
    client = await session.get(Client, client_id)
    if not client or client.deleted_at is not None:
        raise ApiError("not_found")
    return client


def _record(
    request: Request,
    session: AsyncSession,
    user: UserAccount,
    action: str,
    client: Client,
    **detail: Any,
) -> None:
    audit.record(
        session,
        actor_type="user",
        user_id=user.user_id,
        action=action,
        entity_type="client",
        entity_id=client.client_id,
        client_id=client.client_id,
        ip_hash=ip_hash(request),
        detail=detail,
    )


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _flag_counts(
    session: AsyncSession, profile_ids: list[uuid.UUID]
) -> dict[uuid.UUID, FlagCounts]:
    counts: dict[uuid.UUID, Counter[str]] = {pid: Counter() for pid in profile_ids}
    if profile_ids:
        rows = await session.execute(
            select(Measurement.profile_id, Measurement.confidence_flag).where(
                Measurement.profile_id.in_(profile_ids)
            )
        )
        for profile_id, flag in rows:
            counts[profile_id][flag] += 1
    return {
        pid: FlagCounts(**{"pass": c["pass"], "check": c["check"], "fail": c["fail"]})
        for pid, c in counts.items()
    }


@router.get(
    "/clients",
    operation_id="listClients",
    response_model=ClientPage,
    tags=["clients"],
    dependencies=[STAFF],
)
async def list_clients(
    principal: CurrentPrincipal,
    session: Session,
    search: Annotated[str | None, Query(max_length=60)] = None,
    sort: Literal["last_capture", "code", "name"] | None = None,
    filter: Literal["has_new", "has_flags", "no_profiles"] | None = None,  # noqa: A002
    page: Page = 1,
    page_size: PageSize = 25,
) -> ClientPage:
    conditions: list[Any] = [Client.deleted_at.is_(None)]
    if principal.user.role != "admin":
        tailor = await tailor_of(session, principal.user)
        conditions.append(Client.tailor_id == tailor.tailor_id)
    if search:
        pattern = _escape(search)
        conditions.append(
            Client.client_code.ilike(f"{pattern}%", escape="\\")
            | Client.display_name.ilike(f"%{pattern}%", escape="\\")
        )
    latest = (
        select(MeasurementProfile.profile_id, MeasurementProfile.captured_at)
        .where(
            MeasurementProfile.client_id == Client.client_id,
            MeasurementProfile.status != "superseded",
        )
        .order_by(
            case((MeasurementProfile.status == "final", 0), else_=1),
            MeasurementProfile.captured_at.desc(),
        )
        .limit(1)
        .lateral("latest")
    )
    flagged = exists().where(
        Measurement.profile_id == latest.c.profile_id,
        Measurement.confidence_flag.in_(("check", "fail")),
    )
    unused = latest.c.profile_id.isnot(None) & ~exists().where(
        Order.profile_id == latest.c.profile_id
    )
    if filter == "has_new":
        conditions.append(unused)
    elif filter == "has_flags":
        conditions.append(flagged)
    elif filter == "no_profiles":
        conditions.append(latest.c.profile_id.is_(None))
    base = select(Client, latest.c.profile_id, latest.c.captured_at).outerjoin(latest, true())
    total = await session.scalar(
        select(func.count()).select_from(base.where(*conditions).subquery())
    )
    order = {
        "code": (Client.client_code,),
        "name": (Client.display_name.asc().nulls_last(), Client.client_code),
    }.get(sort or "", (latest.c.captured_at.desc().nulls_last(), Client.client_code))
    rows = (
        await session.execute(
            base.where(*conditions).order_by(*order).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    ids = [row.Client.client_id for row in rows]
    flags = await _flag_counts(session, [row.profile_id for row in rows if row.profile_id])
    used = set(
        await session.scalars(
            select(Order.profile_id).where(
                Order.profile_id.in_([row.profile_id for row in rows if row.profile_id])
            )
        )
    )
    open_orders = {
        row[0]: row[1]
        for row in await session.execute(
            select(Order.client_id, func.count())
            .where(Order.client_id.in_(ids), Order.status != "collected")
            .group_by(Order.client_id)
        )
    }
    conflicted = set(
        await session.scalars(
            select(Conflict.client_id).where(
                Conflict.client_id.in_(ids), Conflict.resolved_at.is_(None)
            )
        )
    )
    return ClientPage(
        items=[
            ClientSummary(
                client_id=str(row.Client.client_id),
                client_code=row.Client.client_code,
                display_name=row.Client.display_name,
                source=row.Client.source,
                last_capture_at=row.captured_at,
                flag_counts=flags.get(row.profile_id) if row.profile_id else None,
                open_orders=open_orders.get(row.Client.client_id, 0),
                has_new=bool(row.profile_id) and row.profile_id not in used,
                has_conflict=row.Client.client_id in conflicted,
            )
            for row in rows
        ],
        page=page,
        page_size=page_size,
        total=total or 0,
    )


@router.post(
    "/clients",
    operation_id="createClient",
    status_code=201,
    response_model=ClientCreated,
    tags=["clients"],
    dependencies=[TAILOR],
)
async def create_client(
    body: ClientInput, principal: CurrentPrincipal, request: Request, session: Session
) -> ClientCreated:
    tailor = await tailor_of(session, principal.user)
    for _ in range(CODE_ATTEMPTS):
        client = Client(
            client_code=new_code(),
            tailor_id=tailor.tailor_id,
            display_name=body.display_name,
            height_mm=body.height_mm,
        )
        try:
            async with session.begin_nested():
                session.add(client)
                await session.flush()
        except IntegrityError:
            continue
        break
    else:
        raise ApiError("server_error")
    _record(request, session, principal.user, "code_issue", client, source="tailor")
    reply = ClientCreated(
        client_id=str(client.client_id),
        client_code=client.client_code,
        deep_link=f"/start?code={client.client_code}",
    )
    await session.commit()
    return reply


async def _detail(session: AsyncSession, client: Client) -> ClientDetail:
    requested = await session.scalar(
        select(
            exists().where(
                DeletionRequest.client_id == client.client_id, DeletionRequest.status != "rejected"
            )
        )
    )
    return ClientDetail(
        client_id=str(client.client_id),
        client_code=client.client_code,
        tailor_id=str(client.tailor_id),
        display_name=client.display_name,
        height_mm=client.height_mm,
        created_at=client.created_at,
        deletion_requested=bool(requested),
        source=client.source,  # type: ignore[arg-type]
    )


@router.get(
    "/clients/{client_id}",
    operation_id="getClient",
    response_model=ClientDetail,
    tags=["clients"],
    dependencies=[STAFF],
)
async def get_client(
    client_id: uuid.UUID, principal: CurrentPrincipal, session: Session
) -> ClientDetail:
    return await _detail(session, await reach_client(session, principal.user, client_id))


@router.patch(
    "/clients/{client_id}",
    operation_id="updateClient",
    response_model=ClientDetail,
    tags=["clients"],
    dependencies=[STAFF],
)
async def update_client(
    client_id: uuid.UUID,
    body: ClientInput,
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> ClientDetail:
    client = await reach_client(session, principal.user, client_id)
    changes = body.model_dump(exclude_unset=True)
    for name, value in changes.items():
        setattr(client, name, value)
    _record(request, session, principal.user, "client_update", client, fields=sorted(changes))
    await session.flush()
    await session.refresh(client)
    reply = await _detail(session, client)
    await session.commit()
    return reply


@router.post(
    "/clients/{client_id}/rotate-code",
    operation_id="rotateClientCode",
    response_model=ClientCodeRotated,
    tags=["clients"],
    dependencies=[TAILOR],
)
async def rotate_code(
    client_id: uuid.UUID, principal: CurrentPrincipal, request: Request, session: Session
) -> ClientCodeRotated:
    client = await owned_client(session, principal.user, client_id)
    old = client.client_code
    for _ in range(CODE_ATTEMPTS):
        try:
            async with session.begin_nested():
                client.client_code = new_code()
                client.previous_code = old
                # A phone holding the old code has no secret for the new one, so the claim goes too.
                free_claim(client)
                await session.flush()
        except IntegrityError:
            continue
        break
    else:
        raise ApiError("server_error")
    _record(request, session, principal.user, "code_rotate", client)
    reply = ClientCodeRotated(client_code=client.client_code)
    await session.commit()
    return reply


@router.get(
    "/clients/{client_id}/profiles",
    operation_id="listClientProfiles",
    response_model=list[ProfileSummary],
    tags=["clients"],
    dependencies=[STAFF],
)
async def list_client_profiles(
    client_id: uuid.UUID, principal: CurrentPrincipal, session: Session
) -> list[ProfileSummary]:
    client = await reach_client(session, principal.user, client_id)
    rows = (
        await session.execute(
            select(MeasurementProfile, CaptureSession.capture_mode)
            .join(CaptureSession, CaptureSession.session_id == MeasurementProfile.session_id)
            .where(MeasurementProfile.client_id == client.client_id)
            .order_by(MeasurementProfile.captured_at.desc())
        )
    ).all()
    ids = [row.MeasurementProfile.profile_id for row in rows]
    flags = await _flag_counts(session, ids)
    checks = {
        row[0]: row[1]
        for row in await session.execute(
            select(ServerCheck.profile_id, func.count())
            .where(ServerCheck.profile_id.in_(ids))
            .group_by(ServerCheck.profile_id)
        )
    }
    return [
        ProfileSummary(
            profile_id=str(row.MeasurementProfile.profile_id),
            version=row.MeasurementProfile.version,
            captured_at=row.MeasurementProfile.captured_at,
            status=row.MeasurementProfile.status,
            capture_mode=row.capture_mode,
            flag_counts=flags[row.MeasurementProfile.profile_id],
            server_check_count=checks.get(row.MeasurementProfile.profile_id, 0),
        )
        for row in rows
    ]


@router.get(
    "/clients/{client_id}/claim",
    operation_id="getClientClaim",
    response_model=ClientClaim,
    tags=["clients"],
    dependencies=[TAILOR],
)
async def get_claim(
    client_id: uuid.UUID, principal: CurrentPrincipal, session: Session
) -> dict[str, Any]:
    return await claim_view(session, await owned_client(session, principal.user, client_id))


@router.post(
    "/clients/{client_id}/claim/free",
    operation_id="freeClientClaim",
    response_model=ClientClaim,
    tags=["clients"],
    dependencies=[TAILOR],
)
async def free_client_claim(
    client_id: uuid.UUID, principal: CurrentPrincipal, request: Request, session: Session
) -> dict[str, Any]:
    client = await owned_client(session, principal.user, client_id)
    # A row lock against an upload that is claiming at this moment.
    await session.refresh(client, with_for_update={"key_share": True})
    # An unclaimed code still moves on if it holds rows, or a new phone could never claim it.
    free_claim(client)
    _record(request, session, principal.user, "code_reset", client, claim_round=client.claim_round)
    await session.flush()
    reply = await claim_view(session, client)
    await session.commit()
    return reply


@router.post(
    "/clients/{client_id}/claim/review",
    operation_id="reviewClientClaim",
    response_model=ClientClaim,
    tags=["clients"],
    dependencies=[TAILOR],
)
async def review_client_claim(
    client_id: uuid.UUID,
    body: ClaimReviewInput,
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> dict[str, Any]:
    client = await owned_client(session, principal.user, client_id)
    await session.refresh(client, with_for_update={"key_share": True})
    done = await apply_review(
        session,
        client,
        body.supersede_profile_ids,
        body.clear_consent_ids,
        body.close_request_ids,
    )
    _record(request, session, principal.user, "claim_review", client, **done)
    await session.flush()
    reply = await claim_view(session, client)
    await session.commit()
    return reply


@router.get(
    "/profiles/{profile_id}",
    operation_id="getProfile",
    response_model=ProfileView,
    response_model_exclude_none=False,
    tags=["profiles"],
    dependencies=[STAFF],
)
async def get_profile(
    profile_id: uuid.UUID, principal: CurrentPrincipal, request: Request, session: Session
) -> dict[str, Any]:
    row = await session.get(MeasurementProfile, profile_id)
    if not row:
        raise ApiError("not_found")
    client = await reach_client(session, principal.user, row.client_id)
    consents = list(
        await session.scalars(select(Consent).where(Consent.client_id == client.client_id))
    )
    body = await profile_json(session, client, row, consents)
    audit.record(
        session,
        actor_type="user",
        user_id=principal.user.user_id,
        action="profile_view",
        entity_type="measurement_profile",
        entity_id=row.profile_id,
        client_id=client.client_id,
        ip_hash=ip_hash(request),
        detail={"version": row.version},
    )
    await session.commit()
    return body


async def _side(session: AsyncSession, profile_id: uuid.UUID) -> dict[str, Any]:
    row = await session.get(MeasurementProfile, profile_id)
    assert row is not None
    rows = await session.scalars(
        select(Measurement)
        .where(Measurement.profile_id == profile_id)
        .order_by(Measurement.site_code)
    )
    return {
        "profile_id": str(row.profile_id),
        "version": row.version,
        "captured_at": row.captured_at,
        "measurements": [measurement_json(m) for m in rows],
    }


async def _conflict_json(session: AsyncSession, row: Conflict, code: str) -> dict[str, Any]:
    return {
        "conflict_id": str(row.conflict_id),
        "client_id": str(row.client_id),
        "client_code": code,
        "server_profile": await _side(session, row.server_profile_id),
        "incoming_profile": await _side(session, row.incoming_profile_id),
        "created_at": row.created_at,
        "resolved_at": row.resolved_at,
        "resolution": row.resolution,
    }


@router.get(
    "/conflicts",
    operation_id="listConflicts",
    response_model=list[ConflictView],
    tags=["profiles"],
    dependencies=[TAILOR],
)
async def list_conflicts(principal: CurrentPrincipal, session: Session) -> list[dict[str, Any]]:
    tailor = await tailor_of(session, principal.user)
    rows = await session.execute(
        select(Conflict, Client.client_code)
        .join(Client, Client.client_id == Conflict.client_id)
        .where(
            Client.tailor_id == tailor.tailor_id,
            Client.deleted_at.is_(None),
            Conflict.resolved_at.is_(None),
        )
        .order_by(Conflict.created_at.desc())
    )
    return [await _conflict_json(session, row.Conflict, row.client_code) for row in rows.all()]


@router.post(
    "/conflicts/{conflict_id}/resolve",
    operation_id="resolveConflict",
    response_model=ConflictView,
    tags=["profiles"],
    dependencies=[TAILOR],
)
async def resolve_conflict(
    conflict_id: uuid.UUID,
    body: ConflictResolution,
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> dict[str, Any]:
    conflict = await session.get(Conflict, conflict_id, with_for_update={"key_share": True})
    if not conflict:
        raise ApiError("not_found")
    client = await owned_client(session, principal.user, conflict.client_id)
    if conflict.resolved_at is None:
        server = await session.get(MeasurementProfile, conflict.server_profile_id)
        incoming = await session.get(MeasurementProfile, conflict.incoming_profile_id)
        assert server is not None and incoming is not None
        if body.keep == "newer":
            newer, older = (
                (incoming, server)
                if incoming.captured_at > server.captured_at
                else (server, incoming)
            )
            top = await session.scalar(
                select(func.max(MeasurementProfile.version)).where(
                    MeasurementProfile.client_id == client.client_id
                )
            )
            # Older first, because the unique index allows one final row for each version.
            older.status = "superseded"
            await session.flush()
            newer.status = "final"
            newer.version = (top or 0) + 1
        else:
            incoming.status = "superseded"
        conflict.resolved_at = datetime.now(UTC)
        conflict.resolution = body.keep
        conflict.resolved_by = principal.user.user_id
        audit.record(
            session,
            actor_type="user",
            user_id=principal.user.user_id,
            action="conflict_resolve",
            entity_type="conflict",
            entity_id=conflict.conflict_id,
            client_id=client.client_id,
            ip_hash=ip_hash(request),
            detail={"keep": body.keep},
        )
        await session.flush()
    reply = await _conflict_json(session, conflict, client.client_code)
    await session.commit()
    return reply
