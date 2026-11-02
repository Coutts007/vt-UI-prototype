"""Specification sheets, signed file links and the share log (backend-spec 8, 13; F6)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi import Path as PathParam
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import ApiError
from app.models import (
    CaptureSession,
    Client,
    Measurement,
    MeasurementProfile,
    Order,
    OrderItem,
    ServerCheck,
    SheetShare,
    SpecSheet,
    Tailor,
    UserAccount,
)
from app.schemas import ShareInput, Sheet, SheetInput
from app.security import signed_urls
from app.security.deps import CurrentPrincipal, Session, require_role, tailor_of
from app.security.ip_hash import ip_hash
from app.services import audit
from app.services import sheets as render_service
from app.services.share_text import ShareInput as ShareTextInput
from app.services.share_text import build_share_text, share_labels

from .orders import _owned_order

router = APIRouter()
TAILOR = Depends(require_role("tailor"))
NAIROBI = ZoneInfo("Africa/Nairobi")
KEEP_FILES = timedelta(days=30)
HOUR = 3600
# Rendering takes about a second of CPU; two at a time keeps the API answering other requests.
_RENDERING = asyncio.Semaphore(2)
SHEET_FILE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|pdf)$"
MEDIA = {"png": "image/png", "pdf": "application/pdf"}


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _link(settings: Settings, file_name: str) -> str:
    expires, signature = signed_urls.sign(settings.signed_url_secret, file_name)
    return f"/api/v1/files/sheets/{file_name}?exp={expires}&sig={signature}"


async def _sheet_data(
    session: AsyncSession, order: Order, user: UserAccount, include_name: bool
) -> tuple[render_service.SheetData, ShareTextInput]:
    client = await session.get(Client, order.client_id)
    profile = await session.get(MeasurementProfile, order.profile_id)
    tailor = await session.get(Tailor, order.tailor_id)
    assert client is not None and profile is not None and tailor is not None
    capture = await session.get(CaptureSession, profile.session_id)
    measured = {
        row.site_code: row
        for row in await session.scalars(
            select(Measurement).where(Measurement.profile_id == profile.profile_id)
        )
    }
    items = {
        row.site_code: row
        for row in await session.scalars(
            select(OrderItem).where(OrderItem.order_id == order.order_id)
        )
    }
    checks = await session.scalars(
        select(ServerCheck)
        .where(ServerCheck.profile_id == profile.profile_id)
        .order_by(ServerCheck.kind, ServerCheck.site_code)
    )
    locale = user.locale if user.locale in ("en", "sw") else "en"
    unit = user.unit_pref if user.unit_pref in ("cm", "in") else "cm"
    names = share_labels()["labels"][locale]["site_names"]
    sheet_labels = render_service._labels(locale)
    rows = []
    for site in share_labels()["sites"]:
        m = measured.get(site)
        item = items.get(site)
        if item is not None:
            rows.append(
                render_service.SheetRow(
                    site_code=site,
                    body_mm=item.body_mm,
                    flag=item.confidence_flag,
                    reasons=tuple(m.flag_reasons) if m else (),
                    in_order=True,
                    ease_mm=item.ease_mm,
                    finished_mm=item.finished_mm,
                    pending_fitting=item.pending_fitting,
                )
            )
        else:
            rows.append(
                render_service.SheetRow(
                    site_code=site,
                    body_mm=m.value_mm if m else None,
                    flag=m.confidence_flag if m else "fail",
                    reasons=tuple(m.flag_reasons) if m else (),
                )
            )
    check_lines = []
    for check in checks:
        label = sheet_labels["server_checks"].get(check.kind, check.kind)
        check_lines.append(
            f"{label}: {names[check.site_code]}" if check.site_code in names else label
        )
    name = client.display_name if include_name else None
    captured_on = profile.captured_at.astimezone(NAIROBI).date()
    data = render_service.SheetData(
        locale=locale,
        unit=unit,
        client_code=client.client_code,
        name=name,
        profile_id=str(profile.profile_id),
        profile_version=profile.version,
        captured_on=captured_on,
        business_name=tailor.business_name,
        garment_type=order.garment_type,
        due_date=order.due_date,
        order_no=order.order_no,
        rows=tuple(rows),
        server_checks=tuple(dict.fromkeys(check_lines)),
        app_version=capture.app_version if capture else "",
        rules_version=profile.rules_version,
        model_variant=capture.model_variant if capture else "",
        front_checks=dict(capture.front_checks) if capture else {},
        side_checks=dict(capture.side_checks) if capture else {},
        scale_disagreement_pct=(
            float(capture.scale_disagreement_pct)
            if capture and capture.scale_disagreement_pct is not None
            else None
        ),
        generated_at=datetime.now(UTC),
    )
    share = ShareTextInput.model_validate(
        {
            "locale": locale,
            "unit": unit,
            "client_code": client.client_code,
            "name": name,
            "profile_version": profile.version,
            "captured_on": captured_on,
            "garment_type": order.garment_type,
            "due_date": order.due_date,
            "items": [
                {
                    "site_code": row.site_code,
                    "body_mm": row.body_mm,
                    "flag": row.confidence_flag,
                    "pending_fitting": row.pending_fitting,
                }
                for row in items.values()
            ],
        }
    )
    return data, share


@router.post(
    "/orders/{order_id}/sheets",
    operation_id="createSheet",
    status_code=201,
    response_model=Sheet,
    tags=["sheets"],
    dependencies=[TAILOR],
)
async def create_sheet(
    order_id: uuid.UUID,
    body: SheetInput,
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> dict[str, Any]:
    order = await _owned_order(session, principal.user, order_id)
    settings = _settings(request)
    request.app.state.limiter.hit(
        "sheet", str(principal.user.user_id), settings.sheets_per_tailor_hour, HOUR
    )
    data, share = await _sheet_data(session, order, principal.user, body.include_name)
    # End the read before waiting to render, so the connection goes back to the pool: held
    # through the wait and the render, it starved other requests under load (M12).
    await session.commit()
    async with _RENDERING:
        pdf, png = await asyncio.to_thread(render_service.render, data)
    sheet_id = uuid.uuid4()
    directory = Path(settings.sheets_dir)
    await asyncio.to_thread(render_service.store, directory, str(sheet_id), pdf, png)
    generated = data.generated_at or datetime.now(UTC)
    session.add(
        SpecSheet(
            sheet_id=sheet_id,
            order_id=order.order_id,
            generated_at=generated,
            include_name=body.include_name,
            locale=data.locale,
            unit=data.unit,
            png_sha256=render_service.sha256(png),
            pdf_sha256=render_service.sha256(pdf),
            storage_key=str(sheet_id),
            expires_at=generated + KEEP_FILES,
        )
    )
    audit.record(
        session,
        actor_type="user",
        user_id=principal.user.user_id,
        action="export",
        entity_type="sheet",
        entity_id=sheet_id,
        client_id=order.client_id,
        ip_hash=ip_hash(request),
        detail={"order_no": order.order_no, "include_name": body.include_name},
    )
    try:
        await session.commit()
    except BaseException:
        render_service.remove_files(directory, str(sheet_id))
        raise
    return {
        "sheet_id": str(sheet_id),
        "png_url": _link(settings, f"{sheet_id}.png"),
        "pdf_url": _link(settings, f"{sheet_id}.pdf"),
        "share_text": build_share_text(share),
        "generated_at": generated,
    }


@router.get("/files/sheets/{sheet_file}", operation_id="getSheetFile", tags=["sheets"])
async def get_sheet_file(
    request: Request,
    session: Session,
    sheet_file: Annotated[str, PathParam(pattern=SHEET_FILE)],
    exp: Annotated[int, Query()],
    sig: Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")],
) -> Response:
    settings = _settings(request)
    if not signed_urls.valid(settings.signed_url_secret, sheet_file, exp, sig):
        raise ApiError("sheet_link_invalid")
    stem, suffix = sheet_file.rsplit(".", 1)
    sheet = await session.get(SpecSheet, uuid.UUID(stem))
    path = Path(settings.sheets_dir) / sheet_file
    if sheet is None or not path.is_file():
        raise ApiError("not_found")
    # Read whole (a sheet is a few hundred KB). A streamed file response would stop early here,
    # because the middleware has already replayed the request and then reports a disconnect.
    content = await asyncio.to_thread(path.read_bytes)
    return Response(
        content,
        media_type=MEDIA[suffix],
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="sheet-{stem[:8]}.{suffix}"',
        },
    )


@router.post(
    "/sheets/{sheet_id}/shares",
    operation_id="logShare",
    status_code=204,
    tags=["sheets"],
    dependencies=[TAILOR],
)
async def log_share(
    sheet_id: uuid.UUID,
    body: ShareInput,
    principal: CurrentPrincipal,
    request: Request,
    session: Session,
) -> Response:
    sheet = await session.get(SpecSheet, sheet_id)
    if sheet is None:
        raise ApiError("not_found")
    tailor = await tailor_of(session, principal.user)
    order = await session.get(Order, sheet.order_id)
    assert order is not None
    if order.tailor_id != tailor.tailor_id:
        raise ApiError("forbidden")
    session.add(SheetShare(sheet_id=sheet_id, via=body.via, user_id=principal.user.user_id))
    audit.record(
        session,
        actor_type="user",
        user_id=principal.user.user_id,
        action="share",
        entity_type="sheet",
        entity_id=sheet_id,
        client_id=order.client_id,
        ip_hash=ip_hash(request),
        detail={"order_no": order.order_no, "via": body.via},
    )
    await session.commit()
    return Response(status_code=204)
