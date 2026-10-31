import importlib.util
import json
from collections import Counter
from datetime import date
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).parents[1]
CONTRACT = yaml.safe_load((ROOT.parent / "contracts" / "openapi.yaml").read_text())
SEED = json.loads((ROOT / "seed.json").read_text())
REGISTRY = Registry().with_resource(
    "urn:vt:contract", Resource.from_contents(CONTRACT, default_specification=DRAFT202012)
)

spec = importlib.util.spec_from_file_location("seed_generate", ROOT / "generate.py")
assert spec and spec.loader
generate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generate)


def check(name, instance):
    schema = {"$ref": f"urn:vt:contract#/components/schemas/{name}"}
    Draft202012Validator(schema, registry=REGISTRY, format_checker=FormatChecker()).validate(
        instance
    )


@pytest.mark.parametrize(
    ("collection", "schema"),
    [
        ("clients", "ClientDetail"),
        ("profiles", "MeasurementProfile"),
        ("conflicts", "Conflict"),
        ("orders", "Order"),
        ("audit", "AuditEntry"),
        ("participants", "Participant"),
        ("reference_readings", "ReferenceReading"),
    ],
)
def test_rows_match_the_contract(collection, schema):
    for row in SEED[collection]:
        check(schema, row)


def test_users_match_user_and_account():
    for user in SEED["users"]:
        check("User", {k: v for k, v in user.items() if k not in ("created_at", "trained_on")})
        check("Account", {k: v for k, v in user.items() if k not in ("locale", "unit_pref")})


def test_settings_match_the_contract():
    check("AdminSettings", SEED["settings"])


def test_presets_match_the_contract():
    for entry in SEED["ease_presets"]:
        for preset in entry["presets"]:
            check("EasePreset", preset)


def test_generation_is_deterministic_and_committed():
    assert generate.render() == generate.render()
    assert generate.render() == (ROOT / "seed.json").read_text()


def test_ids_are_stable_uuid5():
    """Changing the namespace would break every link to the seed."""
    assert generate.uid("user:admin") == "8565f3f7-826f-5f06-af3e-e35bd0505a7a"
    admin = next(u for u in SEED["users"] if u["email"] == "admin@vt.test")
    assert admin["user_id"] == generate.uid("user:admin")


def test_accounts():
    by_email = {u["email"]: u for u in SEED["users"]}
    assert by_email["wanjiru@vt.test"]["business_name"] == "Mama Wanjiru Tailors"
    assert by_email["otieno@vt.test"]["business_name"] == "Otieno Bespoke"
    assert by_email["pending@vt.test"]["status"] == "pending"
    assert by_email["admin@vt.test"]["role"] == "admin"
    assert sorted(u["measurer_code"] for u in SEED["users"] if u["role"] == "measurer") == [
        "A",
        "B",
    ]
    assert SEED["demo_password"] == "vt-demo-2026"


def test_client_split():
    owners = Counter(c["tailor_id"] for c in SEED["clients"])
    assert sorted(owners.values()) == [3, 8]
    names = [c["display_name"] for c in SEED["clients"]]
    assert None in names and any(names)
    assert len({c["client_code"] for c in SEED["clients"]}) == 11


def rows(profile):
    return {m["site_code"]: m for m in profile["measurements"]}


def test_profile_scenarios():
    profiles = SEED["profiles"]
    assert len(profiles) == 12
    assert any(all(m["confidence_flag"] == "pass" for m in p["measurements"]) for p in profiles)
    waist = [p for p in profiles if p["session"]["scale_disagreement_pct"] == 3.2]
    assert len(waist) == 1 and rows(waist[0])["waist"]["confidence_flag"] == "check"
    failed = [p for p in profiles if rows(p)["inleg"]["confidence_flag"] == "fail"]
    assert len(failed) == 1
    assert rows(failed[0])["inleg"]["value_mm"] is None
    assert "crotch_not_found" in rows(failed[0])["inleg"]["flag_reasons"]
    assert failed[0]["silhouette_front"]["crotch_y_px"] is None
    assert any(p["session"]["level_unchecked"] for p in profiles)
    assert any(p["covariates"]["clothing_fit"] == "loose" for p in profiles)


