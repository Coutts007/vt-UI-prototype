"""The calibration learner: virtual capture to tailor measurement (backend-spec 11.3).

For each torso girth it grid-searches the level, fits a correction factor through the origin
(CF = sum(P*T) / sum(P^2)) and scores each level by leave-one-participant-out MAE, refitting the
factor inside every fold. The prior level stays unless a new one is at least 2 mm better. An affine
variant (a*P + c) is adopted only if it is at least 3 mm better and its bootstrap interval of the
gain excludes zero. Widths and lengths get constant offsets. A participant-level bootstrap gives
95% intervals. Every random number comes from one seeded generator, so a fit is reproducible.
"""

import copy
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from vt_measure.derive import SITES, derive

from vt_ml import __version__
from vt_ml.data import CALIBRATION, PROTOCOL_READINGS, SEXES, Participant, cohort_hash

GIRTH_BANDS = {
    "chest": (0.15, 0.40),
    "waist": (0.45, 0.75),
    "hip": (0.10, 0.40),
    "neck": (0.05, 0.20),
}
LEVEL_STEP = 0.01
PRIOR_KEEP_MM = 2.0
AFFINE_ADOPT_MM = 3.0
PER_SEX_MINIMUM = 8
OFFSET_SITES = ("shoulder", "sleeve", "outleg", "inleg")
BOOTSTRAP_RESAMPLES = 2000
DEFAULT_SEED = 20270301
# Decimal places kept in the artifact. The database stores factors to 4 places.
CF_DECIMALS = 4
MM_DECIMALS = 1
METRIC_DECIMALS = 2

Rules = dict[str, Any]


def grid(low: float, high: float) -> list[float]:
    count = round((high - low) / LEVEL_STEP)
    return [round(low + i * LEVEL_STEP, 2) for i in range(count + 1)]


def read_level(rules: Mapping[str, Any], site: str, sex: str = "unspecified") -> float:
    levels = rules["levels"]
    if site == "chest":
        return float(levels["chest"][sex])
    if site == "waist":
        return float(levels["waist"])
    if site == "hip":
        return float(levels["hip_band_knee_fraction"])
    return float(levels["neck_above_shoulder_frac"])


def set_level(rules: Rules, site: str, value: float, sexes: Sequence[str] = SEXES) -> None:
    levels = rules["levels"]
    if site == "chest":
        for sex in sexes:
            levels["chest"][sex] = value
    elif site == "waist":
        levels["waist"] = value
    elif site == "hip":
        levels["hip_band_knee_fraction"] = value
    else:
        levels["neck_above_shoulder_frac"] = value


def neutral(rules: Mapping[str, Any]) -> Rules:
    """Raw system values: factor 1, no intercept, no offsets, nothing refused as implausible."""
    out = copy.deepcopy(dict(rules))
    out["girth_model"]["correction_factors"] = dict.fromkeys(GIRTH_BANDS, 1.0)
    out["girth_model"].pop("intercepts_mm", None)
    out["offsets_mm"] = dict.fromkeys(out["offsets_mm"], 0)
    out["plausible_mm"] = {site: [0, 100000] for site in SITES}
    return out


def _mean(values: Sequence[float]) -> float | None:
    if not values:
        return None
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


@dataclass
class Exclusion:
    participant: str
    set_no: int | None
    site: str
    reason: str


