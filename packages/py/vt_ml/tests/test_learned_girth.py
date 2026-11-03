"""The ridge experiment (spec 11.4): nested CV, the exact promotion rule, an exportable model."""

import json
from pathlib import Path

import numpy as np
import pytest
from vt_ml import learned_girth
from vt_ml.calibrate import calibrate
from vt_ml.data import CalibrationRepository
from vt_ml.synthetic import synthetic_bundle

RULES = Path(__file__).parents[3] / "rules"
BASE = json.loads((RULES / "rules-0.1-uncalibrated.json").read_text())


def test_promotion_rule_at_its_boundaries():
    cis = {"chest": [0.5, 6], "waist": [0.5, 6], "hip": [-1, 1], "neck": [-1, 1]}
    gains = {"chest": 3.0, "waist": 3.0, "hip": 0.0, "neck": 0.0}
    assert learned_girth.promoted(gains, cis)
    assert not learned_girth.promoted({**gains, "waist": 2.99}, cis)  # one win is not enough
    assert not learned_girth.promoted({**gains, "neck": -1.01}, cis)  # worse by more than 1 mm
    assert learned_girth.promoted({**gains, "neck": -1.0}, cis)  # exactly 1 mm worse is allowed
    assert not learned_girth.promoted(gains, {**cis, "waist": [0.0, 6]})  # interval touches zero
    assert not learned_girth.promoted(gains, {**cis, "waist": None})
    assert not learned_girth.promoted({**gains, "hip": float("nan")}, cis)


def test_loo_errors_leave_the_participant_out():
    rng = np.random.default_rng(3)
    X = rng.normal(size=(12, 4))
    T = X @ np.array([10, 5, 0, 0]) + 900 + rng.normal(0, 1, 12)
    P = T / 1.02 + rng.normal(0, 3, 12)
    ridge, ellipse, alphas = learned_girth.loo_errors(X, T, P)
    assert ridge.shape == ellipse.shape == (12,)
    assert len(alphas) == 12 and all(a in learned_girth.ALPHAS for a in alphas)
    # Brute force for one fold.
    model = learned_girth._model().fit(X[1:], T[1:])
    assert ridge[0] == pytest.approx(abs(model.predict(X[:1])[0] - T[0]))


@pytest.fixture(scope="module")
def fitted():
    people = CalibrationRepository(synthetic_bundle(12, seed=11, base=BASE)).calibration_data()
    fit = calibrate(
        people, BASE, version="1.0-test", created_at="2027-03-01T08:00:00Z", resamples=50
    )
    return people, fit.artifact


def test_experiment_reports_each_girth_and_an_exportable_model(fitted):
    people, artifact = fitted
    out = learned_girth.experiment(people, artifact, seed=1, resamples=40)
    assert out["features"] == list(learned_girth.FEATURES)
    for site in ("chest", "waist", "hip", "neck"):
        row = out["sites"][site]
        assert row["n"] == 12
        export = row["export"]
        assert len(export["coefficients"]) == len(export["means"]) == len(learned_girth.FEATURES)
        assert isinstance(export["intercept"], float)
        low, high = row["gain_ci_mm"]
        assert low <= high
    assert isinstance(out["promoted"], bool)
    # The synthetic truth is ellipse x factor exactly, so ridge cannot beat it by 3 mm.
    assert out["promoted"] is False
    assert "Not written into the artifact" in out["verdict"] or "stays" in out["verdict"]


def test_experiment_is_deterministic(fitted):
    people, artifact = fitted
    one = learned_girth.experiment(people, artifact, seed=1, resamples=20)
    two = learned_girth.experiment(people, artifact, seed=1, resamples=20)
    assert json.dumps(one, sort_keys=True) == json.dumps(two, sort_keys=True)


def test_too_few_people_is_reported_not_fitted():
    people = CalibrationRepository(synthetic_bundle(3, seed=2, base=BASE)).calibration_data()
    out = learned_girth.experiment(people, BASE, seed=1, resamples=10)
    assert all(row["status"] == "insufficient" for row in out["sites"].values())
    assert out["promoted"] is False
