"""Specification sheets (backend-spec 13): Jinja2 to a PDF with WeasyPrint, page 1 to a PNG.

A sheet carries numbers, labels, a generic outline and a QR code of the profile id. It never
carries a picture of the client: the outlines are static drawings, the same for everyone.
"""

import hashlib
import io
import json
import mimetypes
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import url2pathname

import jinja2
import pypdfium2  # type: ignore[import-untyped]
import segno

from app.services.share_text import clean_name, format_date, format_length, share_labels

TEMPLATES = Path(__file__).resolve().parents[1] / "templates" / "sheet"
DPI = 150
PNG_SIZE = (1240, 1754)
# What the API itself writes: <id>.png, <id>.pdf, and .<id>.<ext>.part while writing.
SHEET_FILE = re.compile(
    r"\.?(?P<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|pdf)(\.part)?"
)
NUMBERED = ("shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck")
_ICON = '<svg width="9pt" height="9pt" viewBox="0 0 10 10">{}</svg>'
_FLAG_ICONS = {
    "pass": _ICON.format(
        '<path d="M1 5.5 L4 8.5 L9 1.5" fill="none" stroke="#000" stroke-width="1.8"/>'
    ),
    "check": _ICON.format('<path d="M5 0.8 L9.6 9.2 L0.4 9.2 Z" fill="#000"/>'),
    "fail": _ICON.format(
        '<path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="#000" stroke-width="1.8"/>'
    ),
}


@dataclass(frozen=True)
class SheetRow:
    site_code: str
    body_mm: int | None
    flag: str
    reasons: tuple[str, ...] = ()
    in_order: bool = False
    ease_mm: int | None = None
    finished_mm: int | None = None
    pending_fitting: bool = False


@dataclass(frozen=True)
class SheetData:
    locale: str
    unit: str
    client_code: str
    name: str | None
    profile_id: str
    profile_version: int
    captured_on: date
    business_name: str
    garment_type: str
    due_date: date
    order_no: str
    rows: tuple[SheetRow, ...]
    server_checks: tuple[str, ...]
    app_version: str
    rules_version: str
    model_variant: str
    front_checks: dict[str, str] = field(default_factory=dict)
    side_checks: dict[str, str] = field(default_factory=dict)
    scale_disagreement_pct: float | None = None
    generated_at: datetime | None = None


