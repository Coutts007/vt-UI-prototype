"""results.md in the layout of proposal Table 3.2, plus the acceptance table and method notes."""

import math
from collections.abc import Mapping
from typing import Any

from vt_analysis.data import SITES, TIERED
from vt_analysis.run import RunResult, SiteResult, verdict_rows

NAMES = {
    "stature": "Stature", "shoulder": "Shoulder width", "chest": "Chest", "waist": "Waist",
    "hip": "Hip", "sleeve": "Sleeve", "outleg": "Outside leg", "inleg": "Inside leg",
    "neck": "Neck",
}  # fmt: skip
Row = tuple[str, str, str]


def _f(value: Any, places: int = 1, sign: bool = False) -> str:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return "–"
    return f"{value:+.{places}f}" if sign else f"{value:.{places}f}"


def _ci(low: Any, high: Any, places: int = 1, sign: bool = False) -> str:
    return f"{_f(low, places, sign)} to {_f(high, places, sign)}"


def _est(stats: Mapping[str, Any] | None, key: str, places: int, sign: bool = False) -> str:
    """'value (low to high)' for a dict holding key, lower and upper."""
    if not stats:
        return "–"
    return f"{_f(stats[key], places, sign)} ({_ci(stats['lower'], stats['upper'], places, sign)})"


def _limit(value: float, ci: tuple[float, float]) -> str:
    return f"{_f(value, 1, True)} ({_ci(*ci, 1, True)})"


def _magnitudes(m: Mapping[str, float]) -> str:
    return f"{_f(m['mae'])}, {_f(m['rmse'])} mm, {_f(m['mape_pct'])}%"


def _tem(tem: Mapping[str, Any]) -> str:
    if "pooled_tem_mm" not in tem:
        return "–"
    intra = ", ".join(
        f"{k.split('_')[2]} {v}" for k, v in tem.items() if k.startswith("intra_tem_")
    )
    return (
        f"intra {intra}; inter {tem.get('inter_tem_mm', '–')}; pooled {tem['pooled_tem_mm']}; "
        f"{tem['pct_tem']}%; R {tem['reliability']}"
    )


def _rows(result: SiteResult) -> list[Row]:
    a = result.agreement
    assert a is not None
    mp, w = result.magnitudes_pairs, result.within
    within = ", ".join(
        f"{w[k] * 100:.0f}%" for k in ("within_10mm", "within_15mm", "within_20mm", "within_30mm")
    )
    modes = result.modes
    return [
        ("n (participants; pairs)", f"{a.n_participants}; {a.n_pairs}", "Sample"),
        ("Mean bias, 95% CI (mm)", _limit(a.bias, a.bias_ci),
         "Systematic error; tier 1 after constant-offset correction"),
        ("SD of differences (mm)", _f(a.sd_differences), "Random error (mixed model)"),
        ("95% limits of agreement with CIs (mm)",
         f"{_limit(a.loa_lower, a.loa_lower_ci)} to {_limit(a.loa_upper, a.loa_upper_ci)}",
         "Tier 3, outer confidence bounds"),
        ("Moments cross-check of the LoA (mm)",
         f"{_f(a.loa_moments_lower, 1, True)} to {_f(a.loa_moments_upper, 1, True)}",
         "Bland and Altman (1999) method of moments"),
        ("MAE, RMSE, MAPE (pairs)", _magnitudes(mp), "Comparison with published studies"),
        ("MAE, RMSE, MAPE (participant means)", _magnitudes(result.magnitudes_means),
         "Same, one value per person"),
        ("Share within 10, 15, 20, 30 mm", within, "Tier 2"),
        ("Absolute error p50, p75, p90 (mm)",
         f"{_f(mp['p50_abs'])}, {_f(mp['p75_abs'])}, {_f(mp['p90_abs'])}",
         "Typical, poor and bad cases"),
        ("ICC(2,1), 95% CI", _est(result.icc, "icc", 3), "Reliability, absolute agreement"),
        ("Lin's CCC, 95% CI", _est(result.ccc, "ccc", 3),
         "Agreement penalising bias and scatter"),
        ("Difference on mean: slope, 95% CI", _est(result.proportional, "slope", 3, True),
         "Proportional bias"),
        ("Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R", _tem(result.tem),
         "Noise floor of the reference"),
        ("System repeatability: s_w, 2.77 s_w (mm)",
         f"{_f(result.repeatability.get('s_within'))}, "
         f"{_f(result.repeatability.get('coefficient'))}",
         "Across the capture sets"),
        ("Self-capture minus assisted (mm), 95% CI, n",
         f"{_f(modes.get('mean'), 1, True)} "
         f"({_ci(modes.get('lower'), modes.get('upper'), 1, True)}), n = {modes.get('n', 0)}",
         "Capture mode difference"),
    ]  # fmt: skip


