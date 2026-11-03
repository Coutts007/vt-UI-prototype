"""One analysis run (backend-spec 12.3 to 12.7): statistics per site, verdicts, exploratory
analyses, figures, tables and metadata. Deterministic for the same inputs and seed."""

import csv
import json
import math
import platform
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any

import numpy as np

from vt_analysis import __version__, exploratory, plots
from vt_analysis.data import GIRTHS, SITES, TIERED, Dataset, bmi_class
from vt_analysis.stats import (
    Agreement,
    agreement,
    group_means,
    icc_2_1,
    lins_ccc,
    magnitudes,
    proportional_bias,
    repeatability,
    tem_multi_reading,
    tem_summary,
    tem_two_readings,
    within_tolerance,
)
from vt_analysis.verdicts import Verdict, verdict

DEFAULT_SEED = 20270520
DEFAULT_RESAMPLES = 2000
MIN_PARTICIPANTS = 3


@dataclass
class SiteResult:
    site: str
    agreement: Agreement | None
    magnitudes_pairs: dict[str, float]
    magnitudes_means: dict[str, float]
    within: dict[str, float]
    icc: dict[str, float] | None
    ccc: dict[str, float] | None
    proportional: dict[str, float] | None
    repeatability: dict[str, float]
    modes: dict[str, Any]
    tem: dict[str, Any]
    verdict: Verdict | None
    note: str | None = None


@dataclass
class RunResult:
    sites: dict[str, SiteResult]
    strata: list[dict[str, Any]]
    decomposition: list[dict[str, Any]]
    lighting: list[dict[str, Any]]
    figures: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


def _arrays(pairs: Sequence[tuple[str, int, float, float]]) -> tuple[np.ndarray, ...]:
    return (
        np.array([p[0] for p in pairs]),
        np.array([p[1] for p in pairs]),
        np.array([p[2] for p in pairs], dtype=float),
        np.array([p[3] for p in pairs], dtype=float),
    )


def tape_reliability(dataset: Dataset, site: str) -> dict[str, Any]:
    """Intra- and inter-observer TEM, the pooled multi-reading TEM, %TEM and R (12.3)."""
    by: dict[str, dict[tuple[str, int], float]] = {}
    for r in dataset.readings:
        if r.site == site:
            by.setdefault(r.participant, {})[(r.measurer, r.reading_no)] = r.value_mm
    # The protocol: two measurers, two readings each. Participants whose readings are arranged
    # differently (a third measurer, a third reading) are left out of the reliability figures.
    measurers = sorted({m for v in by.values() for (m, _) in v})[:2]
    keys = [(m, k) for m in measurers for k in (1, 2)]
    complete = {code: v for code, v in by.items() if all(key in v for key in keys)}
    out: dict[str, Any] = {"n_participants": len(complete), "measurers": ",".join(measurers)}
    if len(complete) < 2 or len(measurers) < 2:
        out["note"] = "too few participants with the two-measurer, two-reading protocol"
        return out
    all_values = np.array([[v[key] for key in keys] for v in complete.values()])
    for m in measurers:
        first = np.array([v[(m, 1)] for v in complete.values()])
        second = np.array([v[(m, 2)] for v in complete.values()])
        out[f"intra_tem_{m}_mm"] = round(tem_two_readings(first, second), 2)
    a, b = measurers
    mean_a = np.array([(v[(a, 1)] + v[(a, 2)]) / 2 for v in complete.values()])
    mean_b = np.array([(v[(b, 1)] + v[(b, 2)]) / 2 for v in complete.values()])
    out["inter_tem_mm"] = round(tem_two_readings(mean_a, mean_b), 2)
    pooled = tem_multi_reading(all_values)
    # R against the SD of all readings (Ulijaszek and Kerr, 1999).
    summary = tem_summary(pooled, all_values.ravel())
    out["pooled_tem_mm"] = round(pooled, 2)
    out["pct_tem"] = round(summary["pct_tem"], 3)
    out["reliability"] = round(summary["reliability"], 4)
    return out


def analyse_site(dataset: Dataset, site: str, *, resamples: int, seed: int) -> SiteResult:
    pairs = dataset.pairs(site)
    groups, sets, system, tape = _arrays(pairs) if pairs else (np.array([]),) * 4
    tem = tape_reliability(dataset, site)
    n = len(np.unique(groups)) if len(groups) else 0
    if n < MIN_PARTICIPANTS:
        return SiteResult(
            site, None, {}, {}, {}, None, None, None, {}, {}, tem, None,
            note=f"too few participants with a value and a reference ({n})",
        )  # fmt: skip
    agree = agreement(groups, system, tape, resamples=resamples, seed=seed)
    labels, sys_means = group_means(groups, system)
    _, tape_means = group_means(groups, tape)
    within = within_tolerance(system, tape)
    result = SiteResult(
        site=site,
        agreement=agree,
        magnitudes_pairs=magnitudes(system, tape),
        magnitudes_means=magnitudes(sys_means, tape_means),
        within=within,
        icc=icc_2_1(np.column_stack([sys_means, tape_means])),
        ccc=lins_ccc(sys_means, tape_means),
        proportional=proportional_bias(groups, system, tape),
        repeatability=repeatability(groups, system),
        modes=exploratory.modes_difference(dataset, site),
        tem=tem,
        verdict=None,
    )
    if site in TIERED:
        limit = 15 if site not in GIRTHS else 30
        result.verdict = verdict(site, agree, within[f"within_{limit}mm"])
    return result


