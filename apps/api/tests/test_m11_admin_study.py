"""M11: admin accounts and settings, the A9 guard, enrolment, blind readings, held deletions."""

import csv
import io
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from app.config import Settings
from app.main import create_app
from app.models import (
    AuditLog,
    Client,
    MeasurementProfile,
    Participant,
    ReferenceMeasurement,
    UserAccount,
)
from app.services.allocation import cohort_for
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

API = "/api/v1"
VALUES = {
    "stature": 1700, "shoulder": 450, "chest": 900, "waist": 800, "hip": 950,
    "sleeve": 600, "outleg": 1050, "inleg": 780, "neck": 380,
}  # fmt: skip
FILLED = {
    "ierc_ref": "MKU/IERC/0001",
    "nacosti_licence_no": "NACOSTI/P/00/0000",
    "approvals_confirmed_by": "Admin",
    "confirmed_at": "2026-11-01T08:00:00Z",
    "odpc_response_on": None,
    "odpc_response_ref": None,
}


async def as_(client: AsyncClient, email: str) -> dict[str, str]:
    return bearer(await sign_in(client, email))


def reading(code: str, number: int = 1) -> dict[str, Any]:
    return {
        "participant_code": code,
        "reading_no": number,
        "values": VALUES,
        "taken_at": "2026-11-01T09:00:00Z",
    }


# --- The A9 approvals guard, in production ---------------------------------------------------


@pytest.fixture
async def production(settings: Settings, app: FastAPI) -> AsyncIterator[AsyncClient]:
    """The same database as `app` (seed loaded), with the API in production mode."""
    live = settings.model_copy(
        update={
            "env": "production",
            "jwt_secret": "p" * 40,
            "signed_url_secret": "s" * 40,
            "ip_pepper": "production-pepper",
            "vt_app_db_password": "not-the-default",
            "vt_retention_db_password": "not-the-default-either",
        }
    )
    application = create_app(live)
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as http:
        yield http
    await application.state.engine.dispose()


async def set_approvals(client: AsyncClient, headers: dict[str, str], **values: Any) -> None:
    reply = await client.put(
        f"{API}/admin/settings", json={"approvals": {**FILLED, **values}}, headers=headers
    )
    assert reply.status_code == 200, reply.text


async def test_production_refuses_study_writes_until_the_approvals_exist(
    production: AsyncClient,
) -> None:
    admin = await as_(production, "admin@vt.test")
    enrol = await production.post(
        f"{API}/study/participants",
        json={"participant_code": "P050", "sex": "female", "age_band": "25-34", "venue": "V"},
        headers=admin,
    )
    assert enrol.status_code == 409
    assert enrol.json()["code"] == "approvals_missing"
    measurer = await as_(production, "measurer-b@vt.test")
    tape = await production.post(
        f"{API}/study/reference-readings", json=reading("P004"), headers=measurer
    )
    assert tape.status_code == 409
    assert tape.json()["code"] == "approvals_missing"
    shown = (await production.get(f"{API}/admin/settings", headers=admin)).json()
    assert set(shown["approvals_missing"]) == {
        "ierc_ref", "nacosti_licence_no", "dpia_submitted_on", "approvals_confirmed_by",
        "confirmed_at",
    }  # fmt: skip


async def test_production_waits_60_days_after_the_dpia(production: AsyncClient) -> None:
    admin = await as_(production, "admin@vt.test")
    recent = (date.today() - timedelta(days=10)).isoformat()
    await set_approvals(production, admin, dpia_submitted_on=recent)
    shown = (await production.get(f"{API}/admin/settings", headers=admin)).json()
    assert shown["approvals_missing"] == []
    assert shown["earliest_collection_date"] == (date.today() + timedelta(days=50)).isoformat()
    body = {"participant_code": "P051", "sex": "male", "age_band": "18-24", "venue": "V"}
    early = await production.post(f"{API}/study/participants", json=body, headers=admin)
    assert early.json()["code"] == "approvals_missing"
    # The ODPC answered early, so collection may start (A9).
    await set_approvals(
        production, admin, dpia_submitted_on=recent,
        odpc_response_on=date.today().isoformat(), odpc_response_ref="ODPC/1",
    )  # fmt: skip
    allowed = await production.post(f"{API}/study/participants", json=body, headers=admin)
    assert allowed.status_code == 201, allowed.text


async def test_production_allows_study_writes_once_everything_is_in(
    production: AsyncClient,
) -> None:
    admin = await as_(production, "admin@vt.test")
    await set_approvals(
        production, admin, dpia_submitted_on=(date.today() - timedelta(days=61)).isoformat()
    )
    measurer = await as_(production, "measurer-b@vt.test")
    tape = await production.post(
        f"{API}/study/reference-readings", json=reading("P004"), headers=measurer
    )
    assert tape.status_code == 201, tape.text


