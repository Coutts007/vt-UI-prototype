"""Exploratory analyses (backend-spec 12.5): strata, the error decomposition and lighting.

Everything here is labelled exploratory. The oracle terms of the decomposition are diagnostic and
were never used for acceptance.
"""

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from vt_analysis.data import GIRTHS, STRATA, Dataset, group_of
from vt_analysis.stats import (
    cluster_bootstrap,
    method_of_moments_loa,
    participant_differences,
)

MIN_STRATUM = 3


def _arrays(pairs: Sequence[tuple[str, int, float, float]]) -> tuple[np.ndarray, ...]:
    groups = np.array([p[0] for p in pairs])
    system = np.array([p[2] for p in pairs], dtype=float)
    tape = np.array([p[3] for p in pairs], dtype=float)
    return groups, system, tape


def stratified(dataset: Dataset, site: str, *, resamples: int, seed: int) -> list[dict[str, Any]]:
    """Bias (participant means, cluster-bootstrap CI) and moments LoA per stratum level."""
    pairs = dataset.pairs(site)
    by_set = {(s.participant, s.set_no): s for s in dataset.sets}
    rows: list[dict[str, Any]] = []
    for stratum in STRATA:
        levels: dict[str, list[tuple[str, int, float, float]]] = {}
        for pair in pairs:
            level = group_of(dataset, by_set[(pair[0], pair[1])], stratum)
            if level is not None:
                levels.setdefault(str(level), []).append(pair)
        for level, subset in sorted(levels.items()):
            groups, system, tape = _arrays(subset)
            n = len(np.unique(groups))
            if n < MIN_STRATUM:
                rows.append({"site": site, "stratum": stratum, "level": level, "n_participants": n,
                             "note": "too few participants"})  # fmt: skip
                continue
            d = system - tape
            bias = float(participant_differences(groups, system, tape).mean())

            def resampled(
                rows: np.ndarray,
                clusters: np.ndarray,
                system: np.ndarray = system,
                tape: np.ndarray = tape,
            ) -> float:
                return float(participant_differences(clusters, system[rows], tape[rows]).mean())

            # A seed per stratum level that does not depend on Python's string hashing.
            offset = STRATA.index(stratum) * 100 + sorted(levels).index(level)
            boot = cluster_bootstrap(groups, resampled, resamples=resamples, seed=seed + offset)
            low, high = np.percentile(boot, [2.5, 97.5])
            loa = method_of_moments_loa(groups, d)
            rows.append({
                "site": site, "stratum": stratum, "level": level, "n_participants": n,
                "n_pairs": len(d), "bias_mm": round(bias, 2), "bias_ci_low": round(float(low), 2),
                "bias_ci_high": round(float(high), 2), "loa_lower_mm": round(loa["lower"], 2),
                "loa_upper_mm": round(loa["upper"], 2), "note": "exploratory",
            })  # fmt: skip
    return rows


def decomposition(dataset: Dataset) -> list[dict[str, Any]]:
    """Sequential substitution on the test cohort's girths (12.5, proposal 3.7.2).

    1. Scale term: the system girth rescaled by tape stature over system stature, which is what
       the marker scale would give if it matched the stature scale.
    2. Level term: not estimable from the CSV exports, which hold values and not profiles. It
       needs the capture profiles (a bundle of the test cohort) and is reported as not estimated.
    3. Cross-section term: the residual after an oracle per-site factor fitted on these very
       test values (least squares through the origin).
    4. Remainder: what is left after the oracle factor.
    Shares are of the total squared error before any substitution. Diagnostic only.
    """
    rows: list[dict[str, Any]] = []
    stature_tape = dataset.reference("stature")
    stature_system: dict[tuple[str, int], float] = {
        (s.participant, s.set_no): s.values_mm["stature"]
        for s in dataset.sets
        if "stature" in s.values_mm
    }
    for site in GIRTHS:
        pairs = dataset.pairs(site)
        usable = [p for p in pairs if p[0] in stature_tape and (p[0], p[1]) in stature_system]
        if len(usable) < 3:
            rows.append({"site": site, "n_pairs": len(usable), "note": "too few pairs"})
            continue
        groups, system, tape = _arrays(usable)
        ratio = np.array([stature_tape[p[0]] / stature_system[(p[0], p[1])] for p in usable])
        rescaled = system * ratio
        total = float(((system - tape) ** 2).mean())
        after_scale = float(((rescaled - tape) ** 2).mean())
        factor = float((rescaled * tape).sum() / (rescaled**2).sum())
        after_factor = float(((rescaled * factor - tape) ** 2).mean())
        rows.append({
            "site": site, "n_pairs": len(usable),
            "mae_before_mm": round(float(np.abs(system - tape).mean()), 2),
            "scale_term_mean_abs_change_mm": round(float(np.abs(rescaled - system).mean()), 2),
            "scale_term_share": _share(total - after_scale, total),
            "level_term": "not estimated: needs capture profiles, not in the CSV export",
            "oracle_factor": round(factor, 4),
            "cross_section_term_mean_abs_change_mm": round(
                float(np.abs(rescaled * factor - rescaled).mean()), 2
            ),
            "cross_section_term_share": _share(after_scale - after_factor, total),
            "remainder_rmse_mm": round(math.sqrt(after_factor), 2),
            "remainder_share": _share(after_factor, total),
            "note": "diagnostic; oracle terms fitted on the test cohort, never used for acceptance",
        })  # fmt: skip
    return rows


