"""What the fitting code may read: the calibration cohort and nothing else (spec 2.3, 11.3.8).

A calibration bundle is the JSON written by `vt study export-calibration` on the study laptop. The
API already writes only the calibration cohort, and this repository filters again, so a pilot or
test participant can never reach a fit even if a bundle holds one.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BUNDLE_FORMAT = "vt-calibration-bundle/1"
CALIBRATION = "calibration"
SEXES = ("female", "male", "unspecified")
# 2 measurers x 2 readings each (backend-spec 11.3.1).
PROTOCOL_READINGS = 4


@dataclass(frozen=True)
class Reading:
    site_code: str
    measurer_code: str
    reading_no: int
    value_mm: float


@dataclass(frozen=True)
class CaptureSet:
    set_no: int
    profile: Mapping[str, Any]


@dataclass(frozen=True)
class Participant:
    code: str
    cohort: str
    sex: str
    sets: tuple[CaptureSet, ...]
    readings: tuple[Reading, ...]

    def target(self, site: str, min_readings: int = PROTOCOL_READINGS) -> float | None:
        """The mean tape reading, or None when fewer readings than the protocol exist."""
        values = [r.value_mm for r in self.readings if r.site_code == site]
        if len(values) < min_readings:
            return None
        total = 0.0
        for value in values:
            total += value
        return total / len(values)


def _participant(row: Mapping[str, Any]) -> Participant:
    return Participant(
        code=str(row["participant_code"]),
        cohort=str(row["cohort"]),
        sex=str(row["sex"]),
        sets=tuple(
            CaptureSet(int(s["set_no"]), s["profile"])
            for s in sorted(row.get("sets", []), key=lambda s: int(s["set_no"]))
        ),
        readings=tuple(
            Reading(
                str(r["site_code"]),
                str(r["measurer_code"]),
                int(r["reading_no"]),
                float(r["value_mm"]),
            )  # fmt: skip
            for r in row.get("readings", [])
        ),
    )


class CalibrationRepository:
    """The only way fitting code gets data. It hands out the calibration cohort alone."""

    def __init__(self, bundle: Mapping[str, Any]) -> None:
        if bundle.get("format") != BUNDLE_FORMAT:
            raise ValueError(f"Not a calibration bundle: expected format {BUNDLE_FORMAT}")
        # Parse only the cohort the fit may see: other rows are never even read.
        self._rows = [row for row in bundle["participants"] if row.get("cohort") == CALIBRATION]

    @classmethod
    def from_file(cls, path: Path) -> "CalibrationRepository":
        return cls(json.loads(path.read_text()))

    def calibration_data(self) -> tuple[Participant, ...]:
        people = [_participant(row) for row in self._rows]
        assert all(p.cohort == CALIBRATION for p in people)
        return tuple(sorted(people, key=lambda p: p.code))


def cohort_hash(people: Sequence[Participant]) -> str:
    """SHA-256 of the sorted participant codes (backend-spec 11.3.6)."""
    return hashlib.sha256("\n".join(sorted(p.code for p in people)).encode()).hexdigest()
