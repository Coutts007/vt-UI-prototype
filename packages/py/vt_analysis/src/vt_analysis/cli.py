"""vt-analysis: the validation analytics CLI (backend-spec 12). Offline, on the study laptop."""

import csv
import json
import statistics
from pathlib import Path
from typing import Any

import typer

from vt_analysis.data import AnalysisRefused, load
from vt_analysis.report import results_markdown
from vt_analysis.run import DEFAULT_RESAMPLES, DEFAULT_SEED, run
from vt_analysis.stats import mean_t_ci, sus_grade, sus_score

cli = typer.Typer(no_args_is_help=True)
SUS_TARGET = 68.0


@cli.command("run")
def run_command(
    captures: Path = typer.Option(..., "--captures", help="captures.csv under the version"),
    reference: Path = typer.Option(..., "--reference", help="reference.csv"),
    registry: Path = typer.Option(..., "--registry", help="GET /admin/rules listing as JSON"),
    rules: str = typer.Option(..., "--rules", help="The frozen rules version"),
    out: Path = typer.Option(
        ..., "--out", help="Report folder outside the checkout, e.g. ~/vt-study/report/2027-05-20/"
    ),
    covariates: Path | None = typer.Option(None, "--covariates", help="paper_covariates.csv"),
    calibration_report: Path | None = typer.Option(
        None, "--calibration-report", help="vt-ml report folder, for the level curves"
    ),
    seed: int = typer.Option(DEFAULT_SEED, "--seed"),
    resamples: int = typer.Option(DEFAULT_RESAMPLES, "--resamples", min=50),
) -> None:  # fmt: skip
    """Test cohort only, frozen rules only (12.2); tables, figures, results.md and metadata.json."""
    try:
        dataset = load(captures, reference, registry, rules, covariates)
    except AnalysisRefused as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(2) from error
    result = run(
        dataset, out, seed=seed, resamples=resamples, calibration_report=calibration_report
    )
    (out / "results.md").write_text(results_markdown(result))
    passed = sum(1 for s in result.sites.values() if s.verdict and s.verdict.passed)
    typer.echo(f"{len(dataset.participants)} participants, {len(dataset.sets)} sets; "
               f"{passed} of 8 tiered sites pass; report in {out}")  # fmt: skip


@cli.command("sus")
def sus_command(
    input: Path = typer.Option(..., "--input", help="sus_tam.csv: q1..q10, tam11..tam15"),
    out: Path = typer.Option(..., "--out"),
) -> None:  # fmt: skip
    """SUS (odd items score - 1, even items 5 - score, sum x 2.5) and TAM medians (12.8)."""
    with input.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    scores = [sus_score([int(row[f"q{i}"]) for i in range(1, 11)]) for row in rows]
    summary = mean_t_ci(scores)
    tam: dict[str, dict[str, float]] = {}
    for item in range(11, 16):
        values = [float(row[f"tam{item}"]) for row in rows if row.get(f"tam{item}", "").strip()]
        if values:
            q = statistics.quantiles(values, n=4) if len(values) >= 2 else [values[0]] * 3
            tam[f"tam{item}"] = {
                "median": statistics.median(values),
                "q1": q[0],
                "q3": q[2],
                "n": len(values),
            }
    report: dict[str, Any] = {
        "label": f"formative, n = {len(scores)}",
        "sus": {
            **summary,
            "grade": sus_grade(summary["mean"]) if scores else None,
            "meets_target_68": bool(scores) and summary["mean"] >= SUS_TARGET,
            "scores": scores,
        },
        "tam": tam,
    }  # fmt: skip
    out.mkdir(parents=True, exist_ok=True)
    (out / "usability.json").write_text(json.dumps(report, indent=2) + "\n")
    met = "met" if report["sus"]["meets_target_68"] else "not met"
    lines = [
        f"# Usability ({report['label']})",
        "",
        f"SUS mean {summary['mean']:.1f} (95% CI {summary['lower']:.1f} to "
        f"{summary['upper']:.1f}), grade {report['sus']['grade']}, target 68 {met}.",
        "",
        "| TAM item | median | IQR | n |",
        "|---|---|---|---|",
    ]
    lines += [
        f"| {k} | {v['median']} | {v['q1']} to {v['q3']} | {v['n']} |" for k, v in tam.items()
    ]
    (out / "usability.md").write_text("\n".join(lines) + "\n")
    typer.echo(f"SUS {summary['mean']:.1f}, {report['label']}")


def main() -> None:
    cli()
