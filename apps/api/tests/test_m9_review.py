"""What the independent review of the tailor slice found (M9, D45)."""

import re
from pathlib import Path
from typing import Any

from app.models import Consent, MeasurementProfile
from httpx import AsyncClient
from ingest_support import FREE_CODE, OTHER_SECRET, SECRET, SEED, payload, proof
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from test_m9_tailor import (
    ACCESS,
    API,
    DELETE,
    a_seed_profile,
    client_for,
    freed,
    items_of,
    logged,
    order_body,
    the_tailor,
    upload,
)


def scaled(body: dict[str, Any], factor: float = 1.3) -> dict[str, Any]:
    for row in body["measurements"]:
        if row["value_mm"]:
            row["value_mm"] = int(row["value_mm"] * factor)
    return body


def details(checks: list[dict[str, Any]]) -> str:
    return " ".join(str(row["detail"]) for row in checks)


# --- The blocker: earlier rounds stay out of what a new phone is told ---


async def free_seed_client(http: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    client, _ = a_seed_profile()
    reply = await http.post(f"{API}/clients/{client['client_id']}/claim/free", headers=headers)
    assert reply.status_code == 200, reply.text
    return client


async def test_next_phone_is_not_told_the_earlier_measurements(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    await free_seed_client(client, headers)
    reply = await upload(client, scaled(payload("AB1001", version=50)), OTHER_SECRET)
    assert reply.status_code == 201, reply.text
    checks = reply.json()["server_checks"]
    assert not [row for row in checks if row["kind"] == "change_since_last"]
    assert "before_mm" not in details(checks)


async def test_change_since_last_still_works_within_a_round(client: AsyncClient) -> None:
    assert (await upload(client, payload(version=1))).status_code == 201
    reply = await upload(client, scaled(payload(version=2)))
    assert [row for row in reply.json()["server_checks"] if row["kind"] == "change_since_last"]


async def test_a_phone_never_learns_the_height_the_tailor_typed(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    row = await client_for(client, headers, FREE_CODE)
    await client.patch(
        f"{API}/clients/{row['client_id']}", json={"height_mm": 1200}, headers=headers
    )
    body = payload()
    reply = await upload(client, body)
    assert reply.status_code == 201
    assert "recorded_mm" not in details(reply.json()["server_checks"])
    assert not [c for c in reply.json()["server_checks"] if c["kind"] == "height_mismatch"]
    read = await client.post(ACCESS, json={"client_code": FREE_CODE}, headers=proof())
    assert "recorded_mm" not in str(read.json())
    # The tailor still sees it.
    view = await client.get(f"{API}/profiles/{body['profile_id']}", headers=headers)
    assert "recorded_mm" in str(view.json()["server_checks"])


async def test_a_low_version_after_a_reset_goes_to_the_tailor_and_tells_the_phone_nothing(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    await free_seed_client(client, headers)
    body = payload("AB1001", version=1)
    reply = await upload(client, body, OTHER_SECRET)
    assert reply.status_code == 201, reply.text
    assert "server_version" not in reply.text and reply.json()["version"] == 1
    conflicts = (await client.get(f"{API}/conflicts", headers=headers)).json()
    assert body["profile_id"] in {c["incoming_profile"]["profile_id"] for c in conflicts}
    again = await upload(client, body, OTHER_SECRET)
    assert again.status_code == 201 and "server_version" not in again.text


async def test_a_conflict_within_a_round_still_answers_409(client: AsyncClient) -> None:
    assert (await upload(client, payload(version=3))).status_code == 201
    reply = await upload(client, payload(version=2))
    assert reply.status_code == 409 and reply.json()["server_version"] == 3


# --- Finding 1 ---


async def test_reading_conflicts_is_audited_per_profile(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    before = len(await logged(session, "profile_view"))
    conflicts = (await client.get(f"{API}/conflicts", headers=headers)).json()
    assert conflicts
    session.expire_all()
    views = await logged(session, "profile_view")
    assert len(views) == before + 2 * len(conflicts)


# --- Findings 2 and 3 ---


async def stranded(http: AsyncClient, headers: dict[str, str]) -> tuple[str, str, str]:
    forged = payload(version=5)
    assert (await upload(http, forged, OTHER_SECRET)).status_code == 201
    client_id, _ = await freed(http, headers)
    genuine = payload(version=1)
    assert (await upload(http, genuine, SECRET)).status_code == 201
    await http.post(f"{API}/clients/{client_id}/claim/free", headers=headers)
    return client_id, forged["profile_id"], genuine["profile_id"]


async def test_superseding_the_forgery_leaves_the_genuine_row_usable_and_audited(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    client_id, forged, genuine = await stranded(client, headers)
    reply = await client.post(
        f"{API}/clients/{client_id}/claim/review",
        json={"supersede_profile_ids": [forged], "clear_consent_ids": [], "close_request_ids": []},
        headers=headers,
    )
    assert reply.status_code == 200, reply.text
    rows = {p["profile_id"]: p["status"] for p in reply.json()["profiles"]}
    assert rows == {forged: "superseded", genuine: "final"}
    audited = await logged(session, "conflict_resolve")
    assert len(audited) == 1 and audited[0].user_id is not None
    assert audited[0].detail["keep"] == "newer"
    session.expire_all()
    assert (await session.get(MeasurementProfile, genuine)).version == 6


async def test_review_audit_names_what_it_touched_and_keeps_the_withdrawal_date(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    body = payload()
    assert (await upload(client, body)).status_code == 201
    assert (
        await client.post(
            DELETE, json={"client_code": FREE_CODE, "reason": "withdraw_consent"}, headers=proof()
        )
    ).status_code == 202
    client_id, claim = await freed(client, headers)
    consent_id = claim["withdrawals"][0]["consent_id"]
    withdrawn_at = claim["withdrawals"][0]["withdrawn_at"]
    forged = payload(version=2)
    assert (await upload(client, forged, OTHER_SECRET)).status_code in (201, 422)
    await client.post(f"{API}/clients/{client_id}/claim/free", headers=headers)
    reply = await client.post(
        f"{API}/clients/{client_id}/claim/review",
        json={
            "supersede_profile_ids": [],
            "clear_consent_ids": [consent_id],
            "close_request_ids": [],
        },
        headers=headers,
    )
    assert reply.status_code == 200, reply.text
    rows = await logged(session, "claim_review")
    named = [row.detail for row in rows if row.detail.get("consent_id") == consent_id]
    assert named and named[0]["withdrawn_at"][:19] == withdrawn_at[:19]
    assert (
        await session.scalar(select(Consent).where(Consent.consent_id == consent_id))
    ) is not None


async def test_review_audit_names_superseded_profiles(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await the_tailor(client)
    client_id, forged, _ = await stranded(client, headers)
    await client.post(
        f"{API}/clients/{client_id}/claim/review",
        json={"supersede_profile_ids": [forged], "clear_consent_ids": [], "close_request_ids": []},
        headers=headers,
    )
    rows = await logged(session, "claim_review")
    assert forged in [row.detail.get("profile_id") for row in rows]


# --- Finding 4 ---


async def test_banner_ends_when_the_request_is_done(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    assert (await upload(client, payload())).status_code == 201
    done = await client.post(
        DELETE, json={"client_code": FREE_CODE, "reason": "delete"}, headers=proof()
    )
    assert done.json()["status"] == "done"
    row = await client_for(client, headers, FREE_CODE)
    detail = (await client.get(f"{API}/clients/{row['client_id']}", headers=headers)).json()
    assert detail["deletion_requested"] is False


# --- Finding 6 ---


def flagged_seed() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """A final profile of this tailor with a flagged row among a shirt's sites."""
    tailor_id = a_seed_profile()[0]["tailor_id"]
    for profile in SEED["profiles"]:
        client = next(c for c in SEED["clients"] if c["client_id"] == profile["client_id"])
        if client["tailor_id"] != tailor_id or profile["status"] != "final":
            continue
        for row in profile["measurements"]:
            if row["confidence_flag"] == "check" and row["site_code"] in {
                "shoulder",
                "chest",
                "waist",
                "sleeve",
                "neck",
            }:
                return client, profile, row
    raise AssertionError("the seed has no flagged shirt row")


async def test_a_flagged_row_cannot_be_left_out(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    seed_client, profile, flagged = flagged_seed()
    rows = [r for r in items_of(profile) if r["site_code"] != flagged["site_code"]]
    reply = await client.post(
        f"{API}/orders",
        json=order_body(
            client_id=seed_client["client_id"], profile_id=profile["profile_id"], items=rows
        ),
        headers=headers,
    )
    assert reply.status_code == 422
    assert reply.json()["errors"][0]["code"] == "flag_not_confirmed"


async def test_flagged_rows_of_other_garments_can_be_left_out(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    seed_client, profile, flagged = flagged_seed()
    garment = "skirt" if flagged["site_code"] not in {"waist"} else "trousers"
    sites = {"skirt": {"waist", "hip", "outleg"}, "trousers": {"waist", "hip", "outleg", "inleg"}}
    rows = [r for r in items_of(profile) if r["site_code"] in sites[garment]]
    flags = {m["site_code"]: m["confidence_flag"] for m in profile["measurements"]}
    if flagged["site_code"] == "waist" or any(flags[r["site_code"]] == "check" for r in rows):
        rows = items_of(profile)
        garment = "shirt"
    reply = await client.post(
        f"{API}/orders",
        json=order_body(
            client_id=seed_client["client_id"],
            profile_id=profile["profile_id"],
            garment_type=garment,
            items=rows,
        ),
        headers=headers,
    )
    assert reply.status_code == 201, reply.text


async def test_an_override_must_change_the_value(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    seed_client, profile, flagged = flagged_seed()
    rows = items_of(profile)
    for row in rows:
        if row["site_code"] == flagged["site_code"]:
            row.update(overridden=True, flag_confirmed=False)
    reply = await client.post(
        f"{API}/orders",
        json=order_body(
            client_id=seed_client["client_id"], profile_id=profile["profile_id"], items=rows
        ),
        headers=headers,
    )
    assert reply.status_code == 422
    assert reply.json()["errors"][0]["code"] == "override_unchanged"


async def test_an_order_cannot_use_a_row_in_conflict(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    conflict = (await client.get(f"{API}/conflicts", headers=headers)).json()[0]
    profile = next(
        p for p in SEED["profiles"] if p["profile_id"] == conflict["incoming_profile"]["profile_id"]
    )
    reply = await client.post(
        f"{API}/orders",
        json=order_body(
            client_id=conflict["client_id"],
            profile_id=profile["profile_id"],
            items=items_of(profile),
        ),
        headers=headers,
    )
    assert reply.status_code == 422
    assert reply.json()["errors"][0]["code"] == "profile_in_conflict"


async def test_a_collected_order_keeps_its_items(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    made = (await client.post(f"{API}/orders", json=order_body(), headers=headers)).json()
    url = f"{API}/orders/{made['order_id']}"
    assert (
        await client.patch(url, json={"status": "collected"}, headers=headers)
    ).status_code == 200
    _, profile = a_seed_profile()
    reply = await client.patch(url, json={"items": items_of(profile)}, headers=headers)
    assert reply.status_code == 422
    assert reply.json()["errors"][0]["code"] == "order_collected"


def test_garment_sites_match_the_order_form() -> None:
    from app.api.v1.orders import GARMENT_SITES

    source = (Path(__file__).parents[3] / "apps/web/src/views/tailor/common.tsx").read_text()
    block = source[source.index("GARMENT_SITES:") : source.index("const MM_PER_INCH")]
    for garment, sites in re.findall(r"(\w+): \[([^\]]+)\]", block):
        assert GARMENT_SITES[garment] == frozenset(re.findall(r"'(\w+)'", sites))


# --- Finding 7's contract, finding 8 ---


async def test_profile_list_says_which_round_each_row_is_from(client: AsyncClient) -> None:
    headers = await the_tailor(client)
    seed_client = await free_seed_client(client, headers)
    body = payload("AB1001", version=50)
    assert (await upload(client, body, OTHER_SECRET)).status_code == 201
    rows = (
        await client.get(f"{API}/clients/{seed_client['client_id']}/profiles", headers=headers)
    ).json()
    rounds = {row["profile_id"]: row["claim_round"] for row in rows}
    assert rounds[body["profile_id"]] == 1 and 0 in rounds.values()


async def test_rotating_locks_the_client_row(client: AsyncClient, monkeypatch: Any) -> None:
    locked: list[Any] = []
    original = AsyncSession.refresh

    async def spy(self: AsyncSession, instance: Any, *args: Any, **kwargs: Any) -> None:
        locked.append(kwargs.get("with_for_update"))
        await original(self, instance, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "refresh", spy)
    headers = await the_tailor(client)
    row = await client_for(client, headers, FREE_CODE)
    reply = await client.post(f"{API}/clients/{row['client_id']}/rotate-code", headers=headers)
    assert reply.status_code == 200
    assert any(locked)
