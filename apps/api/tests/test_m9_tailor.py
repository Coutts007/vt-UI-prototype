"""The tailor's slice on the real API: clients, orders, ease, audit and claims (M9, D45)."""

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from app.models import AuditLog
from app.services.ease import rounded_median
from httpx import AsyncClient
from ingest_support import FREE_CODE, OTHER_SECRET, ROUTE, SECRET, SEED, key, payload, proof
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

API = "/api/v1"
TAILOR = "wanjiru@vt.test"
ACCESS = f"{API}/data-requests/access"
DELETE = f"{API}/deletion-requests"


def today() -> datetime:
    return datetime.now(ZoneInfo("Africa/Nairobi"))


def due(days: int = 10) -> str:
    return (today() + timedelta(days=days)).date().isoformat()


async def staff(client: AsyncClient, email: str = TAILOR) -> dict[str, str]:
    return bearer(await sign_in(client, email))


async def the_tailor(client: AsyncClient) -> dict[str, str]:
    return await staff(client)


async def client_for(http: AsyncClient, headers: dict[str, str], code: str) -> dict[str, Any]:
    page = await http.get(f"{API}/clients", params={"search": code}, headers=headers)
    assert page.status_code == 200, page.text
    return next(row for row in page.json()["items"] if row["client_code"] == code)


async def upload(http: AsyncClient, body: dict[str, Any], secret: str = SECRET) -> Any:
    return await http.post(ROUTE, json=body, headers=key(body, secret))


def a_seed_profile() -> tuple[dict[str, Any], dict[str, Any]]:
    client = next(c for c in SEED["clients"] if c["client_code"] == "AB1001")
    profile = next(
        p
        for p in SEED["profiles"]
        if p["client_id"] == client["client_id"] and p["status"] == "final"
    )
    return client, profile


