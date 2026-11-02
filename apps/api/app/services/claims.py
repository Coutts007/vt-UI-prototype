"""What a tailor sees and does about who holds a client code (D45)."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
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
    reviewer: uuid.UUID,
) -> tuple[dict[str, int], list[dict[str, Any]], list[Conflict]]:
    """Only what the tailor named, and all of it or none: a withdrawal may be genuine (D45).

    Returns the counts, one audit detail for each thing touched (a body has a size limit, so they
    are not gathered into one), and the conflicts this review settled.
    """
    named: list[dict[str, Any]] = []
    settled: list[Conflict] = []
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
        named.append({"profile_id": str(profile_id), "did": "supersede"})
    await session.flush()
    moment = datetime.now(UTC)
    if supersede:
        open_conflicts = await session.scalars(
            select(Conflict).where(
                Conflict.client_id == client.client_id,
                Conflict.resolved_at.is_(None),
                Conflict.server_profile_id.in_(supersede)
                | Conflict.incoming_profile_id.in_(supersede),
            )
        )
        for conflict in open_conflicts.all():
            # The row it was waiting on is gone, so the other one is what the tailor has left.
            keep_incoming = conflict.incoming_profile_id not in supersede
            if keep_incoming:
                incoming = await session.get(MeasurementProfile, conflict.incoming_profile_id)
                assert incoming is not None
                top = await session.scalar(
                    select(func.max(MeasurementProfile.version)).where(
                        MeasurementProfile.client_id == client.client_id
                    )
                )
                incoming.status = "final"
                incoming.version = (top or 0) + 1
                await session.flush()
            conflict.resolved_at = moment
            conflict.resolution = "newer" if keep_incoming else "server"
            conflict.resolved_by = reviewer
            settled.append(conflict)
    for consent_id in clear:
        consent = await session.get(Consent, consent_id)
        if consent is None or consent.client_id != client.client_id:
            raise invalid("clear_consent_ids", "not_this_client")
        # The column is cleared, so the audit row is what keeps the date.
        named.append(
            {
                "consent_id": str(consent_id),
                "did": "clear_withdrawal",
                "withdrawn_at": consent.withdrawn_at.isoformat() if consent.withdrawn_at else None,
            }
        )
        consent.withdrawn_at = None
    for request_id in close:
        request = await session.get(DeletionRequest, request_id)
        if request is None or request.client_id != client.client_id:
            raise invalid("close_request_ids", "not_this_client")
        if request.status != "received":
            raise invalid("close_request_ids", "request_already_handled")
        request.status = "rejected"
        request.completed_at = moment
        named.append({"request_id": str(request_id), "did": "close_request"})
    counts = {"superseded": len(supersede), "cleared": len(clear), "closed": len(close)}
    return counts, named, settled
