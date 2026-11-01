"""Deletion and access requests from a client, with proof of possession (backend-spec 14.5)."""

import uuid
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
    DeletedProfile,
    DeletionRequest,
    MeasurementProfile,
    Order,
)
from app.schemas import DeletionRequestInput
from app.security.client_secret import matches
from app.security.ip_hash import ip_hash, keyed_hash
from app.services import audit
from app.services.profiles import consent_json, profile_json

BACKUPS = "Copies leave the backups within 30 days."
RETAINED = " Profiles on an order stay until 30 days after the order is collected."
EARLIER = " Your tailor holds earlier records for this code and has been told."
NOTHING_HELD = "Nothing is held for this code."
PASSED_ON = "Your tailor has been told. Nothing changes until they act."


async def _proven_client(
    session: AsyncSession, code: str, secret: str | None, *, lock: bool = False
) -> Client:
    """One answer for an unknown code, an unclaimed one and a wrong secret (D45)."""
    query = select(Client).where(Client.client_code == code, Client.deleted_at.is_(None))
    client = await session.scalar(query.with_for_update(key_share=True) if lock else query)
    return _proven(client, secret)


def _proven(client: Client | None, secret: str | None) -> Client:
    if not matches(secret, client.secret_hash if client else None) or client is None:
        raise ApiError("client_secret_refused")
    return client


async def _has_profiles(session: AsyncSession, client: Client) -> bool:
    found = await session.scalar(
        select(exists().where(MeasurementProfile.client_id == client.client_id))
    )
    return bool(found)


async def _pass_to_tailor(
    request: Request, session: AsyncSession, client: Client, body: DeletionRequestInput
) -> dict[str, Any]:
    """A freed or unclaimed code holds something and no phone can prove it is theirs (D45)."""
    open_request = await session.scalar(
        select(DeletionRequest)
        .where(
            DeletionRequest.client_id == client.client_id,
            DeletionRequest.status == "received",
            DeletionRequest.reason == body.reason,
        )
        .limit(1)
    )
    if open_request is None:
        open_request = DeletionRequest(
            client_id=client.client_id,
            client_code_hash=keyed_hash(request, body.client_code),
            reason=body.reason,
            status="received",
            note=PASSED_ON,
        )
        session.add(open_request)
        await session.flush()
        audit.record(
            session,
            actor_type="system",
            action="deletion_request",
            entity_type="deletion_request",
            entity_id=open_request.request_id,
            client_id=client.client_id,
            detail={"reason": body.reason, "status": "received", "details_cleared": False},
        )
    receipt = {"request_id": str(open_request.request_id), "status": "received", "note": PASSED_ON}
    await session.commit()
    return receipt


async def request_deletion(
    request: Request, session: AsyncSession, body: DeletionRequestInput, secret: str | None
) -> dict[str, Any]:
    query = select(Client).where(
        Client.client_code == body.client_code, Client.deleted_at.is_(None)
    )
    found = await session.scalar(query.with_for_update(key_share=True))
    if found and found.secret_hash is None:
        if (
            not found.display_name
            and found.height_mm is None
            and not await _has_profiles(session, found)
        ):
            # The upload never arrived, so a stranger gains nothing by asking (D45).
            return {"request_id": str(uuid.uuid4()), "status": "done", "note": NOTHING_HELD}
        return await _pass_to_tailor(request, session, found, body)
    client = _proven(found, secret)
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
            MeasurementProfile.claim_round == client.claim_round,
            MeasurementProfile.profile_id.not_in(on_order),
        )
        .returning(MeasurementProfile.profile_id, MeasurementProfile.session_id)
        .execution_options(synchronize_session=False)
    )
    rows = removed.all()
    sessions = [row.session_id for row in rows]
    if rows:
        session.add_all(
            [DeletedProfile(profile_id=row.profile_id, client_id=client.client_id) for row in rows]
        )
        await session.execute(
            delete(CaptureSession)
            .where(CaptureSession.session_id.in_(sessions))
            .execution_options(synchronize_session=False)
        )
    retained = await session.scalar(
        select(func.count())
        .select_from(MeasurementProfile)
        .where(
            MeasurementProfile.client_id == client.client_id,
            MeasurementProfile.claim_round == client.claim_round,
        )
    )
    earlier = await session.scalar(
        select(func.count())
        .select_from(MeasurementProfile)
        .where(
            MeasurementProfile.client_id == client.client_id,
            MeasurementProfile.claim_round != client.claim_round,
        )
    )
    # Spec 14.5. A claim only ever comes with an upload, so this caller has uploaded under it (D45).
    details_cleared = client.display_name is not None or client.height_mm is not None
    client.display_name = None
    client.height_mm = None
    status = "partially_done" if retained or earlier else "done"
    note = BACKUPS + (RETAINED if retained else "") + (EARLIER if earlier else "")
    row = DeletionRequest(
        client_id=client.client_id,
        client_code_hash=keyed_hash(request, body.client_code),
        reason=body.reason,
        status=status,
        completed_at=None if status == "partially_done" else moment,
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
            "earlier": earlier or 0,
            # What the tailor's claim review must show: a deletion that wiped what they typed (D45).
            "details_cleared": details_cleared,
        },
    )
    receipt = {"request_id": str(row.request_id), "status": status, "note": note}
    await session.commit()
    return receipt


async def request_access(
    request: Request, session: AsyncSession, code: str, secret: str | None
) -> dict[str, Any]:
    client = await _proven_client(session, code, secret)
    consents = list(
        await session.scalars(
            select(Consent).where(Consent.client_id == client.client_id).order_by(Consent.given_at)
        )
    )
    # Only this phone's round: a code freed by its tailor does not hand over what came before (D45).
    rows = await session.scalars(
        select(MeasurementProfile)
        .where(
            MeasurementProfile.client_id == client.client_id,
            MeasurementProfile.claim_round == client.claim_round,
        )
        .order_by(MeasurementProfile.version, MeasurementProfile.captured_at)
    )
    profiles = [await profile_json(session, client, row, consents) for row in rows.all()]
    orders = await session.scalar(
        select(func.count())
        .select_from(Order)
        .join(MeasurementProfile, MeasurementProfile.profile_id == Order.profile_id)
        .where(
            Order.client_id == client.client_id,
            MeasurementProfile.claim_round == client.claim_round,
        )
    )
    export = {
        "client_code": code,
        "profiles": profiles,
        "consents": [
            consent_json(row) for row in consents if row.claim_round == client.claim_round
        ],
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