def run(
    dataset: Dataset,
    out: Path,
    *,
    seed: int = DEFAULT_SEED,
    resamples: int = DEFAULT_RESAMPLES,
    calibration_report: Path | None = None,
) -> RunResult:
    out.mkdir(parents=True, exist_ok=True)
    tables, figures = out / "tables", out / "figures"
    tables.mkdir(exist_ok=True)
    results: dict[str, SiteResult] = {}
    strata: list[dict[str, Any]] = []
    lighting: list[dict[str, Any]] = []
    written: list[str] = []
    for i, site in enumerate(SITES):
        results[site] = analyse_site(dataset, site, resamples=resamples, seed=seed + i)
        strata += exploratory.stratified(dataset, site, resamples=resamples, seed=seed + 100 + i)
        lighting.append(exploratory.lighting(dataset, site))
        written += _figures(dataset, site, results[site], figures)
    decomposition = exploratory.decomposition(dataset)
    if calibration_report is not None and (calibration_report / "level_curves.csv").exists():
        with (calibration_report / "level_curves.csv").open(newline="") as handle:
            written += plots.level_curves(figures, list(csv.DictReader(handle)))
    result = RunResult(results, strata, decomposition, lighting, figures=written)
    result.metadata = _metadata(dataset, seed, resamples)
    _write_tables(result, dataset, tables)
    (out / "metadata.json").write_text(json.dumps(result.metadata, indent=2, sort_keys=True) + "\n")
    return result


def _figures(dataset: Dataset, site: str, result: SiteResult, folder: Path) -> list[str]:
    if result.agreement is None:
        return []
    pairs = dataset.pairs(site)
    groups, sets, system, tape = _arrays(pairs)
    _, sys_means = group_means(groups, system)
    _, tape_means = group_means(groups, tape)
    a = result.agreement
    slope = None
    if result.proportional and math.isfinite(result.proportional["slope"]):
        slope = (result.proportional["slope"], result.proportional["intercept"])
    written = plots.bland_altman(
        folder, site, (sys_means + tape_means) / 2, sys_means - tape_means, a.bias,
        (a.loa_lower, a.loa_upper), a.bias_ci, (a.loa_lower_ci, a.loa_upper_ci), slope,
    )  # fmt: skip
    written += plots.scatter(folder, site, tape_means, sys_means)
    classes: dict[str, list[float]] = {}
    for code, diff in zip(np.unique(groups), sys_means - tape_means, strict=True):
        cls = dataset.covariates.get(str(code), {}).get("bmi_class")
        if cls:
            classes.setdefault(cls, []).append(float(diff))
    if len(classes) >= 2:
        order = [c for c in ("under_25", "25_to_30", "30_or_more") if c in classes]
        written += plots.residuals_by_class(
            folder, site, order, [np.array(classes[c]) for c in order]
        )
    first = {p[0]: p[2] for p in pairs if p[1] == 1}
    third = {p[0]: p[2] for p in pairs if p[1] == 3}
    both = sorted(set(first) & set(third))
    if len(both) >= 3:
        written += plots.repeatability_plot(
            folder, site, np.array([first[c] for c in both]), np.array([third[c] for c in both])
        )
    return written


def _metadata(dataset: Dataset, seed: int, resamples: int) -> dict[str, Any]:
    def version(name: str) -> str:
        try:
            return importlib_metadata.version(name)
        except importlib_metadata.PackageNotFoundError:
            return "unknown"

    return {
        "rules_version": dataset.rules_version,
        "frozen_at": dataset.frozen_at,
        "cohort": "test",
        "cohort_counts_in_export": dataset.cohort_counts,
        "participants_analysed": len(dataset.participants),
        "capture_sets_analysed": len(dataset.sets),
        "exclusions": [e.row() for e in dataset.exclusions],
        "seed": seed,
        "bootstrap_resamples": resamples,
        "software": {
            "vt_analysis": __version__,
            "python": platform.python_version(),
            "numpy": version("numpy"),
            "scipy": version("scipy"),
            "statsmodels": version("statsmodels"),
            "matplotlib": version("matplotlib"),
        },
        "notes": [
            "Bias and LoA on participant means; LoA from a REML mixed model, bootstrap intervals "
            "from the Bland-Altman (1999) moments estimate over participant resamples.",
            "Stature is reported but not tiered. Neck is tiered unless the owner decides "
            "otherwise.",
            "Oracle terms in the error decomposition are diagnostic and never used for acceptance.",
        ],
    }


