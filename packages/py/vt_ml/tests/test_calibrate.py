"""The calibration learner (spec 11.3): recovery, leakage, determinism and the decision rules."""

import copy
import json
import math
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator, FormatChecker
from vt_ml.calibrate import (
    SiteData,
    affine_adopted,
    calibrate,
    checksum,
    fit_girth,
    grid,
    loo_affine_mae,
    loo_cf_mae,
    loo_offset_mae,
    pick_level,
)
from vt_ml.data import CalibrationRepository, cohort_hash
from vt_ml.synthetic import TRUE_FACTORS, TRUE_LEVELS, TRUE_OFFSETS, synthetic_bundle

RULES = Path(__file__).parents[3] / "rules"
BASE = json.loads((RULES / "rules-0.1-uncalibrated.json").read_text())
SCHEMA = json.loads((RULES / "schema.json").read_text())
STAMP = "2027-03-01T08:00:00Z"


def fit(bundle, **options):
    people = CalibrationRepository(bundle).calibration_data()
    options = {"resamples": 60, **options}
    return calibrate(people, BASE, version="1.0-test", created_at=STAMP, **options)


@pytest.fixture(scope="module")
def cohort():
    return synthetic_bundle(25, seed=7, base=BASE)


@pytest.fixture(scope="module")
def fitted(cohort):
    return fit(cohort)


# ---- the closed forms against brute force ----


def brute_loo_cf(P, T, groups):
    errors = []
    for i in range(len(T)):
        rest = groups != groups[i]
        cf = (P[rest] * T[rest]).sum() / (P[rest] ** 2).sum()
        errors.append(abs(cf * P[i] - T[i]))
    return float(np.mean(errors))


def test_loo_factor_matches_brute_force_and_keeps_duplicates_together():
    rng = np.random.default_rng(1)
    P = rng.uniform(800, 1100, 12)
    T = 1.02 * P + rng.normal(0, 5, 12)
    groups = np.array([0, 0, 1, 2, 3, 3, 3, 4, 5, 6, 7, 8])
    assert loo_cf_mae(P, T, groups) == pytest.approx(brute_loo_cf(P, T, groups), rel=1e-12)
    columns = np.column_stack([P, P * 1.1])
    assert loo_cf_mae(columns, T, groups)[1] == pytest.approx(brute_loo_cf(P * 1.1, T, groups))


def test_loo_affine_and_offset_match_brute_force():
    rng = np.random.default_rng(2)
    P = rng.uniform(600, 900, 10)
    T = 0.9 * P + 40 + rng.normal(0, 4, 10)
    groups = np.arange(10)
    affine, offset = [], []
    for i in range(10):
        rest = groups != i
        a, c = np.polyfit(P[rest], T[rest], 1)
        affine.append(abs(a * P[i] + c - T[i]))
        offset.append(abs(P[i] + (T[rest] - P[rest]).mean() - T[i]))
    assert loo_affine_mae(P, T, groups) == pytest.approx(np.mean(affine), rel=1e-9)
    assert loo_offset_mae(P, T, groups) == pytest.approx(np.mean(offset), rel=1e-12)


# ---- the decision rules at their boundaries ----


def test_prior_level_stays_unless_two_mm_better():
    levels = [0.24, 0.25, 0.26]
    assert pick_level([10.0, 11.99, 12.0], levels, 0.25) == (1, 0)  # 1.99 mm: keep the prior
    assert pick_level([10.0, 12.0, 12.5], levels, 0.25) == (0, 0)  # exactly 2 mm: move
    assert pick_level([12.0, 9.0, 9.0], levels, 0.25) == (1, 1)  # the prior is best
    assert pick_level([9.0, 12.0, 9.0], levels, 0.25) == (0, 0)  # a tie goes to the lowest


def test_nothing_scorable_keeps_the_prior():
    assert pick_level([math.nan, math.nan, math.nan], [0.24, 0.25, 0.26], 0.25) == (1, 1)


def test_a_resample_with_one_participant_of_a_sex_takes_the_pooled_level():
    """Per-sex chest on a bootstrap resample with a single female must not crash (review B1)."""
    levels = [0.24, 0.25, 0.26]
    P = np.array([[900.0, 910.0, 920.0]] * 6) * np.arange(1, 7)[:, None] / 6
    T = 1.02 * P[:, 1]
    sexes = np.array(["female", "male", "male", "male", "male", "male"])
    data = SiteData("chest", levels, 0.25, P, T, sexes, per_sex=True)
    rows = np.array([0, 1, 2, 3, 4, 5])
    out = fit_girth(data, rows, rows)
    assert out["levels"]["female"] == out["levels"]["pooled"]
    # And with that female drawn twice (one distinct participant) the same holds.
    rows = np.array([0, 0, 1, 2, 3, 4])
    out = fit_girth(data, rows, np.array([0, 0, 1, 2, 3, 4]))
    assert out["levels"]["female"] == out["levels"]["pooled"]


def test_per_sex_chest_survives_a_long_bootstrap_on_sixteen_people():
    bundle = synthetic_bundle(16, seed=5, base=BASE)
    result = fit(bundle, resamples=2000)
    assert result.artifact["fit"]["loo"]["chest"]["n"] == 16
    assert "level_female" in result.artifact["fit"]["loo"]["chest"]


def test_the_fitter_refuses_other_cohorts():
    bundle = synthetic_bundle(4, seed=3, base=BASE, cohort="test")
    assert CalibrationRepository(bundle).calibration_data() == ()
    from vt_ml.data import _participant

    with pytest.raises(ValueError, match="calibration cohort only"):
        calibrate([_participant(row) for row in bundle["participants"]], BASE,
                  version="1.0-test", created_at=STAMP, resamples=10)  # fmt: skip


