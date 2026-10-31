"""Roles, triggers, migrations and the shape of the schema."""

import asyncio

import pytest
from app.config import Settings
from app.migrate import downgrade, upgrade
from app.seed import SeedRefused, load_demo
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from support import owner_execute


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_log SET action = 'login'",
        "DELETE FROM audit_log",
        "UPDATE reference_measurement SET value_mm = 1000",
        "DELETE FROM reference_measurement",
        "DELETE FROM measurement_profile",
        "DELETE FROM client",
        "UPDATE reference_correction SET value_mm = 1000",
        "DELETE FROM reference_correction",
        "DROP TABLE audit_log",
        "CREATE TABLE sneaky (photo bytea)",
    ],
)
async def test_the_application_role_cannot(session: AsyncSession, statement: str) -> None:
    with pytest.raises(DBAPIError):
        await session.execute(text(statement))
    await session.rollback()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_log SET action = 'login'",
        "DELETE FROM audit_log",
        "UPDATE reference_measurement SET value_mm = 1000",
        "DELETE FROM reference_measurement",
        "UPDATE reference_correction SET value_mm = 1000",
        "DELETE FROM reference_correction",
    ],
)
async def test_even_the_owner_cannot_change_append_only_rows(
    app: FastAPI, owner_url: str, statement: str
) -> None:
    await owner_execute(
        owner_url,
        "INSERT INTO reference_correction (correction_id, ref_id, value_mm, reason, corrected_by) "
        "SELECT gen_random_uuid(), r.ref_id, 1000, 'typing slip', u.user_id "
        "FROM reference_measurement r, user_account u LIMIT 1",
    )
    with pytest.raises(DBAPIError, match="cannot be changed"):
        await owner_execute(owner_url, statement)


async def test_no_binary_columns_exist(session: AsyncSession) -> None:
    rows = await session.execute(
        text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND data_type = 'bytea'"
        )
    )
    assert rows.all() == []


async def test_every_table_in_the_spec_exists(session: AsyncSession) -> None:
    rows = await session.execute(
        text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    )
    names = set(rows.scalars())
    assert names >= {
        "user_account", "tailor", "measurer", "client", "consent", "capture_session",
        "measurement_profile", "measurement", "server_check", "measurement_derivation",
        "rules_version", "order", "order_status_history", "order_item", "ease_preset",
        "spec_sheet", "sheet_share", "conflict", "deletion_request", "audit_log", "participant",
        "reference_measurement", "app_setting", "revoked_token",
    }  # fmt: skip


async def test_failed_site_may_have_no_value_but_others_must(session: AsyncSession) -> None:
    profile = await session.scalar(text("SELECT profile_id FROM measurement_profile LIMIT 1"))
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "UPDATE measurement SET value_mm = NULL, confidence_flag = 'pass' "
                "WHERE profile_id = :p"
            ),
            {"p": profile},
        )
    await session.rollback()


async def test_seed_loaded_every_collection(session: AsyncSession) -> None:
    expected = {
        "user_account": 6, "client": 11, "measurement_profile": 12, "order": 10, "audit_log": 40,
        "participant": 5, "reference_measurement": 63, "conflict": 1,
    }  # fmt: skip
    for table, count in expected.items():
        assert await session.scalar(text(f'SELECT count(*) FROM "{table}"')) == count, table


async def test_study_sessions_point_at_their_participant(session: AsyncSession) -> None:
    linked = await session.scalar(
        text("SELECT count(*) FROM capture_session WHERE participant_id IS NOT NULL")
    )
    assert linked and linked > 0


async def test_seed_runs_twice_without_harm(session: AsyncSession, settings: Settings) -> None:
    assert await load_demo(session, settings) is False


async def test_seed_is_refused_in_production(session: AsyncSession, settings: Settings) -> None:
    production = settings.model_copy(update={"env": "production"})
    with pytest.raises(SeedRefused):
        await load_demo(session, production)


def test_production_refuses_default_secrets() -> None:
    with pytest.raises(ValueError, match="secrets"):
        Settings(env="production", _env_file=None)  # type: ignore[call-arg]


def test_migrations_go_down_and_up_again(owner_url: str, app_url: str) -> None:
    separate = owner_url.rsplit("/", 1)[0] + "/migration_test"
    asyncio.run(_create_database(owner_url))
    upgrade(separate)
    downgrade(separate)
    upgrade(separate)

    async def tables() -> list[str]:
        engine = create_async_engine(separate)
        async with engine.connect() as connection:
            rows = await connection.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
            )
            names = list(rows.scalars())
        await engine.dispose()
        return names

    assert "audit_log" in asyncio.run(tables())
    downgrade(separate)
    assert asyncio.run(tables()) in ([], ["alembic_version"])


async def _create_database(owner_url: str) -> None:
    engine = create_async_engine(owner_url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as connection:
        await connection.execute(text("DROP DATABASE IF EXISTS migration_test"))
        await connection.execute(text("CREATE DATABASE migration_test"))
    await engine.dispose()
