"""Deletion and access requests from a client, with proof of possession (backend-spec 14.5)."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import (
    CaptureSession,
    Client,
    Consent,
    DeletionRequest,
    MeasurementProfile,
    Order,
)
from app.schemas import DeletionRequestInput
from app.security.ip_hash import ip_hash, keyed_hash
from app.services import audit
from app.services.profiles import consent_json, profile_json

BACKUPS = "Copies leave the backups within 30 days."
RETAINED = " Profiles on an order stay until 30 days after the order is collected."


async def _proven_client(
    session: AsyncSession, code: str, profile_ids: Sequence[uuid.UUID], *, lock: bool = False
) -> Client:
    """One answer for every failure: it must not reveal which part was wrong."""
    query = select(Client).where(
        Client.client_code == code,
        Client.deleted_at.is_(None),
        exists().where(
            MeasurementProfile.client_id == Client.client_id,
            MeasurementProfile.profile_id.in_(profile_ids),
            MeasurementProfile.status != "deleted",
        ),
    )
    client = await session.scalar(query.with_for_update(key_share=True) if lock else query)
    if not client:
        raise ApiError("not_found")
    return client


async def request_deletion(
    request: Request, session: AsyncSession, body: DeletionRequestInput
) -> dict[str, Any]:
    client = await _proven_client(session, body.client_code, body.profile_ids, lock=True)
    moment = datetime.now(UTC)
    if body.reason == "withdraw_consent":
        await session.execute(
            update(Consent)
            .where(Consent.client_id == client.client_id, Consent.withdrawn_at.is_(None))
            .values(withdrawn_at=moment)
        )
    on_order = select(Order.profile_id).where(Order.client_id == client.client_id)
    removed = await session.execute(
        delete(MeasurementProfile)
        .where(
            MeasurementProfile.client_id == client.client_id,
            MeasurementProfile.profile_id.not_in(on_order),
        )
        .returning(MeasurementProfile.session_id)
        .execution_options(synchronize_session=False)
    )
    sessions = [row.session_id for row in removed]
    if sessions:
        await session.execute(
            delete(CaptureSession)
            .where(CaptureSession.session_id.in_(sessions))
            .execution_options(synchronize_session=False)
        )
    retained = await session.scalar(
        select(func.count())
        .select_from(MeasurementProfile)
        .where(MeasurementProfile.client_id == client.client_id)
    )
    client.display_name = None
    client.height_mm = None
    status = "partially_done" if retained else "done"
    note = BACKUPS + (RETAINED if retained else "")
    row = DeletionRequest(
        client_id=client.client_id,
        client_code_hash=keyed_hash(request, body.client_code),
        reason=body.reason,
        status=status,
        completed_at=None if retained else moment,
        note=note,
    )
    session.add(row)
    await session.flush()
    audit.record(
        session,
        actor_type="system",
        action="deletion_request",
        entity_type="deletion_request",
        entity_id=row.request_id,
        client_id=client.client_id,
        detail={
            "reason": body.reason,
            "status": status,
            "deleted": len(sessions),
            "retained": retained or 0,
        },
    )
    receipt = {"request_id": str(row.request_id), "status": status, "note": note}
    await session.commit()
    return receipt


async def request_access(
    request: Request, session: AsyncSession, code: str, profile_ids: Sequence[uuid.UUID]
) -> dict[str, Any]:
    client = await _proven_client(session, code, profile_ids)
    consents = list(
        await session.scalars(
            select(Consent).where(Consent.client_id == client.client_id).order_by(Consent.given_at)
        )
    )
    rows = await session.scalars(
        select(MeasurementProfile)
        .where(MeasurementProfile.client_id == client.client_id)
        .order_by(MeasurementProfile.version, MeasurementProfile.captured_at)
    )
    profiles = [await profile_json(session, client, row, consents) for row in rows.all()]
    orders = await session.scalar(
        select(func.count()).select_from(Order).where(Order.client_id == client.client_id)
    )
    export = {
        "client_code": code,
        "profiles": profiles,
        "consents": [consent_json(row) for row in consents],
        "order_count": orders or 0,
    }
    audit.record(
        session,
        actor_type="client",
        action="access_request",
        entity_type="client",
        entity_id=client.client_id,
        client_id=client.client_id,
        ip_hash=ip_hash(request),
        detail={"profiles": len(profiles)},
    )
    await session.commit()
    return export
