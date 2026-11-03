"""Inputs of the validation analysis (backend-spec 12.1, 12.2) and the rules it enforces.

The CLI reads the API's two CSV exports, an optional paper-covariates file that never leaves the
laptop, and the registry listing (`GET /admin/rules`). It analyses the test cohort only, under a
frozen rules version, or it stops. Everything is in millimetres once loaded.
"""

import csv
import json
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SITES = ("stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck")
GIRTHS = ("chest", "waist", "hip", "neck")
LENGTHS = ("shoulder", "sleeve", "outleg", "inleg")
TIERED = LENGTHS + GIRTHS  # stature is reported but not tiered (12.2)
TEST = "test"
READINGS_PER_SITE = 4


class AnalysisRefused(Exception):
    """A rule of 12.2 was broken: the message is the exit reason."""


@dataclass(frozen=True)
class CaptureSet:
    participant: str
    set_no: int
    capture_mode: str
    camera_facing: str
    device_model: str
    lighting: str
    clothing_fit: str
    lux: float | None
    rules_version_used: str
    rederived_rules_version: str
    values_mm: Mapping[str, float]  # sites with a value and a flag that is not fail
    flags: Mapping[str, str]


@dataclass(frozen=True)
class Reading:
    participant: str
    site: str
    measurer: str
    reading_no: int
    value_mm: float


@dataclass
class Exclusion:
    participant: str
    set_no: int | None
    site: str | None
    reason: str

    def row(self) -> dict[str, Any]:
        return {"participant": self.participant, "set_no": self.set_no, "site": self.site,
                "reason": self.reason}  # fmt: skip


@dataclass
class Dataset:
    rules_version: str
    frozen_at: str
    sets: list[CaptureSet]
    readings: list[Reading]
    covariates: dict[str, dict[str, Any]]
    exclusions: list[Exclusion] = field(default_factory=list)
    cohort_counts: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def participants(self) -> list[str]:
        return sorted({s.participant for s in self.sets})

    def reference(self, site: str) -> dict[str, float]:
        """Mean of the protocol's 4 readings per participant; fewer is an exclusion (12.2)."""
        by: dict[str, list[float]] = defaultdict(list)
        for r in self.readings:
            if r.site == site:
                by[r.participant].append(r.value_mm)
        out = {}
        for code, values in by.items():
            if len(values) >= READINGS_PER_SITE:
                out[code] = sum(values) / len(values)
        return out

    def pairs(self, site: str) -> list[tuple[str, int, float, float]]:
        """(participant, set_no, system_mm, tape_mm) for every set with a value and a reference."""
        tape = self.reference(site)
        found = []
        for s in self.sets:
            if s.participant not in tape:
                continue
            value = s.values_mm.get(site)
            if value is None:
                continue
            found.append((s.participant, s.set_no, value, tape[s.participant]))
        return found


def _mm(text: str) -> float | None:
    text = text.strip()
    return None if not text else round(float(text) * 10, 3)


def _float(text: str) -> float | None:
    text = text.strip()
    return None if not text else float(text)


def _covariate(row: Mapping[str, str], column: str) -> float | None:
    """A number from the paper file, or a refusal that names the row and column, not the value."""
    try:
        return _float(row.get(column, ""))
    except ValueError:
        code = row.get("participant_code", "").strip()
        raise AnalysisRefused(f"covariates: bad value for {code} in column {column}") from None


def read_registry(path: Path, version: str) -> Mapping[str, Any]:
    """The `GET /admin/rules` listing: the version must be there and frozen (12.2, 2.3.2)."""
    rows = json.loads(path.read_text())
    if isinstance(rows, dict) and "rules_version" in rows:
        rows = [rows]
    for row in rows:
        if row.get("rules_version") == version:
            if row.get("status") != "frozen" or not row.get("frozen_at"):
                raise AnalysisRefused(f"rules_not_frozen: {version} is {row.get('status')}")
            return dict(row)
    raise AnalysisRefused(f"rules_not_frozen: {version} is not in the registry listing")


