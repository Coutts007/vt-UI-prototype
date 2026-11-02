"""Specification sheets, signed links, the share log and file cleanup (backend-spec 13, M10)."""

import dataclasses
import io
import json
import os
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from app.config import Settings
from app.models import AuditLog, SheetShare, SpecSheet
from app.security import signed_urls
from app.services import sheets
from app.services.share_text import ShareInput, build_share_text
from app.services.sheet_cleanup import clean_sheets
from fastapi import FastAPI
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from support import bearer, sign_in

API = "/api/v1"
SEED = json.loads((Path(__file__).parents[3] / "packages/seed/seed.json").read_text("utf-8"))
ORDER = next(
    o for o in SEED["orders"] if o["order_no"] == "ORD-0001" and o["client_code"] == "AB1001"
)
OTHER_ORDER = next(o for o in SEED["orders"] if o["client_code"] == "CD2001")


async def tailor(http: AsyncClient, email: str = "wanjiru@vt.test") -> dict[str, str]:
    return bearer(await sign_in(http, email))


async def make_sheet(
    http: AsyncClient, headers: dict[str, str], include_name: bool = False, order: Any = ORDER
) -> Any:
    return await http.post(
        f"{API}/orders/{order['order_id']}/sheets",
        json={"include_name": include_name},
        headers=headers,
    )


def tampered(url: str, **change: str) -> str:
    parts = urlsplit(url)
    query = {k: v[0] for k, v in parse_qs(parts.query).items()} | change
    return f"{parts.path}?exp={query['exp']}&sig={query['sig']}"


async def test_a_tailor_generates_a_sheet_for_an_own_order(
    client: AsyncClient, session: AsyncSession, settings: Settings
) -> None:
    reply = await make_sheet(client, await tailor(client))
    assert reply.status_code == 201, reply.text
    body = reply.json()
    assert set(body) == {"sheet_id", "png_url", "pdf_url", "share_text", "generated_at"}
    assert body["png_url"].startswith(f"{API}/files/sheets/{body['sheet_id']}.png?exp=")
    expected = build_share_text(
        ShareInput.model_validate(
            {
                "locale": "en",
                "unit": "cm",
                "client_code": "AB1001",
                "name": None,
                "profile_version": ORDER["profile_version"],
                "captured_on": next(
                    p["captured_at"][:10]
                    for p in SEED["profiles"]
                    if p["profile_id"] == ORDER["profile_id"]
                ),
                "garment_type": "shirt",
                "due_date": ORDER["due_date"],
                "items": [
                    {
                        "site_code": i["site_code"],
                        "body_mm": i["body_mm"],
                        "flag": i["confidence_flag"],
                        "pending_fitting": False,
                    }
                    for i in ORDER["items"]
                ],
            }
        )
    )
    assert body["share_text"] == expected
    assert ORDER["display_name"] not in body["share_text"]
    assert "http" not in body["share_text"] and "/" not in body["share_text"].split("\n")[0]
    row = await session.get(SpecSheet, uuid.UUID(body["sheet_id"]))
    assert row is not None and not row.include_name
    assert (row.locale, row.unit) == ("en", "cm")
    assert row.expires_at - row.generated_at == timedelta(days=30)
    folder = Path(settings.sheets_dir)
    pdf = (folder / f"{body['sheet_id']}.pdf").read_bytes()
    png = (folder / f"{body['sheet_id']}.png").read_bytes()
    assert sheets.sha256(pdf) == row.pdf_sha256 and sheets.sha256(png) == row.png_sha256
    log = await session.scalar(
        select(AuditLog).where(AuditLog.action == "export", AuditLog.entity_id == body["sheet_id"])
    )
    assert log is not None and log.detail == {"order_no": "ORD-0001", "include_name": False}
    assert log.client_id is not None


async def test_the_name_appears_only_when_asked_and_is_recorded(
    client: AsyncClient, session: AsyncSession
) -> None:
    body = (await make_sheet(client, await tailor(client), include_name=True)).json()
    assert f"AB1001 · {ORDER['display_name']} ·" in body["share_text"]
    log = await session.scalar(
        select(AuditLog).where(AuditLog.action == "export", AuditLog.entity_id == body["sheet_id"])
    )
    assert log is not None and log.detail["include_name"] is True
    assert ORDER["display_name"] not in json.dumps(log.detail)


