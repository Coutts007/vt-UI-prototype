"""POST /profiles: guard order, idempotency, versioning and server checks (backend-spec 9)."""

import asyncio
import base64
import copy
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from app.models import (
    AuditLog,
    CaptureSession,
    Client,
    Conflict,
    Consent,
    Measurement,
    MeasurementProfile,
    ServerCheck,
)
from fastapi import FastAPI
from httpx import AsyncClient
from ingest_support import FREE_CODE, ROUTE, SEED, key, payload
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import owner_execute
from test_authorisation import fits_contract


async def post(client: AsyncClient, body: dict[str, Any]) -> Any:
    return await client.post(ROUTE, json=body, headers=key(body))


async def test_accepts_a_valid_profile_and_stores_it(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    reply = await post(client, body)
    assert reply.status_code == 201, reply.text
    fits_contract("ProfileAccepted", reply.json())
    assert reply.json()["profile_id"] == body["profile_id"] and reply.json()["version"] == 1
    row = await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))
    assert row and row.status == "final" and row.payload_sha256
    assert row.silhouette_front == body["silhouette_front"]
    assert await session.get(CaptureSession, uuid.UUID(body["session"]["session_id"]))
    count = await session.scalar(
        select(func.count())
        .select_from(Measurement)
        .where(Measurement.profile_id == row.profile_id)
    )
    assert count == 9


async def test_ingest_writes_one_client_audit_row_with_no_measurements(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    await post(client, body)
    rows = list(
        await session.scalars(select(AuditLog).where(AuditLog.entity_id == body["profile_id"]))
    )
    assert [(r.action, r.actor_type) for r in rows] == [("profile_ingest", "client")]
    assert rows[0].ip_hash and "value_mm" not in str(rows[0].detail)


# --- The guard, in the order of 9.2 ---


async def test_oversized_comes_before_everything(client: AsyncClient) -> None:
    reply = await client.post(ROUTE, content=b"{" + b" " * (256 * 1024), headers={
        "Content-Type": "application/json", "Idempotency-Key": str(uuid.uuid4())})  # fmt: skip
    assert reply.status_code == 413


async def test_wrong_content_type_is_415(client: AsyncClient) -> None:
    reply = await client.post(
        ROUTE, content=b"x", headers={"Content-Type": "image/jpeg", "Idempotency-Key": "x"}
    )
    assert reply.status_code == 415


IMAGE = base64.b64encode(bytes(range(256)) * 8).decode()


@pytest.mark.parametrize(
    "content",
    [
        "data:image/png;base64,AAAA",
        "  DATA:text/plain,hello",
        IMAGE,
        IMAGE.replace("+", "-").replace("/", "_"),
        "y" * 2049,
    ],
)
async def test_image_content_is_refused_anywhere(client: AsyncClient, content: str) -> None:
    for place in ("top", "deep", "key"):
        body = payload()
        if place == "top":
            body["extra_thing"] = content
        elif place == "deep":
            body["session"]["device_model"] = content
        else:
            body["session"][content] = 1
        reply = await post(client, body)
        assert reply.status_code == 422, place
        assert reply.json()["code"] == "image_content_rejected", place


async def test_the_refusal_never_echoes_the_content(client: AsyncClient) -> None:
    body = payload()
    body["session"]["device_model"] = "data:image/png;base64,SECRETSECRET"
    assert "SECRETSECRET" not in (await post(client, body)).text


async def test_image_guard_covers_other_json_routes(client: AsyncClient) -> None:
    reply = await client.post(
        "/api/v1/auth/login", json={"email": "a@b.co", "password": "data:image/png;base64,AA"}
    )
    assert reply.json()["code"] == "image_content_rejected"


async def test_image_guard_runs_before_schema_checks(client: AsyncClient) -> None:
    body = payload(version="not a number", captured_at="data:image/png;base64,AA")
    assert (await post(client, body)).json()["code"] == "image_content_rejected"


def edit(path: list[Any], value: Any) -> dict[str, Any]:
    body = payload()
    target: Any = body
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value
    return body


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(payload(extra=1), id="unknown field"),
        pytest.param(edit(["version"], "1"), id="string where a number belongs"),
        pytest.param(edit(["version"], True), id="boolean where a number belongs"),
        pytest.param(edit(["version"], 0), id="version zero"),
        pytest.param(edit(["landmarks_front"], []), id="no landmarks"),
        pytest.param(edit(["landmarks_side", 0, "x"], 1.6), id="landmark out of range"),
        pytest.param(edit(["landmarks_side", 0, "visibility"], 1.1), id="visibility"),
        pytest.param(edit(["marker_front", "corners", 0, 0], 99999), id="corner outside image"),
        pytest.param(edit(["silhouette_front", "half_width_mm"], [1.0] * 100), id="short profile"),
        pytest.param(edit(["silhouette_side", "anterior_mm", 0], 401), id="profile value"),
        pytest.param(edit(["measurements", 0, "value_mm"], 99), id="value below bounds"),
        pytest.param(edit(["measurements", 0, "value_mm"], 3001), id="value above bounds"),
        pytest.param(edit(["status"], "conflict"), id="status"),
    ],
)
async def test_invalid_payloads_are_refused(client: AsyncClient, body: dict[str, Any]) -> None:
    reply = await post(client, body)
    assert reply.status_code == 422
    assert reply.json()["code"] == "validation_failed"


