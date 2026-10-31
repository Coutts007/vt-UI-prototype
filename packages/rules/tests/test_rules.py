import importlib.util
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).parents[1]
SCHEMA = json.loads((ROOT / "schema.json").read_text())
ARTIFACTS = sorted(ROOT.glob("rules-*.json"))

spec = importlib.util.spec_from_file_location("rules_checksum", ROOT / "checksum.py")
assert spec and spec.loader
checksum_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checksum_module)


def load(path):
    return json.loads(path.read_text())


def test_there_is_an_artifact():
    assert ARTIFACTS


@pytest.mark.parametrize("path", ARTIFACTS, ids=lambda p: p.name)
def test_artifact_matches_schema(path):
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(load(path))


@pytest.mark.parametrize("path", ARTIFACTS, ids=lambda p: p.name)
def test_checksum_is_correct(path):
    artifact = load(path)
    assert artifact["checksum"] == checksum_module.rules_checksum(artifact)


@pytest.mark.parametrize("path", ARTIFACTS, ids=lambda p: p.name)
def test_file_name_matches_version(path):
    assert path.name == f"rules-{load(path)['rules_version']}.json"


def test_checksum_notices_a_changed_value():
    artifact = load(ROOT / "rules-0.1-uncalibrated.json")
    artifact["levels"]["waist"] = 0.61
    assert artifact["checksum"] != checksum_module.rules_checksum(artifact)


def test_uncalibrated_rules_are_a_draft_with_no_correction():
    artifact = load(ROOT / "rules-0.1-uncalibrated.json")
    assert artifact["status"] == "draft"
    assert artifact["scale"]["depth_correction_mm"] == {"front": 0, "side": 0}
    assert set(artifact["girth_model"]["correction_factors"].values()) == {1.0}


def test_only_the_owner_freezes():
    """Nothing in frozen/ until the owner freezes a version."""
    assert [p.name for p in (ROOT / "frozen").iterdir() if p.name != ".gitkeep"] == []


@pytest.mark.parametrize("field", ["anomaly", "fit.loo", "fit.bootstrap_ci", "girth_model.extra"])
def test_free_form_fields_cannot_carry_long_content(field):
    artifact = load(ROOT / "rules-0.1-uncalibrated.json")
    target = artifact
    *parents, last = field.split(".")
    for key in parents:
        target = target[key]
    target[last] = {"note": "x" * 257} if last != "extra" else "x" * 257
    assert list(Draft202012Validator(SCHEMA).iter_errors(artifact))


@pytest.mark.parametrize("path", ARTIFACTS, ids=lambda p: p.name)
def test_bands_run_low_to_high(path):
    low, high = load(path)["levels"]["waist_check_band"]
    assert low < high
    assert load(path)["levels"]["hip_band_knee_fraction"] > 0
