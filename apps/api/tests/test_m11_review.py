"""Fixes from the review of PR #14: withdrawal without a consent row, the A9 dates, the collection
end, allocation under concurrency, database locks, and study sets kept on a deletion (D44)."""

import asyncio
import csv
import io
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.models import (
    AuditLog,
    CaptureSession,
    MeasurementProfile,
    Participant,
)
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from test_m11_admin_study import API, FILLED, as_, production, reading  # noqa: F401

TODAY = date.today()


async def enrol(client: AsyncClient, headers: dict[str, str], code: str, sex: str = "female"):  # type: ignore[no-untyped-def]
    body = {"participant_code": code, "sex": sex, "age_band": "25-34", "venue": "V"}
    return await client.post(f"{API}/study/participants", json=body, headers=headers)


def rows_of(text_csv: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text_csv)))


# --- B1: withdrawal exists without a consent row ---------------------------------------------


async def test_a_participant_with_no_consent_row_can_withdraw_through_the_admin(
    client: AsyncClient,
) -> None:
    admin = await as_(client, "admin@vt.test")
    made = (await enrol(client, admin, "P300")).json()
    measurer = await as_(client, "measurer-a@vt.test")
    saved = await client.post(
        f"{API}/study/reference-readings", json=reading("P300"), headers=measurer
    )
    assert saved.status_code == 201
    # The phone asks to withdraw. The code holds no consent and no profile, but it is a
    # participant's, so the request is held for the admin instead of "nothing held".
    asked = await client.post(
        f"{API}/deletion-requests",
        json={"client_code": made["client_code"], "reason": "withdraw_consent"},
    )
    assert asked.status_code == 202 and asked.json()["status"] == "received", asked.text
    held = (await client.get(f"{API}/admin/deletion-requests", headers=admin)).json()
    request_id = next(r["request_id"] for r in held if r.get("client_code") == made["client_code"])
    honoured = await client.post(
        f"{API}/admin/deletion-requests/{request_id}/honour", headers=admin
    )
    assert honoured.status_code == 200
    people = (await client.get(f"{API}/study/participants", headers=admin)).json()
    assert next(p for p in people if p["participant_code"] == "P300")["withdrawn"] is True
    reference = (await client.get(f"{API}/study/export/reference.csv", headers=admin)).text
    assert all(row["participant_code"] != "P300" for row in rows_of(reference))
    again = await client.post(
        f"{API}/study/reference-readings", json=reading("P300", 2), headers=measurer
    )
    assert again.status_code == 422 and again.json()["code"] == "consent_missing"


async def test_the_admin_can_withdraw_a_participant_and_it_is_audited(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    made = (await enrol(client, admin, "P301")).json()
    reply = await client.post(
        f"{API}/study/participants/{made['participant_id']}/withdraw", headers=admin
    )
    assert reply.status_code == 200 and reply.json()["withdrawn"] is True
    logged = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "participant_update",
            AuditLog.entity_id == made["participant_id"],
        )
    )
    assert logged and logged.detail == {"withdrawn": True}
    # Withdrawal is one way: the database refuses to clear it.
    stored = await session.scalar(select(Participant).where(Participant.participant_code == "P301"))
    assert stored and stored.withdrawn_at is not None
    try:
        await session.execute(
            text("UPDATE participant SET withdrawn_at = NULL WHERE participant_code = 'P301'")
        )
        raise AssertionError("cleared")
    except DBAPIError:
        await session.rollback()


# --- B2: the A9 dates and who confirmed ------------------------------------------------------


async def put_approvals(client: AsyncClient, headers: dict[str, str], **values: Any):  # type: ignore[no-untyped-def]
    return await client.put(
        f"{API}/admin/settings", json={"approvals": {**FILLED, **values}}, headers=headers
    )