async def test_a_nan_is_not_a_number(client: AsyncClient) -> None:
    body = payload()
    body["session"]["scale_front_mm_px"] = float("nan")
    text = json.dumps(body)
    assert "NaN" in text
    reply = await client.post(
        ROUTE, content=text, headers={**key(body), "Content-Type": "application/json"}
    )
    assert reply.status_code == 422


async def test_idempotency_key_must_match(client: AsyncClient) -> None:
    body = payload()
    bad = await client.post(ROUTE, json=body, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert bad.status_code == 422 and bad.json()["code"] == "validation_failed"
    assert (await client.post(ROUTE, json=body)).status_code == 422


async def test_nine_unique_sites(client: AsyncClient) -> None:
    body = payload()
    body["measurements"][1] = copy.deepcopy(body["measurements"][0])
    assert (await post(client, body)).json()["code"] == "validation_failed"


@pytest.mark.parametrize(
    ("value", "flag"), [(None, "pass"), (None, "check"), (800, "fail")]
)  # fmt: skip
async def test_null_if_and_only_if_fail(client: AsyncClient, value: int | None, flag: str) -> None:
    body = payload()
    body["measurements"][0] |= {"value_mm": value, "confidence_flag": flag}
    assert (await post(client, body)).json()["code"] == "validation_failed"


@pytest.mark.parametrize(("delta", "ok"), [
    (timedelta(minutes=11), False), (timedelta(minutes=9), True),
    (timedelta(days=-91), False), (timedelta(days=-89), True),
])  # fmt: skip
async def test_captured_at_window(client: AsyncClient, delta: timedelta, ok: bool) -> None:
    body = payload(captured_at=(datetime.now(UTC) + delta).isoformat())
    assert (await post(client, body)).status_code == (201 if ok else 422)


async def test_a_time_with_no_zone_is_refused(client: AsyncClient) -> None:
    body = payload(captured_at="2026-11-01T10:00:00")
    assert (await post(client, body)).status_code == 422


async def test_unknown_code(client: AsyncClient) -> None:
    reply = await post(client, payload(code="ZZ9999"))
    assert reply.status_code == 404 and reply.json()["code"] == "code_not_found"


async def test_deleted_client_is_unknown(client: AsyncClient, session: AsyncSession) -> None:
    await session.execute(
        update(Client).where(Client.client_code == FREE_CODE).values(deleted_at=datetime.now(UTC))
    )
    await session.commit()
    assert (await post(client, payload())).json()["code"] == "code_not_found"


async def test_validation_comes_before_the_code_lookup(client: AsyncClient) -> None:
    body = payload(code="ZZ9999", version=0)
    assert (await post(client, body)).json()["code"] == "validation_failed"


async def test_an_unverified_code_is_recorded_as_verified_now(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    body["covariates"]["code_verified"] = False
    await post(client, body)
    row = await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))
    assert row and row.covariates["code_verified"] is True


@pytest.mark.parametrize(
    "change",
    [
        {"scope": ["retention"]},
        {"consent_version": "9.9"},
        {"withdrawn_at": "2026-10-01T00:00:00Z"},
    ],
)
async def test_consent_must_be_valid(client: AsyncClient, change: dict[str, Any]) -> None:
    body = payload()
    body["consent"] |= change
    reply = await post(client, body)
    assert reply.status_code == 422 and reply.json()["code"] == "consent_missing"


