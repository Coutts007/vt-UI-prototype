"""vt-ml: calibrate a draft rules artifact from a calibration bundle (backend-spec 11.3).

It writes a draft, a report folder and a model card. It never freezes anything and refuses to
write into packages/rules/frozen/: freezing is the owner's decision (golden rule 8).
"""

import csv
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import typer

from vt_ml import anomaly, learned_girth
from vt_ml.calibrate import BOOTSTRAP_RESAMPLES, DEFAULT_SEED, calibrate
from vt_ml.card import model_card
from vt_ml.data import PROTOCOL_READINGS, CalibrationRepository
from vt_ml.synthetic import synthetic_bundle

cli = typer.Typer(no_args_is_help=True)


def _refuse_frozen(path: Path) -> None:
    if "frozen" in path.resolve().parts:
        raise typer.BadParameter("Drafts never go into a frozen folder; only the owner freezes.")


def _private(path: Path) -> int:
    """Report rows are per participant code, so the files are owner-readable only."""
    return os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)


def _write_json(path: Path, data: Any) -> None:
    with open(_private(path), "w") as handle:
        handle.write(json.dumps(data, indent=2) + "\n")


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with open(_private(path), "w", newline="") as handle:
        if not rows:
            handle.write("")
            return
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


@cli.command("calibrate")
def calibrate_command(
    data: Path = typer.Option(
        ..., "--data", help="Calibration bundle from vt study export-calibration"
    ),
    base: Path = typer.Option(..., "--base", help="The prior rules artifact"),
    version: str = typer.Option(..., "--version", help="The new draft's rules_version"),
    out: Path = typer.Option(..., "--out", help="Where to write the draft artifact"),
    report: Path = typer.Option(..., "--report", help="Folder for diagnostics"),
    card: Path = typer.Option(..., "--card", help="Where to write the model card"),
    seed: int = typer.Option(DEFAULT_SEED, "--seed"),
    resamples: int = typer.Option(BOOTSTRAP_RESAMPLES, "--resamples", min=50),
    min_readings: int = typer.Option(PROTOCOL_READINGS, "--min-readings", min=1, max=4),
    created_at: str = typer.Option("", "--created-at", help="ISO time; default now"),
    label: str = typer.Option("calibration bundle", "--label", help="How the card names the data"),
) -> None:
    for path in (out, card, report):
        _refuse_frozen(path)
    stamp = created_at or datetime.now(UTC).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    people = CalibrationRepository.from_file(data).calibration_data()
    prior = json.loads(base.read_text())
    fit = calibrate(
        people, prior, version=version, created_at=stamp, seed=seed, resamples=resamples,
        min_readings=min_readings, anomaly=anomaly.reference,
    )  # fmt: skip
    experiment = learned_girth.experiment(people, fit.artifact, seed=seed, resamples=resamples,
                                          min_readings=min_readings)  # fmt: skip
    evaluation = (
        anomaly.evaluate(people, fit.artifact) if fit.artifact["anomaly"].get("per_sex") else None
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fit.artifact, indent=2, ensure_ascii=False) + "\n")
    report.mkdir(parents=True, exist_ok=True)
    _write_json(report / "summary.json", fit.summary)
    _write_json(report / "learned_girth.json", experiment)
    if evaluation is not None:
        _write_json(report / "anomaly_evaluation.json", evaluation)
    for name, rows in fit.tables.items():
        _write_csv(report / f"{name}.csv", rows)
    card.parent.mkdir(parents=True, exist_ok=True)
    card.write_text(model_card(fit.artifact, fit.summary, fit.tables, experiment, evaluation,
                               data_label=label))  # fmt: skip
    typer.echo(f"draft {version}: {fit.artifact['fit']['n_participants']} participants, "
               f"checksum {fit.artifact['checksum']}")  # fmt: skip


@cli.command("synth")
def synth_command(
    base: Path = typer.Option(..., "--base"),
    out: Path = typer.Option(..., "--out"),
    n: int = typer.Option(25, "--n", min=2, max=500),
    seed: int = typer.Option(7, "--seed"),
) -> None:
    """A synthetic calibration bundle with known answers. Never real data."""
    bundle = synthetic_bundle(n, seed=seed, base=json.loads(base.read_text()))
    out.write_text(json.dumps(bundle) + "\n")
    typer.echo(f"synthetic bundle: {n} participants")


def main() -> None:
    cli()
