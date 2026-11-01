"""What a tailor sees and does about who holds a client code (D45)."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    Client,
    Conflict,
    Consent,
    DeletionRequest,
    MeasurementProfile,
    Order,
)
from app.services.ingest import invalid


async def claim_view(session: AsyncSession, client: Client) -> dict[str, Any]:
    on_order = set(
        await session.scalars(select(Order.profile_id).where(Order.client_id == client.client_id))
    )
    profiles = await session.scalars(
        select(MeasurementProfile)
        .where(MeasurementProfile.client_id == client.client_id)
        .order_by(MeasurementProfile.received_at.desc())
    )
    withdrawals = await session.scalars(
        select(Consent)
        .where(Consent.client_id == client.client_id, Consent.withdrawn_at.isnot(None))
        .order_by(Consent.withdrawn_at.desc())
    )
    requests = await session.scalars(
        select(DeletionRequest)
        .where(DeletionRequest.client_id == client.client_id)
        .order_by(DeletionRequest.received_at.desc())
    )
    logged = await session.scalars(
        select(AuditLog).where(
            AuditLog.client_id == client.client_id, AuditLog.action == "deletion_request"
        )
    )
    cleared = {row.entity_id for row in logged if row.detail.get("details_cleared")}
    return {
        "claimed": client.secret_hash is not None,
        "claim_round": client.claim_round,
        "profiles": [
            {
                "profile_id": str(row.profile_id),
                "version": row.version,
                "captured_at": row.captured_at,
                "received_at": row.received_at,
                "status": row.status,
                "claim_round": row.claim_round,
                "on_order": row.profile_id in on_order,
            }
            for row in profiles
        ],
        "withdrawals": [
            {
                "consent_id": str(row.consent_id),
                "consent_version": row.consent_version,
                "given_at": row.given_at,
                "withdrawn_at": row.withdrawn_at,
            }
            for row in withdrawals
        ],
        "deletion_requests": [
            {
                "request_id": str(row.request_id),
                "reason": row.reason,
                "status": row.status,
                "received_at": row.received_at,
                "details_cleared": str(row.request_id) in cleared,
            }
            for row in requests
        ],
    }


def free_claim(client: Client) -> None:
    """The next phone starts a new round, and reaches only what it uploads itself."""
    client.secret_hash = None
    client.claim_round += 1


async def apply_review(
    session: AsyncSession,
    client: Client,
    supersede: list[uuid.UUID],
    clear: list[uuid.UUID],
    close: list[uuid.UUID],
) -> dict[str, int]:
    """Only what the tailor named, and all of it or none: a withdrawal may be genuine (D45)."""
    if client.secret_hash is not None:
        raise invalid("client_id", "claim_not_freed")
    for profile_id in supersede:
        row = await session.get(MeasurementProfile, profile_id)
        if row is None or row.client_id != client.client_id:
            raise invalid("supersede_profile_ids", "not_this_client")
        used = await session.scalar(
            select(Order.order_id).where(Order.profile_id == profile_id).limit(1)
        )
        if used:
            raise invalid("supersede_profile_ids", "profile_on_order")
        row.status = "superseded"
    await session.flush()
    moment = datetime.now(UTC)
    if supersede:
        await session.execute(
            update(Conflict)
            .where(
                Conflict.client_id == client.client_id,
                Conflict.resolved_at.is_(None),
                Conflict.server_profile_id.in_(supersede)
                | Conflict.incoming_profile_id.in_(supersede),
            )
            .values(resolved_at=moment, resolution="server")
            .execution_options(synchronize_session=False)
        )
    for consent_id in clear:
        consent = await session.get(Consent, consent_id)
        if consent is None or consent.client_id != client.client_id:
            raise invalid("clear_consent_ids", "not_this_client")
        consent.withdrawn_at = None
    for request_id in close:
        request = await session.get(DeletionRequest, request_id)
        if request is None or request.client_id != client.client_id:
            raise invalid("close_request_ids", "not_this_client")
        if request.status != "received":
            raise invalid("close_request_ids", "request_already_handled")
        request.status = "rejected"
        request.completed_at = moment
    return {"superseded": len(supersede), "cleared": len(clear), "closed": len(close)}
