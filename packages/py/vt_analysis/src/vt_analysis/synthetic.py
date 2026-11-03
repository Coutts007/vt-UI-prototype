"""Synthetic exports for tests and the sample report. Never real people.

Builds captures.csv, reference.csv, paper_covariates.csv and a registry listing in exactly the
formats of backend-spec 12.1 and `GET /admin/rules`, from vt_measure synthetic bodies under rules
with a known bias and noise, so a run has something to analyse before any study exists.
"""

import csv
import json
from pathlib import Path
from typing import Any

import numpy as np
from vt_measure.derive import derive
from vt_measure.synthetic import make_input
from vt_ml.synthetic import _body

from vt_analysis.data import SITES

CHECKS = ("level", "frame", "distance", "symmetry", "arms", "marker", "light", "sharpness")
COLUMNS = [
    "participant_code", "cohort", "set_no", "capture_mode", "camera_facing", "captured_at",
    "device_model", "os", "browser", "model_variant", "rules_version_used",
    "rederived_rules_version", "lighting", "distance_m", "clothing_fit_observed", "lux",
    *(f"front_{c}" for c in CHECKS), *(f"side_{c}" for c in CHECKS),
    "scale_front_mm_px", "scale_side_mm_px", "scale_stature_mm_px", "scale_disagreement_pct",
    "processing_ms", "retake_count", *(x for s in SITES for x in (f"{s}_cm", f"{s}_flag")),
    "server_checks",
]  # fmt: skip
REFERENCE_COLUMNS = ["participant_code", "cohort", "site_code", "measurer_code", "reading_no",
                     "value_cm", "taken_at"]  # fmt: skip
DEVICES = ("Tecno Spark 10", "Samsung A14", "Redmi 12", "iPhone 12")


def _cm(mm: float) -> str:
    return f"{mm / 10:.1f}"


def synthetic_exports(
    folder: Path,
    *,
    n: int,
    seed: int,
    rules: dict[str, Any],
    version: str = "1.0-ke-test",
    sets: int = 3,
    bias_mm: dict[str, float] | None = None,
    noise_mm: float = 6.0,
    tape_noise_mm: float = 2.0,
    cohort: str = "test",
    with_lux: bool = True,
    frozen_at: str = "2027-05-01T08:00:00Z",
) -> dict[str, Path]:
    """Writes the four files and returns their paths. The system is the rules' derivation plus a
    per-site bias and set-to-set noise; the tape is the body's true value plus reading noise."""
    rng = np.random.default_rng(seed)
    bias = bias_mm or {}
    folder.mkdir(parents=True, exist_ok=True)
    captures: list[list[Any]] = []
    reference: list[list[Any]] = []
    covariates: list[list[Any]] = []
    for i in range(n):
        code = f"P{i + 1:03d}"
        sex = ("female", "male")[i % 2]
        body = _body(rng, sex)
        truth = derive(make_input(body), rules).sites
        true_mm = {s: truth[s].raw_mm for s in SITES}
        for site in SITES:
            for measurer in ("A", "B"):
                for k in (1, 2):
                    value = float(true_mm[site] or 0) + rng.normal(0, tape_noise_mm)
                    reference.append([code, cohort, site, measurer, k, _cm(value),
                                      "2027-04-10T09:00:00+03:00"])  # fmt: skip
        weight = round(float(rng.uniform(50, 95)), 1)
        age = rng.choice(["18-29", "30-44", "45+"])
        covariates.append([code, weight, round(body.stature / 10, 1), age, "", sex])
        device = DEVICES[i % len(DEVICES)]
        for set_no in range(1, sets + 1):
            mode = "assisted" if set_no == 3 else "self"
            lux: float | None = round(float(rng.uniform(40, 900)), 0) if with_lux else None
            row: list[Any] = [
                code, cohort, set_no, mode, "environment", f"2027-04-10T1{set_no}:00:00+03:00",
                device, "Android 13", "Chrome 120", "lite", version, version,
                rng.choice(["window", "indoor", "outdoor"]), 2.2,
                rng.choice(["fitted", "fitted", "loose"]), "" if lux is None else lux,
            ]  # fmt: skip
            row += ["pass"] * len(CHECKS) * 2
            row += [1.21, 1.19, 1.2, 1.5, 1800, 0]
            for site in SITES:
                base = true_mm[site]
                if base is None or (site == "neck" and rng.random() < 0.05):
                    row += ["", "fail"]
                    continue
                value = base + bias.get(site, 0.0) + rng.normal(0, noise_mm)
                if lux is not None and lux < 80 and rng.random() < 0.4:
                    row += ["", "fail"]
                    continue
                row += [_cm(value), "pass" if rng.random() > 0.1 else "check"]
            row.append("")
            captures.append(row)
    paths = {
        "captures": folder / "captures.csv",
        "reference": folder / "reference.csv",
        "covariates": folder / "paper_covariates.csv",
        "registry": folder / "registry.json",
    }
    _write(paths["captures"], COLUMNS, captures)
    _write(paths["reference"], REFERENCE_COLUMNS, reference)
    _write(paths["covariates"], ["participant_code", "weight_kg", "measured_stature_cm", "age_band",
                                 "notes", "sex"], covariates)  # fmt: skip
    paths["registry"].write_text(json.dumps([{
        "rules_version": version, "status": "frozen", "checksum": "sha256:" + "0" * 64,
        "parent": "0.1-uncalibrated", "frozen_at": frozen_at,
        "created_at": "2027-04-01T08:00:00Z", "is_current": True,
    }], indent=2) + "\n")  # fmt: skip
    return paths


def _write(path: Path, columns: list[str], rows: list[list[Any]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        writer.writerows(rows)
