"""Regressions for the second M8 review: each failed before its fix (D45, D49)."""

import hashlib
import uuid
from typing import Any

import pytest
from app.models import AuditLog, Client, Consent, DeletionRequest, MeasurementProfile
from app.privacy import has_image_content
from fastapi import FastAPI
from httpx import AsyncClient
from ingest_support import FREE_CODE, OTHER_SECRET, ROUTE, SECRET, key, payload, proof
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import owner_execute

ACCESS = "/api/v1/data-requests/access"
DELETE = "/api/v1/deletion-requests"
REFUSED = "client_secret_refused"
HAS_DATA = "AB1006"
NAME_AND_HEIGHT = (
    f"UPDATE client SET display_name='Halima', height_mm=1700 WHERE client_code='{FREE_CODE}'"
)
FORGET_CLAIM = f"UPDATE client SET secret_hash=NULL WHERE client_code='{FREE_CODE}'"


async def post(client: AsyncClient, body: dict[str, Any], secret: str = SECRET) -> Any:
    return await client.post(ROUTE, json=body, headers=key(body, secret))


async def ask_delete(
    client: AsyncClient, code: str = FREE_CODE, secret: str | None = SECRET, reason: str = "delete"
) -> Any:
    return await client.post(
        DELETE,
        json={"client_code": code, "reason": reason},
        headers=proof(secret) if secret else {},
    )


async def row_of(session: AsyncSession, code: str = FREE_CODE) -> Client:
    session.expire_all()
    row = await session.scalar(select(Client).where(Client.client_code == code))
    assert row
    return row


async def saved(session: AsyncSession, client_id: uuid.UUID) -> int:
    query = select(func.count()).select_from(MeasurementProfile)
    return await session.scalar(query.where(MeasurementProfile.client_id == client_id)) or 0


# --- Decision 1: a code that holds data is never claimed by an upload ---


async def test_an_upload_cannot_claim_a_code_that_holds_data(
    client: AsyncClient, session: AsyncSession
) -> None:
    before = await saved(session, (await row_of(session, HAS_DATA)).client_id)
    reply = await post(client, payload(code=HAS_DATA, version=99))
    await post(client, payload())
    wrong = await post(client, payload(version=2), OTHER_SECRET)
    assert reply.status_code == 403 and reply.json()["code"] == REFUSED
    assert reply.content == wrong.content, "must look the same as a wrong secret"
    row = await row_of(session, HAS_DATA)
    assert row.secret_hash is None
    assert await saved(session, row.client_id) == before
    read = await client.post(ACCESS, json={"client_code": HAS_DATA}, headers=proof())
    assert read.status_code == 403


# --- Decision 2, corrected: the proof and an upload are enough to clear the details (spec 14.5) ---


@pytest.mark.parametrize("reason", ["delete", "withdraw_consent"])
async def test_an_honest_clients_deletion_clears_the_details(
    client: AsyncClient, session: AsyncSession, owner_url: str, reason: str
) -> None:
    await owner_execute(owner_url, NAME_AND_HEIGHT)
    assert (await post(client, payload())).status_code == 201
    assert (await ask_delete(client, reason=reason)).status_code == 202
    row = await row_of(session)
    assert (row.display_name, row.height_mm) == (None, None)
    assert await saved(session, row.client_id) == 0


