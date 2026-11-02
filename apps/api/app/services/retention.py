"""The nightly retention job (backend-spec 14.6, D10, D20, D27, D45).

It runs as `vt_retention`, the only role that may remove audit rows and tape readings. Every
step runs in one transaction. A dry run does the same work, reports the counts and rolls back,
so the report shows exactly what a real run would remove. Counts only: no codes, names or values.
"""

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    CaptureSession,
    Client,
    DeletedProfile,
    DeletionRequest,
    MeasurementDerivation,
    MeasurementProfile,
    Order,
    OrderStatusHistory,
    Participant,
    ReferenceCorrection,
    ReferenceMeasurement,
    RevokedToken,
    SpecSheet,
)
from app.services.erasure import erase_profiles
from app.services.settings import read_settings
from app.services.sheet_cleanup import clean_sheets

AFTER_COLLECTION = timedelta(days=30)  # D10: an order's profile stays 30 days after collection
TOMBSTONE_DAYS = 90  # D45: long enough for any phone's queue, which is refused after 90 days
DIRECTORY_UNUSED_DAYS = 30  # D27: a directory code nobody measured with
STUDY_KEEP_MONTHS = 12  # 14.6 step 3: after the collection end


@dataclass
class RetentionReport:
    run_at: str
    dry_run: bool
    requests_completed: int = 0
    orders_after_collection: int = 0
    profiles_after_collection: int = 0
    clients_inactive: int = 0
    clients_marked_deleted: int = 0
    directory_codes_unused: int = 0
    study_participants: int = 0
    study_readings: int = 0
    audit_rows: int = 0
    revoked_tokens: int = 0
    tombstones: int = 0
    sheet_files: int = 0
    notes: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {k: v for k, v in asdict(self).items() if isinstance(v, int) and k != "dry_run"}


def months_before(moment: datetime, months: int) -> datetime:
    year, month = divmod(moment.month - 1 - months, 12)
    first = moment.replace(year=moment.year + year, month=month + 1, day=1)
    # The same day of the month, or the last day if that month is shorter.
    following = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    return first.replace(day=min(moment.day, (following - timedelta(days=1)).day))


def _collected_at() -> Any:
    return (
        select(func.max(OrderStatusHistory.changed_at))
        .where(
            OrderStatusHistory.order_id == Order.order_id,
            OrderStatusHistory.status == "collected",
        )
        .scalar_subquery()
    )


