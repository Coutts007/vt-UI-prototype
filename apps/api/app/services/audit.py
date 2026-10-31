"""The one place that writes audit rows (backend-spec 14.4)."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

MAX_DETAIL_FIELDS = 16


def record(
    session: AsyncSession,
    *,
    actor_type: str,
    action: str,
    entity_type: str,
    entity_id: str | uuid.UUID,
    user_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    ip_hash: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Identifiers and codes only in `detail`: no names, emails or measurement values."""
    fields = detail or {}
    if len(fields) > MAX_DETAIL_FIELDS:
        raise ValueError("Audit detail is too large")
    session.add(
        AuditLog(
            actor_type=actor_type,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            user_id=user_id,
            client_id=client_id,
            ip_hash=ip_hash,
            detail=fields,
        )
    )
