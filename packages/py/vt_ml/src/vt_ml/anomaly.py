"""Reference statistics for the server's anomaly checks (backend-spec 11.5). Warnings only.

Per sex: the median and MAD x 1.4826 of log(value / stature) for each site and of log(waist / hip),
and a Ledoit-Wolf shrunk covariance of the log-measurements. The artifact stores the precision
matrix and the chi-square threshold, so the API checks a profile with plain arithmetic.
"""

import copy
import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np
from scipy.stats import chi2
from sklearn.covariance import LedoitWolf
from vt_measure.derive import SITES, derive

from vt_ml.data import Participant

Z_LIMIT = 3.5
CHI2_QUANTILE = 0.999
MAD_SCALE = 1.4826
# A ratio that hardly varies in the cohort would turn any jitter into a huge z. One percent of
# the ratio is the least spread a site is allowed; a placeholder to review on real data (11.5.1).
MAD_FLOOR = 0.01
MIN_PER_SEX = 5
RATIO_SITES = tuple(site for site in SITES if site != "stature")
DECIMALS = 6


def system_values(person: Participant, rules: Mapping[str, Any]) -> dict[str, float]:
    """The phone's values under these rules, averaged over the sets where the site has a value."""
    sums: dict[str, list[float]] = {site: [] for site in SITES}
    for capture in person.sets:
        for site, result in derive(capture.profile, rules).sites.items():
            if result.value_mm is not None:
                sums[site].append(float(result.value_mm))
    return {site: float(np.mean(v)) for site, v in sums.items() if v}


def _robust(values: np.ndarray) -> dict[str, float]:
    median = float(np.median(values))
    mad = max(float(np.median(np.abs(values - median))) * MAD_SCALE, MAD_FLOOR)
    return {"median": round(median, DECIMALS), "mad": round(mad, DECIMALS)}


def _group(rows: Sequence[dict[str, float]]) -> dict[str, Any] | None:
    complete = [r for r in rows if all(site in r for site in SITES)]
    if len(complete) < MIN_PER_SEX:
        return None
    out: dict[str, Any] = {"n": len(complete), "sites": {}}
    for site in RATIO_SITES:
        out["sites"][site] = _robust(np.log([r[site] / r["stature"] for r in complete]))
    out["waist_hip"] = _robust(np.log([r["waist"] / r["hip"] for r in complete]))
    # Which ratios hardly varied in this cohort, so their z is set by the floor, not the data.
    out["mad_floored"] = [
        name for name, stats in (*out["sites"].items(), ("waist_hip", out["waist_hip"]))
        if stats["mad"] == MAD_FLOOR
    ]  # fmt: skip
    X = np.log([[r[site] for site in SITES] for r in complete])
    model = LedoitWolf().fit(X)
    precision = np.linalg.inv(model.covariance_)
    out["mahalanobis"] = {
        "sites": list(SITES),
        "mean": [round(float(v), DECIMALS) for v in model.location_],
        "precision": [[round(float(v), DECIMALS) for v in row] for row in precision],
        "threshold": round(float(chi2.ppf(CHI2_QUANTILE, len(SITES))), DECIMALS),
    }
    return out


def reference(people: Sequence[Participant], artifact: Mapping[str, Any]) -> dict[str, Any]:
    """The `anomaly` block for a new artifact. Static bounds stay as the fallback."""
    rows = {p.code: system_values(p, artifact) for p in people}
    by_sex: dict[str, Any] = {}
    for sex in ("female", "male"):
        group = _group([rows[p.code] for p in people if p.sex == sex])
        if group is not None:
            by_sex[sex] = group
    pooled = _group(list(rows.values()))
    if pooled is not None:
        by_sex["unspecified"] = pooled
    block = copy.deepcopy(dict(artifact.get("anomaly", {})))
    block.pop("per_sex", None)
    block["z_limit"] = Z_LIMIT
    block["chi2_quantile"] = CHI2_QUANTILE
    block["per_sex"] = by_sex
    block["notes"] = (
        "Reference from the calibration cohort's own system values; static bounds are the "
        f"fallback for a sex with fewer than {MIN_PER_SEX} complete profiles. MAD floor "
        f"{MAD_FLOOR} (log units). Placeholders to review after the pilot."
    )
    return block


# ---- the checks themselves, as the API runs them (the API has its own copy without numpy) ----


def site_z(values: Mapping[str, float], group: Mapping[str, Any]) -> dict[str, float]:
    out = {}
    for site in RATIO_SITES:
        stats = group["sites"][site]
        if site in values and "stature" in values and stats["mad"] > 0:
            out[site] = (math.log(values[site] / values["stature"]) - stats["median"]) / stats[
                "mad"
            ]
    stats = group["waist_hip"]
    if "waist" in values and "hip" in values and stats["mad"] > 0:
        out["waist_hip"] = (math.log(values["waist"] / values["hip"]) - stats["median"]) / stats[
            "mad"
        ]
    return out


def mahalanobis(values: Mapping[str, float], group: Mapping[str, Any]) -> float | None:
    m = group["mahalanobis"]
    if not all(site in values for site in m["sites"]):
        return None
    d = np.log([values[site] for site in m["sites"]]) - np.asarray(m["mean"])
    return float(d @ np.asarray(m["precision"]) @ d)


def flagged(values: Mapping[str, float], group: Mapping[str, Any]) -> bool:
    z = site_z(values, group)
    d2 = mahalanobis(values, group)
    return any(abs(v) > Z_LIMIT for v in z.values()) or (
        d2 is not None and d2 > group["mahalanobis"]["threshold"]
    )


Corruption = Callable[[Mapping[str, float]], dict[str, float]]
CORRUPTIONS: dict[str, Corruption] = {
    "scale_x1.1": lambda v: {site: value * 1.1 for site, value in v.items()},
    "waist_level_swapped": lambda v: {**v, "waist": v["chest"]},
    "girth_plus_50mm": lambda v: {**v, "waist": v["waist"] + 50},
}


def evaluate(people: Sequence[Participant], artifact: Mapping[str, Any]) -> dict[str, Any]:
    """Share of genuine profiles flagged (target 5% or less) and share of corrupted ones caught.

    In-sample: the reference was built from these same people, so the false-flag rate is optimistic.
    """
    block = artifact["anomaly"]["per_sex"]
    genuine: list[bool] = []
    caught: dict[str, list[bool]] = {name: [] for name in CORRUPTIONS}
    for person in people:
        group = block.get(person.sex) or block.get("unspecified")
        values = system_values(person, artifact)
        if group is None or not all(site in values for site in SITES):
            continue
        genuine.append(flagged(values, group))
        for name, corrupt in CORRUPTIONS.items():
            caught[name].append(flagged(corrupt(values), group))
    n = len(genuine)
    return {
        "n": n,
        "genuine_flagged_share": round(float(np.mean(genuine)), 4) if n else None,
        "caught_share": {k: round(float(np.mean(v)), 4) if v else None for k, v in caught.items()},
    }