def site_table(result: SiteResult) -> list[str]:
    """One Table 3.2 per site: statistic, value, purpose."""
    if result.agreement is None:
        return [f"### {NAMES[result.site]}", "", f"Not analysed: {result.note}.", ""]
    lines = [f"### {NAMES[result.site]}", "", "| Statistic | Value | Purpose |", "|---|---|---|"]
    lines += [f"| {name} | {value} | {purpose} |" for name, value, purpose in _rows(result)]
    return [*lines, ""]


def acceptance_table(result: RunResult) -> list[str]:
    lines = [
        "## Acceptance (proposal Table 1.1)",
        "",
        "| Site | Tier 1 mean bias | Tier 2 individual differences "
        "| Tier 3 limits of agreement | Verdict |",
        "|---|---|---|---|---|",
    ]
    for row in verdict_rows(result.sites):
        name = NAMES[row["site"]]
        if row["verdict"] == "NOT ASSESSED":
            lines.append(f"| {name} | – | – | – | NOT ASSESSED ({row['note']}) |")
            continue
        cells = [
            f"{row[f'tier{i}']}: {row[f'tier{i}_value']} (target {row[f'tier{i}_target']})"
            for i in (1, 2, 3)
        ]
        lines.append(f"| {name} | {' | '.join(cells)} | **{row['verdict']}** |")
    passed = [s for s in TIERED if (v := result.sites[s].verdict) is not None and v.passed]
    names = ", ".join(NAMES[s] for s in passed) or "none"
    lines += [
        "",
        f"Sites passing all three tiers: {names}. A FAIL is never rounded into a PASS; the "
        "numbers stand next to each verdict.",
        "",
    ]
    return lines


