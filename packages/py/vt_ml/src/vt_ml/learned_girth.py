"""Can a small learned model beat ellipse x factor? A ridge experiment (backend-spec 11.4).

Features come from the profile only. Alpha is chosen inside each outer fold by ridge's exact
leave-one-out (nested), and both models are scored by leave-one-participant-out on the same people.
The model is promoted only if, on at least two girths, it beats ellipse x factor by 3 mm or more
with a bootstrap interval of the gain above zero, and it is never more than 1 mm worse on any girth.
Even then it is not written into an artifact here: the phone cannot run it until F11 exists.
"""

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from vt_measure.derive import GIRTHS, _build_views, derive, sample_profile

from vt_ml.data import PROTOCOL_READINGS, Participant

ALPHAS = tuple(float(a) for a in np.logspace(-2, 4, 25))
SHIFTS = (-5, -2, 2, 5)
PROMOTE_GAIN_MM = 3.0
PROMOTE_MIN_SITES = 2
NEVER_WORSE_MM = 1.0
FEATURES = (
    "a", "b", *(f"{axis}{shift:+d}" for shift in SHIFTS for axis in ("a", "b")),
    "a_over_b", "stature_mm", "female", "male", "hip_over_shoulder_width",
)  # fmt: skip


def _row(profile: Mapping[str, Any], rules: Mapping[str, Any], site: str) -> list[float] | None:
    result = derive(profile, rules)
    girth = result.sites[site]
    if girth.flag == "fail" or girth.a_mm is None or girth.b_mm is None:
        return None
    front, side = _build_views(profile, rules)
    fraction = girth.level_fraction
    assert fraction is not None
    if site == "hip":
        uf, us = front.u(front.hip_band_y(fraction)), side.u(side.hip_band_y(fraction))
    elif site == "neck":
        uf, us = front.u(front.level_y(-fraction)), side.u(side.level_y(-fraction))
    else:
        uf, us = front.u(front.level_y(fraction)), side.u(side.level_y(fraction))
    width = profile["silhouette_front"]["half_width_mm"]
    depth = profile["silhouette_side"]["half_depth_mm"]
    shifted = []
    for shift in SHIFTS:
        a = sample_profile(width, uf + shift / 100)
        b = sample_profile(depth, us + shift / 100)
        if a is None or b is None:
            return None
        shifted += [a, b]
    hip_w = sample_profile(width, front.u(front.y(front.hip)))
    shoulder_w = sample_profile(width, front.u(front.shoulder_y))
    stature = result.sites["stature"].raw_mm
    if not hip_w or not shoulder_w or stature is None:
        return None
    sex = profile["covariates"]["sex"]
    return [
        girth.a_mm, girth.b_mm, *shifted, girth.a_mm / girth.b_mm, stature,
        float(sex == "female"), float(sex == "male"), hip_w / shoulder_w,
    ]  # fmt: skip


def features(person: Participant, rules: Mapping[str, Any], site: str) -> list[float] | None:
    rows = [r for r in (_row(s.profile, rules, site) for s in person.sets) if r is not None]
    return None if not rows else [float(v) for v in np.mean(rows, axis=0)]


def _model() -> Any:
    return make_pipeline(StandardScaler(), RidgeCV(alphas=ALPHAS))


def loo_errors(
    X: np.ndarray, T: np.ndarray, P: np.ndarray
) -> tuple[np.ndarray, np.ndarray, list[float]]:
    """Per-participant absolute LOO errors for ridge and for ellipse x factor, and chosen alphas."""
    ridge, ellipse, alphas = [], [], []
    for i in range(len(T)):
        rest = np.arange(len(T)) != i
        model = _model().fit(X[rest], T[rest])
        alphas.append(float(model[-1].alpha_))
        ridge.append(abs(float(model.predict(X[i : i + 1])[0]) - T[i]))
        cf = (P[rest] * T[rest]).sum() / (P[rest] ** 2).sum()
        ellipse.append(abs(cf * P[i] - T[i]))
    return np.asarray(ridge), np.asarray(ellipse), alphas


