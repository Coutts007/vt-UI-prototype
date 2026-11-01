"""Rules, deletion and access (backend-spec 8, 14.5, D10)."""

import uuid
from typing import Any

import pytest
from app.models import (
    AuditLog,
    CaptureSession,
    Client,
    Consent,
    DeletionRequest,
    MeasurementProfile,
)
from app.security.client_secret import hash_secret
from httpx import AsyncClient
from ingest_support import FREE_CODE, ROUTE, SECRET, SEED, key, payload, proof
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from test_authorisation import fits_contract

DELETE = "/api/v1/deletion-requests"
ACCESS = "/api/v1/data-requests/access"


async def test_current_rules(client: AsyncClient) -> None:
    reply = await client.get("/api/v1/rules/current")
    assert reply.status_code == 200
    fits_contract("RulesArtifact", reply.json())
    assert reply.json()["rules_version"] == "0.1-uncalibrated"
    assert reply.json()["girth_model"]["type"] == "ellipse_cf"


async def test_rules_by_version(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/rules/0.1-uncalibrated")).status_code == 200
    missing = await client.get("/api/v1/rules/9.9-none")
    assert missing.status_code == 404 and missing.json()["code"] == "rules_version_unknown"
    assert (await client.get("/api/v1/rules/..%2F..%2Fetc")).status_code in (404, 422)


async def stored(client: AsyncClient, version: int = 1) -> dict[str, Any]:
    body = payload(version=version)
    assert (await client.post(ROUTE, json=body, headers=key(body))).status_code == 201
    return body


def request(reason: str = "delete", code: str = FREE_CODE) -> dict[str, Any]:
    return {"client_code": code, "reason": reason}


async def claim(session: AsyncSession, code: str) -> None:
    """Seed clients come unclaimed, as a client would after a tailor's reset."""
    await session.execute(
        update(Client)
        .where(Client.client_code == code)
        .values(secret_hash=hash_secret(SECRET), claimed_over_data=True)
    )
    await session.commit()


async def test_deletion_removes_every_unreferenced_profile_and_clears_details(
    client: AsyncClient, session: AsyncSession
) -> None:
    first = await stored(client)
    second = await stored(client, 2)
    await claim(session, FREE_CODE)
    reply = await client.post(DELETE, json=request(), headers=proof())
    assert reply.status_code == 202
    fits_contract("DeletionRequestReceipt", reply.json())
    assert reply.json()["status"] == "done" and "30 days" in reply.json()["note"]
    for body in (first, second):
        assert not await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))
        assert not await session.get(CaptureSession, uuid.UUID(body["session"]["session_id"]))
    row = await session.scalar(select(Client).where(Client.client_code == FREE_CODE))
    assert row and row.display_name is None and row.height_mm is None
    request_row = await session.get(DeletionRequest, uuid.UUID(reply.json()["request_id"]))
    assert request_row and request_row.status == "done" and request_row.completed_at
    assert FREE_CODE not in request_row.client_code_hash


async def test_deletion_writes_a_system_audit_row_without_the_code(
    client: AsyncClient, session: AsyncSession
) -> None:
    await stored(client)
    reply = await client.post(DELETE, json=request(), headers=proof())
    rows = list(
        await session.scalars(
            select(AuditLog).where(AuditLog.entity_id == reply.json()["request_id"])
        )
    )
    assert [(r.action, r.actor_type) for r in rows] == [("deletion_request", "system")]
    assert FREE_CODE not in str(rows[0].detail)


async def test_profiles_on_an_order_stay_until_collected_plus_30_days(
    client: AsyncClient, session: AsyncSession
) -> None:
    order = SEED["orders"][0]
    profile = next(p for p in SEED["profiles"] if p["profile_id"] == order["profile_id"])
    await claim(session, profile["client_code"])
    reply = await client.post(DELETE, json=request(code=profile["client_code"]), headers=proof())
    assert reply.status_code == 202 and reply.json()["status"] == "partially_done"
    assert await session.get(MeasurementProfile, uuid.UUID(profile["profile_id"]))
    session.expire_all()
    row = await session.scalar(select(Client).where(Client.client_code == profile["client_code"]))
    assert row and row.display_name is None and row.height_mm is None


