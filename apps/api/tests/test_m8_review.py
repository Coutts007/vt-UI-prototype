"""Regressions for the M8 review: each failed before its fix (D45, D42, D46)."""

import hashlib
import json
import time
import uuid
from typing import Any

import pytest
import structlog.testing
from app.models import (
    AuditLog,
    CaptureSession,
    Client,
    Consent,
    DeletedProfile,
    MeasurementProfile,
    RulesVersion,
    ServerCheck,
)
from app.privacy import has_image_content
from httpx import AsyncClient
from ingest_support import FREE_CODE, OTHER_SECRET, ROUTE, SECRET, key, payload, proof
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from support import owner_execute

ACCESS = "/api/v1/data-requests/access"
DELETE = "/api/v1/deletion-requests"
REFUSED = "client_secret_refused"


async def post(client: AsyncClient, body: dict[str, Any], secret: str = SECRET) -> Any:
    return await client.post(ROUTE, json=body, headers=key(body, secret))


async def count(session: AsyncSession, model: Any) -> int:
    return await session.scalar(select(func.count()).select_from(model)) or 0


# --- Item 1: the secret guards reading and deleting ---


async def test_the_first_accepted_upload_claims_the_code_with_a_hash_only(
    client: AsyncClient, session: AsyncSession
) -> None:
    assert (await post(client, payload())).status_code == 201
    row = await session.scalar(select(Client).where(Client.client_code == FREE_CODE))
    assert row and row.secret_hash == hashlib.sha256(SECRET.encode()).hexdigest()


async def test_a_refused_upload_does_not_claim(client: AsyncClient, session: AsyncSession) -> None:
    body = payload()
    body["consent"]["scope"] = []
    assert (await post(client, body)).json()["code"] == "consent_missing"
    row = await session.scalar(select(Client).where(Client.client_code == FREE_CODE))
    assert row and row.secret_hash is None


@pytest.mark.parametrize("wrong", [OTHER_SECRET, "short", "AB" * 32, None])
async def test_a_forged_upload_leaves_no_row(
    client: AsyncClient, session: AsyncSession, wrong: str | None
) -> None:
    assert (await post(client, payload())).status_code == 201
    before = [
        await count(session, m)
        for m in (MeasurementProfile, CaptureSession, Consent, AuditLog, ServerCheck)
    ]
    body = payload(version=2)
    headers = {
        "Idempotency-Key": body["profile_id"],
        **({"X-Client-Secret": wrong} if wrong else {}),
    }
    reply = await client.post(ROUTE, json=body, headers=headers)
    assert reply.status_code == 403 and reply.json()["code"] == REFUSED
    after = [
        await count(session, m)
        for m in (MeasurementProfile, CaptureSession, Consent, AuditLog, ServerCheck)
    ]
    assert after == before


async def test_an_upload_with_no_secret_cannot_claim(client: AsyncClient) -> None:
    body = payload()
    reply = await client.post(ROUTE, json=body, headers={"Idempotency-Key": body["profile_id"]})
    assert reply.status_code == 403 and reply.json()["code"] == REFUSED


@pytest.mark.parametrize("route", [ACCESS, DELETE])
async def test_a_forger_cannot_read_or_delete(
    client: AsyncClient, session: AsyncSession, route: str
) -> None:
    victim = payload()
    assert (await post(client, victim)).status_code == 201
    extra = {"reason": "delete"} if route == DELETE else {}
    reply = await client.post(
        route, json={"client_code": FREE_CODE, **extra}, headers=proof(OTHER_SECRET)
    )
    assert reply.status_code == 403
    assert await session.get(MeasurementProfile, uuid.UUID(victim["profile_id"]))


@pytest.mark.parametrize("route", [ACCESS, DELETE])
async def test_refusal_is_identical_whether_or_not_the_code_exists(
    client: AsyncClient, route: str
) -> None:
    await post(client, payload())
    extra = {"reason": "delete"} if route == DELETE else {}
    replies = [
        await client.post(
            route, json={"client_code": FREE_CODE, **extra}, headers=proof(OTHER_SECRET)
        ),
        await client.post(route, json={"client_code": FREE_CODE, **extra}),
        await client.post(route, json={"client_code": "ZZ9999", **extra}, headers=proof()),
    ]
    if route == ACCESS:
        # A deletion on an unclaimed code that holds data goes to its tailor instead (D45).
        replies.append(
            await client.post(route, json={"client_code": "AB1002", **extra}, headers=proof())
        )
    assert {r.status_code for r in replies} == {403}
    assert len({r.content for r in replies}) == 1, "unknown, unclaimed and wrong must look the same"


async def test_a_caller_chosen_profile_id_is_no_longer_accepted(client: AsyncClient) -> None:
    body = payload()
    await post(client, body)
    reply = await client.post(
        ACCESS,
        json={"client_code": FREE_CODE, "profile_ids": [body["profile_id"]]},
        headers=proof(),
    )
    assert reply.status_code == 422