@dataclass
class Evaluator:
    """Runs vt_measure over every capture set, once per distinct rules artifact."""

    people: Sequence[Participant]
    exclusions: list[Exclusion] = field(default_factory=list)
    _cache: dict[str, list[list[Any]]] = field(default_factory=dict)
    _logged: set[tuple[str, int, str]] = field(default_factory=set)

    def _sites(self, rules: Rules) -> list[list[Any]]:
        import json

        key = json.dumps(rules, sort_keys=True)
        if key not in self._cache:
            self._cache[key] = [
                [derive(s.profile, rules).sites for s in p.sets] for p in self.people
            ]
        return self._cache[key]

    def values(self, rules: Rules, site: str, kind: str, log: bool = False) -> np.ndarray:
        """Per participant, the mean over sets that did not fail: perimeter or raw value."""
        out = np.full(len(self.people), np.nan)
        for i, (person, results) in enumerate(zip(self.people, self._sites(rules), strict=True)):
            kept = []
            for capture, result in zip(person.sets, results, strict=True):
                r = result[site]
                value = r.perimeter_mm if kind == "perimeter" else r.raw_mm
                if r.flag == "fail" or value is None:
                    tag = (person.code, capture.set_no, site)
                    if log and tag not in self._logged:
                        self._logged.add(tag)
                        reason = ",".join(r.reasons) or "no_value"
                        self.exclusions.append(Exclusion(person.code, capture.set_no, site, reason))
                    continue
                kept.append(float(value))
            mean = _mean(kept)
            if mean is not None:
                out[i] = mean
        return out


# ---- closed-form leave-one-participant-out, vectorised over candidate levels ----


def _group_sums(values: np.ndarray, groups: np.ndarray, count: int) -> np.ndarray:
    out = np.zeros((count, *values.shape[1:]))
    np.add.at(out, groups, values)
    return out


def loo_cf_mae(P: np.ndarray, T: np.ndarray, groups: np.ndarray) -> Any:
    """LOO MAE of factor-through-origin for each column of P, leaving out whole groups.

    An array for a 2-D P (one value per column), a float for a 1-D P.
    """
    P2 = P if P.ndim == 2 else P[:, None]
    count = int(groups.max()) + 1
    PT, PP = P2 * T[:, None], P2 * P2
    gPT, gPP = _group_sums(PT, groups, count), _group_sums(PP, groups, count)
    with np.errstate(divide="ignore", invalid="ignore"):
        cf = (PT.sum(0) - gPT[groups]) / (PP.sum(0) - gPP[groups])
        mae = np.abs(cf * P2 - T[:, None]).mean(0)
    mae[~np.isfinite(mae)] = np.nan
    return mae if P.ndim == 2 else mae[0]


def loo_affine_mae(P: np.ndarray, T: np.ndarray, groups: np.ndarray) -> float:
    """LOO MAE of T = a*P + c, refitting a and c without each group."""
    count = int(groups.max()) + 1
    ones = np.ones_like(P)
    sums = {
        name: _group_sums(v, groups, count)
        for name, v in (("n", ones), ("p", P), ("t", T), ("pp", P * P), ("pt", P * T))
    }
    totals = {"n": len(P), "p": P.sum(), "t": T.sum(), "pp": (P * P).sum(), "pt": (P * T).sum()}
    rest = {k: totals[k] - sums[k][groups] for k in sums}
    with np.errstate(divide="ignore", invalid="ignore"):
        a = (rest["n"] * rest["pt"] - rest["p"] * rest["t"]) / (
            rest["n"] * rest["pp"] - rest["p"] ** 2
        )
        c = (rest["t"] - a * rest["p"]) / rest["n"]
        mae = float(np.abs(a * P + c - T).mean())
    return mae if math.isfinite(mae) else math.nan


def loo_offset_mae(D: np.ndarray, T: np.ndarray, groups: np.ndarray) -> float:
    count = int(groups.max()) + 1
    R = T - D
    gR, gN = _group_sums(R, groups, count), _group_sums(np.ones_like(R), groups, count)
    with np.errstate(divide="ignore", invalid="ignore"):
        offset = (R.sum() - gR[groups]) / (len(R) - gN[groups])
        mae = float(np.abs(D + offset - T).mean())
    return mae if math.isfinite(mae) else math.nan


def cf_through_origin(P: np.ndarray, T: np.ndarray) -> float:
    return float((P * T).sum() / (P * P).sum())


