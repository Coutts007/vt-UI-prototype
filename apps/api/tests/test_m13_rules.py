"""The rules registry, freezing, re-derivation and the calibration bundle (spec 10.6, 11; M13)."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from app.models import Measurement, MeasurementDerivation, RulesVersion
from app.services.calibration_export import calibration_bundle
from app.services.rules import checksum_of, lookup_rules
from fastapi import FastAPI
from httpx import AsyncClient
from jsonschema import Draft202012Validator, FormatChecker
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, owner_execute, sign_in
from vt_ml.calibrate import calibrate
from vt_ml.data import CalibrationRepository

PREFIX = "/api/v1"
RULES = Path(__file__).parents[3] / "packages/rules"
BASE = json.loads((RULES / "rules-0.1-uncalibrated.json").read_text())
SCHEMA = json.loads((RULES / "schema.json").read_text())
SEED = json.loads((Path(__file__).parents[3] / "packages/seed/seed.json").read_text())


def draft(version: str = "0.2-test", **changes: Any) -> dict[str, Any]:
    artifact = copy.deepcopy(BASE)
    artifact["rules_version"] = version
    artifact["parent"] = BASE["rules_version"]
    artifact["levels"]["waist"] = 0.58
    artifact.update(changes)
    artifact["checksum"] = checksum_of(artifact)
    return artifact


async def admin(client: AsyncClient) -> dict[str, str]:
    return bearer(await sign_in(client, "admin@vt.test"))


async def register(client: AsyncClient, artifact: dict[str, Any]) -> dict[str, Any]:
    reply = await client.post(f"{PREFIX}/admin/rules", json=artifact, headers=await admin(client))
    assert reply.status_code == 201, reply.text
    return reply.json()


async def freeze(client: AsyncClient, version: str) -> dict[str, Any]:
    reply = await client.post(f"{PREFIX}/admin/rules/{version}/freeze", headers=await admin(client))
    assert reply.status_code == 200, reply.text
    return reply.json()


async def audit_rows(session: AsyncSession, action: str, entity: str) -> list[dict[str, Any]]:
    from app.models import AuditLog

    rows = await session.scalars(
        select(AuditLog).where(AuditLog.action == action, AuditLog.entity_id == entity)
    )
    return [row.detail for row in rows]


# ---- listing and registering ----


async def test_the_list_shows_the_shipped_file_as_current(client: AsyncClient) -> None:
    reply = await client.get(f"{PREFIX}/admin/rules", headers=await admin(client))
    assert reply.status_code == 200
    rows = {row["rules_version"]: row for row in reply.json()}
    base = rows[BASE["rules_version"]]
    assert base["status"] == "draft" and base["is_current"] and base["frozen_at"] is None
    assert base["checksum"] == BASE["checksum"]


async def test_registering_a_draft_is_audited_without_values(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = await register(client, draft())
    assert body["status"] == "draft" and body["parent"] == BASE["rules_version"]
    assert body["is_current"] is False and body["frozen_at"] is None
    listed = {
        r["rules_version"]
        for r in (await client.get(f"{PREFIX}/admin/rules", headers=await admin(client))).json()
    }
    assert {"0.2-test", BASE["rules_version"]} <= listed
    [detail] = await audit_rows(session, "rules_register", "0.2-test")
    assert detail["checksum"] == body["checksum"] and detail["parent"] == BASE["rules_version"]
    assert "levels" not in json.dumps(detail)


@pytest.mark.parametrize(
    ("change", "field", "code"),
    [
        (lambda a: a.update(checksum="sha256:" + "0" * 64), "checksum", "mismatch"),
        (lambda a: a.update(status="frozen"), "status", "must_be_draft"),
        (lambda a: a.update(rules_version=BASE["rules_version"]), "rules_version", "exists"),
        (lambda a: a.update(parent="0.0-nowhere"), "parent", "unknown"),
        (lambda a: a["levels"].update(waist="high"), "levels/waist", "schema"),
        (lambda a: a.update(extra="x" * 300), "artifact", "schema"),  # unknown key: root
    ],
)
async def test_a_bad_draft_is_refused_with_the_field_named(
    client: AsyncClient, change: Any, field: str, code: str
) -> None:
    artifact = draft()
    change(artifact)
    if code != "mismatch":
        artifact["checksum"] = checksum_of(artifact)
    reply = await client.post(f"{PREFIX}/admin/rules", json=artifact, headers=await admin(client))
    assert reply.status_code == 422, reply.text
    assert reply.json()["code"] == "validation_failed"
    assert {"field": field, "code": code} in reply.json()["errors"]


async def test_the_same_version_cannot_be_registered_twice(client: AsyncClient) -> None:
    await register(client, draft())
    reply = await client.post(f"{PREFIX}/admin/rules", json=draft(), headers=await admin(client))
    assert reply.status_code == 422
    assert {"field": "rules_version", "code": "exists"} in reply.json()["errors"]


# ---- freezing ----


async def test_freezing_is_one_way_and_keeps_the_checksum(
    client: AsyncClient, session: AsyncSession, owner_url: str
) -> None:
    registered = await register(client, draft())
    frozen = await freeze(client, "0.2-test")
    assert frozen["status"] == "frozen" and frozen["frozen_at"] is not None
    assert frozen["checksum"] == registered["checksum"]
    # Served to the phone as frozen, with the registry's status inside the artifact.
    served = await client.get(f"{PREFIX}/rules/0.2-test")
    assert served.status_code == 200
    assert served.json()["status"] == "frozen" and served.json()["checksum"] == frozen["checksum"]
    assert checksum_of(served.json()) == frozen["checksum"]
    # Freezing again changes nothing and leaves one audit row.
    again = await freeze(client, "0.2-test")
    assert again["frozen_at"] == frozen["frozen_at"]
    assert len(await audit_rows(session, "rules_freeze", "0.2-test")) == 1
    # The database refuses every change to a frozen row, even from its owner.
    for statement in (
        "UPDATE rules_version SET artifact = jsonb_set(artifact, '{levels,waist}', '0.5') "
        "WHERE rules_version = '0.2-test'",
        "UPDATE rules_version SET checksum = 'sha256:x' WHERE rules_version = '0.2-test'",
        "UPDATE rules_version SET status = 'draft' WHERE rules_version = '0.2-test'",
        "DELETE FROM rules_version WHERE rules_version = '0.2-test'",
    ):
        with pytest.raises(Exception, match="immutable|cannot be deleted"):
            await owner_execute(owner_url, statement)
    # Retiring is the one step left.
    await owner_execute(
        owner_url, "UPDATE rules_version SET status = 'retired' WHERE rules_version = '0.2-test'"
    )
    with pytest.raises(Exception, match="retired"):
        await owner_execute(
            owner_url, "UPDATE rules_version SET status = 'frozen' WHERE rules_version = '0.2-test'"
        )


async def test_a_draft_is_not_served_to_the_phone_until_frozen_or_current(
    client: AsyncClient,
) -> None:
    await register(client, draft())
    assert (await client.get(f"{PREFIX}/rules/0.2-test")).status_code == 404


async def test_freezing_an_unknown_version_is_404(client: AsyncClient) -> None:
    reply = await client.post(
        f"{PREFIX}/admin/rules/9.9-nowhere/freeze", headers=await admin(client)
    )
    assert reply.status_code == 404 and reply.json()["code"] == "rules_version_unknown"


async def test_the_shipped_file_can_be_frozen_through_the_registry(
    client: AsyncClient, session: AsyncSession
) -> None:
    frozen = await freeze(client, BASE["rules_version"])
    assert frozen["status"] == "frozen" and frozen["is_current"]
    row = await session.get(RulesVersion, BASE["rules_version"])
    assert row is not None and row.status == "frozen" and row.checksum == BASE["checksum"]
    served = await client.get(f"{PREFIX}/rules/current")
    assert served.json()["status"] == "frozen"
    listed = (await client.get(f"{PREFIX}/admin/rules", headers=await admin(client))).json()
    assert [r["rules_version"] for r in listed].count(BASE["rules_version"]) == 1


async def test_a_tampered_registry_row_is_never_computed_with(
    client: AsyncClient, session: AsyncSession, owner_url: str, app: FastAPI
) -> None:
    await register(client, draft())
    await owner_execute(
        owner_url,
        "UPDATE rules_version SET artifact = jsonb_set(artifact, '{levels,waist}', '0.5') "
        "WHERE rules_version = '0.2-test'",
    )
    assert await lookup_rules(app.state.rules, session, "0.2-test") is None
    # It cannot be frozen either, and it is refused wherever it would be used.
    reply = await client.post(f"{PREFIX}/admin/rules/0.2-test/freeze", headers=await admin(client))
    assert reply.status_code == 404 and reply.json()["code"] == "rules_version_unknown"
    assert (await client.get(f"{PREFIX}/rules/0.2-test")).status_code == 404


async def test_a_shipped_file_that_drifts_from_its_frozen_record_is_refused(
    client: AsyncClient, session: AsyncSession, app: FastAPI
) -> None:
    """The registry keeps the checksum of what was frozen; the file in packages/rules must match."""
    await freeze(client, BASE["rules_version"])
    assert (await client.get(f"{PREFIX}/rules/{BASE['rules_version']}")).status_code == 200
    drifted = copy.deepcopy(BASE)
    drifted["levels"]["waist"] = 0.61
    drifted["checksum"] = checksum_of(drifted)
    app.state.rules = {**app.state.rules, BASE["rules_version"]: drifted}
    assert await lookup_rules(app.state.rules, session, BASE["rules_version"]) is None
    assert (await client.get(f"{PREFIX}/rules/{BASE['rules_version']}")).status_code == 404


# ---- the current version ----


async def test_a_registered_version_becomes_current_only_once_frozen(client: AsyncClient) -> None:
    await register(client, draft())
    headers = await admin(client)
    reply = await client.put(
        f"{PREFIX}/admin/settings", json={"current_rules_version": "0.2-test"}, headers=headers
    )
    assert reply.status_code == 422
    assert {"field": "current_rules_version", "code": "not_frozen"} in reply.json()["errors"]
    reply = await client.put(
        f"{PREFIX}/admin/settings", json={"current_rules_version": "9.9-nowhere"}, headers=headers
    )
    assert {"field": "current_rules_version", "code": "unknown"} in reply.json()["errors"]
    await freeze(client, "0.2-test")
    reply = await client.put(
        f"{PREFIX}/admin/settings", json={"current_rules_version": "0.2-test"}, headers=headers
    )
    assert reply.status_code == 200 and reply.json()["current_rules_version"] == "0.2-test"
    assert (await client.get(f"{PREFIX}/rules/current")).json()["rules_version"] == "0.2-test"
    listed = (await client.get(f"{PREFIX}/admin/rules", headers=headers)).json()
    assert [r["rules_version"] for r in listed if r["is_current"]] == ["0.2-test"]


# ---- re-derivation ----


async def test_rederive_needs_a_frozen_version(client: AsyncClient) -> None:
    headers = await admin(client)
    reply = await client.post(
        f"{PREFIX}/admin/rederive",
        params={"rules_version": "9.9-nowhere", "cohort": "test"},
        headers=headers,
    )
    assert reply.status_code == 404 and reply.json()["code"] == "rules_version_unknown"
    await register(client, draft())
    reply = await client.post(
        f"{PREFIX}/admin/rederive",
        params={"rules_version": "0.2-test", "cohort": "test"},
        headers=headers,
    )
    assert reply.status_code == 409 and reply.json()["code"] == "rules_not_frozen"
    reply = await client.post(
        f"{PREFIX}/admin/rederive",
        params={"rules_version": "0.2-test", "cohort": "everyone"},
        headers=headers,
    )
    assert reply.status_code == 422


async def test_rederive_fills_its_own_table_and_leaves_originals_alone(
    client: AsyncClient, session: AsyncSession
) -> None:
    before = sorted(
        (str(r.profile_id), r.site_code, r.value_mm)
        for r in await session.scalars(select(Measurement))
    )
    await register(client, draft())
    await freeze(client, "0.2-test")
    headers = await admin(client)
    reply = await client.post(
        f"{PREFIX}/admin/rederive",
        params={"rules_version": "0.2-test", "cohort": "calibration"},
        headers=headers,
    )
    assert reply.status_code == 200, reply.text
    body = reply.json()
    expected = len(
        [
            p
            for p in SEED["profiles"]
            if p.get("session", {}).get("study", {}).get("cohort") == "calibration"
            or p.get("study", {}).get("cohort") == "calibration"
        ]
    )
    assert body == {
        "rules_version": "0.2-test",
        "cohort": "calibration",
        "profiles_processed": body["profiles_processed"],
    }
    assert body["profiles_processed"] >= 1
    if expected:
        assert body["profiles_processed"] == expected
    rows = list(
        await session.scalars(
            select(MeasurementDerivation).where(MeasurementDerivation.rules_version == "0.2-test")
        )
    )
    assert len(rows) == body["profiles_processed"] * 9
    assert {r.confidence_flag for r in rows} <= {"pass", "check", "fail"}
    after = sorted(
        (str(r.profile_id), r.site_code, r.value_mm)
        for r in await session.scalars(select(Measurement))
    )
    assert after == before
    # Running again replaces, never duplicates.
    again = await client.post(
        f"{PREFIX}/admin/rederive",
        params={"rules_version": "0.2-test", "cohort": "calibration"},
        headers=headers,
    )
    assert again.json() == body
    count = await session.scalar(
        select(func.count())
        .select_from(MeasurementDerivation)
        .where(MeasurementDerivation.rules_version == "0.2-test")
    )
    assert count == len(rows)
    details = await audit_rows(session, "rederive", "0.2-test")
    assert len(details) == 2  # each run is audited
    assert all(
        d == {"cohort": "calibration", "profiles_processed": body["profiles_processed"]}
        for d in details
    )


# ---- the calibration bundle and the learner on the seed cohort ----


async def test_the_bundle_holds_the_calibration_cohort_only_and_no_names(
    session: AsyncSession,
) -> None:
    bundle = await calibration_bundle(session)
    assert bundle["format"] == "vt-calibration-bundle/1"
    codes = [p["participant_code"] for p in bundle["participants"]]
    expected = sorted(
        p["participant_code"] for p in SEED["participants"] if p["cohort"] == "calibration"
    )
    assert codes == expected
    assert all(p["cohort"] == "calibration" for p in bundle["participants"])
    text = json.dumps(bundle)
    for client_row in SEED["clients"]:
        if client_row.get("display_name"):
            assert client_row["display_name"] not in text
        assert client_row["client_code"] not in text
    for user in SEED["users"]:
        assert user["email"] not in text
    readings = sum(len(p["readings"]) for p in bundle["participants"])
    assert readings == len(
        [r for r in SEED["reference_readings"] if r["participant_code"] in codes]
    )
    sets = sum(len(p["sets"]) for p in bundle["participants"])
    assert sets >= 1
    first = bundle["participants"][0]["sets"][0]["profile"]
    assert set(first) == {
        "covariates", "session", "landmarks_front", "landmarks_side",
        "marker_front", "marker_side", "silhouette_front", "silhouette_side",
    }  # fmt: skip


async def test_vt_ml_calibrate_runs_end_to_end_on_the_seed_cohort(session: AsyncSession) -> None:
    bundle = await calibration_bundle(session)
    people = CalibrationRepository(bundle).calibration_data()
    assert len(people) == 2
    # The seed's calibration participants have 2 and 1 tape readings a site, below the 4-reading
    # protocol, so under the protocol nothing can be fitted and every prior stays: the right answer.
    fit = calibrate(
        people, BASE, version="0.2-seed", created_at="2026-11-03T00:00:00Z", resamples=50
    )
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(fit.artifact)
    assert fit.artifact["status"] == "draft"
    assert fit.artifact["fit"]["n_participants"] == 0
    assert fit.artifact["levels"] == BASE["levels"]
    assert {row["reason"] for row in fit.tables["exclusions"]} == {"tape_incomplete"}
    assert fit.artifact["checksum"] == checksum_of(fit.artifact)
    # Allowing single readings, both take part; two people still cannot pick a level.
    loose = calibrate(
        people, BASE, version="0.2-seed", created_at="2026-11-03T00:00:00Z", resamples=50,
        min_readings=1,
    )  # fmt: skip
    assert loose.artifact["fit"]["n_participants"] == 2
    assert "below the 4-reading protocol" in loose.artifact["fit"]["notes"]
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(loose.artifact)


async def test_the_cli_runs_end_to_end_on_the_seed_bundle(
    session: AsyncSession, tmp_path: Path
) -> None:
    """Export, then vt-ml calibrate: an artifact, a report folder and a model card come out."""
    from typer.testing import CliRunner
    from vt_ml.cli import cli

    bundle = tmp_path / "bundle.json"
    bundle.write_text(json.dumps(await calibration_bundle(session)))
    out, report, card = tmp_path / "rules-0.2-seed.json", tmp_path / "report", tmp_path / "card.md"
    result = CliRunner().invoke(cli, [
        "calibrate", "--data", str(bundle), "--base", str(RULES / "rules-0.1-uncalibrated.json"),
        "--version", "0.2-seed", "--out", str(out), "--report", str(report), "--card", str(card),
        "--resamples", "50", "--created-at", "2026-11-03T00:00:00Z", "--label", "seed cohort",
    ])  # fmt: skip
    assert result.exit_code == 0, result.output
    artifact = json.loads(out.read_text())
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(artifact)
    assert artifact["checksum"] == checksum_of(artifact)
    text = card.read_text()
    assert "Status: draft" in text and "seed cohort" in text and "prior kept" in text
    assert (report / "exclusions.csv").exists()
