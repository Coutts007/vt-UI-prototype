"""The tailor directory and Get code (D27), against real PostgreSQL."""

import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml
from app.api.v1 import directory
from app.models import AuditLog, Client, Order, Tailor, UserAccount
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

ROOT = Path(__file__).parents[3]
CONTRACT = yaml.safe_load((ROOT / "packages/contracts/openapi.yaml").read_text())
SEED = json.loads((ROOT / "packages/seed/seed.json").read_text())
PREFIX = "/api/v1"
CODE = r"^[A-Z]{2}[0-9]{4}$"
LISTING = {row["tailor_id"]: row["listing_id"] for row in SEED["directory_listings"]}
USERS = {row["email"]: row for row in SEED["users"]}
WANJIRU = USERS["wanjiru@vt.test"]
OTIENO = USERS["otieno@vt.test"]
PENDING = next(row for row in SEED["users"] if row["status"] == "pending")


def fits(schema: str, value: Any) -> None:
    """additionalProperties is false on these schemas, so an extra field fails here."""
    document = {"$ref": f"#/components/schemas/{schema}", "components": CONTRACT["components"]}
    jsonschema.Draft202012Validator(document).validate(value)


async def listed(client: AsyncClient, **params: Any) -> dict[str, Any]:
    response = await client.get(f"{PREFIX}/tailors", params=params)
    assert response.status_code == 200, response.text
    fits("TailorListingPage", response.json())
    return dict(response.json())


async def names(client: AsyncClient, **params: Any) -> list[str]:
    return [row["business_name"] for row in (await listed(client, **params))["items"]]


async def issue(client: AsyncClient, tailor: dict[str, Any]) -> Any:
    return await client.post(f"{PREFIX}/tailors/{LISTING[tailor['user_id']]}/codes")


async def test_only_active_tailors_who_opted_in_are_listed(client: AsyncClient) -> None:
    assert await names(client) == [WANJIRU["business_name"], OTIENO["business_name"]]
    assert PENDING["business_name"] not in await names(client, search="Pending")


async def test_a_new_tailor_is_not_listed_until_they_opt_in(
    client: AsyncClient, session: AsyncSession
) -> None:
    await session.execute(update(Tailor).values(directory_listed=False))
    await session.commit()
    assert await names(client) == []
    assert (await listed(client))["areas"] == []

    token = await sign_in(client, WANJIRU["email"])
    reply = await client.patch(
        f"{PREFIX}/me", headers=bearer(token), json={"directory_listed": True}
    )
    assert reply.status_code == 200
    fits("User", reply.json())
    assert await names(client) == [WANJIRU["business_name"]]

    await client.patch(f"{PREFIX}/me", headers=bearer(token), json={"directory_listed": False})
    assert await names(client) == []


async def test_a_registered_tailor_defaults_to_not_listed(
    client: AsyncClient, session: AsyncSession
) -> None:
    reply = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": "new-tailor@vt.test",
            "password": "long-enough-password",
            "business_name": "Brand New Tailors",
            "phone": "0700000099",
            "area": "Thika",
            "locale": "en",
        },
    )
    assert reply.status_code == 201
    await session.execute(update(UserAccount).values(status="active"))
    await session.commit()
    assert "Brand New Tailors" not in await names(client)


@pytest.mark.parametrize("status", ["pending", "disabled", "rejected"])
async def test_a_tailor_who_is_not_active_is_hidden_and_issues_nothing(
    client: AsyncClient, session: AsyncSession, status: str
) -> None:
    await session.execute(
        update(UserAccount).where(UserAccount.email == WANJIRU["email"]).values(status=status)
    )
    await session.commit()
    assert WANJIRU["business_name"] not in await names(client)
    assert (await issue(client, WANJIRU)).status_code == 404


async def test_an_opted_out_tailor_issues_nothing(
    client: AsyncClient, session: AsyncSession
) -> None:
    await session.execute(update(Tailor).values(directory_listed=False))
    await session.commit()
    reply = await issue(client, WANJIRU)
    assert reply.status_code == 404
    assert reply.json()["code"] == "not_found"


async def test_a_listing_shows_only_what_was_published(client: AsyncClient) -> None:
    rows = {row["business_name"]: row for row in (await listed(client))["items"]}
    wanjiru, otieno = rows[WANJIRU["business_name"]], rows[OTIENO["business_name"]]
    allowed = {"listing_id", "business_name", "area", "specialties", "description", "phone"}
    assert set(wanjiru) == allowed
    assert wanjiru["phone"] is None
    assert otieno["phone"] == "+254700000002"
    text = json.dumps(rows)
    for secret in (WANJIRU["email"], WANJIRU["user_id"], OTIENO["email"], OTIENO["user_id"]):
        assert secret not in text


