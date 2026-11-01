"""Ease suggestions: history, then the tailor's preset, then the defaults (backend-spec 11.6)."""

import statistics
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EasePreset, Order, OrderItem

HISTORY_MINIMUM = 3
HISTORY_WINDOW = 10
DEFAULTS: dict[str, dict[str, int]] = {
    "shirt": {"shoulder": 10, "chest": 80, "waist": 60, "sleeve": 15, "neck": 15},
    "dress": {"shoulder": 10, "chest": 60, "waist": 40, "hip": 50, "sleeve": 15},
    "trousers": {"waist": 20, "hip": 60, "outleg": 0, "inleg": 0},
    "suit_jacket": {
        "shoulder": 15,
        "chest": 120,
        "waist": 100,
        "hip": 80,
        "sleeve": 15,
        "neck": 15,
    },
    "skirt": {"waist": 20, "hip": 50, "outleg": 0},
    "other": {},
}


def rounded_median(values: list[int]) -> int:
    return 5 * round(statistics.median(values) / 5)


async def suggestions(
    session: AsyncSession, tailor_id: uuid.UUID, garment_type: str
) -> list[dict[str, object]]:
    presets = {
        row.site_code: row.ease_mm
        for row in await session.scalars(
            select(EasePreset).where(
                EasePreset.tailor_id == tailor_id, EasePreset.garment_type == garment_type
            )
        )
    }
    rows = await session.execute(
        select(OrderItem.site_code, OrderItem.ease_mm)
        .join(Order, Order.order_id == OrderItem.order_id)
        .where(Order.tailor_id == tailor_id, Order.garment_type == garment_type)
        .order_by(Order.created_at.desc(), Order.order_id)
    )
    history: dict[str, list[int]] = {}
    for site, ease in rows:
        history.setdefault(site, []).append(ease)
    defaults = DEFAULTS.get(garment_type, {})
    found: list[dict[str, object]] = []
    for site in sorted({*defaults, *presets, *history}):
        past = history.get(site, [])[:HISTORY_WINDOW]
        if len(history.get(site, [])) >= HISTORY_MINIMUM:
            found.append(
                {
                    "site_code": site,
                    "ease_mm": rounded_median(past),
                    "source": "history",
                    "n": len(history[site]),
                }
            )
        elif site in presets:
            found.append({"site_code": site, "ease_mm": presets[site], "source": "preset", "n": 0})
        elif site in defaults:
            found.append(
                {"site_code": site, "ease_mm": defaults[site], "source": "default", "n": 0}
            )
    return found