async def test_a_wrong_secret_leaves_the_details(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    await owner_execute(owner_url, NAME_AND_HEIGHT)
    assert (await post(client, payload())).status_code == 201
    assert (await ask_delete(client, secret=OTHER_SECRET)).status_code == 403
    row = await row_of(session)
    assert (row.display_name, row.height_mm) == ("Halima", 1700)


async def test_a_replay_claim_can_clear_the_details(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    body = payload()
    assert (await post(client, body)).status_code == 201
    await owner_execute(owner_url, NAME_AND_HEIGHT, FORGET_CLAIM)
    assert (await post(client, body)).status_code == 201
    assert (await ask_delete(client)).status_code == 202
    row = await row_of(session)
    assert (row.display_name, row.height_mm) == (None, None)


# --- Decision 3: deletions that have nothing to do, and the lost reply ---


@pytest.mark.parametrize("secret", [SECRET, None], ids=["secret", "no-secret"])
@pytest.mark.parametrize("reason", ["delete", "withdraw_consent"])
async def test_deleting_an_empty_unclaimed_code_is_done_with_nothing_done(
    client: AsyncClient, session: AsyncSession, owner_url: str, secret: str | None, reason: str
) -> None:
    await owner_execute(owner_url, NAME_AND_HEIGHT)
    reply = await ask_delete(client, secret=secret, reason=reason)
    assert reply.status_code == 202 and reply.json()["status"] == "done"
    uuid.UUID(reply.json()["request_id"])
    row = await row_of(session)
    assert row.secret_hash is None, "a deletion must not claim"
    assert (row.display_name, row.height_mm) == ("Halima", 1700)
    query = select(func.count()).select_from(Consent).where(Consent.client_id == row.client_id)
    assert not await session.scalar(query.where(Consent.withdrawn_at.isnot(None)))
    requests = select(func.count()).select_from(DeletionRequest)
    assert not await session.scalar(requests.where(DeletionRequest.client_id == row.client_id))
    assert (await post(client, payload())).status_code == 201, "a real client can still claim"


async def test_deleting_an_unclaimed_code_with_data_or_an_unknown_code_is_refused(
    client: AsyncClient,
) -> None:
    for code in (HAS_DATA, "ZZ9999"):
        reply = await ask_delete(client, code=code)
        assert reply.status_code == 403 and reply.json()["code"] == REFUSED


async def test_a_replay_of_the_stored_body_claims_an_unclaimed_code(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    body = payload()
    assert (await post(client, body)).status_code == 201
    await owner_execute(owner_url, FORGET_CLAIM)
    assert (await post(client, body)).status_code == 201
    row = await row_of(session)
    assert row.secret_hash == hashlib.sha256(SECRET.encode()).hexdigest()
    read = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof())
    assert read.status_code == 200
    assert (await post(client, body, OTHER_SECRET)).json()["code"] == REFUSED


async def test_only_an_identical_body_can_claim_over_data(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    body = payload()
    assert (await post(client, body)).status_code == 201
    await owner_execute(owner_url, FORGET_CLAIM)
    changed = {**body, "version": 7}
    for attempt in (changed, payload(version=8)):
        assert (await post(client, attempt, OTHER_SECRET)).json()["code"] == REFUSED
    malformed = await client.post(ROUTE, json=body, headers=key(body, "short"))
    assert malformed.json()["code"] == REFUSED
    assert (await row_of(session)).secret_hash is None


# --- Decision 5: the per-code limit counts only stored profiles ---


async def test_refused_uploads_cannot_use_up_a_codes_limit(client: AsyncClient) -> None:
    for _ in range(11):
        body = payload()
        body["consent"]["scope"] = []
        assert (await post(client, body, OTHER_SECRET)).json()["code"] == "consent_missing"
    assert (await post(client, payload())).status_code == 201
    for _ in range(11):
        assert (await post(client, payload(version=5), OTHER_SECRET)).json()["code"] == REFUSED
    assert (await post(client, payload(version=6))).status_code == 201


async def test_replays_do_not_count_against_the_limit(client: AsyncClient) -> None:
    body = payload()
    assert (await post(client, body)).status_code == 201
    assert [(await post(client, body)).status_code for _ in range(12)] == [201] * 12
    assert (await post(client, payload(version=2))).status_code == 201


async def test_the_limit_still_stops_stored_profiles(client: AsyncClient) -> None:
    codes = [(await post(client, payload(version=i + 1))).status_code for i in range(11)]
    assert codes == [201] * 10 + [429]


# --- Decision 6: silhouette values are exact tenths ---


@pytest.mark.parametrize("extra", [3.3e-8, 1e-7, 1e-9, 1e-12])
async def test_a_value_finer_than_a_tenth_is_refused(client: AsyncClient, extra: float) -> None:
    body = payload()
    row = body["silhouette_side"]["half_depth_mm"]
    place = next(i for i, value in enumerate(row) if value is not None)
    row[place] += extra
    reply = await post(client, body)
    assert reply.status_code == 422, reply.text


def test_every_tenth_the_phone_can_send_passes_the_exact_check() -> None:
    """The phone's tenth() is Math.round(v * 10) / 10, the double nearest k / 10."""
    from app.schemas import _whole_tenths

    values = [k / 10 for k in range(-20000, 40001)]
    assert _whole_tenths(values) == values


# --- Decision 9: the guard sees through more disguises ---


@pytest.mark.parametrize(
    "text",
    [
        "%25252564ata:image/png;base64,AAAA",
        "%2525252564ata:x",
        "d️ata:image/png;base64,AAAA",
        "͏data:image/png;base64,A",
        "ㅤdata:image/png;base64,A",
        "⠀data:image/png;base64,A",
        "&#100;ata:image/png;base64,AA",
        "&#x64;ata:image/png;base64,AA",
        "&amp;#100;ata:image/png;base64,AA",
        "́data:image/png;base64,AA",
        "d́ata:image/png;base64,AA",
    ],
)
async def test_the_guard_sees_through_a_disguised_prefix(client: AsyncClient, text: str) -> None:
    body = payload()
    body["session"]["device_model"] = text
    assert (await post(client, body)).json()["code"] == "image_content_rejected"


@pytest.mark.parametrize("text", ["Samsung & Co", "Tecno Spark 10%", "Müller", "Infinix; Hot 40"])
def test_the_guard_leaves_ordinary_text_alone(text: str) -> None:
    assert not has_image_content(f'{{"x": "{text}"}}'.encode())


# --- Decision 10: an id is looked up within its own client ---


async def test_another_clients_identifier_gets_one_refusal_live_or_deleted(
    client: AsyncClient, owner_url: str
) -> None:
    theirs = payload(code=FREE_CODE)
    assert (await post(client, theirs)).status_code == 201
    other_code = "AB1009"
    await owner_execute(
        owner_url,
        "INSERT INTO client (client_id, client_code, tailor_id, source) SELECT gen_random_uuid(), "
        f"'{other_code}', tailor_id, source FROM client WHERE client_code='{FREE_CODE}'",
    )
    assert (await post(client, payload(code=other_code), OTHER_SECRET)).status_code == 201
    attempt = payload(code=other_code, version=2)
    attempt["profile_id"] = theirs["profile_id"]
    live = await post(client, attempt, OTHER_SECRET)
    assert (await ask_delete(client)).status_code == 202
    gone = await post(client, attempt, OTHER_SECRET)
    assert live.status_code == gone.status_code == 422
    assert live.content == gone.content
    assert gone.json()["errors"][0]["code"] == "profile_id_reused"


async def test_ones_own_deleted_identifier_still_says_deleted(client: AsyncClient) -> None:
    body = payload()
    await post(client, body)
    await ask_delete(client)
    assert (await post(client, body)).json()["code"] == "profile_deleted"


# --- Decision 12: a claim leaves its own audit row ---


async def test_a_claim_is_audited_on_its_own(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    body = payload()
    await post(client, body)
    await post(client, payload(version=2))
    row = await row_of(session)
    query = select(AuditLog).where(
        AuditLog.client_id == row.client_id, AuditLog.action == "client_code_claim"
    )
    claims = list(await session.scalars(query))
    assert [(c.actor_type, c.detail) for c in claims] == [("client", {"over_data": False})]
    assert SECRET not in str(claims[0].detail)
    await owner_execute(owner_url, FORGET_CLAIM)
    await post(client, body)
    session.expire_all()
    claims = list(await session.scalars(query.order_by(AuditLog.log_id)))
    assert [c.detail for c in claims] == [{"over_data": False}, {"over_data": True}]


def test_downgrading_past_the_secrets_warns(owner_url: str) -> None:
    import asyncio

    from app.migrate import downgrade, upgrade
    from test_database import _create_database

    separate = owner_url.rsplit("/", 1)[0] + "/migration_test"
    asyncio.run(_create_database(owner_url))
    upgrade(separate)
    with pytest.warns(UserWarning, match="reopens every claimed code"):
        downgrade(separate, "0003")


# --- Decision 11: what the generated OpenAPI declares matches the contract ---


def _operation(app: FastAPI, path: str) -> dict[str, Any]:
    return app.openapi()["paths"][f"/api/v1{path}"]["post"]


@pytest.mark.parametrize("path", ["/profiles", "/deletion-requests", "/data-requests/access"])
def test_the_secret_header_and_refusal_are_declared(app: FastAPI, path: str) -> None:
    operation = _operation(app, path)
    header = next(p for p in operation["parameters"] if p["name"] == "X-Client-Secret")
    assert "maxLength" in str(header["schema"]) and "64" in str(header["schema"])
    assert "403" in operation["responses"]


def test_guard_time_is_bounded_on_nested_expanding_text() -> None:
    import json
    import time

    from app.privacy import has_image_content

    text = ("%25" * 7 + "41" + "\ufdfa" * 2048)[:2048]
    body = json.dumps([text] * 40).encode()
    started = time.perf_counter()
    assert has_image_content(body) is True
    assert time.perf_counter() - started < 0.5


def test_guard_budget_leaves_honest_text_alone() -> None:
    import json

    from app.privacy import has_image_content

    honest = ["Wanjik\u0169 & Halima, kifua 100% sawa \U0001f600"] * 40
    assert has_image_content(json.dumps({"notes": honest}).encode()) is False
