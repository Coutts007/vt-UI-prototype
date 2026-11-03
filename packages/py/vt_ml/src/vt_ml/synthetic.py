"""A synthetic calibration cohort with known answers, for the recovery test (M13). Never real data.

Each person is a vt_measure synthetic body with randomised proportions. The tape readings are made
from known "true" rules: girth = factor x ellipse perimeter at the true level, lengths = system
value + a true offset, each plus measurement noise. A good fit must find those numbers again.
"""

import copy
from collections.abc import Mapping
from typing import Any

import numpy as np
from vt_measure.derive import GIRTHS, SITES, derive
from vt_measure.synthetic import Body, make_input

from vt_ml.data import BUNDLE_FORMAT

TRUE_LEVELS = {"chest": 0.30, "waist": 0.55, "hip": 0.20, "neck": 0.15}
TRUE_FACTORS = {"chest": 1.03, "waist": 0.98, "hip": 1.02, "neck": 1.05}
TRUE_OFFSETS = {"shoulder": 12.0, "sleeve": -8.0, "outleg": 15.0, "inleg": -10.0}
LENGTH_OFFSET = {"shoulder": "shoulder", "sleeve": "sleeve", "outleg": "outleg", "inleg": "inleg"}


def true_rules(
    base: Mapping[str, Any],
    levels: Mapping[str, float],
    factors: Mapping[str, float],
    offsets: Mapping[str, float],
) -> dict[str, Any]:
    rules = copy.deepcopy(dict(base))
    rules["levels"]["chest"] = {sex: levels["chest"] for sex in ("female", "male", "unspecified")}
    rules["levels"]["waist"] = levels["waist"]
    rules["levels"]["hip_band_knee_fraction"] = levels["hip"]
    rules["levels"]["neck_above_shoulder_frac"] = levels["neck"]
    rules["girth_model"]["correction_factors"] = dict(factors)
    rules["offsets_mm"] = {**rules["offsets_mm"], "acromion": 0, **offsets}
    # Wide bounds, so a synthetic extreme is never refused as implausible.
    rules["plausible_mm"] = {site: [0, 5000] for site in SITES}
    return rules


def _body(rng: np.random.Generator, sex: str) -> Body:
    def vary(value: float, spread: float = 0.10) -> float:
        return float(value * (1 + rng.uniform(-spread, spread)))

    stature = float(rng.uniform(1550, 1850))
    k = stature / 1700
    return Body(
        stature=stature,
        shoulder=vary(420 * k),
        upper_arm=vary(300 * k, 0.05),
        forearm=vary(300 * k, 0.05),
        chest_a=vary(160),
        chest_b=vary(115),
        waist_a=vary(135),
        waist_b=vary(100),
        hip_a=vary(175),
        hip_b=vary(120),
        neck_a=vary(60),
        neck_b=vary(55),
        neck_taper=float(rng.uniform(10, 40)),
        sex=sex,
    )


def _jitter(profile: dict[str, Any], rng: np.random.Generator, spread: float) -> dict[str, Any]:
    """A second capture of the same person: the outline changes slightly, as on a real phone."""
    copy_ = copy.deepcopy(profile)
    for view, key in (("silhouette_front", "half_width_mm"), ("silhouette_side", "half_depth_mm")):
        copy_[view][key] = [
            None if v is None else round(v * (1 + float(rng.normal(0, spread))), 3)
            for v in copy_[view][key]
        ]
    return copy_


def synthetic_bundle(
    n: int,
    *,
    seed: int,
    base: Mapping[str, Any],
    levels: Mapping[str, float] = TRUE_LEVELS,
    factors: Mapping[str, float] = TRUE_FACTORS,
    offsets: Mapping[str, float] = TRUE_OFFSETS,
    sets: int = 3,
    noise_mm: float = 2.0,
    set_spread: float = 0.002,
    cohort: str = "calibration",
    prefix: str = "S",
) -> dict[str, Any]:
    """A bundle in the export format, with 4 readings per site per person."""
    rng = np.random.default_rng(seed)
    truth = true_rules(base, levels, factors, offsets)
    people = []
    for i in range(n):
        sex = ("female", "male")[i % 2]
        body = _body(rng, sex)
        profile = make_input(body)
        true_values = derive(profile, truth).sites
        readings = []
        for site in SITES:
            if site in GIRTHS:
                value = true_values[site].raw_mm
            else:
                value = true_values[site].raw_mm
            assert value is not None, f"synthetic body {i} fails {site}"
            for measurer in ("A", "B"):
                for reading_no in (1, 2):
                    readings.append({
                        "site_code": site, "measurer_code": measurer, "reading_no": reading_no,
                        "value_mm": round(float(value + rng.normal(0, noise_mm)), 1),
                    })  # fmt: skip
        captured = [{"set_no": 1, "profile": profile}]
        for set_no in range(2, sets + 1):
            captured.append({"set_no": set_no, "profile": _jitter(profile, rng, set_spread)})
        people.append({
            "participant_code": f"{prefix}{i + 1:03d}", "cohort": cohort, "sex": sex,
            "sets": captured, "readings": readings,
        })  # fmt: skip
    return {"format": BUNDLE_FORMAT, "participants": people}