async def test_staging_holds_synthetic_data_without_the_guard(client: AsyncClient) -> None:
    admin = await as_(client, "admin@vt.test")
    reply = await client.post(
        f"{API}/study/participants",
        json={"participant_code": "P060", "sex": "female", "age_band": "35-44", "venue": "V"},
        headers=admin,
    )
    assert reply.status_code == 201


# --- Enrolment and cohorts -------------------------------------------------------------------


async def test_enrolment_allocates_from_the_seed_and_logs_it(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    await client.put(f"{API}/admin/settings", json={"study_mode": True}, headers=admin)
    women_before = await session.scalar(
        select(func.count()).select_from(Participant).where(Participant.sex == "female")
    )
    reply = await client.post(
        f"{API}/study/participants",
        json={"participant_code": "P070", "sex": "female", "age_band": "25-34", "venue": "Hall"},
        headers=admin,
    )
    assert reply.status_code == 201, reply.text
    body = reply.json()
    row = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "participant_create", AuditLog.entity_id == body["participant_id"]
        )
    )
    assert row is not None
    seed = row.detail["allocation_seed"]
    assert body["cohort"] == cohort_for(seed, "female", women_before or 0)
    assert body["withdrawn"] is False and body["sets_captured"] == 0
    # A new pseudonymous code, with no name, phone or height (Regulation 33).
    created = await session.scalar(select(Client).where(Client.client_code == body["client_code"]))
    assert created and created.display_name is None and created.height_mm is None
    # The seed is drawn once and reused.
    again = await client.post(
        f"{API}/study/participants",
        json={"participant_code": "P071", "sex": "male", "age_band": "25-34", "venue": "Hall"},
        headers=admin,
    )
    later = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "participant_create",
            AuditLog.entity_id == again.json()["participant_id"],
        )
    )
    assert later and later.detail["allocation_seed"] == seed


async def test_a_taken_code_and_study_mode_off_are_refused(client: AsyncClient) -> None:
    admin = await as_(client, "admin@vt.test")
    body = {"participant_code": "P001", "sex": "male", "age_band": "25-34", "venue": "V"}
    taken = await client.post(f"{API}/study/participants", json=body, headers=admin)
    assert taken.status_code == 422
    await client.put(f"{API}/admin/settings", json={"study_mode": False}, headers=admin)
    off = await client.post(
        f"{API}/study/participants", json={**body, "participant_code": "P099"}, headers=admin
    )
    assert off.status_code == 409 and off.json()["code"] == "study_mode_off"


async def test_the_cohort_locks_once_readings_exist(client: AsyncClient) -> None:
    admin = await as_(client, "admin@vt.test")
    listed = (await client.get(f"{API}/study/participants", headers=admin)).json()
    p001 = next(p for p in listed if p["participant_code"] == "P001")
    p005 = next(p for p in listed if p["participant_code"] == "P005")
    locked = await client.patch(
        f"{API}/study/participants/{p001['participant_id']}", json={"cohort": "test"},
        headers=admin,
    )  # fmt: skip
    assert locked.status_code == 409 and locked.json()["code"] == "cohort_locked"
    moved = await client.patch(
        f"{API}/study/participants/{p005['participant_id']}", json={"cohort": "pilot"},
        headers=admin,
    )  # fmt: skip
    assert moved.status_code == 200 and moved.json()["cohort"] == "pilot"


# --- Blind tape readings ---------------------------------------------------------------------


async def test_readings_lock_and_flag_reading_two_first(client: AsyncClient) -> None:
    measurer = await as_(client, "measurer-b@vt.test")
    second = await client.post(
        f"{API}/study/reference-readings", json=reading("P004", 2), headers=measurer
    )
    assert second.status_code == 201
    assert second.json() == {
        "participant_code": "P004", "reading_no": 2, "measurer_code": "B", "out_of_order": True,
    }  # fmt: skip
    again = await client.post(
        f"{API}/study/reference-readings", json=reading("P004", 2), headers=measurer
    )
    assert again.status_code == 409 and again.json()["code"] == "reading_locked"
    first = await client.post(
        f"{API}/study/reference-readings", json=reading("P004", 1), headers=measurer
    )
    assert first.json()["out_of_order"] is False


