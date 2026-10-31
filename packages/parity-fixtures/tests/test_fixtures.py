import importlib.util
import json
from collections import Counter
from pathlib import Path

import pytest
from vt_measure.derive import derive
from vt_measure.synthetic import Body, expected_values

ROOT = Path(__file__).parents[1]
FILES = sorted((ROOT / "cases").glob("*.json"))

spec = importlib.util.spec_from_file_location("parity_generate", ROOT / "generate.py")
assert spec and spec.loader
generate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generate)


def load(path):
    return json.loads(path.read_text())


def test_enough_cases_of_each_kind():
    assert len(FILES) >= 40
    kinds = Counter(path.name.split("-")[0] for path in FILES)
    assert kinds["random"] == 20 and kinds["analytic"] > 0 and kinds["edge"] > 0


def test_committed_files_match_the_generator():
    rendered = generate.all_cases()
    assert set(rendered) == {path.stem for path in FILES}
    for path in FILES:
        assert path.read_text() == rendered[path.stem], path.name


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.stem)
def test_vt_measure_reproduces_each_case(path):
    case = load(path)
    result = derive(case["input"], case["rules"])
    for code, expected in case["expected"]["sites"].items():
        site = result.sites[code]
        assert site.value_mm == expected["value_mm"]
        assert site.flag == expected["flag"]
        assert site.reasons == expected["reasons"]
        if expected["value_mm"] is None:
            assert (expected["flag"]) == "fail"


def test_analytic_default_matches_the_known_body():
    sites = load(ROOT / "cases" / "analytic-default.json")["expected"]["sites"]
    for code, value in expected_values(Body()).items():
        assert sites[code]["raw_mm"] == pytest.approx(value, abs=0.1), code


@pytest.mark.parametrize(
    ("name", "site", "flag", "reason"),
    [
        ("edge-visibility-049", "shoulder", "fail", "landmark_low"),
        ("edge-visibility-050", "shoulder", "check", "landmark_low"),
        ("edge-aspect-1031", "waist", "fail", "view_failed"),
        ("edge-disagree-4pct", "waist", "check", "scale_disagree"),
        ("edge-disagree-over-4pct", "sleeve", "check", "scale_disagree"),
        ("edge-crotch-missing", "inleg", "fail", "crotch_not_found"),
        ("edge-null-sample", "waist", "fail", "mask_gap"),
    ],
)
def test_edge_cases_do_what_their_names_say(name, site, flag, reason):
    row = load(ROOT / "cases" / f"{name}.json")["expected"]["sites"][site]
    assert row["flag"] == flag and reason in row["reasons"]


@pytest.mark.parametrize(
    ("name", "site"), [("edge-aspect-1030", "waist"), ("edge-disagree-2pct", "waist")]
)
def test_values_exactly_on_a_limit_pass(name, site):
    assert load(ROOT / "cases" / f"{name}.json")["expected"]["sites"][site]["flag"] == "pass"


def test_views_differ_case_matches_the_hand_calculation():
    waist = load(ROOT / "cases" / "analytic-views-differ.json")["expected"]["sites"]["waist"]
    assert (waist["a_mm"], waist["b_mm"]) == (pytest.approx(142.5), pytest.approx(85.0))


def test_rounding_cases_land_on_a_half():
    down = load(ROOT / "cases" / "edge-round-half-down.json")["expected"]["sites"]["stature"]
    up = load(ROOT / "cases" / "edge-round-half-up.json")["expected"]["sites"]["stature"]
    assert (down["raw_mm"], down["value_mm"]) == (pytest.approx(1700.5), 1700)
    assert (up["raw_mm"], up["value_mm"]) == (pytest.approx(1701.5), 1702)
