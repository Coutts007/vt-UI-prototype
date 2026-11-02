"""The validation study: participants, blind tape readings and exports (backend-spec 8, 11.1, 12.1).

Real participants wait for the approvals in production (A9). A participant who withdrew keeps
their rows on record but is left out of every export and refused for new readings (D44, open).
"""

import secrets
import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import (
    SITES,
    CaptureSession,
    Client,
    Consent,
    MeasurementProfile,
    Measurer,
    Participant,
    ReferenceCorrection,
    ReferenceMeasurement,
    Tailor,
    UserAccount,
)
from app.schemas import (
    OwnReading,
    ParticipantInput,
    ParticipantUpdate,
    ReadingCorrection,
    ReadingCorrectionInput,
    ReferenceReading,
    ReferenceReadingInput,
    ReferenceReadingReceipt,
)
from app.schemas import Participant as ParticipantView
from app.security.deps import CurrentPrincipal, Session, require_role
from app.security.ip_hash import ip_hash
from app.services import audit
from app.services.allocation import cohort_for
from app.services.approvals import require_approvals
from app.services.csvout import csv_response
from app.services.exports import captures_csv, reference_csv
from app.services.ingest import invalid
from app.services.rules import find_rules
from app.services.settings import read_settings, write_setting

from .directory import CODE_ATTEMPTS, new_code

router = APIRouter(tags=["study"])
ADMIN = Depends(require_role("admin"))
MEASURER = Depends(require_role("measurer"))
STUDY_BUSINESS = "Validation study"
Code = Annotated[str, Query(pattern=r"^P[0-9]{3}$", max_length=4)]
RulesQuery = Annotated[str | None, Query(pattern=r"^[0-9]+\.[0-9]+-[a-z0-9-]+$", max_length=40)]


async def _study_on(request: Request, session: AsyncSession) -> dict[str, Any]:
    values = await read_settings(session)
    if not values["study_mode"]:
        raise ApiError("study_mode_off")
    return values


def _guard(request: Request, values: dict[str, Any]) -> None:
    require_approvals(request.app.state.settings.env, values, datetime.now(UTC).date())


def withdrawn_clause(client_id: Any) -> Any:
    return exists().where(Consent.client_id == client_id, Consent.withdrawn_at.isnot(None))


async def _view(session: AsyncSession, participant: Participant) -> ParticipantView:
    client = await session.get(Client, participant.client_id)
    sets = await session.scalar(
        select(func.count(func.distinct(CaptureSession.set_no)))
        .join(MeasurementProfile, MeasurementProfile.session_id == CaptureSession.session_id)
        .where(
            CaptureSession.participant_id == participant.participant_id,
            MeasurementProfile.status != "deleted",
        )
    )
    per_site = (
        select(func.count().label("n"))
        .where(ReferenceMeasurement.participant_id == participant.participant_id)
        .group_by(ReferenceMeasurement.site_code)
        .subquery()
    )
    counts = list(await session.scalars(select(per_site.c.n)))
    # Complete sets of readings: the fewest any of the nine sites has.
    readings = min(counts) if len(counts) == len(SITES) else 0
    withdrawn = await session.scalar(select(withdrawn_clause(participant.client_id)))
    return ParticipantView(
        participant_id=participant.participant_id,
        participant_code=participant.participant_code,
        client_code=client.client_code if client else "",
        sex=participant.sex,  # type: ignore[arg-type]
        age_band=participant.age_band,  # type: ignore[arg-type]
        venue=participant.venue,
        cohort=participant.cohort,  # type: ignore[arg-type]
        enrolled_at=participant.enrolled_at,
        sets_captured=min(sets or 0, 3),
        readings_entered=min(readings, 4),
        withdrawn=bool(withdrawn),
    )


@router.get("/study/participants", operation_id="listParticipants",
            response_model=list[ParticipantView], dependencies=[ADMIN])  # fmt: skip
async def list_participants(session: Session) -> list[ParticipantView]:
    rows = await session.scalars(select(Participant).order_by(Participant.participant_code))
    return [await _view(session, row) for row in rows]