async def test_a_measurer_sees_only_their_own_readings_and_no_system_values(
    client: AsyncClient,
) -> None:
    b = await as_(client, "measurer-b@vt.test")
    # P001 holds both measurers' readings and a system capture set.
    mine = (
        await client.get(
            f"{API}/study/reference-readings/mine", params={"participant_code": "P001"}, headers=b
        )
    ).json()
    assert len(mine) == 18
    assert {tuple(sorted(row)) for row in mine} == {
        ("participant_code", "reading_no", "site_code", "taken_at", "value_mm")
    }
    unknown = await client.get(
        f"{API}/study/reference-readings/mine", params={"participant_code": "P404"}, headers=b
    )
    assert unknown.json() == []
    bad = await client.get(
        f"{API}/study/reference-readings/mine", params={"participant_code": "x"}, headers=b
    )
    assert bad.status_code == 422


async def test_readings_cannot_change_in_the_database(session: AsyncSession) -> None:
    for statement in (
        "UPDATE reference_measurement SET value_mm = value_mm + 1",
        "DELETE FROM reference_measurement",
    ):
        with pytest.raises(DBAPIError):
            await session.execute(text(statement))
        await session.rollback()


async def test_a_withdrawn_participant_gets_no_new_readings(
    client: AsyncClient, session: AsyncSession
) -> None:
    from app.models import Consent

    participant = await session.scalar(
        select(Participant).where(Participant.participant_code == "P004")
    )
    assert participant
    session.add(
        Consent(
            client_id=participant.client_id,
            consent_version="1.0",
            language="en",
            scope=["measure"],
            given_at=datetime(2026, 10, 1, tzinfo=UTC),
            withdrawn_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
    )
    await session.commit()
    measurer = await as_(client, "measurer-b@vt.test")
    reply = await client.post(
        f"{API}/study/reference-readings", json=reading("P004"), headers=measurer
    )
    assert reply.status_code == 422 and reply.json()["code"] == "consent_missing"
    stored = await session.scalar(
        select(func.count())
        .select_from(ReferenceMeasurement)
        .where(ReferenceMeasurement.participant_id == participant.participant_id)
    )
    assert stored == 0


# --- Accounts ---------------------------------------------------------------------------------


async def test_approve_disable_and_enable_an_account(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    pending = (
        await client.get(f"{API}/admin/accounts", params={"status": "pending"}, headers=admin)
    ).json()
    target = next(a for a in pending["items"] if a["email"] == "pending@vt.test")
    assert target["business_name"]
    approved = await client.post(f"{API}/admin/accounts/{target['user_id']}/approve", headers=admin)
    assert approved.status_code == 200 and approved.json()["status"] == "active"
    token = await sign_in(client, "pending@vt.test")
    assert (await client.get(f"{API}/me", headers=bearer(token))).status_code == 200
    await client.post(f"{API}/admin/accounts/{target['user_id']}/disable", headers=admin)
    # The token it held stops at once.
    assert (await client.get(f"{API}/me", headers=bearer(token))).status_code == 401
    back = await client.post(f"{API}/admin/accounts/{target['user_id']}/enable", headers=admin)
    assert back.json()["status"] == "active"
    actions = list(
        await session.scalars(
            select(AuditLog.action).where(AuditLog.entity_id == target["user_id"])
        )
    )
    assert {"approve", "account_disable", "account_enable"} <= set(actions)


async def test_reject_keeps_no_reason_text_and_an_admin_cannot_lock_themself_out(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    pending = (
        await client.get(f"{API}/admin/accounts", params={"status": "pending"}, headers=admin)
    ).json()["items"][0]
    reply = await client.post(
        f"{API}/admin/accounts/{pending['user_id']}/reject",
        json={"reason": "Duplicate shop, call Mary on 0712345678"},
        headers=admin,
    )
    assert reply.json()["status"] == "rejected"
    row = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "account_reject", AuditLog.entity_id == pending["user_id"]
        )
    )
    assert row and "0712345678" not in str(row.detail)
    me = await session.scalar(select(UserAccount).where(UserAccount.email == "admin@vt.test"))
    assert me
    own = await client.post(f"{API}/admin/accounts/{me.user_id}/disable", headers=admin)
    assert own.status_code == 403


async def test_an_admin_creates_a_measurer_who_can_sign_in(client: AsyncClient) -> None:
    admin = await as_(client, "admin@vt.test")
    body = {
        "email": "measurer-c@vt.test", "password": "long-enough-pass",
        "measurer_code": "C", "trained_on": "2026-10-20",
    }  # fmt: skip
    made = await client.post(f"{API}/admin/measurers", json=body, headers=admin)
    assert made.status_code == 201 and made.json()["measurer_code"] == "C"
    await sign_in(client, "measurer-c@vt.test", "long-enough-pass")
    clash = await client.post(
        f"{API}/admin/measurers", json={**body, "email": "other@vt.test"}, headers=admin
    )
    assert clash.status_code == 422


# --- Settings and the audit export ------------------------------------------------------------


async def test_settings_change_is_audited_and_rules_must_exist(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    saved = await client.put(f"{API}/admin/settings", json={"retention_months": 36}, headers=admin)
    assert saved.json()["retention_months"] == 36
    unknown = await client.put(
        f"{API}/admin/settings", json={"current_rules_version": "9.9-nothing"}, headers=admin
    )
    assert unknown.status_code == 422
    row = await session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "settings_change")
        .order_by(AuditLog.log_id.desc())
    )
    assert row and row.detail == {"changed": ["retention_months"]}