async def test_search_area_specialty_and_paging(client: AsyncClient) -> None:
    assert await names(client, search="otieno") == [OTIENO["business_name"]]
    assert await names(client, search="gikomba") == [WANJIRU["business_name"]]
    assert await names(client, search="%") == []
    assert await names(client, area="cbd") == [OTIENO["business_name"]]
    assert await names(client, specialty="kitenge") == [WANJIRU["business_name"]]
    assert await names(client, specialty="uniforms") == []
    one = await listed(client, page_size=1, page=2)
    assert (one["page"], one["page_size"], one["total"]) == (2, 1, 2)
    assert [row["business_name"] for row in one["items"]] == [OTIENO["business_name"]]
    assert one["areas"] == ["CBD", "Gikomba"]
    bad = await client.get(f"{PREFIX}/tailors", params={"specialty": "nope"})
    assert bad.status_code == 422


async def test_each_tap_issues_a_new_code_with_an_audit_row(
    client: AsyncClient, session: AsyncSession
) -> None:
    first, second = await issue(client, WANJIRU), await issue(client, WANJIRU)
    assert first.status_code == second.status_code == 201
    fits("DirectoryCodeIssued", first.json())
    fits("DirectoryCodeIssued", second.json())
    code = first.json()["client_code"]
    assert code != second.json()["client_code"]
    assert first.json()["tailor_business_name"] == WANJIRU["business_name"]

    row = await session.scalar(select(Client).where(Client.client_code == code))
    assert row
    assert row.source == "directory"
    assert row.tailor_id == uuid.UUID(WANJIRU["user_id"])
    assert row.display_name is None and row.height_mm is None

    rows = await session.scalars(
        select(AuditLog).where(AuditLog.action == "code_issue", AuditLog.client_id == row.client_id)
    )
    entry = rows.one()
    assert entry.actor_type == "client"
    assert entry.detail == {"source": "directory"}
    assert entry.ip_hash and entry.user_id is None


async def test_an_issued_code_verifies_with_the_tailor_name(client: AsyncClient) -> None:
    code = (await issue(client, OTIENO)).json()["client_code"]
    reply = await client.get(f"{PREFIX}/client-codes/{code}")
    assert reply.status_code == 200
    fits("ClientCodeCheck", reply.json())
    assert reply.json() == {
        "valid": True,
        "tailor_business_name": OTIENO["business_name"],
        "height_mm": None,
    }
    assert (await client.get(f"{PREFIX}/client-codes/ZZ9999")).json()["code"] == "code_not_found"
    assert (await client.get(f"{PREFIX}/client-codes/nope")).status_code == 422