async def test_an_odpc_date_needs_its_reference_and_a_sensible_date(
    production: AsyncClient,  # noqa: F811
) -> None:
    admin = await as_(production, "admin@vt.test")
    today = TODAY.isoformat()
    no_ref = await put_approvals(
        production, admin, dpia_submitted_on=today, odpc_response_on="2000-01-01"
    )
    assert no_ref.status_code == 422
    before_dpia = await put_approvals(
        production, admin, dpia_submitted_on=today, odpc_response_on="2000-01-01",
        odpc_response_ref="ODPC/1",
    )  # fmt: skip
    assert before_dpia.status_code == 422
    future = (TODAY + timedelta(days=3)).isoformat()
    ahead = await put_approvals(
        production, admin, dpia_submitted_on=today, odpc_response_on=future,
        odpc_response_ref="ODPC/1",
    )  # fmt: skip
    assert ahead.status_code == 422
    dpia_ahead = await put_approvals(production, admin, dpia_submitted_on=future)
    assert dpia_ahead.status_code == 422
    body = {"participant_code": "P060", "sex": "male", "age_band": "18-24", "venue": "V"}
    refused = await production.post(f"{API}/study/participants", json=body, headers=admin)
    assert refused.json()["code"] == "approvals_missing"


async def test_the_server_records_who_confirmed_and_when(
    production: AsyncClient,  # noqa: F811
    session: AsyncSession,
) -> None:
    admin = await as_(production, "admin@vt.test")
    sent = await put_approvals(
        production, admin, dpia_submitted_on=(TODAY - timedelta(days=61)).isoformat(),
        approvals_confirmed_by="Someone else", confirmed_at="2030-01-01T00:00:00Z",
    )  # fmt: skip
    assert sent.status_code == 200, sent.text
    approvals = sent.json()["approvals"]
    assert approvals["approvals_confirmed_by"] == "admin@vt.test"
    confirmed = datetime.fromisoformat(approvals["confirmed_at"])
    assert abs((datetime.now(UTC) - confirmed).total_seconds()) < 120
    logged = await session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "settings_change", AuditLog.entity_id == "admin")
        .order_by(AuditLog.occurred_at.desc())
    )
    assert logged and logged.detail["approvals"]["ierc_ref"] == FILLED["ierc_ref"]


# --- Also 1: the collection end schedules deletion -------------------------------------------


async def test_a_past_collection_end_is_refused_while_the_study_runs(client: AsyncClient) -> None:
    admin = await as_(client, "admin@vt.test")
    past = (TODAY - timedelta(days=400)).isoformat()
    refused = await client.put(
        f"{API}/admin/settings",
        json={"study_collection_end": past, "confirm_study_deletion": True},
        headers=admin,
    )
    assert refused.status_code == 422
    later = (TODAY + timedelta(days=30)).isoformat()
    unconfirmed = await client.put(
        f"{API}/admin/settings", json={"study_collection_end": later}, headers=admin
    )
    assert unconfirmed.status_code == 422
    confirmed = await client.put(
        f"{API}/admin/settings",
        json={"study_collection_end": later, "confirm_study_deletion": True},
        headers=admin,
    )
    assert confirmed.status_code == 200 and confirmed.json()["study_collection_end"] == later


async def test_the_collection_end_change_is_audited_with_old_and_new(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    later = (TODAY + timedelta(days=30)).isoformat()
    await client.put(
        f"{API}/admin/settings",
        json={"study_collection_end": later, "confirm_study_deletion": True},
        headers=admin,
    )
    logged = await session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "settings_change", AuditLog.entity_id == "admin")
        .order_by(AuditLog.occurred_at.desc())
    )
    assert logged and logged.detail["study_collection_end"] == {"old": None, "new": later}


# --- Also 2: allocation under concurrent enrolments ------------------------------------------


