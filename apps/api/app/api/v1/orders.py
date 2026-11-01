"""Orders, ease and the audit list (backend-spec 8, 11.6). Finished is always body plus ease."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Depends, Query, Request, Response
from sqlalchemy import Integer, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import (
    AuditLog,
    Client,
    Conflict,
    Measurement,
    MeasurementProfile,
    Order,
    OrderItem,
    OrderStatusHistory,
    Tailor,
    UserAccount,
)
from app.models import (
    EasePreset as PresetRow,
)
from app.schemas import (
    AuditEntry,
    AuditPage,
    EasePreset,
    EaseSuggestion,
    GarmentType,
    OrderInput,
    OrderItemInput,
    OrderPage,
    OrderStatus,
    OrderSummary,
    OrderUpdate,
)
from app.schemas import (
    Order as OrderView,
)
from app.security.deps import CurrentPrincipal, Session, owned_client, require_role, tailor_of
from app.security.ip_hash import ip_hash
from app.services import audit
from app.services.ease import suggestions
from app.services.ingest import invalid

from .directory import Page, PageSize

router = APIRouter()
TAILOR = Depends(require_role("tailor"))
NAIROBI = ZoneInfo("Africa/Nairobi")
LONGEST_LEAD = timedelta(days=180)


def _check_due(due: date) -> None:
    today = datetime.now(NAIROBI).date()
    if not today <= due <= today + LONGEST_LEAD:
        raise ApiError("due_date_past")


async def _flags_of(
    session: AsyncSession, profile_id: uuid.UUID
) -> dict[str, tuple[str, int | None]]:
    rows = await session.execute(
        select(Measurement.site_code, Measurement.confidence_flag, Measurement.value_mm).where(
            Measurement.profile_id == profile_id
        )
    )
    return {site: (flag, value) for site, flag, value in rows}


def _check_items(items: list[OrderItemInput], measured: dict[str, tuple[str, int | None]]) -> None:
    sites = [item.site_code for item in items]
    if len(set(sites)) != len(sites):
        raise invalid("items", "duplicate_site")
    for item in items:
        field = f"items.{item.site_code}"
        if item.site_code not in measured:
            raise invalid(field, "not_measured")
        flag, value = measured[item.site_code]
        if not item.overridden and item.body_mm != value:
            # A changed body value without saying so would hide who decided it.
            raise invalid(field, "override_required")
        if item.body_mm is None and not item.pending_fitting:
            raise invalid(field, "value_or_pending_required")
        if flag == "check" and not (item.flag_confirmed or item.overridden):
            raise invalid(field, "flag_not_confirmed")
        if flag == "fail" and not (item.overridden or item.pending_fitting):
            raise invalid(field, "override_or_pending_required")


def _item_row(
    order_id: uuid.UUID, item: OrderItemInput, measured: dict[str, tuple[str, int | None]]
) -> OrderItem:
    return OrderItem(
        order_id=order_id,
        site_code=item.site_code,
        body_mm=item.body_mm,
        ease_mm=item.ease_mm,
        finished_mm=None if item.body_mm is None else item.body_mm + item.ease_mm,
        overridden=item.overridden,
        override_reason=item.override_reason,
        flag_confirmed=bool(item.flag_confirmed),
        pending_fitting=bool(item.pending_fitting),
        confidence_flag=measured[item.site_code][0],
    )


async def _owned_order(session: AsyncSession, user: UserAccount, order_id: uuid.UUID) -> Order:
    tailor = await tailor_of(session, user)
    order = await session.get(Order, order_id)
    if not order:
        raise ApiError("not_found")
    if order.tailor_id != tailor.tailor_id:
        raise ApiError("forbidden")
    return order


async def _order_json(session: AsyncSession, order: Order) -> dict[str, Any]:
    client = await session.get(Client, order.client_id)
    profile = await session.get(MeasurementProfile, order.profile_id)
    assert client is not None and profile is not None
    items = await session.scalars(
        select(OrderItem).where(OrderItem.order_id == order.order_id).order_by(OrderItem.site_code)
    )
    steps = await session.scalars(
        select(OrderStatusHistory)
        .where(OrderStatusHistory.order_id == order.order_id)
        .order_by(OrderStatusHistory.changed_at, OrderStatusHistory.history_id)
    )
    return {
        "order_id": str(order.order_id),
        "order_no": order.order_no,
        "client_id": str(order.client_id),
        "client_code": client.client_code,
        "display_name": client.display_name,
        "profile_id": str(order.profile_id),
        "profile_version": profile.version,
        "garment_type": order.garment_type,
        "status": order.status,
        "due_date": order.due_date,
        "notes": order.notes,
        "items": [
            {
                "site_code": row.site_code,
                "body_mm": row.body_mm,
                "ease_mm": row.ease_mm,
                "finished_mm": row.finished_mm,
                "overridden": row.overridden,
                "override_reason": row.override_reason,
                "flag_confirmed": row.flag_confirmed,
                "pending_fitting": row.pending_fitting,
                "confidence_flag": row.confidence_flag,
            }
            for row in items
        ],
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "status_history": [{"status": row.status, "at": row.changed_at} for row in steps],
    }


def _record(
    request: Request,
    session: AsyncSession,
    user: UserAccount,
    action: str,
    order: Order,
    **detail: Any,
) -> None:
    audit.record(
        session,
        actor_type="user",
        user_id=user.user_id,
        action=action,
        entity_type="order",
        entity_id=order.order_id,
        client_id=order.client_id,
        ip_hash=ip_hash(request),
        detail={"order_no": order.order_no, **detail},
    )


@router.get(
    "/orders",
    operation_id="listOrders",
    response_model=OrderPage,
    tags=["orders"],
    dependencies=[TAILOR],
)
async def list_orders(
    principal: CurrentPrincipal,
    session: Session,
    status: OrderStatus | None = None,
    sort: Literal["due_date", "created_at"] | None = None,
    page: Page = 1,
    page_size: PageSize = 25,
) -> OrderPage:
    tailor = await tailor_of(session, principal.user)
    conditions: list[Any] = [Order.tailor_id == tailor.tailor_id]
    if status:
        conditions.append(Order.status == status)
    total = await session.scalar(select(func.count()).select_from(Order).where(*conditions))
    order_by = (
        (Order.created_at.desc(), Order.order_id)
        if sort == "created_at"
        else (Order.due_date, Order.order_id)
    )
    rows = (
        await session.execute(
            select(Order, Client, MeasurementProfile.version)
            .join(Client, Client.client_id == Order.client_id)
            .join(MeasurementProfile, MeasurementProfile.profile_id == Order.profile_id)
            .where(*conditions)
            .order_by(*order_by)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    ids = [row.Order.order_id for row in rows]
    flagged = {
        row[0]: row[1]
        for row in await session.execute(
            select(OrderItem.order_id, func.count())
            .where(OrderItem.order_id.in_(ids), OrderItem.confidence_flag != "pass")
            .group_by(OrderItem.order_id)
        )
    }
    conflicted = set(
        await session.scalars(
            select(Conflict.client_id).where(
                Conflict.client_id.in_([row.Order.client_id for row in rows]),
                Conflict.resolved_at.is_(None),
            )
        )
    )
    return OrderPage(
        items=[
            OrderSummary(
                order_id=str(row.Order.order_id),
                order_no=row.Order.order_no,
                client_id=str(row.Order.client_id),
                client_code=row.Client.client_code,
                display_name=row.Client.display_name,
                profile_version=row.version,
                garment_type=row.Order.garment_type,
                status=row.Order.status,
                due_date=row.Order.due_date,
                flagged_sites=flagged.get(row.Order.order_id, 0),
                has_conflict=row.Order.client_id in conflicted,
            )
            for row in rows
        ],
        page=page,
        page_size=page_size,
        total=total or 0,
    )


@router.post(
    "/orders",
    operation_id="createOrder",
    status_code=201,
    response_model=OrderView,
    response_model_exclude_none=False,
    tags=["orders"],
    dependencies=[TAILOR],
)
async def create_order(
    body: OrderInput, principal: CurrentPrincipal, request: Request, session: Session
) -> dict[str, Any]:
    client = await owned_client(session, principal.user, body.client_id)
    profile = await session.get(MeasurementProfile, body.profile_id)
    if not profile or profile.client_id != client.client_id or profile.status == "superseded":
        raise ApiError("not_found")
    _check_due(body.due_date)
    measured = await _flags_of(session, profile.profile_id)
    _check_items(body.items, measured)
    # The tailor's row is locked so two saves cannot take the same order number.
    await session.scalar(
        select(Tailor).where(Tailor.tailor_id == client.tailor_id).with_for_update(key_share=True)
    )
    top = await session.scalar(
        select(func.max(func.substr(Order.order_no, 5).cast(Integer))).where(
            Order.tailor_id == client.tailor_id
        )
    )
    number = (top or 0) + 1
    order = Order(
        order_no=f"ORD-{number:04d}",
        tailor_id=client.tailor_id,
        client_id=client.client_id,
        profile_id=profile.profile_id,
        garment_type=body.garment_type,
        status="new",
        due_date=body.due_date,
        notes=body.notes or "",
    )
    session.add(order)
    await session.flush()
    session.add_all([_item_row(order.order_id, item, measured) for item in body.items])
    session.add(
        OrderStatusHistory(order_id=order.order_id, status="new", user_id=principal.user.user_id)
    )
    _record(request, session, principal.user, "order_create", order, garment=body.garment_type)
    overridden = [item.site_code for item in body.items if item.overridden]
    if overridden:
        _record(request, session, principal.user, "override", order, sites=overridden)
    await session.flush()
    await session.refresh(order)
    reply = await _order_json(session, order)
    await session.commit()
    return reply


@router.get(
    "/orders/{order_id}",
    operation_id="getOrder",
    response_model=OrderView,
    tags=["orders"],
    dependencies=[TAILOR],
)
async def get_order(
    order_id: uuid.UUID, principal: CurrentPrincipal, session: Session
) -> dict[str, Any]:
    return await _order_json(session, await _owned_order(session, principal.user, order_id))


@router.patch(
    "/orders/{order_id}",
    operation_id="updateOrder",
    response_model=OrderView,
    tags=["orders"],
    dependencies=[TAILOR],
)
async def update_order(
    order_id: uuid.UUID,
    body: OrderUpdate,
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> dict[str, Any]:
    order = await _owned_order(session, principal.user, order_id)
    user = principal.user
    if body.status and body.status != order.status:
        session.add(
            OrderStatusHistory(order_id=order.order_id, status=body.status, user_id=user.user_id)
        )
        _record(request, session, user, "status_change", order, status=body.status)
        order.status = body.status
    edited: list[str] = []
    if body.due_date and body.due_date != order.due_date:
        _check_due(body.due_date)
        order.due_date = body.due_date
        edited.append("due_date")
    if body.notes is not None and body.notes != order.notes:
        order.notes = body.notes
        edited.append("notes")
    if body.items is not None:
        measured = await _flags_of(session, order.profile_id)
        _check_items(body.items, measured)
        before = {
            row.site_code: row.overridden
            for row in await session.scalars(
                select(OrderItem).where(OrderItem.order_id == order.order_id)
            )
        }
        await session.execute(delete(OrderItem).where(OrderItem.order_id == order.order_id))
        session.add_all([_item_row(order.order_id, item, measured) for item in body.items])
        edited.append("items")
        overridden = [
            item.site_code
            for item in body.items
            if item.overridden and not before.get(item.site_code)
        ]
        if overridden:
            _record(request, session, user, "override", order, sites=overridden)
    if edited:
        _record(request, session, user, "order_update", order, fields=edited)
    order.updated_at = datetime.now(UTC)
    await session.flush()
    reply = await _order_json(session, order)
    await session.commit()
    return reply


@router.delete(
    "/orders/{order_id}",
    operation_id="deleteOrder",
    status_code=204,
    tags=["orders"],
    dependencies=[TAILOR],
)
async def delete_order(
    order_id: uuid.UUID, principal: CurrentPrincipal, request: Request, session: Session
) -> Response:
    order = await _owned_order(session, principal.user, order_id)
    if order.status != "new":
        raise invalid("status", "order_in_progress")
    _record(request, session, principal.user, "order_delete", order)
    await session.delete(order)
    await session.commit()
    return Response(status_code=204)


@router.get(
    "/ease-suggestions",
    operation_id="getEaseSuggestions",
    response_model=list[EaseSuggestion],
    tags=["orders"],
    dependencies=[TAILOR],
)
async def get_ease_suggestions(
    client_id: uuid.UUID,
    profile_id: uuid.UUID,
    garment_type: GarmentType,
    principal: CurrentPrincipal,
    session: Session,
) -> list[dict[str, object]]:
    client = await owned_client(session, principal.user, client_id)
    profile = await session.get(MeasurementProfile, profile_id)
    if not profile or profile.client_id != client.client_id:
        raise ApiError("forbidden")
    return await suggestions(session, client.tailor_id, garment_type)


def _preset_view(row: PresetRow) -> EasePreset:
    return EasePreset.model_validate(
        {"garment_type": row.garment_type, "site_code": row.site_code, "ease_mm": row.ease_mm}
    )


@router.get(
    "/me/ease-presets",
    operation_id="getEasePresets",
    response_model=list[EasePreset],
    tags=["orders"],
    dependencies=[TAILOR],
)
async def get_ease_presets(principal: CurrentPrincipal, session: Session) -> list[EasePreset]:
    tailor = await tailor_of(session, principal.user)
    rows = await session.scalars(
        select(PresetRow)
        .where(PresetRow.tailor_id == tailor.tailor_id)
        .order_by(PresetRow.garment_type, PresetRow.site_code)
    )
    return [_preset_view(row) for row in rows]


@router.put(
    "/me/ease-presets",
    operation_id="putEasePresets",
    response_model=list[EasePreset],
    tags=["orders"],
    dependencies=[TAILOR],
)
async def put_ease_presets(
    body: Annotated[list[EasePreset], Body(max_length=54)],
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> list[EasePreset]:
    if len({(row.garment_type, row.site_code) for row in body}) != len(body):
        raise invalid("body", "duplicate_preset")
    tailor = await tailor_of(session, principal.user)
    await session.execute(delete(PresetRow).where(PresetRow.tailor_id == tailor.tailor_id))
    session.add_all([PresetRow(tailor_id=tailor.tailor_id, **row.model_dump()) for row in body])
    audit.record(
        session,
        actor_type="user",
        user_id=principal.user.user_id,
        action="settings_change",
        entity_type="ease_preset",
        entity_id=tailor.tailor_id,
        ip_hash=ip_hash(request),
        detail={"presets": len(body)},
    )
    await session.commit()
    return body


SUMMARIES = {
    "register": "Registered",
    "login": "Signed in",
    "login_failed": "Sign-in failed",
    "logout": "Signed out",
    "settings_change": "Changed settings",
    "profile_ingest": "A profile arrived",
    "client_code_claim": "A phone claimed a code",
    "profile_view": "Opened a profile",
    "deletion_request": "A client asked for deletion",
    "access_request": "A client asked for their data",
    "deletion": "Marked for deletion",
    "code_issue": "Issued a client code",
    "code_rotate": "Replaced a client code",
    "code_reset": "Freed a client code",
    "claim_review": "Reviewed a freed code",
    "client_update": "Changed client details",
    "conflict_resolve": "Resolved a conflict",
    "order_create": "Created an order",
    "order_update": "Changed an order",
    "order_delete": "Deleted an order",
    "status_change": "Changed an order's status",
    "override": "Overrode a measurement",
    "export": "Exported",
    "share": "Shared",
}


def _summary(row: AuditLog) -> str:
    text = SUMMARIES.get(row.action, row.action)
    number = row.detail.get("order_no")
    return f"{text}: {number}" if number else text


@router.get(
    "/audit",
    operation_id="listAudit",
    response_model=AuditPage,
    tags=["audit"],
    dependencies=[Depends(require_role("tailor", "admin", "measurer"))],
)
async def list_audit(
    principal: CurrentPrincipal,
    session: Session,
    user: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=24)] = None,
    entity_type: Annotated[str | None, Query(max_length=40)] = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
    page: Page = 1,
    page_size: PageSize = 25,
) -> AuditPage:
    conditions: list[Any] = []
    if principal.user.role == "admin":
        if user:
            conditions.append(AuditLog.user_id == user)
    else:
        conditions.append(AuditLog.user_id == principal.user.user_id)
    if action:
        conditions.append(AuditLog.action == action)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if from_:
        conditions.append(AuditLog.occurred_at >= from_)
    if to:
        conditions.append(AuditLog.occurred_at <= to)
    total = await session.scalar(select(func.count()).select_from(AuditLog).where(*conditions))
    rows = await session.execute(
        select(AuditLog, UserAccount.email, UserAccount.role)
        .outerjoin(UserAccount, UserAccount.user_id == AuditLog.user_id)
        .where(*conditions)
        .order_by(AuditLog.occurred_at.desc(), AuditLog.log_id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return AuditPage(
        items=[
            AuditEntry(
                log_id=str(row.AuditLog.log_id),
                occurred_at=row.AuditLog.occurred_at,
                actor_type=row.AuditLog.actor_type,
                user_email=row.email,
                role=row.role,
                action=row.AuditLog.action,
                entity_type=row.AuditLog.entity_type,
                entity_id=row.AuditLog.entity_id,
                summary=_summary(row.AuditLog),
            )
            for row in rows
        ],
        page=page,
        page_size=page_size,
        total=total or 0,
    )