def items_of(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Every site, answered the way the order form must answer it."""
    rows = []
    for row in profile["measurements"]:
        rows.append(
            {
                "site_code": row["site_code"],
                "body_mm": row["value_mm"],
                "ease_mm": 20,
                "overridden": False,
                "flag_confirmed": row["confidence_flag"] == "check",
                "pending_fitting": row["confidence_flag"] == "fail" or row["value_mm"] is None,
            }
        )
    return rows


def order_body(**changes: Any) -> dict[str, Any]:
    client, profile = a_seed_profile()
    body = {
        "client_id": client["client_id"],
        "profile_id": profile["profile_id"],
        "garment_type": "shirt",
        "due_date": due(),
        "items": items_of(profile),
    }
    return {**body, **changes}


async def logged(session: AsyncSession, action: str) -> list[AuditLog]:
    return list(await session.scalars(select(AuditLog).where(AuditLog.action == action)))


# --- Clients ---


async def test_issuing_a_code_is_audited_and_works_at_once(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    made = await client.post(
        f"{API}/clients", json={"display_name": "Neema", "height_mm": 1650}, headers=headers
    )
    assert made.status_code == 201
    code = made.json()["client_code"]
    assert made.json()["deep_link"] == f"/start?code={code}"
    assert "I" not in code[:2] and "O" not in code[:2]
    assert (await upload(client, payload(code))).status_code == 201
    assert await logged(session, "code_issue")


async def test_tailors_see_only_their_own_clients(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    page = (await client.get(f"{API}/clients", params={"page_size": 100}, headers=headers)).json()
    owner = {c["client_id"]: c["tailor_id"] for c in SEED["clients"]}
    assert len({owner[row["client_id"]] for row in page["items"]}) == 1
    other = next(
        c for c in SEED["clients"] if c["tailor_id"] != owner[page["items"][0]["client_id"]]
    )
    for suffix in ("", "/profiles", "/claim"):
        reply = await client.get(f"{API}/clients/{other['client_id']}{suffix}", headers=headers)
        assert reply.status_code == 403, suffix
    missing = await client.get(
        f"{API}/clients/00000000-0000-5000-8000-000000000001", headers=headers
    )
    assert missing.status_code == 404


@pytest.mark.parametrize("wildcard", ["%", "_"])
async def test_search_treats_wildcards_as_text(client: AsyncClient, wildcard: str) -> None:
    headers = await the_tailor(client)
    page = await client.get(f"{API}/clients", params={"search": wildcard}, headers=headers)
    assert page.json()["items"] == []


async def test_list_filters_and_sorts(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    for name in ("has_new", "has_flags", "no_profiles"):
        reply = await client.get(f"{API}/clients", params={"filter": name}, headers=headers)
        assert reply.status_code == 200
    empty = await client.get(f"{API}/clients", params={"filter": "no_profiles"}, headers=headers)
    assert all(row["last_capture_at"] is None for row in empty.json()["items"])
    for sort in ("last_capture", "code", "name"):
        reply = await client.get(f"{API}/clients", params={"sort": sort}, headers=headers)
        assert reply.status_code == 200, reply.text
    codes = await client.get(f"{API}/clients", params={"sort": "code"}, headers=headers)
    listed = [row["client_code"] for row in codes.json()["items"]]
    assert listed == sorted(listed)


async def test_a_profile_view_is_audited_every_time(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    _, profile = a_seed_profile()
    before = len(await logged(session, "profile_view"))
    for _ in range(2):
        reply = await client.get(f"{API}/profiles/{profile['profile_id']}", headers=headers)
        assert reply.status_code == 200
    assert len(await logged(session, "profile_view")) == before + 2


async def test_rotating_stops_the_old_code_and_frees_the_claim(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    assert (await upload(client, payload())).status_code == 201
    row = await client_for(client, headers, FREE_CODE)
    rotated = await client.post(f"{API}/clients/{row['client_id']}/rotate-code", headers=headers)
    code = rotated.json()["client_code"]
    assert code != FREE_CODE
    assert (await upload(client, payload())).status_code == 404
    assert (await upload(client, payload(code, version=2), OTHER_SECRET)).status_code == 201


# --- Conflicts ---


async def test_conflict_keep_newer_and_keep_server(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    conflicts = (await client.get(f"{API}/conflicts", headers=headers)).json()
    assert conflicts
    conflict = conflicts[0]
    other = await client.post(
        f"{API}/conflicts/{conflict['conflict_id']}/resolve",
        json={"keep": "newer"},
        headers=await staff(client, "admin@vt.test"),
    )
    assert other.status_code == 403
    done = await client.post(
        f"{API}/conflicts/{conflict['conflict_id']}/resolve",
        json={"keep": "newer"},
        headers=headers,
    )
    assert done.status_code == 200, done.text
    assert done.json()["resolution"] == "newer" and done.json()["resolved_at"]
    assert (await client.get(f"{API}/conflicts", headers=headers)).json() == []
    assert len(await logged(session, "conflict_resolve")) == 1
    again = await client.post(
        f"{API}/conflicts/{conflict['conflict_id']}/resolve",
        json={"keep": "server"},
        headers=headers,
    )
    assert again.json()["resolution"] == "newer", "a settled conflict stays settled"


# --- Orders ---


async def test_an_order_computes_finished_and_numbers_itself(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    before = len(await logged(session, "order_create"))
    made = await client.post(f"{API}/orders", json=order_body(), headers=headers)
    assert made.status_code == 201, made.text
    order = made.json()
    for item in order["items"]:
        expected = None if item["body_mm"] is None else item["body_mm"] + item["ease_mm"]
        assert item["finished_mm"] == expected
    assert order["status_history"][0]["status"] == "new"
    second = await client.post(f"{API}/orders", json=order_body(), headers=headers)
    assert int(second.json()["order_no"][4:]) == int(order["order_no"][4:]) + 1
    assert len(await logged(session, "order_create")) == before + 2


@pytest.mark.parametrize("days", [-1, 181])
async def test_due_date_must_be_within_range(client: AsyncClient, days: int) -> None:
    headers = await the_tailor(client)
    reply = await client.post(f"{API}/orders", json=order_body(due_date=due(days)), headers=headers)
    assert reply.status_code == 422 and reply.json()["code"] == "due_date_past"


@pytest.mark.parametrize("days", [0, 180])
async def test_due_date_edges_are_allowed(client: AsyncClient, days: int) -> None:
    headers = await the_tailor(client)
    reply = await client.post(f"{API}/orders", json=order_body(due_date=due(days)), headers=headers)
    assert reply.status_code == 201


async def test_ease_range_is_enforced(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    body = order_body()
    body["items"][0]["ease_mm"] = 301
    assert (await client.post(f"{API}/orders", json=body, headers=headers)).status_code == 422


def flagged_body(flag: str) -> tuple[dict[str, Any], str]:
    profile = next(
        p
        for p in SEED["profiles"]
        if p["status"] == "final" and any(m["confidence_flag"] == flag for m in p["measurements"])
    )
    site = next(m["site_code"] for m in profile["measurements"] if m["confidence_flag"] == flag)
    return (
        {
            "client_id": profile["client_id"],
            "profile_id": profile["profile_id"],
            "garment_type": "shirt",
            "due_date": due(),
            "items": items_of(profile),
        },
        site,
    )


def owner_email(client_id: str) -> str:
    tailor = next(c["tailor_id"] for c in SEED["clients"] if c["client_id"] == client_id)
    return next(
        u["email"]
        for u in SEED["users"]
        if u.get("tailor_id") == tailor or u.get("user_id") == tailor
    )


async def test_a_flagged_row_must_be_confirmed_or_overridden(client: AsyncClient) -> None:
    body, site = flagged_body("check")
    headers = await staff(client, owner_email(body["client_id"]))
    row = next(item for item in body["items"] if item["site_code"] == site)
    row["flag_confirmed"] = False
    refused = await client.post(f"{API}/orders", json=body, headers=headers)
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["code"] == "flag_not_confirmed"
    row["overridden"] = True
    row["body_mm"] = (row["body_mm"] or 500) + 5
    row["override_reason"] = "Measured at the fitting"
    assert (await client.post(f"{API}/orders", json=body, headers=headers)).status_code == 201


async def test_a_changed_body_value_must_say_it_is_an_override(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    body = order_body()
    row = next(item for item in body["items"] if item["body_mm"] is not None)
    row["body_mm"] += 10
    refused = await client.post(f"{API}/orders", json=body, headers=headers)
    assert refused.json()["errors"][0]["code"] == "override_required"
    row["overridden"] = True
    assert (await client.post(f"{API}/orders", json=body, headers=headers)).status_code == 201
    assert await logged(session, "override")


async def test_status_changes_append_history_and_audit(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    order = (await client.post(f"{API}/orders", json=order_body(), headers=headers)).json()
    url = f"{API}/orders/{order['order_id']}"
    before = len(await logged(session, "status_change"))
    moved = await client.patch(url, json={"status": "cutting"}, headers=headers)
    assert [step["status"] for step in moved.json()["status_history"]] == ["new", "cutting"]
    assert len(await logged(session, "status_change")) == before + 1
    assert (await client.delete(url, headers=headers)).status_code == 422, "only while new"


async def test_a_new_order_can_be_deleted_and_is_audited(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    order = (await client.post(f"{API}/orders", json=order_body(), headers=headers)).json()
    url = f"{API}/orders/{order['order_id']}"
    assert (await client.delete(url, headers=headers)).status_code == 204
    assert (await client.get(url, headers=headers)).status_code == 404
    assert await logged(session, "order_delete")


async def test_orders_of_another_tailor_are_refused(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    order = (await client.post(f"{API}/orders", json=order_body(), headers=headers)).json()
    owner = next(c["tailor_id"] for c in SEED["clients"] if c["client_id"] == order["client_id"])
    other = next(
        u["email"]
        for u in SEED["users"]
        if u["role"] == "tailor"
        and u["status"] == "active"
        and u.get("user_id") != owner
        and u["email"] != TAILOR
    )
    stranger = await staff(client, other)
    url = f"{API}/orders/{order['order_id']}"
    assert (await client.get(url, headers=stranger)).status_code == 403
    assert (await client.delete(url, headers=stranger)).status_code == 403


# --- Ease ---


@pytest.mark.parametrize(("values", "expected"), [([62, 64, 70], 65), ([10, 20], 15), ([7], 5)])
def test_history_median_rounds_to_five(values: list[int], expected: int) -> None:
    assert rounded_median(values) == expected


async def test_ease_comes_from_defaults_presets_then_history(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    seed_client, profile = a_seed_profile()
    query = {
        "client_id": seed_client["client_id"],
        "profile_id": profile["profile_id"],
        "garment_type": "skirt",
    }

    async def chest() -> dict[str, Any]:
        rows = (await client.get(f"{API}/ease-suggestions", params=query, headers=headers)).json()
        return next(row for row in rows if row["site_code"] == "waist")

    assert await chest() == {"site_code": "waist", "ease_mm": 20, "source": "default", "n": 0}
    saved = await client.put(
        f"{API}/me/ease-presets",
        json=[{"garment_type": "skirt", "site_code": "waist", "ease_mm": 35}],
        headers=headers,
    )
    assert saved.status_code == 200
    assert (await chest())["source"] == "preset"
    body = order_body(garment_type="skirt")
    seeded = sum(
        1
        for order in SEED["orders"]
        if order["garment_type"] == "skirt"
        and any(item["site_code"] == "waist" for item in order["items"])
        and order["client_id"]
        in {c["client_id"] for c in SEED["clients"] if c["tailor_id"] == seed_client["tailor_id"]}
    )
    for _ in range(3):
        assert (await client.post(f"{API}/orders", json=body, headers=headers)).status_code == 201
    assert await chest() == {
        "site_code": "waist",
        "ease_mm": 20,
        "source": "history",
        "n": 3 + seeded,
    }


async def test_duplicate_presets_are_refused(client: AsyncClient) -> None:
    row = {"garment_type": "skirt", "site_code": "waist", "ease_mm": 35}
    reply = await client.put(
        f"{API}/me/ease-presets", json=[row, row], headers=await the_tailor(client)
    )
    assert reply.status_code == 422


# --- Audit ---


async def test_audit_shows_a_tailor_only_their_own_actions(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    page = (await client.get(f"{API}/audit", headers=headers, params={"page_size": 100})).json()
    assert page["items"]
    assert {row["user_email"] for row in page["items"]} == {TAILOR}
    filtered = await client.get(f"{API}/audit", params={"action": "login"}, headers=headers)
    assert {row["action"] for row in filtered.json()["items"]} == {"login"}
    admin = await client.get(
        f"{API}/audit", headers=await staff(client, "admin@vt.test"), params={"page_size": 100}
    )
    assert len({row["user_email"] for row in admin.json()["items"]}) > 1


# --- Who holds a code (D45) ---


async def freed(http: AsyncClient, headers: dict[str, str]) -> tuple[str, dict[str, Any]]:
    row = await client_for(http, headers, FREE_CODE)
    reply = await http.post(f"{API}/clients/{row['client_id']}/claim/free", headers=headers)
    assert reply.status_code == 200, reply.text
    return row["client_id"], reply.json()


async def test_freeing_lets_a_new_phone_claim_and_leaves_the_data(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    old = payload()
    assert (await upload(client, old)).status_code == 201
    assert (await upload(client, payload(version=2), OTHER_SECRET)).status_code == 403
    _, claim = await freed(client, headers)
    assert claim["claimed"] is False and claim["claim_round"] == 1
    assert [p["profile_id"] for p in claim["profiles"]] == [old["profile_id"]]
    new = payload(version=2)
    assert (await upload(client, new, OTHER_SECRET)).status_code == 201
    assert len(await logged(session, "code_reset")) == 1
    assert (await upload(client, payload(version=3), SECRET)).status_code == 403


async def test_a_new_claim_reaches_only_its_own_rows(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    victim = payload()
    assert (await upload(client, victim)).status_code == 201
    await freed(client, headers)
    mine = payload(version=2)
    assert (await upload(client, mine, OTHER_SECRET)).status_code == 201
    read = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof(OTHER_SECRET))
    assert [p["profile_id"] for p in read.json()["profiles"]] == [mine["profile_id"]]
    gone = await client.post(
        DELETE,
        json={"client_code": FREE_CODE, "reason": "delete"},
        headers=proof(OTHER_SECRET),
    )
    assert gone.json()["status"] == "partially_done"
    row = await client_for(client, headers, FREE_CODE)
    claim = (await client.get(f"{API}/clients/{row['client_id']}/claim", headers=headers)).json()
    assert [p["profile_id"] for p in claim["profiles"]] == [victim["profile_id"]]


async def test_a_forgers_replay_after_a_reset_reads_nothing(client: AsyncClient) -> None:
    """Final review A2: a stored body is proof of that row, not of the code."""
    headers = await the_tailor(client)
    forged = payload()
    assert (await upload(client, forged, OTHER_SECRET)).status_code == 201
    client_id, _ = await freed(client, headers)
    # The victim, after the reset, on the same code.
    victim = payload(version=2)
    assert (await upload(client, victim, SECRET)).status_code == 201
    await client.post(f"{API}/clients/{client_id}/claim/free", headers=headers)
    third = "ef" * 32
    # The forger's replay answers as a replay and claims nothing.
    assert (await upload(client, forged, third)).status_code == 201
    read = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof(third))
    assert read.status_code == 403
    gone = await client.post(
        DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof(third)
    )
    assert gone.json()["status"] == "received", "a replay proves nothing about the code"
    claim = (await client.get(f"{API}/clients/{client_id}/claim", headers=headers)).json()
    assert victim["profile_id"] in [p["profile_id"] for p in claim["profiles"]]


async def test_a_replay_cannot_claim_where_someone_elses_row_also_sits(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Rows from before proof of possession carry no owner, so two rows prove nothing."""
    from app.models import Client
    from sqlalchemy import update

    assert (await upload(client, payload())).status_code == 201
    forged = payload(version=2)
    assert (await upload(client, forged)).status_code == 201
    await session.execute(
        update(Client).where(Client.client_code == FREE_CODE).values(secret_hash=None)
    )
    await session.commit()
    assert (await upload(client, forged, OTHER_SECRET)).status_code == 201
    read = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof(OTHER_SECRET))
    assert read.status_code == 403