async def _study_tailor(session: AsyncSession, admin: UserAccount) -> Tailor:
    """Study codes need a tailor row. It is the enrolling admin's, never listed (D44 notes)."""
    tailor = await session.scalar(select(Tailor).where(Tailor.user_id == admin.user_id))
    if tailor is None:
        tailor = Tailor(user_id=admin.user_id, business_name=STUDY_BUSINESS, phone_e164="", area="")
        session.add(tailor)
        await session.flush()
    return tailor


async def _allocation_seed(
    session: AsyncSession, request: Request, values: dict[str, Any], admin: UserAccount
) -> int:
    seed = values.get("allocation_seed")
    if isinstance(seed, int):
        return seed
    # No seed was set with `vt study allocate --seed`, so one is drawn now and logged.
    seed = secrets.randbelow(2**31)
    await write_setting(session, "allocation_seed", seed, admin.user_id)
    audit.record(
        session,
        actor_type="user",
        action="settings_change",
        entity_type="app_setting",
        entity_id="allocation_seed",
        user_id=admin.user_id,
        ip_hash=ip_hash(request),
        detail={"allocation_seed": seed, "drawn": True},
    )
    return seed


@router.post("/study/participants", operation_id="enrolParticipant", status_code=201,
             response_model=ParticipantView, dependencies=[ADMIN])  # fmt: skip
async def enrol_participant(
    body: ParticipantInput, request: Request, session: Session, principal: CurrentPrincipal
) -> ParticipantView:
    values = await _study_on(request, session)
    _guard(request, values)
    if await session.scalar(
        select(Participant).where(Participant.participant_code == body.participant_code)
    ):
        raise invalid("participant_code", "taken")
    seed = await _allocation_seed(session, request, values, principal.user)
    index = await session.scalar(
        select(func.count()).select_from(Participant).where(Participant.sex == body.sex)
    )
    cohort = cohort_for(seed, body.sex, index or 0)
    tailor = await _study_tailor(session, principal.user)
    for _ in range(CODE_ATTEMPTS):
        client = Client(client_code=new_code(), tailor_id=tailor.tailor_id, sex=body.sex)
        try:
            async with session.begin_nested():
                session.add(client)
                await session.flush()
        except IntegrityError:
            continue
        break
    else:
        raise ApiError("server_error")
    participant = Participant(
        participant_code=body.participant_code,
        client_id=client.client_id,
        sex=body.sex,
        age_band=body.age_band,
        venue=body.venue,
        cohort=cohort,
    )
    session.add(participant)
    await session.flush()
    audit.record(
        session,
        actor_type="user",
        action="participant_create",
        entity_type="participant",
        entity_id=participant.participant_id,
        user_id=principal.user.user_id,
        client_id=client.client_id,
        ip_hash=ip_hash(request),
        detail={
            "participant_code": body.participant_code,
            "cohort": cohort,
            "allocation_seed": seed,
            "stratum_index": index or 0,
        },
    )
    await session.commit()
    await session.refresh(participant)
    return await _view(session, participant)


@router.patch("/study/participants/{participant_id}", operation_id="updateParticipant",
              response_model=ParticipantView, dependencies=[ADMIN])  # fmt: skip
async def update_participant(
    participant_id: uuid.UUID,
    body: ParticipantUpdate,
    request: Request,
    session: Session,
    principal: CurrentPrincipal,
) -> ParticipantView:
    participant = await session.get(Participant, participant_id, with_for_update=True)
    if participant is None:
        raise ApiError("not_found")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "cohort" in changes and changes["cohort"] != participant.cohort:
        has_readings = await session.scalar(
            select(exists().where(ReferenceMeasurement.participant_id == participant_id))
        )
        if has_readings:
            raise ApiError("cohort_locked")
    for key, value in changes.items():
        setattr(participant, key, value)
    if "cohort" in changes:
        participant.cohort_assigned_at = datetime.now(UTC)
    if changes:
        audit.record(
            session,
            actor_type="user",
            action="participant_update",
            entity_type="participant",
            entity_id=participant.participant_id,
            user_id=principal.user.user_id,
            ip_hash=ip_hash(request),
            detail={"changed": sorted(changes), **({"cohort": changes["cohort"]}
                                                   if "cohort" in changes else {})},
        )  # fmt: skip
    await session.commit()
    return await _view(session, participant)