def affine_fit(P: np.ndarray, T: np.ndarray) -> tuple[float, float]:
    n = len(P)
    a = (n * (P * T).sum() - P.sum() * T.sum()) / (n * (P * P).sum() - P.sum() ** 2)
    return float(a), float((T.sum() - a * P.sum()) / n)


def pick_level(maes: Sequence[float], levels: Sequence[float], prior: float) -> tuple[int, int]:
    """(chosen index, best index). The prior stays unless the best is at least 2 mm better.

    Ties go to the first (lowest) level, so the choice never depends on float noise.
    """
    scores = np.asarray(maes, dtype=float)
    prior_index = levels.index(prior)
    if not np.isfinite(scores).any():
        # Nothing could be scored (too few participants): the prior stays.
        return prior_index, prior_index
    best = int(np.nanargmin(scores))
    if not math.isfinite(scores[prior_index]):
        return best, best
    gain = round(float(scores[prior_index] - scores[best]), 6)
    return (best if gain >= PRIOR_KEEP_MM else prior_index), best


def affine_adopted(gain_mm: float, gain_ci: Sequence[float] | None) -> bool:
    """Adopt a*P + c only if it gains at least 3 mm and the interval of the gain excludes zero."""
    if not math.isfinite(gain_mm) or gain_ci is None or not all(map(math.isfinite, gain_ci)):
        return False
    return round(gain_mm, 6) >= AFFINE_ADOPT_MM and gain_ci[0] > 0


# ---- one complete fit on a set of rows (used for the data and for every bootstrap resample) ----


@dataclass
class SiteData:
    """Everything a girth fit needs: perimeters per candidate level, and the tape targets."""

    site: str
    levels: list[float]
    prior: float
    P: np.ndarray  # participants x candidate levels (per-sex levels for chest are separate entries)
    T: np.ndarray
    sexes: np.ndarray
    per_sex: bool


def fit_girth(data: SiteData, rows: np.ndarray, groups: np.ndarray) -> dict[str, Any]:
    """Level, factor and LOO metrics on the given rows of the site data."""
    P, T, sexes = data.P[rows], data.T[rows], data.sexes[rows]
    out: dict[str, Any] = {}

    def choose(mask: np.ndarray) -> tuple[int, int, np.ndarray]:
        maes = loo_cf_mae(P[mask], T[mask], _dense(groups[mask]))
        chosen, best = pick_level(list(maes), data.levels, data.prior)
        return chosen, best, maes

    chosen, best, maes = choose(np.ones(len(T), dtype=bool))
    column = np.full(len(T), chosen)
    out["levels"] = {"pooled": data.levels[chosen]}
    out["best_level"] = data.levels[best]
    out["curve"] = maes
    if data.per_sex:
        for sex in ("female", "male"):
            mask = sexes == sex
            # A bootstrap resample can hold one participant of a sex, or none: leave-one-out has
            # nothing left to fit then, so that sex takes the pooled level.
            sex_chosen = chosen if len(np.unique(groups[mask])) < 2 else choose(mask)[0]
            column[mask] = sex_chosen
            out["levels"][sex] = data.levels[sex_chosen]
    p_final = P[np.arange(len(T)), column]
    out["cf"] = cf_through_origin(p_final, T)
    out["loo_mae"] = float(loo_cf_mae(p_final, T, groups))
    prior_index = data.levels.index(data.prior)
    out["prior_loo_mae"] = float(maes[prior_index])
    out["affine"] = affine_fit(p_final, T)
    out["affine_loo_mae"] = loo_affine_mae(p_final, T, groups)
    out["affine_gain"] = out["loo_mae"] - out["affine_loo_mae"]
    out["p_final"] = p_final
    return out


def _dense(groups: np.ndarray) -> np.ndarray:
    _, dense = np.unique(groups, return_inverse=True)
    return dense


