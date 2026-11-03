"""Re-derivation under another rules version, into its own table (backend-spec 2.3.3, 11.3.7).

Originals are never overwritten: `measurement` keeps what the phone computed, and every other
rules version's numbers go to `measurement_derivation`.
"""

from typing import Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from vt_measure.derive import derive

from app.models import CaptureSession, MeasurementDerivation, MeasurementProfile, Participant
from app.services.exports import _kept

log = structlog.get_logger()


def derive_input(profile: MeasurementProfile, capture: CaptureSession) -> dict[str, Any]:
    """The numbers vt_measure reads, rebuilt from the stored rows."""
    return {
        "covariates": profile.covariates,
        "session": {"level_unchecked": capture.level_unchecked, "free_arm": capture.free_arm},
        "landmarks_front": profile.landmarks_front,
        "landmarks_side": profile.landmarks_side,
        "marker_front": profile.marker_front,
        "marker_side": profile.marker_side,
        "silhouette_front": profile.silhouette_front,
        "silhouette_side": profile.silhouette_side,
    }


async def cohort_sets(
    session: AsyncSession, cohort: str
) -> list[tuple[MeasurementProfile, CaptureSession, Participant]]:
    """Final study profiles of a cohort's participants still in the study (D44 default)."""
    found = await session.execute(
        select(MeasurementProfile, CaptureSession, Participant)
        .join(CaptureSession, CaptureSession.session_id == MeasurementProfile.session_id)
        .join(Participant, Participant.participant_id == CaptureSession.participant_id)
        .where(Participant.cohort == cohort, MeasurementProfile.status == "final", _kept())
        .order_by(
            Participant.participant_code, CaptureSession.set_no, MeasurementProfile.profile_id
        )
    )
    return [(row[0], row[1], row[2]) for row in found.all()]


async def rederive(session: AsyncSession, artifact: dict[str, Any], cohort: str) -> int:
    """Recompute a cohort under one artifact. A profile that cannot be derived is skipped."""
    version = artifact["rules_version"]
    processed = 0
    for profile, capture, _ in await cohort_sets(session, cohort):
        try:
            sites = derive(derive_input(profile, capture), artifact).sites
        except Exception as error:
            # The type only: a message could carry numbers from the profile.
            log.error("rederive_profile_failed", error_type=type(error).__name__)
            continue
        await session.execute(
            delete(MeasurementDerivation).where(
                MeasurementDerivation.profile_id == profile.profile_id,
                MeasurementDerivation.rules_version == version,
            )
        )
        for site, result in sites.items():
            session.add(
                MeasurementDerivation(
                    profile_id=profile.profile_id,
                    rules_version=version,
                    site_code=site,
                    value_mm=result.value_mm,
                    confidence_flag=result.flag,
                )
            )
        processed += 1
    return processed
