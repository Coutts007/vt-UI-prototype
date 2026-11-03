"""The anomaly reference (backend-spec 11.5): built from the cohort, applied with arithmetic."""

import json
import math
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator, FormatChecker
from vt_ml import anomaly
from vt_ml.calibrate import calibrate
from vt_ml.data import CalibrationRepository
from vt_ml.synthetic import synthetic_bundle

RULES = Path(__file__).parents[3] / "rules"
BASE = json.loads((RULES / "rules-0.1-uncalibrated.json").read_text())
SCHEMA = json.loads((RULES / "schema.json").read_text())


@pytest.fixture(scope="module")
def people():
    return CalibrationRepository(synthetic_bundle(16, seed=5, base=BASE)).calibration_data()


@pytest.fixture(scope="module")
def artifact(people):
    fit = calibrate(people, BASE, version="1.0-test", created_at="2027-03-01T08:00:00Z",
                    resamples=50, anomaly=anomaly.reference)  # fmt: skip
    return fit.artifact


def test_reference_has_each_sex_and_the_pooled_group_and_fits_the_schema(artifact):
    block = artifact["anomaly"]
    assert set(block["per_sex"]) == {"female", "male", "unspecified"}
    assert block["per_sex"]["female"]["n"] == 8
    assert block["per_sex"]["unspecified"]["n"] == 16
    assert block["static_ratio_bounds"] == BASE["anomaly"]["static_ratio_bounds"]
    assert block["z_limit"] == 3.5
    group = block["per_sex"]["female"]
    assert set(group["sites"]) == {
        "shoulder",
        "chest",
        "waist",
        "hip",
        "sleeve",
        "outleg",
        "inleg",
        "neck",
    }
    assert group["mahalanobis"]["threshold"] == pytest.approx(27.877, abs=0.01)  # chi2 0.999, df 9
    # The synthetic legs are exact fractions of stature, so those two ratios sit on the floor.
    assert {"outleg", "inleg"} <= set(group["mad_floored"])
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(artifact)


def test_fewer_than_five_complete_profiles_gives_no_group():
    people = CalibrationRepository(synthetic_bundle(6, seed=5, base=BASE)).calibration_data()
    block = anomaly.reference(people, BASE)
    assert set(block["per_sex"]) == {"unspecified"}  # 3 per sex is too few, 6 pooled is enough


def test_robust_statistics_by_hand():
    values = np.log(np.array([0.50, 0.52, 0.49, 0.51, 0.90]))
    stats = anomaly._robust(values)
    assert stats["median"] == pytest.approx(math.log(0.51), abs=1e-6)
    assert stats["mad"] == pytest.approx(
        np.median(np.abs(values - math.log(0.51))) * 1.4826, abs=1e-6
    )


def test_a_ratio_that_never_varies_gets_the_mad_floor():
    stats = anomaly._robust(np.log(np.full(8, 0.45)))
    assert stats["mad"] == anomaly.MAD_FLOOR


def test_a_genuine_person_is_not_flagged_and_gross_corruptions_are(artifact, people):
    group = artifact["anomaly"]["per_sex"]["female"]
    person = next(p for p in people if p.sex == "female")
    values = anomaly.system_values(person, artifact)
    assert all(abs(z) < 3.5 for z in anomaly.site_z(values, group).values())
    d2 = anomaly.mahalanobis(values, group)
    assert d2 is not None and d2 < group["mahalanobis"]["threshold"]
    # A scale error moves every log-measurement together, so the ratios cannot see it; only the
    # whole-profile distance can.
    scaled = {site: v * 1.1 for site, v in values.items()}
    assert anomaly.site_z(scaled, group) == pytest.approx(anomaly.site_z(values, group))
    assert anomaly.mahalanobis(scaled, group) > d2
    # A waist half as large again breaks the waist ratios. (Reading the waist at chest level is
    # tested as a share below: on a person whose chest and waist are alike it changes nothing.)
    assert anomaly.flagged({**values, "waist": values["waist"] * 1.5}, group)


def test_evaluation_reports_shares_honestly(artifact, people):
    """The spec asks for the shares, not for a pass: a 50 mm waist error is about one MAD on a
    cohort whose waists vary by ten percent, so most of those go uncaught and the card says so."""
    report = anomaly.evaluate(people, artifact)
    assert report["n"] == 16
    assert 0 <= report["genuine_flagged_share"] <= 0.2
    assert set(report["caught_share"]) == {"scale_x1.1", "waist_level_swapped", "girth_plus_50mm"}
    assert all(0 <= share <= 1 for share in report["caught_share"].values())
    assert report["caught_share"]["waist_level_swapped"] >= 0.5
    assert report["caught_share"]["girth_plus_50mm"] <= 0.5


def test_the_reference_is_deterministic(people, artifact):
    again = anomaly.reference(people, artifact)
    assert json.dumps(again, sort_keys=True) == json.dumps(artifact["anomaly"], sort_keys=True)