def _share(part: float, total: float) -> float | None:
    return None if total <= 0 else round(part / total, 3)


def lighting(dataset: Dataset, site: str) -> dict[str, Any]:
    """Absolute error against lux (lowess) and the lux below which failed sites rise (12.5)."""
    pairs = dataset.pairs(site)
    by_set = {(s.participant, s.set_no): s for s in dataset.sets}
    lux = np.array([by_set[(p[0], p[1])].lux or math.nan for p in pairs], dtype=float)
    err = np.array([abs(p[2] - p[3]) for p in pairs], dtype=float)
    keep = np.isfinite(lux)
    out: dict[str, Any] = {"site": site, "n_with_lux": int(keep.sum())}
    if keep.sum() < 5:
        out["note"] = "too few sets with a lux reading"
        return out
    from statsmodels.nonparametric.smoothers_lowess import lowess

    curve = lowess(err[keep], lux[keep], frac=0.6, return_sorted=True)
    out["lowess"] = [[round(float(a), 1), round(float(b), 2)] for a, b in curve]
    # Share of failed sites per lux band, and the first band from the top where it rises.
    flagged = []
    for s in dataset.sets:
        if s.lux is not None:
            flagged.append((s.lux, s.flags.get(site) == "fail"))
    bands = sorted({50, 100, 200, 400, 800} | {round(f[0], -1) for f in flagged})
    shares = []
    for low, high in zip([0, *bands], bands, strict=False):
        inside = [f[1] for f in flagged if low <= f[0] < high]
        if inside:
            shares.append({"lux_from": low, "lux_to": high, "n": len(inside),
                           "failed_share": round(sum(inside) / len(inside), 3)})  # fmt: skip
    out["failed_share_by_lux"] = shares
    overall = sum(f[1] for f in flagged) / len(flagged) if flagged else 0.0
    rising = [b for b in shares if b["failed_share"] > overall and b["n"] >= 3]
    out["flags_rise_below_lux"] = max(b["lux_to"] for b in rising) if rising else None
    return out


def modes_difference(dataset: Dataset, site: str) -> dict[str, Any]:
    """Self-capture against assisted on participants who have both (12.3 repeatability row)."""
    per: dict[str, dict[str, list[float]]] = {}
    for s in dataset.sets:
        value = s.values_mm.get(site)
        if value is None:
            continue
        per.setdefault(s.participant, {}).setdefault(s.capture_mode, []).append(value)
    both = [
        (np.mean(m["self"]), np.mean(m["assisted"]))
        for m in per.values()
        if "self" in m and "assisted" in m
    ]
    from vt_analysis.stats import paired_difference

    if not both:
        return {"n": 0, "mean": math.nan, "lower": math.nan, "upper": math.nan}
    a, b = np.array([x[0] for x in both]), np.array([x[1] for x in both])
    return paired_difference(a, b)


def summarise_strata_for_card(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    return {str(r["stratum"]): 0 for r in rows} if rows else {}