async def test_signed_links_serve_the_files(client: AsyncClient) -> None:
    body = (await make_sheet(client, await tailor(client))).json()
    png = await client.get(body["png_url"])
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"
    assert png.headers["cache-control"] == "no-store"
    assert Image.open(io.BytesIO(png.content)).size == sheets.PNG_SIZE
    pdf = await client.get(body["pdf_url"])
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    # No sign-in is needed or used: the signature is the check.
    assert "authorization" not in {k.lower() for k in png.request.headers}


@pytest.mark.parametrize("change", ["sig", "exp", "file", "late", "early"])
async def test_a_tampered_or_expired_link_is_refused(
    client: AsyncClient, settings: Settings, change: str
) -> None:
    body = (await make_sheet(client, await tailor(client))).json()
    url = body["png_url"]
    query = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    if change == "sig":
        url = tampered(url, sig=("0" if query["sig"][0] != "0" else "1") + query["sig"][1:])
    elif change == "exp":
        url = tampered(url, exp=str(int(query["exp"]) + 1))
    elif change == "file":
        url = url.replace(".png?", ".pdf?")
    else:
        moment = time.time() - 700 if change == "late" else time.time() + 3600
        expires, signature = signed_urls.sign(
            settings.signed_url_secret, f"{body['sheet_id']}.png", moment
        )
        url = f"{API}/files/sheets/{body['sheet_id']}.png?exp={expires}&sig={signature}"
    reply = await client.get(url)
    assert reply.status_code == 403
    assert reply.json()["code"] == "sheet_link_invalid"


async def test_a_removed_file_answers_404(client: AsyncClient, settings: Settings) -> None:
    body = (await make_sheet(client, await tailor(client))).json()
    (Path(settings.sheets_dir) / f"{body['sheet_id']}.png").unlink()
    assert (await client.get(body["png_url"])).status_code == 404


async def test_another_tailor_cannot_generate_or_log(client: AsyncClient) -> None:
    other = await tailor(client, "otieno@vt.test")
    assert (await make_sheet(client, other)).status_code == 403
    own = (await make_sheet(client, await tailor(client))).json()
    reply = await client.post(
        f"{API}/sheets/{own['sheet_id']}/shares", json={"via": "wa_link"}, headers=other
    )
    assert reply.status_code == 403
    assert (await make_sheet(client, {})).status_code == 401
    admin = bearer(await sign_in(client, "admin@vt.test"))
    assert (await make_sheet(client, admin)).status_code == 403
    missing = await client.post(
        f"{API}/orders/{uuid.uuid4()}/sheets", json={"include_name": False}, headers=other
    )
    assert missing.status_code == 404


async def test_the_share_log_records_how_and_who(
    client: AsyncClient, session: AsyncSession
) -> None:
    headers = await tailor(client)
    body = (await make_sheet(client, headers)).json()
    for via in ("whatsapp_share", "wa_link", "download", "print"):
        reply = await client.post(
            f"{API}/sheets/{body['sheet_id']}/shares", json={"via": via}, headers=headers
        )
        assert reply.status_code == 204, reply.text
    shares = list(
        await session.scalars(
            select(SheetShare).where(SheetShare.sheet_id == uuid.UUID(body["sheet_id"]))
        )
    )
    assert sorted(s.via for s in shares) == ["download", "print", "wa_link", "whatsapp_share"]
    assert all(s.user_id is not None for s in shares)
    logs = list(
        await session.scalars(
            select(AuditLog).where(
                AuditLog.action == "share", AuditLog.entity_id == body["sheet_id"]
            )
        )
    )
    assert sorted(log.detail["via"] for log in logs) == [
        "download",
        "print",
        "wa_link",
        "whatsapp_share",
    ]
    bad = await client.post(
        f"{API}/sheets/{body['sheet_id']}/shares", json={"via": "email"}, headers=headers
    )
    assert bad.status_code == 422
    unknown = await client.post(
        f"{API}/sheets/{uuid.uuid4()}/shares", json={"via": "print"}, headers=headers
    )
    assert unknown.status_code == 404


async def test_sheet_generation_is_rate_limited(app: FastAPI, client: AsyncClient) -> None:
    app.state.settings = app.state.settings.model_copy(update={"sheets_per_tailor_hour": 2})
    headers = await tailor(client)
    assert [(await make_sheet(client, headers)).status_code for _ in range(3)] == [201, 201, 429]