def _ci(values: Sequence[float]) -> list[float] | None:
    array = np.asarray(values, dtype=float)
    array = array[np.isfinite(array)]
    if len(array) == 0:
        return None
    low, high = np.percentile(array, [2.5, 97.5])
    return [round(float(low), 4), round(float(high), 4)]


@dataclass
class Fit:
    artifact: Rules
    summary: dict[str, Any]
    tables: dict[str, list[dict[str, Any]]]


def calibrate(
    people: Sequence[Participant],
    base: Mapping[str, Any],
    *,
    version: str,
    created_at: str,
    seed: int = DEFAULT_SEED,
    resamples: int = BOOTSTRAP_RESAMPLES,
    min_readings: int = PROTOCOL_READINGS,
    anomaly: Callable[[Sequence[Participant], Rules], dict[str, Any]] | None = None,
) -> Fit:
    """Fit a draft artifact from the calibration cohort. Takes data only from the repository."""
    rng = np.random.default_rng(seed)
    people = list(people)
    if any(p.cohort != CALIBRATION for p in people):
        raise ValueError("The fitter reads the calibration cohort only (backend-spec 2.3.1)")
    evaluator = Evaluator(people)
    raw = neutral(base)
    artifact: Rules = copy.deepcopy(dict(base))
    loo: dict[str, Any] = {}
    cis: dict[str, Any] = {}
    curves: list[dict[str, Any]] = []
    scatter: list[dict[str, Any]] = []
    sexes = np.array([p.sex for p in people])
    targets = {
        site: np.array([_nan(p.target(site, min_readings)) for p in people]) for site in SITES
    }

    # 1. Torso girths, in an order that lets outside leg use the fitted waist level.
    site_data: dict[str, tuple[SiteData, np.ndarray]] = {}
    for site, (low, high) in GIRTH_BANDS.items():
        prior = round(read_level(base, site), 2)
        levels = sorted({*grid(low, high), prior})
        per_sex = site == "chest" and all(
            int(((sexes == sex) & np.isfinite(targets[site])).sum()) >= PER_SEX_MINIMUM
            for sex in ("female", "male")
        )
        columns = []
        for value in levels:
            rules = copy.deepcopy(raw)
            set_level(rules, site, value)
            columns.append(evaluator.values(rules, site, "perimeter", log=value == prior))
        P = np.column_stack(columns)
        usable = np.isfinite(targets[site]) & np.isfinite(P).all(axis=1)
        for i in np.where(~usable)[0]:
            reason = "tape_incomplete" if not np.isfinite(targets[site][i]) else "a_level_failed"
            evaluator.exclusions.append(Exclusion(people[i].code, None, site, reason))
        site_data[site] = (SiteData(site, levels, prior, P, targets[site], sexes, per_sex), usable)

    # 2. One fit on the data, then the bootstrap over participants.
    results: dict[str, dict[str, Any]] = {}
    for site, (data, usable) in site_data.items():
        rows = np.where(usable)[0]
        n = len(rows)
        if n < 2:
            loo[site] = {"n": n, "status": "insufficient", "level": data.prior,
                         "cf": float(base["girth_model"]["correction_factors"][site])}  # fmt: skip
            continue
        fit = fit_girth(data, rows, np.arange(n))
        boot: dict[str, list[float]] = {"level": [], "cf": [], "loo_mae": [], "affine_gain": []}
        for _ in range(resamples):
            pick = rows[rng.integers(0, n, n)]
            if len(np.unique(pick)) < 2:
                continue
            again = fit_girth(data, pick, _dense(pick))
            boot["level"].append(again["levels"]["pooled"])
            boot["cf"].append(again["cf"])
            boot["loo_mae"].append(again["loo_mae"])
            boot["affine_gain"].append(again["affine_gain"])
        ci = {name: _ci(values) for name, values in boot.items()}
        fit["ci"] = ci
        fit["adopt_affine"] = affine_adopted(fit["affine_gain"], ci["affine_gain"])
        results[site] = fit
        for level, mae in zip(data.levels, fit["curve"], strict=True):
            curves.append({"site": site, "level": level, "loo_mae_mm": _round(mae), "n": n})

    intercepts: dict[str, float] = {}
    for site, fit in results.items():
        levels = fit["levels"]
        if site == "chest":
            pooled = levels["pooled"]
            artifact["levels"]["chest"] = {
                "female": levels.get("female", pooled),
                "male": levels.get("male", pooled),
                "unspecified": pooled,
            }
        else:
            set_level(artifact, site, levels["pooled"])
        if fit["adopt_affine"]:
            a, c = fit["affine"]
            artifact["girth_model"]["correction_factors"][site] = round(a, CF_DECIMALS)
            intercepts[site] = round(c, MM_DECIMALS)
        else:
            artifact["girth_model"]["correction_factors"][site] = round(fit["cf"], CF_DECIMALS)
        loo[site] = {
            "n": int(len(fit["p_final"])),
            "level": levels["pooled"],
            **(
                {"level_female": levels["female"], "level_male": levels["male"]}
                if "female" in levels
                else {}
            ),
            "best_level": fit["best_level"],
            "kept_prior": levels["pooled"] != fit["best_level"],
            "cf": round(fit["cf"], CF_DECIMALS),
            "loo_mae_mm": _round(fit["loo_mae"]),
            "prior_loo_mae_mm": _round(fit["prior_loo_mae"]),
            "affine_loo_mae_mm": _round(fit["affine_loo_mae"]),
            "affine_adopted": fit["adopt_affine"],
        }
        cis[site] = {k: v for k, v in fit["ci"].items() if v is not None}
    if intercepts:
        artifact["girth_model"]["intercepts_mm"] = {
            site: intercepts.get(site, 0.0) for site in GIRTH_BANDS
        }
    else:
        artifact["girth_model"].pop("intercepts_mm", None)

    # 3. Constant offsets for widths and lengths, under the fitted levels (outleg needs the waist).
    lengths = neutral(artifact)
    for site in OFFSET_SITES:
        D = evaluator.values(lengths, site, "raw", log=True)
        T = targets[site]
        usable = np.isfinite(D) & np.isfinite(T)
        n = int(usable.sum())
        prior = _prior_offset(base, site)
        if n < 1:
            loo[site] = {"n": 0, "status": "insufficient", "offset_mm": prior}
            continue
        d, t = D[usable], T[usable]
        offset = float((t - d).mean())
        groups = np.arange(n)
        entry: dict[str, Any] = {
            "n": n,
            "offset_mm": round(offset, MM_DECIMALS),
            "prior_offset_mm": prior,
            "prior_mae_mm": _round(float(np.abs(d + prior - t).mean())),
        }
        boot_offsets = []
        if n >= 2:
            entry["loo_mae_mm"] = _round(loo_offset_mae(d, t, groups))
            for _ in range(resamples):
                pick = rng.integers(0, n, n)
                boot_offsets.append(float((t[pick] - d[pick]).mean()))
            offset_ci = _ci(boot_offsets)
            if offset_ci is not None:
                cis[site] = {"offset_mm": offset_ci}
        loo[site] = entry
        _set_offset(artifact, site, round(offset, MM_DECIMALS))

    # 4. The anomaly reference, from the same rows and nothing else.
    if anomaly is not None:
        artifact["anomaly"] = anomaly(people, artifact)

    counted = [
        p
        for p in people
        if any(np.isfinite(targets[s][i]) for s in SITES for i in [people.index(p)])
    ]
    artifact.update(
        rules_version=version,
        status="draft",
        parent=base["rules_version"],
        created_at=created_at,
        created_by=f"vt_ml.calibrate {__version__}",
    )
    artifact["fit"] = {
        "cohort": "calibration",
        "n_participants": len(counted),
        "n_capture_sets": sum(len(p.sets) for p in counted),
        "cohort_hash": cohort_hash(counted) if counted else None,
        "loo": loo,
        "bootstrap_ci": cis,
        "notes": _notes(len(counted), min_readings, resamples, seed),
    }
    artifact["checksum"] = checksum(artifact)

    tables = _tables(evaluator, people, base, artifact, targets, results)
    tables["level_curves"] = curves
    tables["exclusions"] = [e.__dict__ for e in evaluator.exclusions]
    for site, fit in results.items():
        rows_used = np.where(site_data[site][1])[0]
        for i, p_value in zip(rows_used, fit["p_final"], strict=True):
            scatter.append({
                "site": site, "participant": people[i].code,
                "perimeter_mm": _round(p_value), "tape_mm": _round(targets[site][i]),
            })  # fmt: skip
    tables["perimeter_vs_tape"] = scatter
    summary = {
        "rules_version": version, "parent": base["rules_version"], "seed": seed,
        "resamples": resamples, "min_readings": min_readings, "fit": artifact["fit"],
    }  # fmt: skip
    return Fit(artifact, summary, tables)


