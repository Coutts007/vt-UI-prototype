"""The first administrator on a fresh database, such as the study laptop (M12)."""

from app.cli import create_admin
from app.config import Settings
from app.models import AuditLog, UserAccount
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def test_create_admin_once_on_a_database_without_one(
    settings: Settings, session: AsyncSession
) -> None:
    others = (await session.scalars(select(UserAccount).where(UserAccount.role == "admin"))).all()
    for admin in others:
        admin.role = "tailor"
    await session.commit()
    try:
        assert await create_admin(settings, "short@vt.test", "short") == (
            "refused: the password needs 10 to 256 characters"
        )
        assert await create_admin(settings, " First@VT.test ", "long-enough-pw") == (
            "administrator created"
        )
        assert (await create_admin(settings, "second@vt.test", "long-enough-pw")).startswith(
            "refused: an administrator already exists"
        )
        created = await session.scalar(
            select(UserAccount).where(UserAccount.email == "first@vt.test")
        )
        assert created and created.role == "admin" and created.status == "active"
        row = await session.scalar(
            select(AuditLog).where(
                AuditLog.action == "account_create", AuditLog.entity_id == str(created.user_id)
            )
        )
        assert row and row.actor_type == "system" and row.detail == {"role": "admin", "via": "cli"}
        created.role = "tailor"
        created.status = "disabled"
    finally:
        for admin in others:
            admin.role = "admin"
        await session.commit()
