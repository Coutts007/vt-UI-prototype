"""The share text equals the shared fixture character for character (backend-spec 13)."""

import json
from pathlib import Path
from typing import Any

import pytest
from app.services.share_text import ShareInput, build_share_text, format_length

FIXTURE = json.loads(
    (Path(__file__).parents[3] / "packages/contracts/share-text.json").read_text("utf-8")
)


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    assert build_share_text(ShareInput.model_validate(case["input"])) == case["expected"]


@pytest.mark.parametrize(
    ("mm", "unit", "text"),
    [
        (0, "cm", "0.0 cm"),
        (985, "cm", "98.5 cm"),
        (1003, "cm", "100.3 cm"),
        (0, "in", "0 in"),
        (3, "in", "1/8 in"),
        (6, "in", "1/4 in"),
        (13, "in", "1/2 in"),
        (254, "in", "10 in"),
        (251, "in", "9 7/8 in"),
        (256, "in", "10 1/8 in"),
        (1016, "in", "40 in"),
        (1013, "in", "39 7/8 in"),
    ],
)
def test_lengths(mm: int, unit: str, text: str) -> None:
    assert format_length(mm, unit, "en") == text


def test_eighths_never_tie() -> None:
    # mm * 8 / 25.4 is never exactly half way for whole millimetres, so the TypeScript and
    # Python rounding rules cannot disagree.
    for mm in range(0, 3000):
        assert (mm * 160) % 508 != 254


def test_long_names_stay_under_the_whatsapp_limit() -> None:
    case = FIXTURE["cases"][0]["input"] | {
        "name": "N" * 64,
        "items": [
            {"site_code": s, "body_mm": 9999, "flag": "check", "pending_fitting": False}
            for s in FIXTURE["sites"]
        ],
    }
    for locale in ("en", "sw"):
        text = build_share_text(ShareInput.model_validate(case | {"locale": locale}))
        assert len(text) <= FIXTURE["max_length"]