async def test_code_generation_retries_a_taken_code(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    taken = SEED["clients"][0]["client_code"]
    fresh = "ZZ0001"
    codes = iter([taken, taken, fresh])
    monkeypatch.setattr(directory, "new_code", lambda: next(codes))
    reply = await issue(client, WANJIRU)
    assert reply.status_code == 201
    assert reply.json()["client_code"] == fresh


async def test_code_generation_gives_up_cleanly(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    taken = SEED["clients"][0]["client_code"]
    monkeypatch.setattr(directory, "new_code", lambda: taken)
    reply = await issue(client, WANJIRU)
    assert reply.status_code == 500
    assert reply.json()["code"] == "server_error"
    entries = await session.scalars(
        select(AuditLog).where(AuditLog.action == "code_issue", AuditLog.actor_type == "client")
    )
    assert entries.all() == []


def test_generated_codes_fit_the_format_and_avoid_i_and_o() -> None:
    import re

    for _ in range(500):
        code = directory.new_code()
        assert re.fullmatch(CODE, code)
        assert not {"I", "O"} & set(code)


async def test_issuing_is_rate_limited_per_address(client: AsyncClient) -> None:
    for _ in range(10):
        assert (await issue(client, WANJIRU)).status_code == 201
    refused = await issue(client, OTIENO)
    assert refused.status_code == 429
    assert refused.json()["code"] == "rate_limited"
    assert int(refused.headers["retry-after"]) > 0


async def test_the_day_limit_also_holds(app: FastAPI, client: AsyncClient) -> None:
    limiter = app.state.limiter
    for _ in range(3):
        for _ in range(10):
            assert (await issue(client, WANJIRU)).status_code == 201
        limiter.windows = {
            k: v for k, v in limiter.windows.items() if k[0] != "directory-code-hour"
        }
    assert (await issue(client, WANJIRU)).status_code == 429


async def test_browsing_and_verifying_are_rate_limited(client: AsyncClient) -> None:
    for _ in range(10):
        await client.get(f"{PREFIX}/client-codes/ZZ9999")
    assert (await client.get(f"{PREFIX}/client-codes/ZZ9999")).status_code == 429
    for _ in range(60):
        await client.get(f"{PREFIX}/tailors")
    assert (await client.get(f"{PREFIX}/tailors")).status_code == 429


async def test_a_tailor_sees_and_removes_their_directory_clients(
    client: AsyncClient, session: AsyncSession
) -> None:
    code = (await issue(client, WANJIRU)).json()["client_code"]
    theirs = (await issue(client, OTIENO)).json()["client_code"]
    token = await sign_in(client, WANJIRU["email"])
    reply = await client.get(f"{PREFIX}/me/directory-clients", headers=bearer(token))
    assert reply.status_code == 200
    fits("DirectoryClientPage", reply.json())
    rows = reply.json()["items"]
    assert [row["client_code"] for row in rows] == [code]
    assert rows[0]["has_profile"] is False

    removed = await client.delete(f"{PREFIX}/clients/{rows[0]['client_id']}", headers=bearer(token))
    assert removed.status_code == 204
    again = await client.get(f"{PREFIX}/me/directory-clients", headers=bearer(token))
    assert again.json()["items"] == [] and again.json()["total"] == 0
    assert (await client.get(f"{PREFIX}/client-codes/{code}")).status_code == 404
    twice = await client.delete(f"{PREFIX}/clients/{rows[0]['client_id']}", headers=bearer(token))
    assert twice.status_code == 404

    entry = await session.scalar(
        select(AuditLog).where(AuditLog.action == "deletion", AuditLog.user_id.is_not(None))
    )
    assert entry
    assert entry.detail == {"source": "directory"}

    other = await session.scalar(select(Client).where(Client.client_code == theirs))
    assert other
    refused = await client.delete(f"{PREFIX}/clients/{other.client_id}", headers=bearer(token))
    assert refused.status_code == 403
    await session.refresh(other)
    assert other.deleted_at is None


async def test_a_client_with_active_orders_cannot_be_removed(
    client: AsyncClient, session: AsyncSession
) -> None:
    order = await session.scalar(select(Order).where(Order.status != "collected").limit(1))
    assert order
    owner = await session.get(Tailor, order.tailor_id)
    assert owner
    user = await session.get(UserAccount, owner.user_id)
    assert user
    token = await sign_in(client, user.email)
    reply = await client.delete(f"{PREFIX}/clients/{order.client_id}", headers=bearer(token))
    assert reply.status_code == 409
    assert reply.json()["code"] == "client_has_orders"


async def test_an_admin_can_remove_a_client(client: AsyncClient, session: AsyncSession) -> None:
    code = (await issue(client, WANJIRU)).json()["client_code"]
    row = await session.scalar(select(Client).where(Client.client_code == code))
    assert row
    token = await sign_in(client, "admin@vt.test")
    reply = await client.delete(f"{PREFIX}/clients/{row.client_id}", headers=bearer(token))
    assert reply.status_code == 204


async def test_listing_settings_are_audited_without_the_text(
    client: AsyncClient, session: AsyncSession
) -> None:
    token = await sign_in(client, OTIENO["email"])
    reply = await client.patch(
        f"{PREFIX}/me",
        headers=bearer(token),
        json={
            "directory_listed": False,
            "directory_show_phone": False,
            "directory_specialties": ["suits", "casual"],
            "directory_description": "Secret words",
        },
    )
    assert reply.status_code == 200
    body = reply.json()
    assert body["directory_specialties"] == ["suits", "casual"]
    assert body["directory_description"] == "Secret words"
    entry = await session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "settings_change", AuditLog.user_id == uuid.UUID(OTIENO["user_id"])
        )
        .order_by(AuditLog.log_id.desc())
    )
    assert entry
    assert entry.detail["listed"] is False
    assert "directory_description" in entry.detail["fields"]
    assert "Secret words" not in json.dumps(entry.detail)


@pytest.mark.parametrize(
    "body",
    [
        {"directory_specialties": ["nope"]},
        {"directory_specialties": ["suits", "suits"]},
        {"directory_description": "x" * 241},
        {"public_client_code": "AB1234"},
    ],
)
async def test_bad_listing_settings_are_refused(client: AsyncClient, body: dict[str, Any]) -> None:
    token = await sign_in(client, WANJIRU["email"])
    reply = await client.patch(f"{PREFIX}/me", headers=bearer(token), json=body)
    assert reply.status_code == 422


async def test_listing_fields_are_for_tailors(client: AsyncClient) -> None:
    token = await sign_in(client, "admin@vt.test")
    reply = await client.patch(
        f"{PREFIX}/me", headers=bearer(token), json={"directory_listed": True}
    )
    assert reply.status_code == 422


async def test_the_database_refuses_bad_values(session: AsyncSession) -> None:
    from sqlalchemy.exc import IntegrityError

    client = await session.scalar(select(Client).limit(1))
    assert client
    client.source = "nope"
    with pytest.raises(IntegrityError):
        await session.flush()
    await session.rollback()
    tailor = await session.scalar(select(Tailor).limit(1))
    assert tailor
    tailor.directory_specialties = ["nope"]
    with pytest.raises(IntegrityError):
        await session.flush()