@cache
def _labels(locale: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((TEMPLATES / f"i18n_{locale}.json").read_text("utf-8"))
    return data


@cache
def _environment() -> jinja2.Environment:
    return jinja2.Environment(
        loader=jinja2.FileSystemLoader(TEMPLATES), autoescape=True, undefined=jinja2.StrictUndefined
    )


def font_configuration() -> Any:
    """One per render: two renders run at once and WeasyPrint does not promise thread safety."""
    # Imported here, so the API starts (and its contract tests run) without Pango installed.
    from weasyprint.text.fonts import FontConfiguration  # type: ignore[import-untyped]

    return FontConfiguration()


def fetch_resource(url: str) -> Any:
    """Serves the template's own files (CSS, fonts) and refuses every other address.

    The template holds no links of its own beyond these, but a value that slipped into the
    HTML must never make the server read a local file or call out to the network.
    """
    from weasyprint.urls import URLFetcherResponse  # type: ignore[import-untyped]

    parts = urlsplit(url)
    if parts.scheme != "file" or parts.netloc not in ("", "localhost"):
        raise ValueError("Sheets load only their own files")
    path = Path(url2pathname(parts.path)).resolve()
    if not path.is_relative_to(TEMPLATES.resolve()) or not path.is_file():
        raise ValueError("Sheets load only their own files")
    kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return URLFetcherResponse(url, path.read_bytes(), {"Content-Type": kind})


def _fetcher() -> Any:
    from weasyprint.urls import URLFetcher

    class TemplateOnly(URLFetcher):  # type: ignore[misc]
        def fetch(self, url: str, headers: Any = None) -> Any:
            return fetch_resource(url)

    return TemplateOnly()


def write_pdf(html: str) -> bytes:
    from weasyprint import HTML  # type: ignore[import-untyped]

    pdf: bytes = HTML(string=html, base_url=str(TEMPLATES), url_fetcher=_fetcher()).write_pdf(
        font_config=font_configuration(), uncompressed_pdf=False
    )
    return pdf


def _passed(checks: dict[str, str], t: dict[str, Any]) -> str:
    if not checks:
        return str(t["unknown"])
    passed = sum(1 for value in checks.values() if value == "pass")
    return str(t["checks_passed"]).format(passed=passed, total=len(checks))


def _row(
    row: SheetRow, data: SheetData, t: dict[str, Any], names: dict[str, str]
) -> dict[str, Any]:
    def length(mm: int | None) -> str:
        return "–" if mm is None else format_length(mm, data.unit, data.locale)

    note = ""
    if row.site_code == "stature":
        note = t["check_only"]
    elif row.pending_fitting:
        note = t["pending_fitting"]
    elif row.body_mm is None:
        note = t["not_measured"]
    elif not row.in_order:
        note = t["not_in_order"]
    return {
        "number": NUMBERED.index(row.site_code) + 1 if row.site_code in NUMBERED else None,
        "name": names[row.site_code],
        "iso": t["iso"][row.site_code],
        "body": length(row.body_mm),
        "ease": length(row.ease_mm),
        "finished": length(row.finished_mm),
        "note": note,
        "icon": _FLAG_ICONS[row.flag],
        "flag_word": t[f"flag_{row.flag}"],
        "reason": t["reasons"].get(row.reasons[0], "") if row.reasons else "",
    }


def render_html(data: SheetData) -> str:
    t = _labels(data.locale)
    names = share_labels()["labels"][data.locale]["site_names"]
    order = share_labels()["sites"]
    rows = sorted(data.rows, key=lambda r: order.index(r.site_code))
    qr = segno.make(data.profile_id, error="m")
    scale = (
        t["unknown"]
        if data.scale_disagreement_pct is None
        else f"{data.scale_disagreement_pct:.1f}%"
    )
    return (
        _environment()
        .get_template("sheet.html.j2")
        .render(
            t=t,
            locale=data.locale,
            client_code=data.client_code,
            name=clean_name(data.name),
            profile_version=data.profile_version,
            captured_on=format_date(data.captured_on, data.locale),
            business_name=data.business_name,
            garment=share_labels()["labels"][data.locale]["garments"][data.garment_type],
            due_date=format_date(data.due_date, data.locale),
            order_no=data.order_no,
            rows=[_row(r, data, t, names) for r in rows],
            server_checks=list(data.server_checks),
            footer_version=t["footer_version"].format(
                app=data.app_version, rules=data.rules_version, model=data.model_variant
            ),
            footer_checks=t["footer_checks"].format(
                front=_passed(data.front_checks, t), side=_passed(data.side_checks, t), scale=scale
            ),
            front_svg=(TEMPLATES / "silhouette_front.svg").read_text("utf-8"),
            side_svg=(TEMPLATES / "silhouette_side.svg").read_text("utf-8"),
            qr_svg=qr.svg_inline(scale=4, border=0),
            generated_at=(data.generated_at or datetime(1970, 1, 1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
    )


def render(data: SheetData) -> tuple[bytes, bytes]:
    """The PDF and the 150 dpi PNG of its first page."""
    pdf = write_pdf(render_html(data))
    document = pypdfium2.PdfDocument(pdf)
    try:
        bitmap = document[0].render(scale=DPI / 72)
        # A4 at 150 dpi is 1240.2 px wide; the spec's size is 1240 x 1754.
        image = bitmap.to_pil().crop((0, 0, PNG_SIZE[0], PNG_SIZE[1]))
        out = io.BytesIO()
        image.save(out, format="PNG", optimize=True)
    finally:
        document.close()
    return pdf, out.getvalue()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def store(directory: Path, sheet_id: str, pdf: bytes, png: bytes) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for suffix, content in (("pdf", pdf), ("png", png)):
        final = directory / f"{sheet_id}.{suffix}"
        partial = directory / f".{sheet_id}.{suffix}.part"
        partial.write_bytes(content)
        partial.replace(final)


def remove_files(directory: Path, sheet_id: str) -> int:
    removed = 0
    for suffix in ("pdf", "png"):
        path = directory / f"{sheet_id}.{suffix}"
        if path.exists():
            path.unlink()
            removed += 1
    return removed


def orphan_files(directory: Path, known: set[str], older_than_s: float) -> list[Path]:
    """Files no sheet row names, such as a render whose transaction was rolled back."""
    if not directory.exists():
        return []
    limit = time.time() - older_than_s
    out = []
    for path in directory.iterdir():
        match = SHEET_FILE.fullmatch(path.name)
        if not match or not path.is_file() or path.is_symlink():
            continue
        if match["id"] not in known and path.stat().st_mtime < limit:
            out.append(path)
    return out