async def test_deleting_an_order_removes_its_files(client: AsyncClient, settings: Settings) -> None:
    headers = await tailor(client)
    body = (await make_sheet(client, headers)).json()
    folder = Path(settings.sheets_dir)
    assert (folder / f"{body['sheet_id']}.pdf").exists()
    reply = await client.delete(f"{API}/orders/{ORDER['order_id']}", headers=headers)
    assert reply.status_code == 204, reply.text
    assert not (folder / f"{body['sheet_id']}.pdf").exists()
    assert not (folder / f"{body['sheet_id']}.png").exists()


async def test_cleanup_removes_old_files_and_orphans_only(
    client: AsyncClient, session: AsyncSession, settings: Settings
) -> None:
    headers = await tailor(client)
    old = (await make_sheet(client, headers)).json()["sheet_id"]
    fresh = (await make_sheet(client, headers)).json()["sheet_id"]
    folder = Path(settings.sheets_dir)
    orphan = folder / f"{uuid.uuid4()}.png"
    orphan.write_bytes(b"x")
    new_orphan = folder / f"{uuid.uuid4()}.pdf"
    new_orphan.write_bytes(b"x")
    two_hours_ago = time.time() - 7200
    os.utime(orphan, (two_hours_ago, two_hours_ago))
    later = datetime.now(UTC) + timedelta(days=30, seconds=5)
    row = await session.get(SpecSheet, uuid.UUID(fresh))
    assert row is not None
    row.expires_at = later + timedelta(days=1)  # so only `old` is past its 30 days at `later`
    await session.commit()
    report = await clean_sheets(session, folder, now=later)
    assert report.expired_files == 2 and report.orphan_files == 1
    assert not (folder / f"{old}.pdf").exists() and not (folder / f"{old}.png").exists()
    assert (folder / f"{fresh}.pdf").exists() and (folder / f"{fresh}.png").exists()
    assert not orphan.exists() and new_orphan.exists()
    assert await session.get(SpecSheet, uuid.UUID(old)) is not None


def sample() -> sheets.SheetData:
    rows = (
        sheets.SheetRow("stature", 1640, "pass"),
        sheets.SheetRow("shoulder", 400, "pass", (), True, 10, 410),
        sheets.SheetRow("chest", 827, "check", ("loose_clothing",), True, 80, 907),
        sheets.SheetRow("waist", 713, "pass", (), True, 60, 773),
        sheets.SheetRow("hip", 919, "pass"),
        sheets.SheetRow("sleeve", 575, "pass", (), True, 15, 590),
        sheets.SheetRow("outleg", 1001, "pass"),
        sheets.SheetRow("inleg", None, "fail", ("crotch_not_found",)),
        sheets.SheetRow("neck", 339, "pass", (), True, 15, None, True),
    )
    return sheets.SheetData(
        locale="en",
        unit="cm",
        client_code="AB1001",
        name=None,
        profile_id="2576ae62-107e-5421-bb55-f45661f18284",
        profile_version=2,
        captured_on=date(2026, 10, 4),
        business_name="Example Tailors",
        garment_type="shirt",
        due_date=date(2026, 11, 16),
        order_no="ORD-0001",
        rows=rows,
        server_checks=("Large change since the last profile: Chest",),
        app_version="0.1.0",
        rules_version="0.1.0",
        model_variant="lite",
        front_checks={"arms": "pass", "light": "check"},
        side_checks={"arms": "pass"},
        scale_disagreement_pct=1.24,
        generated_at=datetime(2026, 11, 2, 8, 0, tzinfo=UTC),
    )


def test_rendering_is_stable_apart_from_the_font_timestamp(monkeypatch: pytest.MonkeyPatch) -> None:
    # Font subsetting stamps the time it ran; with that pinned, the files are byte-identical.
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1793520000")
    first = sheets.render(sample())
    started = time.perf_counter()
    second = sheets.render(sample())
    took = time.perf_counter() - started
    assert first == second
    assert took < 3.0  # spec 1.5 s on the server; CI machines are slower and shared
    assert Image.open(io.BytesIO(first[1])).size == (1240, 1754)


def test_a_sheet_carries_no_picture_of_anyone() -> None:
    html = sheets.render_html(dataclasses.replace(sample(), name="Akinyi"))
    assert "<img" not in html and "data:" not in html and "url(" not in html.split("</head>", 1)[1]
    front = (sheets.TEMPLATES / "silhouette_front.svg").read_text()
    assert front in html  # the same drawing for every client