async def test_withdrawn_client_is_refused(client: AsyncClient, session: AsyncSession) -> None:
    client_id = await session.scalar(
        select(Client.client_id).where(Client.client_code == FREE_CODE)
    )
    assert client_id
    session.add(
        Consent(
            client_id=client_id, consent_version="1.0", language="en", scope=["measure"],
            given_at=datetime.now(UTC), withdrawn_at=datetime.now(UTC),
        )
    )  # fmt: skip
    await session.commit()
    assert (await post(client, payload())).json()["code"] == "consent_missing"


async def test_consent_is_inserted_once(client: AsyncClient, session: AsyncSession) -> None:
    first = payload()
    second = payload(version=2, consent=first["consent"])
    await post(client, first)
    await post(client, second)
    client_id = await session.scalar(
        select(Client.client_id).where(Client.client_code == FREE_CODE)
    )
    count = await session.scalar(
        select(func.count()).select_from(Consent).where(Consent.client_id == client_id)
    )
    assert count == 1


STUDY = {"set_no": 1, "lighting": "window", "distance_m": 2.2, "clothing_fit_observed": "fitted"}


async def test_study_block_needs_the_matching_participant(client: AsyncClient) -> None:
    other = SEED["participants"][0]["participant_code"]
    body = payload(code="CD2003")
    body["session"]["study"] = {**STUDY, "participant_code": other}
    assert (await post(client, body)).status_code == 422


async def test_study_block_refused_with_study_mode_off(client: AsyncClient, owner_url: str) -> None:
    participant = SEED["participants"][0]
    await owner_execute(
        owner_url, "UPDATE app_setting SET value = 'false' WHERE key = 'study_mode'"
    )
    code = participant["client_code"]
    body = payload(code=code, version=50)
    body["session"]["study"] = {**STUDY, "participant_code": participant["participant_code"]}
    assert (await post(client, body)).status_code == 422


async def test_study_block_accepted_when_it_matches(
    client: AsyncClient, session: AsyncSession
) -> None:
    participant = SEED["participants"][0]
    code = participant["client_code"]
    body = payload(code=code, version=50)
    body["session"]["study"] = {**STUDY, "participant_code": participant["participant_code"]}
    assert (await post(client, body)).status_code == 201
    row = await session.get(CaptureSession, uuid.UUID(body["session"]["session_id"]))
    assert row and row.participant_id and row.set_no == 1