async def _delete_orders(session: AsyncSession, order_ids: list[Any]) -> int:
    if not order_ids:
        return 0
    result = await session.execute(
        delete(Order)
        .where(Order.order_id.in_(order_ids))
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0  # type: ignore[attr-defined]


async def _finish_requests(session: AsyncSession, now: datetime, report: RetentionReport) -> None:
    """Step 1: profiles kept for an order go 30 days after it is collected (14.5 step 2)."""
    held = await session.scalars(
        select(DeletionRequest).where(
            DeletionRequest.status == "partially_done", DeletionRequest.client_id.isnot(None)
        )
    )
    for request in list(held):
        assert request.client_id is not None
        query = select(Order.order_id).where(
            Order.client_id == request.client_id,
            Order.status == "collected",
            _collected_at() <= now - AFTER_COLLECTION,
        )
        if request.claim_round is not None:
            # A request a phone proved reaches only its own round's orders (D45).
            query = query.join(
                MeasurementProfile, MeasurementProfile.profile_id == Order.profile_id
            ).where(MeasurementProfile.claim_round == request.claim_round)
        old_orders = list(await session.scalars(query))
        report.orders_after_collection += await _delete_orders(session, old_orders)
        erased = await erase_profiles(session, request.client_id, request.claim_round)
        report.profiles_after_collection += erased.deleted
        if erased.retained == 0:
            request.status = "done"
            request.completed_at = now
            report.requests_completed += 1


async def _remove_clients(session: AsyncSession, client_ids: list[Any]) -> int:
    """Whole clients: their orders first, then the client, which takes everything else with it."""
    if not client_ids:
        return 0
    orders = list(
        await session.scalars(select(Order.order_id).where(Order.client_id.in_(client_ids)))
    )
    await _delete_orders(session, orders)
    result = await session.execute(
        delete(Client)
        .where(Client.client_id.in_(client_ids))
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0  # type: ignore[attr-defined]


async def _old_clients(
    session: AsyncSession, now: datetime, months: int, report: RetentionReport
) -> None:
    """Step 2 and D27: inactive clients, clients the tailor removed, and unused directory codes."""
    is_participant = exists().where(Participant.client_id == Client.client_id)
    open_order = exists().where(Order.client_id == Client.client_id, Order.status != "collected")
    last_order = (
        select(func.max(Order.updated_at)).where(Order.client_id == Client.client_id)
    ).scalar_subquery()
    last_profile = (
        select(func.max(MeasurementProfile.received_at)).where(
            MeasurementProfile.client_id == Client.client_id
        )
    ).scalar_subquery()
    last_activity = func.greatest(Client.created_at, last_order, last_profile)
    inactive = list(
        await session.scalars(
            select(Client.client_id).where(
                ~is_participant, ~open_order, last_activity < months_before(now, months)
            )
        )
    )
    report.clients_inactive = await _remove_clients(session, inactive)
    any_order = exists().where(Order.client_id == Client.client_id)
    marked = list(
        await session.scalars(
            select(Client.client_id).where(
                Client.deleted_at.isnot(None), ~any_order, ~is_participant
            )
        )
    )
    report.clients_marked_deleted = await _remove_clients(session, marked)
    any_profile = exists().where(MeasurementProfile.client_id == Client.client_id)
    unused = list(
        await session.scalars(
            select(Client.client_id).where(
                Client.source == "directory",
                ~any_profile,
                ~any_order,
                ~is_participant,
                Client.created_at < now - timedelta(days=DIRECTORY_UNUSED_DAYS),
            )
        )
    )
    report.directory_codes_unused = await _remove_clients(session, unused)


async def _study_records(
    session: AsyncSession, now: datetime, end: Any, report: RetentionReport
) -> None:
    """Step 3: study records go 12 months after the collection end."""
    if not end:
        return
    collection_end = date.fromisoformat(str(end))
    keep_until = months_before(
        datetime(collection_end.year, collection_end.month, collection_end.day, tzinfo=UTC),
        -STUDY_KEEP_MONTHS,
    )
    if now < keep_until:
        return
    study_profiles = (
        select(MeasurementProfile.profile_id)
        .join(CaptureSession, CaptureSession.session_id == MeasurementProfile.session_id)
        .where(CaptureSession.participant_id.isnot(None))
    )
    await session.execute(
        delete(MeasurementDerivation)
        .where(MeasurementDerivation.profile_id.in_(study_profiles))
        .execution_options(synchronize_session=False)
    )
    await session.execute(delete(ReferenceCorrection).execution_options(synchronize_session=False))
    readings = await session.execute(
        delete(ReferenceMeasurement).execution_options(synchronize_session=False)
    )
    report.study_readings = readings.rowcount or 0  # type: ignore[attr-defined]
    await session.execute(
        update(CaptureSession)
        .where(CaptureSession.participant_id.isnot(None))
        .values(
            participant_id=None,
            set_no=None,
            lighting=None,
            distance_m=None,
            clothing_fit_observed=None,
            lux=None,
        )  # fmt: skip
        .execution_options(synchronize_session=False)
    )
    people = await session.execute(delete(Participant).execution_options(synchronize_session=False))
    report.study_participants = people.rowcount or 0  # type: ignore[attr-defined]


async def _small_rows(
    session: AsyncSession, now: datetime, audit_months: int, report: RetentionReport
) -> None:
    """Steps 4 and 5, and the D45 tombstones."""
    audit_rows = await session.execute(
        delete(AuditLog)
        .where(AuditLog.occurred_at < months_before(now, audit_months))
        .execution_options(synchronize_session=False)
    )
    report.audit_rows = audit_rows.rowcount or 0  # type: ignore[attr-defined]
    tokens = await session.execute(
        delete(RevokedToken)
        .where(RevokedToken.expires_at < now)
        .execution_options(synchronize_session=False)
    )
    report.revoked_tokens = tokens.rowcount or 0  # type: ignore[attr-defined]
    tombstones = await session.execute(
        delete(DeletedProfile)
        .where(DeletedProfile.deleted_at < now - timedelta(days=TOMBSTONE_DAYS))
        .execution_options(synchronize_session=False)
    )
    report.tombstones = tombstones.rowcount or 0  # type: ignore[attr-defined]


async def run_retention(
    session: AsyncSession,
    *,
    sheets_dir: Path,
    reports_dir: Path | None,
    dry_run: bool,
    now: datetime | None = None,
) -> RetentionReport:
    moment = now or datetime.now(UTC)
    report = RetentionReport(run_at=moment.isoformat(), dry_run=dry_run)
    values = await read_settings(session)
    await _finish_requests(session, moment, report)
    await _old_clients(session, moment, int(values["retention_months"]), report)
    await _study_records(session, moment, values.get("study_collection_end"), report)
    await _small_rows(session, moment, int(values["audit_retention_months"]), report)
    if dry_run:
        report.sheet_files = (
            await session.scalar(
                select(func.count()).select_from(SpecSheet).where(SpecSheet.expires_at <= moment)
            )
            or 0
        )
        report.notes.append("Dry run: nothing was removed. Counts are what a real run removes.")
        await session.rollback()
    else:
        session.add(
            AuditLog(
                actor_type="system",
                action="retention",
                entity_type="job",
                entity_id=moment.date().isoformat(),
                detail={k: v for k, v in report.counts().items() if v},
            )
        )
        await session.commit()
        # Files go after the rows commit, so a failed run never leaves a row without its file.
        cleaned = await clean_sheets(session, sheets_dir, moment)
        report.sheet_files = cleaned.expired_files + cleaned.orphan_files
        await session.commit()
    if reports_dir is not None:
        write_report(reports_dir, report)
    return report


def write_report(reports_dir: Path, report: RetentionReport) -> Path:
    reports_dir.mkdir(parents=True, exist_ok=True)
    suffix = "-dry-run" if report.dry_run else ""
    path = reports_dir / f"retention-{report.run_at[:10]}{suffix}.json"
    path.write_text(json.dumps(asdict(report), indent=2, sort_keys=True) + "\n")
    return path
