"""Study exports match backend-spec 12.1 exactly and carry no names or contacts."""

import csv
import io
import json
from datetime import UTC, datetime
from pathlib import Path

from app.models import Consent, Participant
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

PREFIX = "/api/v1"
SITES = ["stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck"]
CHECKS = ["level", "frame", "distance", "symmetry", "arms", "marker", "light", "sharpness"]
CAPTURE_COLUMNS = (
    "participant_code, cohort, set_no, capture_mode, camera_facing, captured_at, device_model, "
    "os, browser, model_variant, rules_version_used, rederived_rules_version, lighting, "
    "distance_m, clothing_fit_observed, lux"
).split(", ")
CAPTURE_COLUMNS += [f"front_{c}" for c in CHECKS] + [f"side_{c}" for c in CHECKS]
CAPTURE_COLUMNS += [
    "scale_front_mm_px", "scale_side_mm_px", "scale_stature_mm_px", "scale_disagreement_pct",
    "processing_ms", "retake_count",
]  # fmt: skip
for _site in SITES:
    CAPTURE_COLUMNS += [f"{_site}_cm", f"{_site}_flag"]
CAPTURE_COLUMNS.append("server_checks")
REFERENCE_COLUMNS = [
    "participant_code", "cohort", "site_code", "measurer_code", "reading_no", "value_cm",
    "taken_at",
]  # fmt: skip


def rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


async def admin(client: AsyncClient) -> dict[str, str]:
    return bearer(await sign_in(client, "admin@vt.test"))


async def test_captures_columns_match_the_spec_exactly(client: AsyncClient) -> None:
    reply = await client.get(f"{PREFIX}/study/export/captures.csv", headers=await admin(client))
    assert reply.status_code == 200
    assert reply.headers["content-type"].startswith("text/csv")
    header = next(csv.reader(io.StringIO(reply.text)))
    assert header == CAPTURE_COLUMNS
    body = rows(reply.text)
    assert body, "the seed has study capture sets"
    first = body[0]
    assert first["participant_code"].startswith("P")
    assert first["chest_cm"] == "" or "." in first["chest_cm"]


async def test_reference_columns_match_the_spec_exactly(client: AsyncClient) -> None:
    reply = await client.get(f"{PREFIX}/study/export/reference.csv", headers=await admin(client))
    assert reply.status_code == 200
    header = next(csv.reader(io.StringIO(reply.text)))
    assert header == REFERENCE_COLUMNS
    body = rows(reply.text)
    assert len(body) == 63
    assert all(row["value_cm"].count(".") == 1 for row in body)


async def test_exports_hold_no_names_or_contacts(client: AsyncClient) -> None:
    seed = json.loads((Path(__file__).parents[3] / "packages/seed/seed.json").read_text())
    names = [c["display_name"] for c in seed["clients"] if c.get("display_name")]
    codes = [c["client_code"] for c in seed["clients"]]
    headers = await admin(client)
    for name in ("captures.csv", "reference.csv"):
        text = (await client.get(f"{PREFIX}/study/export/{name}", headers=headers)).text
        for word in ["@", "+254", "display_name", "email", *names, *codes]:
            assert word not in text, (name, word)


async def test_a_correction_replaces_the_value_in_the_export(client: AsyncClient) -> None:
    headers = await admin(client)
    readings = await client.get(
        f"{PREFIX}/admin/study/reference-readings",
        params={"participant_code": "P001"},
        headers=headers,
    )
    assert readings.status_code == 200
    target = readings.json()[0]
    fixed = await client.post(
        f"{PREFIX}/admin/study/reference-readings/{target['ref_id']}/corrections",
        json={"value_mm": 1234, "reason": "Typed 1324"},
        headers=headers,
    )
    assert fixed.status_code == 201
    assert fixed.json()["value_mm"] == target["value_mm"]
    assert fixed.json()["correction"]["value_mm"] == 1234
    body = rows((await client.get(f"{PREFIX}/study/export/reference.csv", headers=headers)).text)
    match = [
        row for row in body
        if row["participant_code"] == "P001" and row["site_code"] == target["site_code"]
        and row["measurer_code"] == target["measurer_code"]
        and row["reading_no"] == str(target["reading_no"])
    ]  # fmt: skip
    assert [row["value_cm"] for row in match] == ["123.4"]


async def test_withdrawn_participants_leave_the_exports(
    client: AsyncClient, session: AsyncSession
) -> None:
    participant = await session.scalar(
        select(Participant).where(Participant.participant_code == "P001")
    )
    assert participant
    await session.execute(
        update(Consent)
        .where(Consent.client_id == participant.client_id)
        .values(withdrawn_at=datetime(2026, 11, 1, 10, tzinfo=UTC))
    )
    await session.commit()
    headers = await admin(client)
    for name in ("captures.csv", "reference.csv"):
        text = (await client.get(f"{PREFIX}/study/export/{name}", headers=headers)).text
        assert "P001" not in text, name
    listed = (await client.get(f"{PREFIX}/study/participants", headers=headers)).json()
    assert next(p for p in listed if p["participant_code"] == "P001")["withdrawn"] is True


async def test_an_unknown_rules_version_is_refused(client: AsyncClient) -> None:
    reply = await client.get(
        f"{PREFIX}/study/export/captures.csv",
        params={"rules_version": "9.9-nothing"},
        headers=await admin(client),
    )
    assert reply.status_code == 404
    assert reply.json()["code"] == "rules_version_unknown"


async def test_exports_are_audited(client: AsyncClient, session: AsyncSession) -> None:
    from app.models import AuditLog

    headers = await admin(client)
    await client.get(f"{PREFIX}/study/export/reference.csv", headers=headers)
    row = await session.scalar(
        select(AuditLog).where(AuditLog.action == "export", AuditLog.entity_id == "reference.csv")
    )
    assert row and row.detail["rows"] == 63