def _row(result: SiteResult) -> dict[str, Any]:
    a = result.agreement
    row: dict[str, Any] = {"site": result.site}
    if a is None:
        row["note"] = result.note
        return row
    row.update({
        "n_participants": a.n_participants, "n_pairs": a.n_pairs,
        "bias_mm": _r(a.bias), "bias_ci_low": _r(a.bias_ci[0]), "bias_ci_high": _r(a.bias_ci[1]),
        "sd_differences_mm": _r(a.sd_differences),
        "loa_lower_mm": _r(a.loa_lower), "loa_lower_ci_low": _r(a.loa_lower_ci[0]),
        "loa_lower_ci_high": _r(a.loa_lower_ci[1]),
        "loa_upper_mm": _r(a.loa_upper), "loa_upper_ci_low": _r(a.loa_upper_ci[0]),
        "loa_upper_ci_high": _r(a.loa_upper_ci[1]),
        "loa_moments_lower_mm": _r(a.loa_moments_lower),
        "loa_moments_upper_mm": _r(a.loa_moments_upper),
        "sigma_between_mm": _r(a.sigma_between), "sigma_within_mm": _r(a.sigma_within),
    })  # fmt: skip
    for key, value in result.magnitudes_pairs.items():
        row[f"{key}_pairs"] = _r(value)
    for key, value in result.magnitudes_means.items():
        row[f"{key}_means"] = _r(value)
    for key, value in result.within.items():
        row[key] = _r(value, 4)
    if result.icc:
        row.update(icc=_r(result.icc["icc"], 4), icc_ci_low=_r(result.icc["lower"], 4),
                   icc_ci_high=_r(result.icc["upper"], 4))  # fmt: skip
    if result.ccc:
        row.update(ccc=_r(result.ccc["ccc"], 4), ccc_ci_low=_r(result.ccc["lower"], 4),
                   ccc_ci_high=_r(result.ccc["upper"], 4))  # fmt: skip
    if result.proportional:
        row.update(prop_slope=_r(result.proportional["slope"], 4),
                   prop_slope_ci_low=_r(result.proportional["lower"], 4),
                   prop_slope_ci_high=_r(result.proportional["upper"], 4))  # fmt: skip
    row.update(repeat_s_within_mm=_r(result.repeatability.get("s_within")),
               repeat_coefficient_mm=_r(result.repeatability.get("coefficient")),
               self_vs_assisted_mm=_r(result.modes.get("mean")),
               self_vs_assisted_ci_low=_r(result.modes.get("lower")),
               self_vs_assisted_ci_high=_r(result.modes.get("upper")),
               self_vs_assisted_n=result.modes.get("n"))  # fmt: skip
    for key, value in result.tem.items():
        row[f"tape_{key}"] = value
    return row


def _r(value: Any, places: int = 2) -> Any:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    return round(float(value), places)


def verdict_rows(results: Mapping[str, SiteResult]) -> list[dict[str, Any]]:
    rows = []
    for site in TIERED:
        v = results[site].verdict
        if v is None:
            rows.append({"site": site, "verdict": "NOT ASSESSED", "note": results[site].note})
            continue
        row: dict[str, Any] = {"site": site, "verdict": "PASS" if v.passed else "FAIL"}
        for i, tier in enumerate(v.tiers, start=1):
            row[f"tier{i}"] = "PASS" if tier.passed else "FAIL"
            row[f"tier{i}_value"] = tier.value
            row[f"tier{i}_target"] = tier.target
        rows.append(row)
    return rows


def _write_tables(result: RunResult, dataset: Dataset, folder: Path) -> None:
    write_csv(folder / "agreement.csv", [_row(r) for r in result.sites.values()])
    write_csv(folder / "acceptance.csv", verdict_rows(result.sites))
    write_csv(folder / "strata.csv", result.strata)
    write_csv(folder / "decomposition.csv", result.decomposition)
    write_csv(folder / "exclusions.csv", [e.row() for e in dataset.exclusions])
    (folder / "lighting.json").write_text(
        json.dumps(result.lighting, indent=2, sort_keys=True) + "\n"
    )


def write_csv(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if v is None else v) for k, v in row.items()})


def site_result_dict(result: SiteResult) -> dict[str, Any]:
    return {**asdict(result), "verdict": None if result.verdict is None else asdict(result.verdict)}


__all__ = ["RunResult", "SiteResult", "bmi_class", "run", "sys", "verdict_rows", "write_csv"]