async def _participant(session: AsyncSession, code: str) -> Participant:
    participant = await session.scalar(
        select(Participant).where(Participant.participant_code == code)
    )
    if participant is None:
        raise ApiError("not_found")
    return participant


async def _measurer(session: AsyncSession, user: UserAccount) -> Measurer:
    measurer = await session.scalar(select(Measurer).where(Measurer.user_id == user.user_id))
    if measurer is None:
        raise ApiError("forbidden")
    return measurer


@router.post("/study/reference-readings", operation_id="submitReferenceReadings",
             status_code=201, response_model=ReferenceReadingReceipt,
             dependencies=[MEASURER])  # fmt: skip
async def submit_readings(
    body: ReferenceReadingInput, request: Request, session: Session, principal: CurrentPrincipal
) -> ReferenceReadingReceipt:
    values = await _study_on(request, session)
    _guard(request, values)
    measurer = await _measurer(session, principal.user)
    participant = await _participant(session, body.participant_code)
    if await session.scalar(select(withdrawn_clause(participant.client_id))):
        raise ApiError("consent_missing")
    mine = select(ReferenceMeasurement.reading_no).where(
        ReferenceMeasurement.participant_id == participant.participant_id,
        ReferenceMeasurement.measurer_id == measurer.measurer_id,
    )
    taken = set(await session.scalars(mine))
    if body.reading_no in taken:
        raise ApiError("reading_locked")
    # Reading 2 before reading 1 is kept, and marked (frontend-spec 15.2).
    out_of_order = body.reading_no == 2 and 1 not in taken
    readings = body.values.model_dump()
    try:
        async with session.begin_nested():
            session.add_all(
                [
                    ReferenceMeasurement(
                        participant_id=participant.participant_id,
                        measurer_id=measurer.measurer_id,
                        site_code=site,
                        reading_no=body.reading_no,
                        value_mm=readings[site],
                        taken_at=body.taken_at,
                        out_of_order=out_of_order,
                    )
                    for site in SITES
                ]
            )
            await session.flush()
    except IntegrityError as error:
        # Two devices sent the same reading at once: the first one stands.
        raise ApiError("reading_locked") from error
    audit.record(
        session,
        actor_type="user",
        action="reference_entry",
        entity_type="participant",
        entity_id=participant.participant_id,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={
            "participant_code": participant.participant_code,
            "reading_no": body.reading_no,
            "measurer_code": measurer.measurer_code,
            "out_of_order": out_of_order,
        },
    )
    await session.commit()
    return ReferenceReadingReceipt(
        participant_code=participant.participant_code,
        reading_no=body.reading_no,
        measurer_code=measurer.measurer_code,
        out_of_order=out_of_order,
    )


@router.get("/study/reference-readings/mine", operation_id="listMyReferenceReadings",
            response_model=list[OwnReading], dependencies=[MEASURER])  # fmt: skip
async def my_readings(
    participant_code: Code, session: Session, principal: CurrentPrincipal
) -> list[OwnReading]:
    measurer = await _measurer(session, principal.user)
    participant = await session.scalar(
        select(Participant).where(Participant.participant_code == participant_code)
    )
    if participant is None:
        return []
    # The caller's own readings as typed, never another measurer's and never a system value.
    rows = await session.scalars(
        select(ReferenceMeasurement)
        .where(
            ReferenceMeasurement.participant_id == participant.participant_id,
            ReferenceMeasurement.measurer_id == measurer.measurer_id,
        )
        .order_by(ReferenceMeasurement.reading_no, ReferenceMeasurement.site_code)
    )
    return [
        OwnReading(
            participant_code=participant_code,
            reading_no=row.reading_no,  # type: ignore[arg-type]
            site_code=row.site_code,  # type: ignore[arg-type]
            value_mm=row.value_mm,
            taken_at=row.taken_at,
        )
        for row in rows
    ]