def test_value_is_null_only_when_failed():
    """Correction C4."""
    for profile in SEED["profiles"]:
        for row in profile["measurements"]:
            assert (row["value_mm"] is None) == (row["confidence_flag"] == "fail")


def test_conflict_pair_follows_the_ingest_rule():
    """An incoming version only conflicts if it does not exceed the server's."""
    conflict = SEED["conflicts"][0]
    assert conflict["incoming_profile"]["version"] <= conflict["server_profile"]["version"]
    assert conflict["incoming_profile"]["captured_at"] > conflict["server_profile"]["captured_at"]


def test_silhouette_mm_values_stay_within_limits():
    for profile in SEED["profiles"]:
        for values in (
            profile["silhouette_front"]["half_width_mm"],
            profile["silhouette_side"]["half_depth_mm"],
            profile["silhouette_side"]["anterior_mm"],
        ):
            assert len(values) == 101
            assert all(0 <= v <= 400 for v in values)


def test_girths_agree_with_silhouettes():
    for profile in SEED["profiles"]:
        for site in ("chest", "waist", "hip", "neck"):
            row = rows(profile)[site]
            expected = generate.ellipse_perimeter(row["half_width_mm"], row["half_depth_mm"])
            assert abs(row["value_mm"] - expected) <= 0.5


def test_markers_agree_with_the_session_scale():
    for profile in SEED["profiles"]:
        scale = 150 / profile["marker_front"]["side_px"]
        assert scale == pytest.approx(profile["session"]["scale_front_mm_px"], abs=1e-3)


def test_orders():
    orders = SEED["orders"]
    assert len(orders) == 10
    assert {o["status"] for o in orders} == {"new", "cutting", "fitting", "ready", "collected"}
    anchor = date.fromisoformat(SEED["anchor_date"])
    overdue = [
        o
        for o in orders
        if date.fromisoformat(o["due_date"]) < anchor and o["status"] != "collected"
    ]
    assert len(overdue) == 1
    items = [i for o in orders for i in o["items"]]
    assert any(i["overridden"] and i["override_reason"] for i in items)
    assert any(i["confidence_flag"] == "check" and i["flag_confirmed"] for i in items)
    for item in items:
        if item["body_mm"] is None:
            assert item["finished_mm"] is None and item["pending_fitting"]
        else:
            assert item["finished_mm"] == item["body_mm"] + item["ease_mm"]


def test_order_numbers_restart_per_tailor():
    numbers = [o["order_no"] for o in SEED["orders"]]
    assert numbers.count("ORD-0001") == 2 and numbers.count("ORD-0002") == 2


def test_order_links_resolve():
    profiles = {p["profile_id"]: p for p in SEED["profiles"]}
    for order in SEED["orders"]:
        assert profiles[order["profile_id"]]["client_id"] == order["client_id"]


def test_audit_has_40_rows_and_retention_follows_d20():
    assert len(SEED["audit"]) == 40
    assert SEED["settings"]["audit_retention_months"] == 24
    assert all(r["actor_type"] != "client" for r in SEED["audit"] if r["action"] == "login_failed")


def test_study_is_on_with_partial_readings_across_cohorts():
    assert SEED["settings"]["study_mode"] is True
    participants = SEED["participants"]
    assert [p["participant_code"] for p in participants] == [f"P00{i}" for i in range(1, 6)]
    assert {p["cohort"] for p in participants} == {"pilot", "calibration", "test"}
    counts = [p["readings_entered"] for p in participants]
    assert max(counts) == 4 and 0 < min(c for c in counts if c) < 4 and 0 in counts
    assert len(SEED["reference_readings"]) == 9 * sum(counts)


def test_seed_never_contains_approvals():
    """A9: the seed cannot make a production database look approved."""
    approvals = SEED["settings"]["approvals"]
    assert all(value is None for value in approvals.values())


def test_seed_contains_no_image_content():
    text = (ROOT / "seed.json").read_text()
    assert "data:image" not in text and "base64" not in text