async def test_an_old_app_is_told_so(client: AsyncClient, owner_url: str) -> None:
    await owner_execute(
        owner_url,
        """INSERT INTO app_setting (key, value) VALUES ('min_app_version', '"9.0.0"')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
    )
    reply = await post(client, payload())
    assert reply.status_code == 409 and reply.json()["code"] == "stale_app_version"


# --- 9.3 Idempotency and versioning ---


async def test_replay_returns_the_original_reply(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    first = await post(client, body)
    second = await post(client, body)
    assert second.status_code == 201 and second.json() == first.json()
    count = await session.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.entity_id == body["profile_id"])
    )
    assert count == 1


async def test_key_order_does_not_change_the_hash(client: AsyncClient) -> None:
    body = payload()
    await post(client, body)
    shuffled = dict(reversed(list(body.items())))
    assert (await post(client, shuffled)).status_code == 201


async def test_same_id_with_other_content_is_refused(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    await post(client, body)
    body["session"]["processing_ms"] += 1
    reply = await post(client, body)
    assert reply.status_code == 422 and reply.json()["code"] == "validation_failed"
    assert reply.json()["errors"][0]["code"] == "profile_id_reused"


async def test_a_reused_session_is_refused_not_a_crash(client: AsyncClient) -> None:
    first = payload()
    await post(client, first)
    second = payload(version=2)
    second["session"]["session_id"] = first["session"]["session_id"]
    assert (await post(client, second)).status_code == 422


async def test_new_version_goes_final(client: AsyncClient) -> None:
    await post(client, payload())
    reply = await post(client, payload(version=2))
    assert reply.status_code == 201 and reply.json()["version"] == 2


@pytest.mark.parametrize("version", [1, 2])
async def test_old_or_equal_version_is_a_conflict(
    client: AsyncClient, session: AsyncSession, version: int
) -> None:
    server = payload(version=2)
    await post(client, server)
    incoming = payload(version=version)
    reply = await post(client, incoming)
    assert reply.status_code == 409
    problem = reply.json()
    fits_contract("ProfileVersionConflict", problem)
    assert problem["code"] == "profile_version_conflict" and problem["server_version"] == 2
    row = await session.get(MeasurementProfile, uuid.UUID(incoming["profile_id"]))
    assert row and row.status == "conflict"
    conflict = await session.get(Conflict, uuid.UUID(problem["conflict_id"]))
    assert conflict and str(conflict.server_profile_id) == server["profile_id"]
    assert str(conflict.incoming_profile_id) == incoming["profile_id"]
    assert (await post(client, incoming)).json() == problem, "a replay gives the same conflict"


async def test_two_phones_at_once_give_one_final_and_one_conflict(
    client: AsyncClient, session: AsyncSession
) -> None:
    a, b = payload(), payload()
    replies = await asyncio.gather(post(client, a), post(client, b))
    assert sorted(r.status_code for r in replies) == [201, 409]


async def test_a_duplicate_sent_twice_at_once_is_stored_once(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = payload()
    replies = await asyncio.gather(post(client, body), post(client, body))
    assert [r.status_code for r in replies] == [201, 201]
    assert replies[0].json() == replies[1].json()


# --- 9.5 Post-insert checks ---


def kinds(reply: Any) -> list[str]:
    return [c["kind"] for c in reply.json()["server_checks"]]


async def test_an_honest_phone_gets_no_mismatch(client: AsyncClient) -> None:
    assert "client_server_mismatch" not in kinds(await post(client, payload()))


async def test_mismatch_over_2_mm(client: AsyncClient, session: AsyncSession) -> None:
    body = payload()
    row = next(m for m in body["measurements"] if m["site_code"] == "chest")
    wanted = row["value_mm"]
    row["value_mm"] = wanted + 3
    reply = await post(client, body)
    assert reply.status_code == 201, "the client's value still stands"
    check = next(c for c in reply.json()["server_checks"] if c["kind"] == "client_server_mismatch")
    assert check["site_code"] == "chest" and check["severity"] == "check"
    assert check["detail"]["client_mm"] == wanted + 3 and check["detail"]["server_mm"] == wanted
    stored = await session.scalar(
        select(Measurement.value_mm).where(
            Measurement.profile_id == uuid.UUID(body["profile_id"]),
            Measurement.site_code == "chest",
        )
    )
    assert stored == wanted + 3


async def test_no_mismatch_at_exactly_2_mm(client: AsyncClient) -> None:
    body = payload()
    next(m for m in body["measurements"] if m["site_code"] == "chest")["value_mm"] += 2
    assert "client_server_mismatch" not in kinds(await post(client, body))


async def test_a_different_flag_is_a_mismatch(client: AsyncClient) -> None:
    body = payload()
    row = next(m for m in body["measurements"] if m["confidence_flag"] == "pass")
    row["confidence_flag"] = "check"
    assert "client_server_mismatch" in kinds(await post(client, body))


async def test_unknown_rules_are_accepted_with_a_check(client: AsyncClient) -> None:
    reply = await post(client, payload(rules_version="9.9-unknown"))
    assert reply.status_code == 201 and "rules_version_unknown" in kinds(reply)
    assert "client_server_mismatch" not in kinds(reply)


async def test_bad_rederivation_input_still_commits(
    client: AsyncClient, session: AsyncSession, app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.profile_checks as checks

    def explode(*_: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(checks, "derive", explode)
    body = payload()
    assert (await post(client, body)).status_code == 201
    assert await session.get(MeasurementProfile, uuid.UUID(body["profile_id"]))


async def test_checks_are_stored(client: AsyncClient, session: AsyncSession) -> None:
    body = payload(rules_version="9.9-unknown")
    await post(client, body)
    rows = await session.scalars(
        select(ServerCheck.kind).where(ServerCheck.profile_id == uuid.UUID(body["profile_id"]))
    )
    assert "rules_version_unknown" in list(rows)
