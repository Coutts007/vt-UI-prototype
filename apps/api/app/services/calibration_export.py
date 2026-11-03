"""The calibration bundle that vt-ml calibrate reads (backend-spec 11.1, 11.3).

The calibration cohort only, by participant code. No name, contact detail or client code: the
bundle holds the numbers the phone sent, the tape readings (with any correction applied) and sex.
"""

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Measurer, Participant, ReferenceCorrection, ReferenceMeasurement
from app.services.derivation import cohort_sets, derive_input
from app.services.exports import _kept

BUNDLE_FORMAT = "vt-calibration-bundle/1"
CALIBRATION = "calibration"


async def calibration_bundle(session: AsyncSession) -> dict[str, Any]:
    people = list(
        await session.scalars(
            select(Participant)
            .where(Participant.cohort == CALIBRATION, _kept())
            .order_by(Participant.participant_code)
        )
    )
    sets: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for profile, capture, person in await cohort_sets(session, CALIBRATION):
        sets[person.participant_id].append(
            {"set_no": capture.set_no, "profile": derive_input(profile, capture)}
        )
    found = await session.execute(
        select(ReferenceMeasurement, Measurer)
        .join(Measurer, Measurer.measurer_id == ReferenceMeasurement.measurer_id)
        .where(ReferenceMeasurement.participant_id.in_([p.participant_id for p in people]))
        .order_by(
            ReferenceMeasurement.site_code, Measurer.measurer_code, ReferenceMeasurement.reading_no
        )
    )
    readings = found.all()
    latest: dict[Any, int] = {}
    for correction in await session.scalars(
        select(ReferenceCorrection)
        .where(ReferenceCorrection.ref_id.in_([r.ReferenceMeasurement.ref_id for r in readings]))
        .order_by(ReferenceCorrection.corrected_at, ReferenceCorrection.correction_id)
    ):
        latest[correction.ref_id] = correction.value_mm  # the newest one wins
    by_person: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for row in readings:
        reading = row.ReferenceMeasurement
        by_person[reading.participant_id].append(
            {
                "site_code": reading.site_code,
                "measurer_code": row.Measurer.measurer_code,
                "reading_no": reading.reading_no,
                "value_mm": latest.get(reading.ref_id, reading.value_mm),
            }
        )
    return {
        "format": BUNDLE_FORMAT,
        "participants": [
            {
                "participant_code": p.participant_code,
                "cohort": p.cohort,
                "sex": p.sex,
                "sets": sets.get(p.participant_id, []),
                "readings": by_person.get(p.participant_id, []),
            }
            for p in people
        ],
    }