def read_captures(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def read_covariates(path: Path | None) -> dict[str, dict[str, Any]]:
    """paper_covariates.csv: participant_code, weight_kg, measured_stature_cm, age_band, notes,
    and optionally sex. Local only, never uploaded (12.1). Only the columns the analysis uses are
    read: weight and stature for the BMI class, and sex for its stratum."""
    if path is None:
        return {}
    out: dict[str, dict[str, Any]] = {}
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            code = row["participant_code"].strip()
            weight = _covariate(row, "weight_kg")
            stature_cm = _covariate(row, "measured_stature_cm")
            bmi = None
            if weight and stature_cm:
                bmi = weight / (stature_cm / 100) ** 2
            out[code] = {
                "weight_kg": weight,
                "measured_stature_cm": stature_cm,
                "bmi": bmi,
                "bmi_class": bmi_class(bmi),
                "sex": row.get("sex", "").strip() or None,
            }
    return out


def bmi_class(bmi: float | None) -> str | None:
    """WHO cut-offs, as the proposal's three classes: below 25, 25 to 30, 30 or more."""
    if bmi is None:
        return None
    if bmi < 25:
        return "under_25"
    if bmi < 30:
        return "25_to_30"
    return "30_or_more"


def load(
    captures: Path,
    reference: Path,
    registry: Path,
    rules_version: str,
    covariates: Path | None = None,
) -> Dataset:
    entry = read_registry(registry, rules_version)
    rows = read_captures(captures)
    counts: dict[str, int] = defaultdict(int)
    people: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        counts[row["cohort"]] += 1
        people[row["cohort"]].add(row["participant_code"])
    exclusions: list[Exclusion] = []
    sets: list[CaptureSet] = []
    for row in rows:
        code, set_no = row["participant_code"], int(row["set_no"])
        if row["cohort"] != TEST:
            continue
        rederived, used = row["rederived_rules_version"].strip(), row["rules_version_used"].strip()
        under_version = rederived == rules_version or (not rederived and used == rules_version)
        if not under_version:
            exclusions.append(Exclusion(code, set_no, None, "other_rules_version"))
            continue
        values: dict[str, float] = {}
        flags: dict[str, str] = {}
        for site in SITES:
            value, flag = _mm(row[f"{site}_cm"]), row[f"{site}_flag"].strip()
            flags[site] = flag
            if value is None or flag == "fail":
                exclusions.append(Exclusion(code, set_no, site, "site_failed"))
                continue
            values[site] = value
        sets.append(
            CaptureSet(
                participant=code,
                set_no=set_no,
                capture_mode=row["capture_mode"],
                camera_facing=row["camera_facing"],
                device_model=row["device_model"],
                lighting=row["lighting"],
                clothing_fit=row["clothing_fit_observed"],
                lux=_float(row["lux"]),
                rules_version_used=used,
                rederived_rules_version=rederived,
                values_mm=values,
                flags=flags,
            )
        )
    if not sets:
        raise AnalysisRefused(
            "cohort mismatch: no test-cohort capture sets under this rules version"
        )
    readings: list[Reading] = []
    with reference.open(newline="") as handle:
        for row in csv.DictReader(handle):
            if row["cohort"] != TEST:
                continue
            value = _mm(row["value_cm"])
            if value is None:
                continue
            readings.append(
                Reading(
                    row["participant_code"],
                    row["site_code"],
                    row["measurer_code"],
                    int(row["reading_no"]),
                    value,
                )  # fmt: skip
            )
    dataset = Dataset(
        rules_version=rules_version,
        frozen_at=str(entry["frozen_at"]),
        sets=sets,
        readings=readings,
        covariates=read_covariates(covariates),
        exclusions=exclusions,
        cohort_counts={
            c: {"capture_sets": counts[c], "participants": len(people[c])} for c in sorted(counts)
        },
    )
    _note_missing_readings(dataset)
    return dataset


def _note_missing_readings(dataset: Dataset) -> None:
    for site in SITES:
        complete = dataset.reference(site)
        for code in dataset.participants:
            if code not in complete:
                dataset.exclusions.append(Exclusion(code, None, site, "tape_incomplete"))


def unique(values: Iterable[str]) -> list[str]:
    return sorted(set(values))


def group_of(dataset: Dataset, capture: CaptureSet, stratum: str) -> str | None:
    """The value of a stratification variable for one capture set (12.5)."""
    if stratum in ("sex", "bmi_class"):
        return dataset.covariates.get(capture.participant, {}).get(stratum)
    return {
        "clothing_fit": capture.clothing_fit or None,
        "lighting": capture.lighting or None,
        "camera_facing": capture.camera_facing or None,
        "device_model": capture.device_model or None,
        "capture_mode": capture.capture_mode or None,
    }[stratum]


STRATA: Sequence[str] = (
    "sex", "bmi_class", "clothing_fit", "lighting", "camera_facing", "device_model", "capture_mode",
)  # fmt: skip
