"""vt-ml end to end: a synthetic bundle in, a draft, a report and a model card out. Never frozen."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from typer.testing import CliRunner
from vt_ml.cli import cli

RULES = Path(__file__).parents[3] / "rules"
BASE = RULES / "rules-0.1-uncalibrated.json"
SCHEMA = json.loads((RULES / "schema.json").read_text())


def test_synth_then_calibrate_writes_a_valid_draft_report_and_card(tmp_path: Path) -> None:
    runner = CliRunner()
    bundle = tmp_path / "bundle.json"
    result = runner.invoke(cli, ["synth", "--base", str(BASE), "--out", str(bundle), "--n", "12",
                                 "--seed", "4"])  # fmt: skip
    assert result.exit_code == 0, result.output
    out = tmp_path / "rules-1.0-test.json"
    report = tmp_path / "report"
    card = tmp_path / "model-card-1.0-test.md"
    result = runner.invoke(cli, [
        "calibrate", "--data", str(bundle), "--base", str(BASE), "--version", "1.0-test",
        "--out", str(out), "--report", str(report), "--card", str(card),
        "--resamples", "50", "--created-at", "2027-03-01T08:00:00Z", "--label", "synthetic test",
    ])  # fmt: skip
    assert result.exit_code == 0, result.output
    artifact = json.loads(out.read_text())
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(artifact)
    assert artifact["status"] == "draft"
    assert artifact["fit"]["n_participants"] == 12
    assert artifact["anomaly"]["per_sex"]["unspecified"]["n"] == 12
    for name in ("summary.json", "learned_girth.json", "anomaly_evaluation.json",
                 "before_after.csv", "level_curves.csv", "exclusions.csv", "residuals.csv",
                 "perimeter_vs_tape.csv"):  # fmt: skip
        assert (report / name).exists(), name
    text = card.read_text()
    assert "Status: draft" in text and "synthetic test" in text
    assert "## Learned girth experiment" in text and "## Anomaly reference" in text
    assert "1.0-test" in result.output and artifact["checksum"] in result.output


def test_nothing_is_written_into_a_frozen_folder(tmp_path: Path) -> None:
    runner = CliRunner()
    frozen = tmp_path / "frozen"
    frozen.mkdir()
    result = runner.invoke(cli, [
        "calibrate", "--data", str(tmp_path / "none.json"), "--base", str(BASE),
        "--version", "1.0-test", "--out", str(frozen / "rules-1.0-test.json"),
        "--report", str(tmp_path / "r"), "--card", str(tmp_path / "c.md"),
    ])  # fmt: skip
    assert result.exit_code != 0
    assert "only the owner freezes" in result.output
    assert not list(frozen.iterdir())
