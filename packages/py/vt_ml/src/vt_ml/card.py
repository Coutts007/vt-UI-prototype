"""The model card for a draft rules version (backend-spec 11.7). Written, never hand-tuned."""

from collections.abc import Mapping
from typing import Any

SITE_NAMES = {
    "stature": "Stature", "shoulder": "Shoulder width", "chest": "Chest", "waist": "Waist",
    "hip": "Hip", "sleeve": "Sleeve", "outleg": "Outside leg", "inleg": "Inside leg",
    "neck": "Neck",
}  # fmt: skip


def _ci(cis: Mapping[str, Any], site: str, name: str) -> str:
    value = cis.get(site, {}).get(name)
    return "–" if not value else f"{value[0]} to {value[1]}"


def _fmt(value: Any) -> str:
    return "–" if value is None else str(value)


def _floored(artifact: Mapping[str, Any]) -> str:
    floored = sorted({
        name
        for group in artifact.get("anomaly", {}).get("per_sex", {}).values()
        for name in group.get("mad_floored", [])
    })  # fmt: skip
    if not floored:
        return "No ratio needed the MAD floor."
    return (
        "Ratios whose spread was below the MAD floor, so their z is set by the floor and not by "
        f"the cohort: {', '.join(floored)}. Review on real data."
    )


