"""Removes sheet files after 30 days (backend-spec 13, 15 job 5). Rows stay for the share log.

A later request simply generates a new sheet. Files no row names, left by a render whose
transaction failed, go after an hour.
"""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SpecSheet
from app.services.sheets import orphan_files, remove_files

ORPHAN_AGE_S = 3600


@dataclass(frozen=True)
class CleanupReport:
    expired_files: int
    orphan_files: int


async def clean_sheets(
    session: AsyncSession, directory: Path, now: datetime | None = None
) -> CleanupReport:
    moment = now or datetime.now(UTC)
    expired = [
        str(sheet_id)
        for sheet_id in await session.scalars(
            select(SpecSheet.sheet_id).where(SpecSheet.expires_at <= moment)
        )
    ]
    live = {
        str(sheet_id)
        for sheet_id in await session.scalars(
            select(SpecSheet.sheet_id).where(SpecSheet.expires_at > moment)
        )
    }

    def sweep() -> CleanupReport:
        removed = sum(remove_files(directory, sheet_id) for sheet_id in expired)
        orphans = orphan_files(directory, live | set(expired), ORPHAN_AGE_S)
        for path in orphans:
            path.unlink(missing_ok=True)
        return CleanupReport(expired_files=removed, orphan_files=len(orphans))

    return await asyncio.to_thread(sweep)