def test_affine_only_with_three_mm_and_an_interval_clear_of_zero():
    assert affine_adopted(3.0, [0.4, 5.0])
    assert not affine_adopted(2.99, [0.4, 5.0])
    assert not affine_adopted(4.0, [0.0, 6.0])
    assert not affine_adopted(4.0, [-0.1, 6.0])
    assert not affine_adopted(4.0, None)


def test_grid_is_in_hundredths():
    assert grid(0.15, 0.40)[:3] == [0.15, 0.16, 0.17]
    assert grid(0.15, 0.40)[-1] == 0.40
    assert len(grid(0.45, 0.75)) == 31


# ---- recovery: a cohort with known answers ----


def test_fit_recovers_the_true_levels_factors_and_offsets(fitted):
    artifact = fitted.artifact
    levels = artifact["levels"]
    assert levels["chest"]["unspecified"] == pytest.approx(TRUE_LEVELS["chest"], abs=0.01)
    assert levels["waist"] == pytest.approx(TRUE_LEVELS["waist"], abs=0.01)
    assert levels["neck_above_shoulder_frac"] == pytest.approx(TRUE_LEVELS["neck"], abs=0.01)
    for site, factor in TRUE_FACTORS.items():
        assert artifact["girth_model"]["correction_factors"][site] == pytest.approx(
            factor, rel=0.01
        )
    for site, offset in TRUE_OFFSETS.items():
        assert artifact["offsets_mm"][site] == pytest.approx(offset, abs=1.5)
    assert "intercepts_mm" not in artifact["girth_model"]


def test_hip_band_has_no_unique_answer_on_this_shape_but_its_factor_is_right(fitted):
    """The synthetic hip is widest on a plateau, so every band that reaches it gives one perimeter.

    The fit then keeps the prior band (no 2 mm gain) and the factor still comes out right.
    """
    hip = fitted.artifact["fit"]["loo"]["hip"]
    assert hip["level"] == BASE["levels"]["hip_band_knee_fraction"]
    assert hip["loo_mae_mm"] < 5


def test_intervals_cover_the_true_factors(fitted):
    cis = fitted.artifact["fit"]["bootstrap_ci"]
    for site, factor in TRUE_FACTORS.items():
        low, high = cis[site]["cf"]
        assert low - 1e-4 <= factor <= high + 1e-4  # intervals are stored to four places


def test_artifact_is_a_valid_draft_with_a_matching_checksum(fitted, cohort):
    artifact = fitted.artifact
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(artifact)
    assert artifact["status"] == "draft"
    assert artifact["parent"] == BASE["rules_version"]
    assert artifact["checksum"] == checksum(artifact)
    people = CalibrationRepository(cohort).calibration_data()
    assert artifact["fit"]["cohort_hash"] == cohort_hash(people)
    assert artifact["fit"]["n_participants"] == 25
    assert artifact["fit"]["n_capture_sets"] == 75


# ---- leakage and determinism ----


def poisoned(bundle, cohort):
    """Pilot or test rows whose profiles break vt_measure if anything ever reads them."""
    rows = copy.deepcopy(bundle["participants"][:4])
    for row in rows:
        row["cohort"] = cohort
        row["participant_code"] = cohort[0].upper() + row["participant_code"]
        for capture in row["sets"]:
            capture["profile"] = {"never": "read"}
        for reading in row["readings"]:
            reading["value_mm"] = 99999
    return rows


def test_pilot_and_test_rows_never_reach_the_fit(cohort, fitted):
    mixed = copy.deepcopy(cohort)
    mixed["participants"] += poisoned(cohort, "test") + poisoned(cohort, "pilot")
    again = fit(mixed)
    assert json.dumps(again.artifact, sort_keys=True) == json.dumps(fitted.artifact, sort_keys=True)
    codes = {p.code for p in CalibrationRepository(mixed).calibration_data()}
    assert codes == {f"S{i:03d}" for i in range(1, 26)}


def test_the_same_seed_gives_the_same_bytes_and_another_seed_moves_only_the_intervals(
    cohort, fitted
):
    again = fit(cohort)
    assert json.dumps(again.artifact) == json.dumps(fitted.artifact)
    other = fit(cohort, seed=99)
    assert other.artifact["fit"]["bootstrap_ci"] != fitted.artifact["fit"]["bootstrap_ci"]
    assert other.artifact["levels"] == fitted.artifact["levels"]
    assert other.artifact["girth_model"] == fitted.artifact["girth_model"]


def test_a_bundle_in_another_format_is_refused():
    with pytest.raises(ValueError):
        CalibrationRepository({"format": "something-else", "participants": []})


# ---- too little data ----


def test_incomplete_tape_readings_keep_the_prior_and_say_why():
    bundle = synthetic_bundle(3, seed=3, base=BASE)
    for row in bundle["participants"]:
        row["readings"] = [r for r in row["readings"] if r["measurer_code"] == "A"]
    result = fit(bundle)
    artifact = result.artifact
    assert artifact["levels"] == BASE["levels"]
    assert (
        artifact["girth_model"]["correction_factors"] == BASE["girth_model"]["correction_factors"]
    )
    assert artifact["fit"]["loo"]["chest"]["status"] == "insufficient"
    reasons = {row["reason"] for row in result.tables["exclusions"]}
    assert "tape_incomplete" in reasons


def test_fewer_readings_can_be_allowed_and_the_card_says_so():
    bundle = synthetic_bundle(4, seed=3, base=BASE)
    for row in bundle["participants"]:
        row["readings"] = [r for r in row["readings"] if r["measurer_code"] == "A"]
    result = fit(bundle, min_readings=2)
    assert result.artifact["fit"]["loo"]["chest"]["n"] == 4
    assert "below the 4-reading protocol" in result.artifact["fit"]["notes"]