def model_card(
    artifact: Mapping[str, Any],
    summary: Mapping[str, Any],
    tables: Mapping[str, Any],
    experiment: Mapping[str, Any] | None,
    evaluation: Mapping[str, Any] | None,
    *,
    data_label: str,
) -> str:
    fit = artifact["fit"]
    loo, cis = fit["loo"], fit["bootstrap_ci"]
    lines = [
        f"# Model card: rules {artifact['rules_version']} (draft)",
        "",
        f"Written by `{artifact['created_by']}` on {artifact['created_at']}. Parent: "
        f"`{artifact['parent']}`. Checksum `{artifact['checksum']}`.",
        "",
        "**Status: draft.** Only the owner freezes a rules version. A draft must not be used for "
        "test-cohort agreement (backend-spec 2.3).",
        "",
        "## Data",
        "",
        f"- Source: {data_label}.",
        f"- Calibration cohort only: {fit['n_participants']} participants, "
        f"{fit['n_capture_sets']} capture sets. Cohort hash `{fit['cohort_hash']}`.",
        f"- Tape target: the mean of at least {summary['min_readings']} readings per site "
        "(protocol: 2 measurers x 2 readings).",
        f"- {len(tables.get('exclusions', []))} exclusions, listed in `exclusions.csv`.",
        "- BodyM: not used. Its licence is CC BY-NC 4.0 and the product is meant to be sold "
        "(decision M13-2); the prior is the literature defaults.",
        "",
        "## Intended use",
        "",
        "Turning a phone capture of a fitted-clothing adult into tailor tape measurements, as a "
        "starting point the tailor confirms at the fitting.",
        "",
        "## Out of scope",
        "",
        "Medical or health use; children; loose clothing; people or phones unlike the "
        "calibration cohort.",
        "",
        "## Method",
        "",
        "Torso girths: level grid search over the anatomical band in steps of 0.01, ellipse "
        "perimeter times a factor fitted by least squares through the origin, scored by "
        "leave-one-participant-out MAE with the factor refitted in every fold. The prior level "
        "stays unless a new level is at least 2 mm better. The affine variant a*P + c is adopted "
        "only if it is at least 3 mm better and its bootstrap interval of the gain excludes zero. "
        "Widths and lengths: one constant offset each, the mean of tape minus system. "
        f"Uncertainty: participant bootstrap, {summary['resamples']} resamples, seed "
        f"{summary['seed']}.",
        "",
        "## Fitted girths",
        "",
        "| Site | n | Level | Best level | Factor (95% CI) | LOO MAE mm (95% CI) "
        "| Prior LOO MAE | Affine |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for site in ("chest", "waist", "hip", "neck"):
        row = loo.get(site, {})
        if row.get("status") == "insufficient":
            lines.append(f"| {SITE_NAMES[site]} | {row['n']} | prior kept | – | – | – | – | – |")
            continue
        affine = (
            "adopted"
            if row.get("affine_adopted")
            else f"not adopted ({_fmt(row.get('affine_loo_mae_mm'))} mm)"
        )
        lines.append(
            f"| {SITE_NAMES[site]} | {row['n']} | {row['level']} | {row['best_level']} | "
            f"{row['cf']} ({_ci(cis, site, 'cf')}) | {_fmt(row['loo_mae_mm'])} "
            f"({_ci(cis, site, 'loo_mae')}) | {_fmt(row['prior_loo_mae_mm'])} | {affine} |"
        )
    lines += [
        "", "## Fitted offsets", "",
        "| Site | n | Offset mm (95% CI) | Prior MAE | LOO MAE |", "|---|---|---|---|---|",
    ]  # fmt: skip
    for site in ("shoulder", "sleeve", "outleg", "inleg"):
        row = loo.get(site, {})
        if row.get("status") == "insufficient":
            lines.append(f"| {SITE_NAMES[site]} | 0 | prior kept | – | – |")
            continue
        lines.append(
            f"| {SITE_NAMES[site]} | {row['n']} | {row['offset_mm']} "
            f"({_ci(cis, site, 'offset_mm')}) | {_fmt(row.get('prior_mae_mm'))} "
            f"| {_fmt(row.get('loo_mae_mm'))} |"
        )
    lines += [
        "", "## Before and after, in sample", "",
        "| Site | n | Bias before | MAE before | Bias after | MAE after |",
        "|---|---|---|---|---|---|",
    ]  # fmt: skip
    for row in tables["before_after"]:
        lines.append(
            f"| {SITE_NAMES[row['site']]} | {row['n_after']} | {_fmt(row['bias_before_mm'])} | "
            f"{_fmt(row['mae_before_mm'])} | {_fmt(row['bias_after_mm'])} | "
            f"{_fmt(row['mae_after_mm'])} |"
        )
    lines += [
        "",
        "In-sample figures flatter the fit; the LOO columns above are the honest ones. Where "
        "chest was fitted per sex, the levels are chosen per sex under a per-sex factor, but the "
        "artifact carries one pooled factor, and the LOO MAE and intervals are for that pooled "
        "factor; the per-sex levels have no interval of their own.",
        "",
    ]
    if experiment is not None:
        lines += [
            "## Learned girth experiment (11.4)", "", experiment["verdict"], "",
            "| Site | n | Ridge LOO MAE | Ellipse LOO MAE | Gain mm (95% CI) |",
            "|---|---|---|---|---|",
        ]  # fmt: skip
        for site, row in experiment["sites"].items():
            if row.get("status") == "insufficient":
                lines.append(f"| {SITE_NAMES[site]} | {row['n']} | – | – | – |")
                continue
            low, high = row["gain_ci_mm"]
            lines.append(
                f"| {SITE_NAMES[site]} | {row['n']} | {row['ridge_loo_mae_mm']} | "
                f"{row['ellipse_loo_mae_mm']} | {row['gain_mm']} ({low} to {high}) |"
            )
        lines.append("")
    if evaluation is not None:
        caught = evaluation["caught_share"]
        lines += [
            "## Anomaly reference (11.5)",
            "",
            f"Built from {evaluation['n']} complete calibration profiles. Genuine profiles "
            f"flagged: {_fmt(evaluation['genuine_flagged_share'])} (target 0.05 or less; "
            "in-sample, so optimistic). Corrupted profiles caught: scale x1.1 "
            f"{_fmt(caught['scale_x1.1'])}, waist level swapped "
            f"{_fmt(caught['waist_level_swapped'])}, waist +50 mm "
            f"{_fmt(caught['girth_plus_50mm'])}.",
            "",
            "The reference comes from each participant's mean over capture sets, while the "
            "server checks one set at a time, so the false-flag rate in use will be higher than "
            "the in-sample share. " + _floored(artifact),
            "",
        ]
    lines += [
        "## Known limitations",
        "",
        "- Population: the calibration cohort only; nothing here generalises beyond it.",
        "- BMI range, clothing, phones and camera facing: as recorded for the cohort; not yet "
        "summarised here.",
        "- A cohort of about 25 is a small sample. Treat every interval as wide and every level "
        "as provisional.",
        "- Acceptance status (backend-spec 12): not known until the test cohort is analysed "
        "under a frozen version.",
        "",
        "## Licences",
        "",
        "Fitted with numpy, scipy and scikit-learn (BSD-3-Clause). No dataset outside the study "
        "was used.",
        "",
    ]
    return "\n".join(lines)