async def test_a_held_deletion_gets_through_after_a_reset_and_changes_nothing(
    client: AsyncClient,
) -> None:
    """The deadlock: an order-held profile on a freed code refused both deletion and upload."""
    headers = await the_tailor(client)
    seed_client, _ = a_seed_profile()
    reply = await client.post(
        f"{API}/clients/{seed_client['client_id']}/claim/free", headers=headers
    )
    assert reply.status_code == 200
    code = seed_client["client_code"]
    asked = await client.post(
        DELETE, json={"client_code": code, "reason": "delete"}, headers=proof()
    )
    assert asked.status_code == 202 and asked.json()["status"] == "received"
    assert (await upload(client, payload(code, version=50))).status_code == 201
    detail = await client.get(f"{API}/clients/{seed_client['client_id']}", headers=headers)
    assert detail.json()["deletion_requested"] is True


async def test_the_review_is_explicit_and_needs_a_freed_code(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    forged = payload()
    assert (await upload(client, forged)).status_code == 201
    withdraw = await client.post(
        DELETE, json={"client_code": FREE_CODE, "reason": "withdraw_consent"}, headers=proof()
    )
    assert withdraw.status_code == 202
    forged2 = payload()
    row = await client_for(client, headers, FREE_CODE)
    url = f"{API}/clients/{row['client_id']}/claim"
    held = await client.post(f"{url}/review", json={}, headers=headers)
    assert held.status_code == 422 and held.json()["errors"][0]["code"] == "claim_not_freed"

    claim = (await client.post(f"{url}/free", headers=headers)).json()
    assert claim["withdrawals"], "freeing shows the withdrawal"
    assert (await upload(client, forged2, OTHER_SECRET)).status_code == 422, "and does not clear it"

    consent = claim["withdrawals"][0]["consent_id"]
    cleared = await client.post(
        f"{url}/review", json={"clear_consent_ids": [consent]}, headers=headers
    )
    assert cleared.status_code == 200 and cleared.json()["withdrawals"] == []
    assert (await upload(client, forged2, OTHER_SECRET)).status_code == 201
    assert len(await logged(session, "claim_review")) == 1


async def test_supersede_refuses_a_profile_on_an_order_and_anothers_ids(
    client: AsyncClient,
) -> None:
    headers = await the_tailor(client)
    seed_client, _ = a_seed_profile()
    used = next(
        o["profile_id"] for o in SEED["orders"] if o["client_id"] == seed_client["client_id"]
    )
    url = f"{API}/clients/{seed_client['client_id']}/claim"
    await client.post(f"{url}/free", headers=headers)
    refused = await client.post(
        f"{url}/review", json={"supersede_profile_ids": [used]}, headers=headers
    )
    assert refused.json()["errors"][0]["code"] == "profile_on_order"
    foreign = next(
        p["profile_id"] for p in SEED["profiles"] if p["client_id"] != seed_client["client_id"]
    )
    refused = await client.post(
        f"{url}/review", json={"supersede_profile_ids": [foreign]}, headers=headers
    )
    assert refused.json()["errors"][0]["code"] == "not_this_client"


async def test_a_superseded_forged_profile_stays_visible_and_a_request_can_be_closed(
    client: AsyncClient,
) -> None:
    headers = await the_tailor(client)
    forged = payload()
    assert (await upload(client, forged)).status_code == 201
    row = await client_for(client, headers, FREE_CODE)
    url = f"{API}/clients/{row['client_id']}/claim"
    await client.post(f"{url}/free", headers=headers)
    asked = await client.post(
        DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof()
    )
    request_id = asked.json()["request_id"]
    done = await client.post(
        f"{url}/review",
        json={"supersede_profile_ids": [forged["profile_id"]], "close_request_ids": [request_id]},
        headers=headers,
    )
    assert done.status_code == 200, done.text
    assert done.json()["profiles"][0]["status"] == "superseded"
    assert done.json()["deletion_requests"][0]["status"] == "rejected"
    detail = await client.get(f"{API}/clients/{row['client_id']}", headers=headers)
    assert detail.json()["deletion_requested"] is False


async def test_the_claim_review_shows_a_deletion_that_wiped_the_tailors_details(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    row = await client_for(client, headers, FREE_CODE)
    await client.patch(
        f"{API}/clients/{row['client_id']}",
        json={"display_name": "Halima", "height_mm": 1700},
        headers=headers,
    )
    assert (await upload(client, payload())).status_code == 201
    wiped = await client.post(
        DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof()
    )
    assert wiped.status_code == 202
    claim = (await client.get(f"{API}/clients/{row['client_id']}/claim", headers=headers)).json()
    assert claim["deletion_requests"][0]["details_cleared"] is True
    assert (await logged(session, "client_update"))[0].detail == {
        "fields": ["display_name", "height_mm"]
    }
    # No names or measurements in the audit detail.
    for entry in await logged(session, "deletion_request"):
        assert "Halima" not in str(entry.detail)