def promoted(gains: Mapping[str, float], gain_cis: Mapping[str, Sequence[float] | None]) -> bool:
    """The exact rule of 11.4. A gain is ellipse MAE minus ridge MAE, so positive favours ridge."""
    if any(not math.isfinite(g) or round(g, 6) < -NEVER_WORSE_MM for g in gains.values()):
        return False
    wins = [
        site for site, gain in gains.items()
        if round(gain, 6) >= PROMOTE_GAIN_MM
        and (ci := gain_cis.get(site)) is not None
        and ci[0] > 0
    ]  # fmt: skip
    return len(wins) >= PROMOTE_MIN_SITES


def experiment(
    people: Sequence[Participant],
    artifact: Mapping[str, Any],
    *,
    seed: int,
    resamples: int,
    min_readings: int = PROTOCOL_READINGS,
) -> dict[str, Any]:
    """Run the comparison on the calibration cohort under the fitted artifact's levels."""
    rng = np.random.default_rng(seed)
    raw = {**artifact, "girth_model": {**artifact["girth_model"]}}
    raw["girth_model"]["correction_factors"] = dict.fromkeys(GIRTHS, 1.0)
    raw["girth_model"].pop("intercepts_mm", None)
    out: dict[str, Any] = {"features": list(FEATURES), "sites": {}}
    gains, cis = {}, {}
    for site in GIRTHS:
        rows, targets, perimeters = [], [], []
        for person in people:
            target = person.target(site, min_readings)
            x = features(person, raw, site)
            found = [derive(s.profile, raw).sites[site].perimeter_mm for s in person.sets]
            p: list[float] = [float(v) for v in found if v is not None]
            if target is None or x is None or not p:
                continue
            rows.append(x)
            targets.append(target)
            perimeters.append(sum(p) / len(p))
        n = len(targets)
        if n < 5:
            out["sites"][site] = {"n": n, "status": "insufficient"}
            gains[site] = math.nan
            continue
        X, T, P = np.asarray(rows), np.asarray(targets), np.asarray(perimeters)
        ridge, ellipse, alphas = loo_errors(X, T, P)
        boot = []
        for _ in range(resamples):
            pick = rng.integers(0, n, n)
            boot.append(float(ellipse[pick].mean() - ridge[pick].mean()))
        low, high = np.percentile(boot, [2.5, 97.5])
        gain = float(ellipse.mean() - ridge.mean())
        gains[site], cis[site] = gain, [float(low), float(high)]
        final = _model().fit(X, T)
        scaler, ridge_model = final[0], final[-1]
        out["sites"][site] = {
            "n": n,
            "ridge_loo_mae_mm": round(float(ridge.mean()), 2),
            "ellipse_loo_mae_mm": round(float(ellipse.mean()), 2),
            "gain_mm": round(gain, 2),
            "gain_ci_mm": [round(float(low), 2), round(float(high), 2)],
            "alpha_median": float(np.median(alphas)),
            "export": {
                "alpha": float(ridge_model.alpha_),
                "means": [round(float(v), 6) for v in scaler.mean_],
                "scales": [round(float(v), 6) for v in scaler.scale_],
                "coefficients": [round(float(v), 6) for v in ridge_model.coef_],
                "intercept": round(float(ridge_model.intercept_), 6),
            },
        }
    out["promoted"] = promoted(gains, cis)
    out["verdict"] = (
        "Promotion rule met. Not written into the artifact: the phone needs F11 first."
        if out["promoted"]
        else "Promotion rule not met: ellipse x factor stays. A neutral or negative result."
    )
    out["method_note"] = (
        "Gains are bootstrapped over the fixed per-participant LOO errors (paired, no refit per "
        "resample). The ellipse baseline uses the level chosen on all participants, which if "
        "anything favours the ellipse, so the comparison is conservative towards promotion."
    )
    return out