async def test_the_owner_can_read_and_delete_with_the_secret(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    await post(client, body)
    reply = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof())
    assert reply.status_code == 200 and len(reply.json()["profiles"]) == 1
    reply = await client.post(
        DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof()
    )
    assert reply.status_code == 202
    assert not await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))


async def test_the_secret_survives_deletion_so_the_phone_can_measure_again(
    client: AsyncClient,
) -> None:
    await post(client, payload())
    await client.post(DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof())
    assert (await post(client, payload())).status_code == 201
    assert (await post(client, payload(version=2), OTHER_SECRET)).status_code == 403


async def test_the_secret_is_nowhere_stored_or_logged(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    body = payload()
    with structlog.testing.capture_logs() as logs:
        await post(client, body)
        export = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof())
        withdraw = {"client_code": FREE_CODE, "reason": "withdraw_consent"}
        await client.post(DELETE, json=withdraw, headers=proof())
    assert SECRET not in str(logs) and SECRET not in export.text
    row = await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))
    assert row is None
    digest = hashlib.sha256(SECRET.encode()).hexdigest()
    await owner_execute(
        owner_url, f"UPDATE client SET secret_hash='{digest}' WHERE client_code='AB1007'"
    )
    keep = payload(code="AB1007")
    await post(client, keep)
    stored = await session.get(MeasurementProfile, uuid.UUID(keep["profile_id"]))
    assert stored
    expected = hashlib.sha256(
        json.dumps(keep, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    assert stored.payload_sha256 == expected, "the hash covers the body alone"
    audit = await session.scalars(select(AuditLog.detail))
    assert SECRET not in str(list(audit))


# --- Item 4: nobody else can poison the version ---


async def test_a_forged_high_version_cannot_block_the_owner(client: AsyncClient) -> None:
    assert (await post(client, payload())).status_code == 201
    assert (await post(client, payload(version=100000), OTHER_SECRET)).status_code == 403
    assert (await post(client, payload(version=2))).status_code == 201


# --- Item 5: refused uploads do not use up the code's allowance ---


async def test_forged_uploads_do_not_lock_out_the_owner(client: AsyncClient) -> None:
    await post(client, payload())
    for _ in range(12):
        assert (await post(client, payload(version=5), OTHER_SECRET)).status_code == 403
    assert (await post(client, payload(version=2))).status_code == 201


# --- Item 2: replay and the app version ---


OLD_APP = """INSERT INTO app_setting (key, value) VALUES ('min_app_version', '"9.0.0"')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"""


async def test_a_replay_still_answers_after_the_minimum_version_rises(
    client: AsyncClient, owner_url: str
) -> None:
    body = payload()
    first = await post(client, body)
    await owner_execute(owner_url, OLD_APP)
    second = await post(client, body)
    assert second.status_code == 201 and second.json() == first.json()


async def test_an_updated_app_can_send_a_profile_captured_on_the_old_one(
    client: AsyncClient, owner_url: str
) -> None:
    await owner_execute(owner_url, OLD_APP)
    body = payload()
    old = await client.post(ROUTE, json=body, headers={**key(body), "X-App-Version": "8.9.0"})
    assert old.json()["code"] == "stale_app_version"
    new = await client.post(ROUTE, json=body, headers={**key(body), "X-App-Version": "9.0.0"})
    assert new.status_code == 201


# --- Item 6: only a person on the tailor's side may override ---


async def test_the_public_route_refuses_an_override(client: AsyncClient) -> None:
    body = payload()
    body["measurements"][0]["method"] = "override"
    reply = await post(client, body)
    assert reply.status_code == 422 and reply.json()["code"] == "validation_failed"


# --- Item 7: the guard's cost grows with the body, not its square ---


def test_the_guard_is_fast_on_its_worst_case() -> None:
    near_miss = ("A" * 1024 + ".") + "A" * 1023
    choppy = "A." * 1024
    body = json.dumps({"x": [near_miss] * 60 + [choppy] * 60}).encode()
    assert len(body) < 256 * 1024
    started = time.perf_counter()
    assert has_image_content(body) is False
    assert time.perf_counter() - started < 0.05


# --- Item 8: disguised prefixes and fine silhouette numbers ---


@pytest.mark.parametrize(
    "text_",
    [
        "​data:image/png;base64,AAAA",
        "﻿data:image/png;base64,AAAA",
        "­data:image/png;base64,AAAA",
        "ｄata:image/png;base64,AAAA",
        "%64ata:image/png;base64,AAAA",
        "%2564ata:image/png;base64,AAAA",
        "d‍ata:image/png;base64,AAAA",
    ],
)
async def test_a_disguised_data_prefix_is_refused(client: AsyncClient, text_: str) -> None:
    body = payload()
    body["session"]["device_model"] = text_
    assert (await post(client, body)).json()["code"] == "image_content_rejected"


async def test_an_ordinary_device_name_passes(client: AsyncClient) -> None:
    body = payload()
    body["session"]["device_model"] = "Tecno Spark 100% data"
    assert (await post(client, body)).status_code == 201


@pytest.mark.parametrize(
    ("view", "field"),
    [
        ("silhouette_front", "half_width_mm"),
        ("silhouette_side", "half_depth_mm"),
        ("silhouette_side", "anterior_mm"),
    ],
)
async def test_silhouette_values_finer_than_a_tenth_are_refused(
    client: AsyncClient, view: str, field: str
) -> None:
    body = payload()
    row = body[view][field]
    index = next(i for i, value in enumerate(row) if value is not None)
    row[index] = 100.123
    assert (await post(client, body)).json()["code"] == "validation_failed"


# --- Item 9: deleted stays deleted ---


async def test_a_deleted_profile_cannot_come_back_through_replay(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    await post(client, body)
    await client.post(DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof())
    assert await session.get(DeletedProfile, uuid.UUID(body["profile_id"]))
    reply = await post(client, body)
    assert reply.status_code == 410 and reply.json()["code"] == "profile_deleted"
    session.expire_all()
    assert not await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))


# --- Item 10 ---


async def test_a_lost_connection_is_not_blamed_on_the_payload(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {"n": 0}
    real = AsyncSession.flush

    async def lost(self: AsyncSession, *args: Any, **kwargs: Any) -> None:
        calls["n"] += 1
        raise DBAPIError("INSERT", {}, ConnectionError("gone"), connection_invalidated=True)

    monkeypatch.setattr(AsyncSession, "flush", lost)
    reply = await post(client, payload())
    monkeypatch.setattr(AsyncSession, "flush", real)
    assert calls["n"] and reply.status_code == 500


async def test_a_number_the_column_cannot_hold_is_still_a_422(client: AsyncClient) -> None:
    body = payload()
    body["measurements"][0]["correction_factor"] = 10
    assert (await post(client, body)).status_code == 422


async def test_a_rederivation_failure_keeps_the_other_checks_and_records_itself(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.profile_checks as checks

    def explode(*_: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(checks, "derive", explode)
    body = payload()
    next(m for m in body["measurements"] if m["site_code"] == "chest")["value_mm"] = 2500
    reply = await post(client, body)
    kinds = [c["kind"] for c in reply.json()["server_checks"]]
    assert "rederive_failed" in kinds and "unusual_proportion" in kinds


async def test_newer_known_rules_are_not_stale(client: AsyncClient, session: AsyncSession) -> None:
    for version in ("0.0-older", "0.2-newer"):
        session.add(RulesVersion(rules_version=version, status="frozen", artifact={}, checksum="x"))
    await session.commit()
    older = await post(client, payload(rules_version="0.0-older"))
    assert "stale_rules" in [c["kind"] for c in older.json()["server_checks"]]
    newer = await post(client, payload(version=2, rules_version="0.2-newer"))
    assert "stale_rules" not in [c["kind"] for c in newer.json()["server_checks"]]


async def test_public_rules_serve_frozen_and_the_current_draft_only(
    client: AsyncClient, session: AsyncSession
) -> None:
    base = {"checksum": "sha256:" + "0" * 64}
    for version, status in (("0.2-draft", "draft"), ("0.3-frozen", "frozen")):
        artifact = {"rules_version": version, "status": status, **base}
        session.add(
            RulesVersion(rules_version=version, status=status, checksum="x", artifact=artifact)
        )
    await session.commit()
    assert (await client.get("/api/v1/rules/0.2-draft")).status_code == 404
    assert (await client.get("/api/v1/rules/0.3-frozen")).status_code == 200
    current = await client.get("/api/v1/rules/0.1-uncalibrated")
    assert current.status_code == 200 and current.json()["status"] == "draft"


# --- Also found by the review's proof tests ---


async def test_a_lone_surrogate_is_a_422_not_a_crash(client: AsyncClient) -> None:
    body = payload()
    body["session"]["device_model"] = "\ud800x"
    reply = await client.post(
        ROUTE, content=json.dumps(body), headers={**key(body), "Content-Type": "application/json"}
    )
    assert reply.status_code == 422


@pytest.mark.parametrize(
    ("place", "value"),
    [("started_at", "0001-01-01T00:00:00+14:00"), ("given_at", "9999-12-31T23:59:59-14:00")],
)
async def test_an_absurd_date_is_a_422_not_a_crash(
    client: AsyncClient, place: str, value: str
) -> None:
    body = payload()
    body["session" if place == "started_at" else "consent"][place] = value
    assert (await post(client, body)).status_code == 422


# --- Item 11: what the app role may delete ---


async def test_the_app_role_cannot_delete_a_profile_on_an_order(
    client: AsyncClient, session: AsyncSession
) -> None:
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "DELETE FROM measurement_profile WHERE profile_id IN "
                '(SELECT profile_id FROM "order")'
            )
        )
    await session.rollback()