async def test_concurrent_enrolments_keep_the_allocation_blocks(
    client: AsyncClient, session: AsyncSession
) -> None:
    from app.services.allocation import cohort_for
    from app.services.settings import read_settings

    admin = await as_(client, "admin@vt.test")
    before = await session.scalar(
        select(func.count()).select_from(Participant).where(Participant.sex == "unspecified")
    )
    replies = await asyncio.gather(
        *(enrol(client, admin, f"P4{n:02d}", "unspecified") for n in range(8))
    )
    assert all(r.status_code == 201 for r in replies), [r.text for r in replies]
    seed = (await read_settings(session))["allocation_seed"]
    cohorts = [r.json()["cohort"] for r in replies]
    # Each stratum position is used once, so the cohorts are exactly the allocation's.
    expected = [cohort_for(seed, "unspecified", i) for i in range(before or 0, (before or 0) + 8)]
    assert sorted(cohorts) == sorted(expected)


# --- Also 3: the database holds the study locks ----------------------------------------------


async def test_the_database_keeps_cohort_study_link_and_seed(
    session: AsyncSession, owner_url: str
) -> None:
    from support import owner_execute

    for statement in (
        # P001 has tape readings, so its cohort is locked.
        "UPDATE participant SET cohort = 'test' WHERE participant_code = 'P001'",
        "UPDATE capture_session SET participant_id = NULL WHERE participant_id IS NOT NULL",
        "UPDATE capture_session SET set_no = 3 WHERE set_no = 1",
    ):
        try:
            await session.execute(text(statement))
            raise AssertionError(statement)
        except DBAPIError:
            await session.rollback()
    await owner_execute(
        owner_url,
        "INSERT INTO app_setting (key, value) VALUES ('allocation_seed', '7')"
        " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    for statement in (
        "UPDATE app_setting SET value = '8' WHERE key = 'allocation_seed'",
        "DELETE FROM app_setting WHERE key = 'allocation_seed'",
    ):
        try:
            await session.execute(text(statement))
            raise AssertionError(statement)
        except DBAPIError:
            await session.rollback()


# --- Also 6: a study upload in production waits for the approvals ----------------------------


async def test_a_study_upload_in_production_needs_the_approvals(
    production: AsyncClient,  # noqa: F811
    owner_url: str,
) -> None:
    from ingest_support import SEED, key, payload
    from test_ingest import STUDY, claimed

    participant = SEED["participants"][3]
    await claimed(owner_url, participant["client_code"])
    body = payload(code=participant["client_code"], version=60)
    body["consent"] = {
        "consent_version": "study-paper-1.0", "language": "en",
        "scope": ["study_paper", "measure"], "given_at": body["consent"]["given_at"],
    }  # fmt: skip
    body["session"]["study"] = {**STUDY, "participant_code": participant["participant_code"]}
    reply = await production.post(f"{API}/profiles", json=body, headers=key(body))
    assert reply.status_code == 409 and reply.json()["code"] == "approvals_missing", reply.text


# --- Also 8: carrying out a request keeps study sets (D44) -----------------------------------


async def test_honouring_a_request_keeps_the_study_capture_sets(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    p001 = await session.scalar(select(Participant).where(Participant.participant_code == "P001"))
    assert p001
    study_sets = (
        select(func.count())
        .select_from(MeasurementProfile)
        .join(CaptureSession, CaptureSession.session_id == MeasurementProfile.session_id)
        .where(CaptureSession.participant_id == p001.participant_id)
    )
    before = await session.scalar(study_sets)
    assert before and before > 0
    people = (await client.get(f"{API}/study/participants", headers=admin)).json()
    code = next(p["client_code"] for p in people if p["participant_code"] == "P001")
    asked = await client.post(
        f"{API}/deletion-requests", json={"client_code": code, "reason": "delete"}
    )
    assert asked.json()["status"] == "received", asked.text
    held = (await client.get(f"{API}/admin/deletion-requests", headers=admin)).json()
    request_id = next(r["request_id"] for r in held if r.get("client_code") == code)
    done = await client.post(f"{API}/admin/deletion-requests/{request_id}/honour", headers=admin)
    assert done.status_code == 200 and done.json()["status"] == "done", done.text
    session.expire_all()
    assert await session.scalar(study_sets) == before
    people = (await client.get(f"{API}/study/participants", headers=admin)).json()
    assert next(p for p in people if p["participant_code"] == "P001")["withdrawn"] is True