async def _reading_view(session: AsyncSession, row: ReferenceMeasurement) -> ReferenceReading:
    participant = await session.get(Participant, row.participant_id)
    measurer = await session.get(Measurer, row.measurer_id)
    correction = await session.scalar(
        select(ReferenceCorrection)
        .where(ReferenceCorrection.ref_id == row.ref_id)
        .order_by(ReferenceCorrection.corrected_at.desc(), ReferenceCorrection.correction_id)
        .limit(1)
    )
    return ReferenceReading(
        ref_id=row.ref_id,
        participant_code=participant.participant_code if participant else "",
        measurer_code=measurer.measurer_code if measurer else "",
        reading_no=row.reading_no,  # type: ignore[arg-type]
        site_code=row.site_code,  # type: ignore[arg-type]
        value_mm=row.value_mm,
        taken_at=row.taken_at,
        out_of_order=row.out_of_order,
        correction=(
            ReadingCorrection(
                value_mm=correction.value_mm,
                reason=correction.reason,
                corrected_at=correction.corrected_at,
            )
            if correction
            else None
        ),
    )


@router.get("/admin/study/reference-readings", operation_id="listReferenceReadings",
            response_model=list[ReferenceReading], dependencies=[ADMIN])  # fmt: skip
async def list_readings(participant_code: Code, session: Session) -> list[ReferenceReading]:
    participant = await _participant(session, participant_code)
    rows = await session.scalars(
        select(ReferenceMeasurement)
        .where(ReferenceMeasurement.participant_id == participant.participant_id)
        .order_by(
            ReferenceMeasurement.measurer_id,
            ReferenceMeasurement.reading_no,
            ReferenceMeasurement.site_code,
        )
    )
    return [await _reading_view(session, row) for row in rows]


@router.post("/admin/study/reference-readings/{ref_id}/corrections",
             operation_id="correctReferenceReading", status_code=201,
             response_model=ReferenceReading, dependencies=[ADMIN])  # fmt: skip
async def correct_reading(
    ref_id: uuid.UUID,
    body: ReadingCorrectionInput,
    request: Request,
    session: Session,
    principal: CurrentPrincipal,
) -> ReferenceReading:
    row = await session.get(ReferenceMeasurement, ref_id)
    if row is None:
        raise ApiError("not_found")
    # The reading itself never changes. The correction sits beside it, with who made it.
    session.add(
        ReferenceCorrection(
            ref_id=row.ref_id,
            value_mm=body.value_mm,
            reason=body.reason,
            corrected_by=principal.user.user_id,
        )
    )
    audit.record(
        session,
        actor_type="user",
        action="reference_correction",
        entity_type="reference_measurement",
        entity_id=row.ref_id,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={"site_code": row.site_code, "reading_no": row.reading_no},
    )
    await session.commit()
    return await _reading_view(session, row)


def _record_export(
    request: Request, session: AsyncSession, principal: CurrentPrincipal, name: str, **extra: Any
) -> None:
    audit.record(
        session,
        actor_type="user",
        action="export",
        entity_type="study_export",
        entity_id=name,
        user_id=principal.user.user_id,
        ip_hash=ip_hash(request),
        detail={"file": name, **extra},
    )


@router.get("/study/export/captures.csv", operation_id="exportCaptures", dependencies=[ADMIN],
            responses={200: {"content": {"text/csv": {}}}})  # fmt: skip
async def export_captures(
    request: Request,
    session: Session,
    principal: CurrentPrincipal,
    rules_version: RulesQuery = None,
) -> Response:
    if rules_version is not None:
        await find_rules(request.app.state.rules, session, rules_version)
    body, count = await captures_csv(session, rules_version)
    _record_export(request, session, principal, "captures.csv", rows=count,
                   rules_version=rules_version)  # fmt: skip
    await session.commit()
    return csv_response(body, f"captures-{date.today().isoformat()}.csv")


@router.get("/study/export/reference.csv", operation_id="exportReference", dependencies=[ADMIN],
            responses={200: {"content": {"text/csv": {}}}})  # fmt: skip
async def export_reference(
    request: Request, session: Session, principal: CurrentPrincipal
) -> Response:
    body, count = await reference_csv(session)
    _record_export(request, session, principal, "reference.csv", rows=count)
    await session.commit()
    return csv_response(body, f"reference-{date.today().isoformat()}.csv")
