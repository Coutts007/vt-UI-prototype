"""Removing a client's profiles once a deletion is proven or checked (backend-spec 14.5, D45)."""

import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CaptureSession, DeletedProfile, MeasurementProfile, Order


@dataclass(frozen=True)
class Erased:
    deleted: int
    retained: int


def _scope(client_id: uuid.UUID, claim_round: int | None) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [MeasurementProfile.client_id == client_id]
    if claim_round is not None:
        conditions.append(MeasurementProfile.claim_round == claim_round)
    return conditions


async def erase_profiles(
    session: AsyncSession, client_id: uuid.UUID, claim_round: int | None
) -> Erased:
    """Deletes every profile in scope that no order names, with its session, and leaves a
    tombstone so a phone's replay cannot bring it back. `None` covers every claim round."""
    on_order = select(Order.profile_id).where(Order.client_id == client_id)
    removed = await session.execute(
        delete(MeasurementProfile)
        .where(*_scope(client_id, claim_round), MeasurementProfile.profile_id.not_in(on_order))
        .returning(MeasurementProfile.profile_id, MeasurementProfile.session_id)
        .execution_options(synchronize_session=False)
    )
    rows = removed.all()
    if rows:
        session.add_all(
            [DeletedProfile(profile_id=row.profile_id, client_id=client_id) for row in rows]
        )
        await session.execute(
            delete(CaptureSession)
            .where(CaptureSession.session_id.in_([row.session_id for row in rows]))
            .execution_options(synchronize_session=False)
        )
    retained = await session.scalar(
        select(func.count()).select_from(MeasurementProfile).where(*_scope(client_id, claim_round))
    )
    return Erased(deleted=len(rows), retained=retained or 0)
