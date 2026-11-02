"""The nightly retention job with seeded ages (backend-spec 14.6). It runs as vt_retention."""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from app.db.session import make_engine, make_sessions
from app.models import (
    AuditLog,
    CaptureSession,
    Client,
    DeletedProfile,
    DeletionRequest,
    MeasurementProfile,
    Order,
    Participant,
    ReferenceMeasurement,
    RevokedToken,
)
from app.services.retention import months_before, run_retention
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import owner_execute

RETENTION_PASSWORD = "vt-retention-test"


@pytest.fixture
async def job(app: FastAPI, owner_url: str) -> AsyncIterator[AsyncSession]:
    """A session as vt_retention, the role the nightly job uses (backend-spec 7)."""
    await owner_execute(owner_url, f"ALTER ROLE vt_retention PASSWORD '{RETENTION_PASSWORD}'")
    host = owner_url.split("@", 1)[1]
    engine = make_engine(f"postgresql+asyncpg://vt_retention:{RETENTION_PASSWORD}@{host}")
    async with make_sessions(engine)() as session:
        yield session
    await engine.dispose()


async def run(job: AsyncSession, tmp_path: Path, *, dry_run: bool = False):  # type: ignore[no-untyped-def]
    return await run_retention(
        job, sheets_dir=tmp_path / "sheets", reports_dir=tmp_path / "reports", dry_run=dry_run
    )


async def count(session: AsyncSession, model: type, *where: object) -> int:
    return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0  # type: ignore[arg-type]


async def age_client(owner_url: str, code: str, days: int) -> None:
    """Moves every date of a client and its rows `days` into the past."""
    ago = f"now() - interval '{days} days'"
    owner = f"(SELECT client_id FROM client WHERE client_code = '{code}')"
    await owner_execute(
        owner_url,
        f"UPDATE client SET created_at = {ago} WHERE client_code = '{code}'",
        f"UPDATE measurement_profile SET received_at = {ago}, captured_at = {ago}"
        f" WHERE client_id = {owner}",
        f'UPDATE "order" SET updated_at = {ago}, created_at = {ago} WHERE client_id = {owner}',
        f"UPDATE order_status_history SET changed_at = {ago} WHERE order_id IN"
        f' (SELECT order_id FROM "order" WHERE client_id = {owner})',
    )


def test_months_before_keeps_the_day_or_the_last_one() -> None:
    assert months_before(datetime(2026, 3, 31, tzinfo=UTC), 1) == datetime(2026, 2, 28, tzinfo=UTC)
    assert months_before(datetime(2026, 1, 15, tzinfo=UTC), 24) == datetime(2024, 1, 15, tzinfo=UTC)
    assert months_before(datetime(2025, 6, 1, tzinfo=UTC), -12) == datetime(2026, 6, 1, tzinfo=UTC)


