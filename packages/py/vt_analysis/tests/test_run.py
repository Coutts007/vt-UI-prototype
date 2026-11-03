"""A whole run on synthetic exports: the 12.2 guards, determinism, the outputs and a known bias."""

import filecmp
import json
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner
from vt_analysis.cli import cli
from vt_analysis.data import AnalysisRefused, load
from vt_analysis.report import results_markdown
from vt_analysis.run import run
from vt_analysis.synthetic import synthetic_exports

RULES = json.loads(
    (Path(__file__).parents[3] / "rules" / "rules-0.1-uncalibrated.json").read_text()
)
BIAS = {"chest": 12.0, "waist": -3.0, "sleeve": 4.0}


@pytest.fixture(scope="module")
def exports(tmp_path_factory):
    folder = tmp_path_factory.mktemp("exports")
    return synthetic_exports(folder, n=24, seed=9, rules=RULES, bias_mm=BIAS)


@pytest.fixture(scope="module")
def dataset(exports):
    return load(exports["captures"], exports["reference"], exports["registry"], "1.0-ke-test",
                exports["covariates"])  # fmt: skip


@pytest.fixture(scope="module")
def result(dataset, tmp_path_factory):
    out = tmp_path_factory.mktemp("report")
    return run(dataset, out, seed=5, resamples=200), out


def test_a_draft_or_unknown_version_is_refused(exports, tmp_path):
    rows = json.loads(exports["registry"].read_text())
    rows[0]["status"] = "draft"
    rows[0]["frozen_at"] = None
    draft = tmp_path / "registry-draft.json"
    draft.write_text(json.dumps(rows))
    with pytest.raises(AnalysisRefused, match="rules_not_frozen"):
        load(exports["captures"], exports["reference"], draft, "1.0-ke-test")
    with pytest.raises(AnalysisRefused, match="rules_not_frozen"):
        load(exports["captures"], exports["reference"], exports["registry"], "9.9-nowhere")


def test_a_bad_covariate_cell_is_refused_without_echoing_it(exports, tmp_path):
    lines = exports["covariates"].read_text().splitlines()
    header = lines[0].split(",")
    cells = lines[1].split(",")
    cells[header.index("weight_kg")] = "72.5kg"
    bad = tmp_path / "covariates-bad.csv"
    bad.write_text("\n".join([lines[0], ",".join(cells), *lines[2:]]) + "\n")
    with pytest.raises(
        AnalysisRefused, match="covariates: bad value for P001 in column weight_kg"
    ) as info:
        load(exports["captures"], exports["reference"], exports["registry"], "1.0-ke-test", bad)
    assert "72" not in str(info.value)


def test_covariates_keep_only_the_columns_the_analysis_uses(dataset):
    assert set(next(iter(dataset.covariates.values()))) == {
        "weight_kg",
        "measured_stature_cm",
        "bmi",
        "bmi_class",
        "sex",
    }


def test_rows_under_another_version_or_cohort_are_left_out(exports, tmp_path):
    text = exports["captures"].read_text()
    other = tmp_path / "captures-other.csv"
    other.write_text(text.replace(",1.0-ke-test,1.0-ke-test,", ",0.1-uncalibrated,,"))
    with pytest.raises(AnalysisRefused, match="cohort mismatch"):
        load(other, exports["reference"], exports["registry"], "1.0-ke-test")
    pilot = tmp_path / "captures-pilot.csv"
    pilot.write_text(text.replace(",test,", ",pilot,"))
    with pytest.raises(AnalysisRefused, match="cohort mismatch"):
        load(pilot, exports["reference"], exports["registry"], "1.0-ke-test")


def test_the_dataset_is_the_test_cohort_in_millimetres(dataset):
    assert dataset.rules_version == "1.0-ke-test" and dataset.frozen_at.startswith("2027")
    assert len(dataset.participants) == 24
    assert all(700 < v < 1400 for v in dataset.reference("chest").values())
    reasons = {e.reason for e in dataset.exclusions}
    assert reasons <= {"site_failed", "tape_incomplete", "other_rules_version"}