@pytest.mark.parametrize("locale", ["en", "sw"])
@pytest.mark.parametrize("unit", ["cm", "in"])
def test_labels_and_units_follow_the_tailor(locale: str, unit: str) -> None:
    html = sheets.render_html(dataclasses.replace(sample(), locale=locale, unit=unit))
    labels = json.loads((sheets.TEMPLATES / f"i18n_{locale}.json").read_text("utf-8"))
    assert labels["title"] in html and labels["footer_privacy"] in html
    assert ("82.7 cm" in html) == (unit == "cm")
    assert ("32 1/2 in" in html) == (unit == "in")
    assert "check" in html or "kagua" in html.lower()


def test_both_label_files_have_the_same_keys() -> None:
    en = json.loads((sheets.TEMPLATES / "i18n_en.json").read_text("utf-8"))
    sw = json.loads((sheets.TEMPLATES / "i18n_sw.json").read_text("utf-8"))

    def keys(d: dict[str, Any], prefix: str = "") -> set[str]:
        out = set()
        for k, v in d.items():
            out |= keys(v, f"{prefix}{k}.") if isinstance(v, dict) else {prefix + k}
        return out

    assert keys(en) == keys(sw)


def test_production_needs_its_own_link_secret() -> None:
    with pytest.raises(ValueError, match="own secrets"):
        Settings(  # type: ignore[call-arg]
            env="production",
            jwt_secret="x" * 40,
            ip_pepper="p",
            vt_app_db_password="q",
            _env_file=None,
        )


# Review of PR #13: the renderer reads only its own templates, cleanup touches only sheet files,
# names cannot break the share text, and renders do not share font state.


def test_the_renderer_fetches_only_its_own_template_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret = tmp_path / "secret.css"
    secret.write_text("body { color: red; }")
    asked: list[str] = []
    real = sheets.fetch_resource

    def spy(url: str) -> Any:
        asked.append(url)
        return real(url)

    monkeypatch.setattr(sheets, "fetch_resource", spy)
    html = (
        f'<link rel="stylesheet" href="{secret.as_uri()}">'
        '<link rel="stylesheet" href="http://example.invalid/x.css">'
        '<img src="file:///etc/hostname"><p>x</p>'
    )
    pdf = sheets.write_pdf(html)
    assert pdf.startswith(b"%PDF")
    assert secret.as_uri() in asked and "http://example.invalid/x.css" in asked
    for url in (secret.as_uri(), "http://example.invalid/x.css", "file:///etc/hostname"):
        with pytest.raises(ValueError):
            real(url)
    escape = (sheets.TEMPLATES / "fonts" / ".." / ".." / ".." / "config.py").as_uri()
    with pytest.raises(ValueError):
        real(escape)
    assert real((sheets.TEMPLATES / "sheet.css").as_uri()).status == 200


def test_cleanup_ignores_folders_and_foreign_files(tmp_path: Path) -> None:
    old = time.time() - 7200
    sheet = str(uuid.uuid4())
    stray = tmp_path / f"{sheet}.png"
    part = tmp_path / f".{uuid.uuid4()}.pdf.part"
    folder = tmp_path / str(uuid.uuid4())
    folder.mkdir()
    foreign = tmp_path / "notes.txt"
    lookalike = tmp_path / f"{uuid.uuid4()}.png.bak"
    for path in (stray, part, foreign, lookalike):
        path.write_bytes(b"x")
    for path in (stray, part, folder, foreign, lookalike):
        os.utime(path, (old, old))
    found = sheets.orphan_files(tmp_path, set(), 3600)
    assert sorted(p.name for p in found) == sorted([stray.name, part.name])


@pytest.mark.parametrize("name", ["Ami\nna", "Ami\r\nna", "Ami na", "Ami\tna", " Ami  na\x00"])
def test_control_characters_in_a_name_cannot_add_lines(name: str) -> None:
    data = ShareInput.model_validate(
        {
            "locale": "en",
            "unit": "cm",
            "client_code": "AB1001",
            "name": name,
            "profile_version": 1,
            "captured_on": "2026-10-04",
            "garment_type": "shirt",
            "due_date": "2026-11-16",
            "items": [],
        }
    )
    text = build_share_text(data)
    assert text.split("\n")[0].endswith(
        "· Ami na · Profile v1 (4 Oct 2026) · Shirt · Due 16 Nov 2026"
    )
    assert len(text.split("\n")) == 2
    html = sheets.render_html(dataclasses.replace(sample(), name=name))
    assert ">Ami na<" in html


def test_each_render_has_its_own_font_configuration() -> None:
    assert sheets.font_configuration() is not sheets.font_configuration()
