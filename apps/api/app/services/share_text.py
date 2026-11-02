"""The WhatsApp share text (backend-spec 13).

The labels and the expected texts live in packages/contracts/share-text.json. The mock builds the
same text from the same file (apps/web/mocks/shareText.ts), and both are tested against it.
"""

import json
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

FIXTURE = Path(__file__).resolve().parents[4] / "packages/contracts/share-text.json"
SEP = " · "


@cache
def share_labels() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(FIXTURE.read_text("utf-8"))
    return data


class ShareItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_code: str
    body_mm: int | None
    flag: Literal["pass", "check", "fail"]
    pending_fitting: bool


class ShareInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: Literal["en", "sw"]
    unit: Literal["cm", "in"]
    client_code: str
    name: str | None = Field(default=None, max_length=64)
    profile_version: int
    captured_on: date
    garment_type: str
    due_date: date
    items: list[ShareItem]


def format_length(mm: int, unit: str, locale: str) -> str:
    """Centimetres to one decimal, or inches to the nearest eighth (backend-spec 13)."""
    if unit == "cm":
        return f"{mm // 10}.{mm % 10} cm"
    # Whole millimetres never fall exactly half way between eighths, so plain rounding is safe.
    eighths = (mm * 160 + 254) // 508  # round(mm * 8 / 25.4)
    whole, part = divmod(eighths, 8)
    if part == 0:
        return f"{whole} in"
    numerator, denominator = part, 8
    while numerator % 2 == 0:
        numerator, denominator = numerator // 2, denominator // 2
    fraction = f"{numerator}/{denominator}"
    return f"{fraction} in" if whole == 0 else f"{whole} {fraction} in"


def format_date(day: date, locale: str) -> str:
    months = share_labels()["labels"][locale]["months"]
    return f"{day.day} {months[day.month - 1]} {day.year}"


def build_share_text(data: ShareInput) -> str:
    labels = share_labels()["labels"][data.locale]
    captured = format_date(data.captured_on, data.locale)
    head = [
        labels["brand"],
        f"{labels['client']} {data.client_code}",
        *([data.name] if data.name else []),
        f"{labels['profile']} v{data.profile_version} ({captured})",
        labels["garments"][data.garment_type],
        f"{labels['due']} {format_date(data.due_date, data.locale)}",
    ]
    lines = [SEP.join(head)]
    order = share_labels()["sites"]
    for item in sorted(data.items, key=lambda i: order.index(i.site_code)):
        name = labels["site_names"][item.site_code]
        if item.pending_fitting:
            lines.append(f"{name}: {labels['pending_fitting']}")
        elif item.body_mm is None:
            lines.append(f"{name}: {labels['not_measured']}")
        else:
            mark = labels["pass"] if item.flag == "pass" else labels["check"]
            lines.append(f"{name} {format_length(item.body_mm, data.unit, data.locale)} {mark}")
    lines.append(labels["no_photo"])
    return "\n".join(lines)