async def test_withdrawal_sets_withdrawn_and_stops_new_profiles(
    client: AsyncClient, session: AsyncSession
) -> None:
    await stored(client)
    reply = await client.post(DELETE, json=request("withdraw_consent"), headers=proof())
    assert reply.status_code == 202
    consents = list(
        await session.scalars(
            select(Consent)
            .join(Client, Client.client_id == Consent.client_id)
            .where(Client.client_code == FREE_CODE)
        )
    )
    assert consents and all(c.withdrawn_at for c in consents)
    again = payload(version=2)
    refused = await client.post(ROUTE, json=again, headers=key(again))
    assert refused.json()["code"] == "consent_missing"


async def test_access_returns_the_clients_data(client: AsyncClient, session: AsyncSession) -> None:
    body = await stored(client)
    reply = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof())
    assert reply.status_code == 200, reply.text
    fits_contract("ClientDataExport", reply.json())
    data = reply.json()
    assert data["client_code"] == FREE_CODE and data["order_count"] == 0
    assert [p["profile_id"] for p in data["profiles"]] == [body["profile_id"]]
    assert len(data["profiles"][0]["measurements"]) == 9 and data["consents"]
    rows = list(await session.scalars(select(AuditLog).where(AuditLog.action == "access_request")))
    assert len(rows) == 1 and rows[0].actor_type == "client"


async def test_access_has_no_tailor_notes(client: AsyncClient, session: AsyncSession) -> None:
    order = next(o for o in SEED["orders"])
    profile = next(p for p in SEED["profiles"] if p["profile_id"] == order["profile_id"])
    await claim(session, profile["client_code"])
    reply = await client.post(ACCESS, json={"client_code": profile["client_code"]}, headers=proof())
    assert reply.status_code == 200 and "notes" not in reply.text
    assert reply.json()["order_count"] >= 1


@pytest.mark.parametrize(("route", "limit"), [(DELETE, 5), (ACCESS, 5)])
async def test_data_requests_are_limited(client: AsyncClient, route: str, limit: int) -> None:
    body: dict[str, Any] = {"client_code": "ZZ9999"}
    if route == DELETE:
        body["reason"] = "delete"
    for _ in range(limit):
        assert (await client.post(route, json=body)).status_code == 403
    reply = await client.post(route, json=body)
    assert reply.status_code == 429 and "retry-after" in reply.headers


async def test_ingest_limit_by_code(client: AsyncClient) -> None:
    for i in range(10):
        body = payload(version=i + 1)
        assert (await client.post(ROUTE, json=body, headers=key(body))).status_code == 201
    body = payload(version=11)
    assert (await client.post(ROUTE, json=body, headers=key(body))).status_code == 429


async def test_ingest_limit_by_address(client: AsyncClient) -> None:
    codes = [c["client_code"] for c in SEED["clients"]]
    sent = 0
    for code in codes:
        for i in range(10):
            if sent == 30:
                break
            body = payload(code=code, version=100 + i)
            reply = await client.post(ROUTE, json=body, headers=key(body))
            assert reply.status_code != 429, sent
            sent += 1
    body = payload(code=codes[-1], version=500)
    assert (await client.post(ROUTE, json=body, headers=key(body))).status_code == 429


def test_seed_profiles_derive_to_their_stored_values() -> None:
    """The release-blocking metric on the seed: mismatch rate 0 (9.5)."""
    from app.services.profile_checks import rederive_checks
    from app.services.rules import load_rules

    rules = load_rules()
    found = []
    for profile in SEED["profiles"]:
        found += rederive_checks(profile, rules[profile["rules_version"]])
    assert found == [] and len(SEED["profiles"]) >= 10