def _nan(value: float | None) -> float:
    return math.nan if value is None else value


def _round(value: float) -> float | None:
    return None if not math.isfinite(value) else round(float(value), METRIC_DECIMALS)


def _prior_offset(base: Mapping[str, Any], site: str) -> float:
    offsets = base["offsets_mm"]
    if site == "shoulder":
        return float(2 * offsets["acromion"] + offsets["shoulder"])
    return float(offsets[site])


def _set_offset(artifact: Rules, site: str, value: float) -> None:
    """Shoulder and acromion share one fitted offset, carried on shoulder (11.3.3)."""
    if site == "shoulder":
        artifact["offsets_mm"]["acromion"] = 0
    artifact["offsets_mm"][site] = value


def _notes(n: int, min_readings: int, resamples: int, seed: int) -> str:
    text = (
        f"Fitted by vt_ml.calibrate on {n} calibration participants; LOO by participant; "
        f"{resamples} participant bootstrap resamples, seed {seed}."
    )
    if min_readings < PROTOCOL_READINGS:
        text += f" Tape targets used {min_readings}+ readings, below the 4-reading protocol."
    return text


def _tables(evaluator: Evaluator, people: Sequence[Participant], base: Mapping[str, Any],
            artifact: Mapping[str, Any], targets: Mapping[str, np.ndarray],
            results: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:  # fmt: skip
    before_rules, after_rules = copy.deepcopy(dict(base)), copy.deepcopy(dict(artifact))
    rows, residuals = [], []
    for site in SITES:
        before = evaluator.values(before_rules, site, "raw")
        after = evaluator.values(after_rules, site, "raw")
        T = targets[site]
        entry: dict[str, Any] = {"site": site}
        for label, values in (("before", before), ("after", after)):
            ok = np.isfinite(values) & np.isfinite(T)
            err = values[ok] - T[ok]
            entry[f"n_{label}"] = int(ok.sum())
            entry[f"bias_{label}_mm"] = _round(float(err.mean())) if len(err) else None
            entry[f"mae_{label}_mm"] = _round(float(np.abs(err).mean())) if len(err) else None
            entry[f"rmse_{label}_mm"] = (
                _round(float(np.sqrt((err**2).mean()))) if len(err) else None
            )
        rows.append(entry)
        stature = targets["stature"]
        for i, person in enumerate(people):
            if math.isfinite(after[i]) and math.isfinite(T[i]):
                residuals.append({"site": site, "participant": person.code, "sex": person.sex,
                                  "stature_tape_mm": _round(stature[i]),
                                  "residual_mm": _round(after[i] - T[i])})  # fmt: skip
    return {"before_after": rows, "residuals": residuals}


def checksum(artifact: Mapping[str, Any]) -> str:
    """The same canonical form as packages/rules/checksum.py and the API."""
    import hashlib
    import json

    body = {k: v for k, v in artifact.items() if k not in ("checksum", "status")}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