def _decomposition(result: RunResult) -> list[str]:
    lines = ["### Error decomposition (girths)", ""]
    if not result.decomposition:
        return [*lines, "Not computed.", ""]
    lines += [
        "| Site | n pairs | MAE before | Scale term: mean abs change, share | Level term "
        "| Oracle factor | Cross-section term: mean abs change, share | Remainder RMSE, share |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for d in result.decomposition:
        name = NAMES[d["site"]]
        if "oracle_factor" not in d:
            lines.append(f"| {name} | {d['n_pairs']} | – | – | – | – | – | {d.get('note', '')} |")
            continue
        lines.append(
            f"| {name} | {d['n_pairs']} | {d['mae_before_mm']} "
            f"| {d['scale_term_mean_abs_change_mm']}, {d['scale_term_share']} "
            f"| {d['level_term']} | {d['oracle_factor']} "
            f"| {d['cross_section_term_mean_abs_change_mm']}, {d['cross_section_term_share']} "
            f"| {d['remainder_rmse_mm']}, {d['remainder_share']} |"
        )
    lines += [
        "",
        "The oracle factor was fitted on the test cohort itself and is diagnostic only; it was "
        "never used for acceptance. The level term needs the capture profiles, which the CSV "
        "export does not carry. Shares are of the squared error before any substitution and sum "
        "to one; a share below zero or above one means that substitution added error.",
        "",
    ]
    return lines


def _lighting(result: RunResult) -> list[str]:
    lines = ["### Lighting", ""]
    with_lux = [entry for entry in result.lighting if entry.get("n_with_lux", 0) >= 5]
    if not with_lux:
        return [*lines, "Too few capture sets carried a lux reading for a lighting analysis.", ""]
    for entry in with_lux:
        level = entry.get("flags_rise_below_lux")
        rise = f"flags rise below {level} lux" if level else "no lux level with more failures"
        lines.append(
            f"- {NAMES[entry['site']]}: {entry['n_with_lux']} sets with lux; {rise}; lowess "
            "curve in `tables/lighting.json`."
        )
    return [*lines, ""]


METHOD_NOTES = [
    "- Bias: mean of participant-mean differences (system minus tape); 95% CI by cluster "
    "bootstrap over participants.",
    "- Limits of agreement: linear mixed model d_ij = mu + u_i + e_ij (REML), "
    "LoA = mu +/- 1.96 sqrt(sigma_u^2 + sigma_e^2); cluster-bootstrap CIs from the Bland-Altman "
    "(1999) moments estimate on each resample; the moments point estimate is printed as a "
    "cross-check.",
    "- ICC(2,1): two-way random effects, absolute agreement, on participant means, F-based CI "
    "(McGraw and Wong, 1996).",
    "- Lin's CCC with a Fisher-z interval. Proportional bias: OLS of difference on mean with "
    "cluster-robust SEs and t quantiles on the number of participants minus one.",
    "- Tape reliability: intra-observer TEM sqrt(sum d^2 / 2n) per measurer, inter-observer TEM "
    "on measurer means, pooled multi-reading TEM, %TEM against the mean, R = 1 - TEM^2 / SD^2 "
    "with the SD of all readings (Ulijaszek and Kerr, 1999).",
    "- System repeatability: within-participant SD across sets and the repeatability "
    "coefficient 2.77 s_w.",
    "- Figures in `figures/`: Bland-Altman and scatter per site, residuals by BMI class where "
    "covariates exist, set 1 against set 3, and the calibration level curves when a fit report "
    "is given.",
]


def _cohorts(counts: Mapping[str, Mapping[str, int]]) -> str:
    return (
        "; ".join(
            f"{cohort}: {c['participants']} participants, {c['capture_sets']} sets"
            for cohort, c in counts.items()
        )
        or "nothing"
    )


def results_markdown(result: RunResult) -> str:
    m = result.metadata
    lines = [
        "# Validation results",
        "",
        f"Rules `{m['rules_version']}`, frozen at {m['frozen_at']}. Test cohort only: "
        f"{m['participants_analysed']} participants, {m['capture_sets_analysed']} capture sets "
        f"(the export held {_cohorts(m['cohort_counts_in_export'])}). Seed {m['seed']}, "
        f"{m['bootstrap_resamples']} bootstrap resamples. {len(m['exclusions'])} exclusions, "
        "listed in `tables/exclusions.csv`.",
        "",
        "Units are millimetres. Reference value: the mean of four tape readings. System value: "
        "every capture set with a value. Bias is the mean of participant means; the limits of "
        "agreement come from a mixed model over all sets.",
        "",
        *acceptance_table(result),
        "## Agreement per site (proposal Table 3.2 layout)",
        "",
        "Stature is reported but is not in the acceptance tiers.",
        "",
    ]
    for site in SITES:
        lines += site_table(result.sites[site])
    lines += [
        "## Exploratory analyses",
        "",
        "Labelled exploratory: subgroups are small and nothing here was used for acceptance.",
        "",
        "### Strata",
        "",
        "See `tables/strata.csv`: bias with a cluster-bootstrap interval and moments limits of "
        "agreement by sex, BMI class, clothing fit, lighting, camera facing, phone model and "
        "capture mode, for every level with at least three participants.",
        "",
        *_decomposition(result),
        *_lighting(result),
        "## Method notes",
        "",
        *METHOD_NOTES,
        "",
    ]
    return "\n".join(lines)