def test_the_run_recovers_the_known_biases_and_writes_every_output(result):
    res, out = result
    chest = res.sites["chest"].agreement
    assert chest is not None
    assert chest.bias_ci[0] < BIAS["chest"] < chest.bias_ci[1]
    waist = res.sites["waist"].agreement
    assert waist.bias_ci[0] < BIAS["waist"] < waist.bias_ci[1]
    hip = res.sites["hip"].agreement
    assert hip.bias_ci[0] < 0 < hip.bias_ci[1]
    # Chest fails tier 1 by construction (12 mm bias); hip has none.
    assert res.sites["chest"].verdict is not None and not res.sites["chest"].verdict.tiers[0].passed
    assert res.sites["hip"].verdict is not None and res.sites["hip"].verdict.tiers[0].passed
    assert res.sites["stature"].verdict is None  # reported, not tiered
    for name in ("agreement.csv", "acceptance.csv", "strata.csv", "decomposition.csv",
                 "exclusions.csv", "lighting.json"):  # fmt: skip
        assert (out / "tables" / name).exists(), name
    assert (out / "metadata.json").exists()
    figures = {p.name for p in (out / "figures").iterdir()}
    assert "bland-altman-chest.png" in figures and "scatter-waist.svg" in figures
    assert any(f.startswith("residuals-bmi-") for f in figures)
    assert any(f.startswith("repeatability-") for f in figures)
    meta = json.loads((out / "metadata.json").read_text())
    assert meta["frozen_at"] == "2027-05-01T08:00:00Z" and meta["cohort"] == "test"
    assert meta["seed"] == 5 and meta["bootstrap_resamples"] == 200
    assert {"vt_analysis", "numpy", "statsmodels"} <= set(meta["software"])


def test_the_report_has_the_table_layout_and_honest_labels(result):
    res, _ = result
    text = results_markdown(res)
    headings = (
        "## Acceptance (proposal Table 1.1)", "### Chest", "| Statistic | Value | Purpose |",
        "ICC(2,1)", "Lin's CCC", "Tape TEM", "## Exploratory analyses",
        "### Error decomposition", "diagnostic only", "## Method notes",
    )  # fmt: skip
    for heading in headings:
        assert heading in text, heading
    assert "**FAIL**" in text and "Stature is reported but is not in the acceptance tiers" in text


def test_two_runs_give_byte_identical_tables_and_figures(dataset, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    run(dataset, a, seed=5, resamples=100)
    run(dataset, b, seed=5, resamples=100)
    for name in sorted(p.name for p in (a / "tables").iterdir()):
        assert filecmp.cmp(a / "tables" / name, b / "tables" / name, shallow=False), name
    assert (a / "metadata.json").read_bytes() == (b / "metadata.json").read_bytes()
    for name in sorted(p.name for p in (a / "figures").iterdir()):
        assert filecmp.cmp(a / "figures" / name, b / "figures" / name, shallow=False), name
    shutil.rmtree(a)


def test_the_cli_runs_and_refuses_a_draft(exports, tmp_path):
    runner = CliRunner()
    out = tmp_path / "report"
    result = runner.invoke(cli, [
        "run", "--captures", str(exports["captures"]), "--reference", str(exports["reference"]),
        "--registry", str(exports["registry"]), "--rules", "1.0-ke-test", "--out", str(out),
        "--covariates", str(exports["covariates"]), "--resamples", "60", "--seed", "1",
    ])  # fmt: skip
    assert result.exit_code == 0, result.output
    assert (out / "results.md").exists() and "tiered sites pass" in result.output
    rows = json.loads(exports["registry"].read_text())
    rows[0]["status"] = "draft"
    draft = tmp_path / "draft.json"
    draft.write_text(json.dumps(rows))
    refused = runner.invoke(cli, [
        "run", "--captures", str(exports["captures"]), "--reference", str(exports["reference"]),
        "--registry", str(draft), "--rules", "1.0-ke-test", "--out", str(tmp_path / "r2"),
    ])  # fmt: skip
    assert refused.exit_code == 2 and "rules_not_frozen" in refused.output


def test_sus_command(tmp_path):
    rows = [
        "respondent,"
        + ",".join(f"q{i}" for i in range(1, 11))
        + ","
        + ",".join(f"tam{i}" for i in range(11, 16))
    ]
    answers = [[4, 2, 4, 2, 4, 2, 4, 2, 4, 2], [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], [3] * 10]
    for i, a in enumerate(answers):
        rows.append(f"t{i}," + ",".join(map(str, a)) + ",4,5,3,4,2")
    path = tmp_path / "sus_tam.csv"
    path.write_text("\n".join(rows) + "\n")
    result = CliRunner().invoke(cli, ["sus", "--input", str(path), "--out", str(tmp_path / "u")])
    assert result.exit_code == 0, result.output
    report = json.loads((tmp_path / "u" / "usability.json").read_text())
    assert report["sus"]["scores"] == [75.0, 100.0, 50.0]
    assert report["sus"]["mean"] == pytest.approx(75.0) and report["label"] == "formative, n = 3"
    assert report["tam"]["tam11"]["median"] == 4