async def test_an_inactive_client_goes_after_the_retention_period(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    # AB1006 has one collected order; 25 months ago is past the default 24.
    await age_client(owner_url, "AB1006", 25 * 31)
    # AB1001 is as old but still has open orders, so it stays.
    await age_client(owner_url, "AB1001", 25 * 31)
    # AB1003 was active 23 months ago, so it stays.
    await age_client(owner_url, "AB1003", 23 * 30)
    report = await run(job, tmp_path)
    assert report.clients_inactive == 1
    remaining = set(await session.scalars(select(Client.client_code)))
    assert "AB1006" not in remaining
    assert {"AB1001", "AB1003"} <= remaining


async def test_a_dry_run_reports_and_changes_nothing(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    await age_client(owner_url, "AB1006", 25 * 31)
    clients_before = await count(session, Client)
    audit_before = await count(session, AuditLog)
    report = await run(job, tmp_path, dry_run=True)
    assert report.clients_inactive == 1 and report.dry_run
    assert await count(session, Client) == clients_before
    assert await count(session, AuditLog) == audit_before
    written = json.loads(next((tmp_path / "reports").glob("retention-*-dry-run.json")).read_text())
    assert written["clients_inactive"] == 1 and written["dry_run"] is True
    # Counts only: no codes or names in the report.
    assert "AB1006" not in json.dumps(written)


async def test_a_real_run_writes_one_system_audit_row_with_counts(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    await age_client(owner_url, "AB1006", 25 * 31)
    await run(job, tmp_path)
    rows = list(await session.scalars(select(AuditLog).where(AuditLog.action == "retention")))
    assert len(rows) == 1
    assert rows[0].actor_type == "system" and rows[0].detail["clients_inactive"] == 1


async def test_a_kept_profile_goes_30_days_after_collection(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    client = await session.scalar(select(Client).where(Client.client_code == "AB1006"))
    assert client
    request = DeletionRequest(
        client_id=client.client_id,
        client_code_hash="x" * 64,
        reason="delete",
        status="partially_done",
        claim_round=client.claim_round,
    )
    session.add(request)
    await session.commit()
    owner = f"(SELECT order_id FROM \"order\" WHERE client_id = '{client.client_id}')"
    await owner_execute(
        owner_url,
        "UPDATE order_status_history SET changed_at = now() - interval '10 days'"
        f" WHERE status = 'collected' AND order_id IN {owner}",
    )
    soon = await run(job, tmp_path)
    assert soon.orders_after_collection == 0
    await session.refresh(request)
    assert request.status == "partially_done"
    await owner_execute(
        owner_url,
        "UPDATE order_status_history SET changed_at = now() - interval '31 days'"
        f" WHERE status = 'collected' AND order_id IN {owner}",
    )
    later = await run(job, tmp_path)
    assert later.orders_after_collection == 1 and later.requests_completed == 1
    client_id = client.client_id
    session.expire_all()
    await session.refresh(request)
    assert request.status == "done" and request.completed_at is not None
    assert await count(session, Order, Order.client_id == client_id) == 0
    assert await count(session, MeasurementProfile, MeasurementProfile.client_id == client_id) == 0
    # A tombstone stops the phone's queue from bringing the profile back (D45).
    assert await count(session, DeletedProfile, DeletedProfile.client_id == client_id) >= 1


async def test_study_records_go_12_months_after_collection_ends(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    end = (datetime.now(UTC) - timedelta(days=400)).date().isoformat()
    await owner_execute(
        owner_url,
        "INSERT INTO app_setting (key, value) VALUES"
        f" ('study_collection_end', '\"{end}\"')"
        " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    assert await count(session, ReferenceMeasurement) == 63
    # A dry run a week or more earlier must have shown the deletion (review of PR #14).
    early = await run_retention(
        job, sheets_dir=tmp_path / "sheets", reports_dir=tmp_path / "reports", dry_run=True,
        now=datetime.now(UTC) - timedelta(days=8),
    )  # fmt: skip
    assert early.study_readings == 63
    report = await run(job, tmp_path)
    assert report.study_readings == 63 and report.study_participants == 5
    assert await count(session, Participant) == 0
    assert await count(session, CaptureSession, CaptureSession.participant_id.isnot(None)) == 0


async def test_study_records_stay_within_the_12_months(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    end = (datetime.now(UTC) - timedelta(days=300)).date().isoformat()
    await owner_execute(
        owner_url,
        "INSERT INTO app_setting (key, value) VALUES"
        f" ('study_collection_end', '\"{end}\"')"
        " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    await run(job, tmp_path)
    assert await count(session, ReferenceMeasurement) == 63


async def test_old_audit_rows_tokens_and_tombstones_go(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    await owner_execute(
        owner_url,
        "INSERT INTO audit_log (occurred_at, actor_type, action, entity_type, entity_id, detail)"
        " VALUES (now() - interval '25 months', 'system', 'login', 'x', 'old', '{}'),"
        " (now() - interval '23 months', 'system', 'login', 'x', 'recent', '{}')",
        "INSERT INTO revoked_token (jti, expires_at) VALUES"
        " ('old-token', now() - interval '1 day'), ('live-token', now() + interval '1 day')",
        "INSERT INTO deleted_profile (profile_id, deleted_at) VALUES"
        " ('00000000-0000-4000-8000-000000000091', now() - interval '91 days'),"
        " ('00000000-0000-4000-8000-000000000089', now() - interval '89 days')",
    )
    report = await run(job, tmp_path)
    assert report.audit_rows >= 1 and report.revoked_tokens == 1 and report.tombstones == 1
    entities = set(
        await session.scalars(select(AuditLog.entity_id).where(AuditLog.entity_type == "x"))
    )
    assert entities == {"recent"}
    assert set(await session.scalars(select(RevokedToken.jti))) == {"live-token"}
    assert await count(session, DeletedProfile) >= 1


async def test_removed_clients_and_unused_directory_codes_go(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    await owner_execute(
        owner_url,
        "UPDATE client SET deleted_at = now() WHERE client_code = 'AB1008'",
        "INSERT INTO client (client_id, client_code, tailor_id, source, created_at)"
        " SELECT '00000000-0000-4000-8000-0000000000d1', 'ZZ9001', tailor_id, 'directory',"
        " now() - interval '31 days' FROM client WHERE client_code = 'AB1001'",
        "INSERT INTO client (client_id, client_code, tailor_id, source, created_at)"
        " SELECT '00000000-0000-4000-8000-0000000000d2', 'ZZ9002', tailor_id, 'directory',"
        " now() - interval '5 days' FROM client WHERE client_code = 'AB1001'",
        "INSERT INTO client (client_id, client_code, tailor_id, deleted_at)"
        " SELECT '00000000-0000-4000-8000-0000000000d3', 'ZZ9003', tailor_id, now()"
        " FROM client WHERE client_code = 'AB1001'",
    )
    report = await run(job, tmp_path)
    codes = set(await session.scalars(select(Client.client_code)))
    # AB1008 is a study participant's code, so the study keeps it.
    assert "AB1008" in codes
    assert "ZZ9001" not in codes and "ZZ9002" in codes and "ZZ9003" not in codes
    assert report.directory_codes_unused == 1 and report.clients_marked_deleted == 1


async def test_the_app_role_cannot_do_what_the_job_does(session: AsyncSession) -> None:
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    with pytest.raises(DBAPIError):
        await session.execute(text("DELETE FROM audit_log"))


def test_the_nightly_job_runs_at_two_in_nairobi() -> None:
    from app.services.schedule import seconds_until_next

    # 22:30 UTC is 01:30 in Nairobi: half an hour to go.
    assert seconds_until_next(datetime(2026, 11, 1, 22, 30, tzinfo=UTC)) == 1800
    # 23:00 UTC is 02:00 exactly, so the next run is a day later.
    assert seconds_until_next(datetime(2026, 11, 1, 23, 0, tzinfo=UTC)) == 86400


def test_production_refuses_the_default_retention_password() -> None:
    from app.config import Settings

    with pytest.raises(ValueError, match="own secrets"):
        Settings(  # type: ignore[call-arg]
            env="production",
            jwt_secret="x" * 40,
            ip_pepper="p",
            vt_app_db_password="q",
            signed_url_secret="s" * 40,
            _env_file=None,
        )


async def test_study_records_stay_without_an_earlier_dry_run(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    end = (datetime.now(UTC) - timedelta(days=400)).date().isoformat()
    await owner_execute(
        owner_url,
        "INSERT INTO app_setting (key, value) VALUES"
        f" ('study_collection_end', '\"{end}\"')"
        " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    # A dry run today is not enough: the deletion waits a week after the report that showed it.
    await run(job, tmp_path, dry_run=True)
    report = await run(job, tmp_path)
    assert report.study_readings == 0
    assert await count(session, ReferenceMeasurement) == 63
    assert any("study" in note.lower() for note in report.notes)


async def test_the_job_role_deletes_only_what_it_cleans(job: AsyncSession) -> None:
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    for statement in (
        "DELETE FROM app_setting",
        "DELETE FROM user_account",
        "DELETE FROM tailor",
        "DELETE FROM measurer",
        "SELECT * FROM alembic_version",
        "SELECT password_hash FROM user_account",
    ):
        with pytest.raises(DBAPIError):
            await job.execute(text(statement))
        await job.rollback()


async def test_a_request_with_no_round_is_left_for_the_admin(
    job: AsyncSession, session: AsyncSession, owner_url: str, tmp_path: Path
) -> None:
    """An old request with no round recorded must not reach every round (D45)."""
    client = await session.scalar(select(Client).where(Client.client_code == "AB1006"))
    assert client
    request = DeletionRequest(
        client_id=client.client_id, client_code_hash="y" * 64, reason="delete",
        status="partially_done", claim_round=None,
    )  # fmt: skip
    session.add(request)
    await session.commit()
    owner = f"(SELECT order_id FROM \"order\" WHERE client_id = '{client.client_id}')"
    await owner_execute(
        owner_url,
        "UPDATE order_status_history SET changed_at = now() - interval '31 days'"
        f" WHERE status = 'collected' AND order_id IN {owner}",
    )
    report = await run(job, tmp_path)
    assert report.orders_after_collection == 0
    await session.refresh(request)
    assert request.status == "partially_done"