async def test_the_audit_csv_is_audited_and_quotes_formulas(
    client: AsyncClient, session: AsyncSession
) -> None:
    admin = await as_(client, "admin@vt.test")
    session.add(AuditLog(actor_type="system", action="export", entity_type="x", entity_id="=1+1"))
    await session.commit()
    reply = await client.get(f"{API}/admin/audit.csv", headers=admin)
    assert reply.status_code == 200 and reply.headers["cache-control"] == "no-store"
    rows = list(csv.DictReader(io.StringIO(reply.text)))
    assert any(row["entity_id"] == "'=1+1" for row in rows)
    logged = await session.scalar(
        select(AuditLog).where(AuditLog.action == "export", AuditLog.entity_id == "audit.csv")
    )
    assert logged is not None


# --- Held deletions ---------------------------------------------------------------------------


async def test_an_admin_honours_a_held_deletion_on_every_round(
    client: AsyncClient, session: AsyncSession
) -> None:
    tailor = await as_(client, "wanjiru@vt.test")
    admin = await as_(client, "admin@vt.test")
    listed = (await client.get(f"{API}/clients", headers=tailor)).json()["items"]
    target = next(c for c in listed if c["client_code"] == "AB1001")
    freed = await client.post(f"{API}/clients/{target['client_id']}/claim/free", headers=tailor)
    assert freed.status_code == 200
    held = await client.post(
        f"{API}/deletion-requests", json={"client_code": "AB1001", "reason": "delete"}
    )
    assert held.status_code == 202 and held.json()["status"] == "received"
    queue = (await client.get(f"{API}/admin/deletion-requests", headers=admin)).json()
    row = next(r for r in queue if r["request_id"] == held.json()["request_id"])
    assert row["client_code"] == "AB1001"
    done = await client.post(
        f"{API}/admin/deletion-requests/{row['request_id']}/honour", headers=admin
    )
    assert done.status_code == 200, done.text
    client_row = await session.scalar(select(Client).where(Client.client_code == "AB1001"))
    assert client_row and client_row.display_name is None and client_row.height_mm is None
    kept = list(
        await session.scalars(
            select(MeasurementProfile.profile_id).where(
                MeasurementProfile.client_id == client_row.client_id
            )
        )
    )
    # Only profiles an order uses remain, and only then is the request partly done.
    assert done.json()["status"] == ("partially_done" if kept else "done")
    again = await client.post(
        f"{API}/admin/deletion-requests/{row['request_id']}/honour", headers=admin
    )
    assert again.status_code in (200, 403)
    logged = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "deletion", AuditLog.entity_id == row["request_id"]
        )
    )
    assert logged and logged.detail["all_rounds"] is True


# --- Study capture with paper consent (frontend-spec 15.1) ----------------------------------


async def test_a_study_set_with_paper_consent_is_stored(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    from app.models import CaptureSession, Consent
    from ingest_support import SEED, key, payload
    from test_ingest import STUDY, claimed

    participant = SEED["participants"][3]
    code = participant["client_code"]
    await claimed(owner_url, code)
    body = payload(code=code, version=50)
    body["consent"] = {
        "consent_version": "study-paper-1.0",
        "language": "en",
        "scope": ["study_paper", "measure"],
        "given_at": body["consent"]["given_at"],
    }
    body["session"]["study"] = {
        **STUDY, "participant_code": participant["participant_code"], "lux": 240,
    }  # fmt: skip
    reply = await client.post(f"{API}/profiles", json=body, headers=key(body))
    assert reply.status_code == 201, reply.text
    stored = await session.get(CaptureSession, uuid.UUID(body["session"]["session_id"]))
    assert stored and stored.lux == 240
    consent = await session.scalar(
        select(Consent).where(Consent.consent_version == "study-paper-1.0")
    )
    assert consent and consent.source == "study_paper"


async def test_paper_consent_outside_the_study_is_refused(
    client: AsyncClient, owner_url: str
) -> None:
    from ingest_support import key, payload

    body = payload()
    body["consent"] = {
        "consent_version": "study-paper-1.0",
        "language": "en",
        "scope": ["study_paper", "measure"],
        "given_at": body["consent"]["given_at"],
    }
    reply = await client.post(f"{API}/profiles", json=body, headers=key(body))
    assert reply.status_code == 422 and reply.json()["code"] == "consent_missing"
