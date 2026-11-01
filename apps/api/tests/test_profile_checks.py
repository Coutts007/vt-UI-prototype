"""The pure server checks (backend-spec 9.5, 11.5). Written before the code."""

from typing import Any

import pytest
from app.services.profile_checks import change_since_last, height_mismatch, static_bounds

BOUNDS = {
    "inleg_stature": [0.38, 0.52],
    "sleeve_stature": [0.3, 0.4],
    "waist_hip": [0.6, 1.2],
    "chest_stature": [0.45, 0.85],
}
GOOD = {"stature": 1700, "inleg": 750, "sleeve": 600, "waist": 800, "hip": 1000, "chest": 950}


def sites(checks: list[dict[str, Any]]) -> list[str | None]:
    return [c["site_code"] for c in checks]


def test_a_good_body_has_no_unusual_proportions() -> None:
    assert static_bounds(GOOD, BOUNDS) == []


@pytest.mark.parametrize(
    ("change", "site"),
    [
        ({"inleg": 500}, "inleg"),
        ({"inleg": 900}, "inleg"),
        ({"sleeve": 500}, "sleeve"),
        ({"sleeve": 700}, "sleeve"),
        ({"waist": 500}, "waist"),
        ({"waist": 1300}, "waist"),
        ({"chest": 700}, "chest"),
        ({"chest": 1500}, "chest"),
    ],
)
def test_each_bound(change: dict[str, int], site: str) -> None:
    found = static_bounds({**GOOD, **change}, BOUNDS)
    assert sites(found) == [site]
    assert found[0]["kind"] == "unusual_proportion" and found[0]["severity"] == "check"
    assert found[0]["detail"]["low"] < found[0]["detail"]["high"]


def test_exactly_on_a_bound_is_fine() -> None:
    assert static_bounds({**GOOD, "inleg": 646}, BOUNDS) == []  # 0.38 of 1700


def test_a_failed_site_has_no_ratio() -> None:
    assert static_bounds({**GOOD, "stature": None, "waist": None}, BOUNDS) == []


def test_no_bounds_no_checks() -> None:
    assert static_bounds(GOOD, {}) == []


BEFORE = {"stature": 1700, "chest": 1000, "hip": 1000, "waist": 800, "neck": 400, "sleeve": 600}


def test_girth_changes_over_5_percent() -> None:
    assert sites(change_since_last({**BEFORE, "chest": 1051}, BEFORE)) == ["chest"]
    assert change_since_last({**BEFORE, "chest": 1050}, BEFORE) == []


def test_length_changes_over_2_percent() -> None:
    assert sites(change_since_last({**BEFORE, "stature": 1735}, BEFORE)) == ["stature"]
    assert change_since_last({**BEFORE, "stature": 1734}, BEFORE) == []


def test_change_counts_both_directions_and_skips_nulls() -> None:
    assert sites(change_since_last({**BEFORE, "hip": 900}, BEFORE)) == ["hip"]
    assert change_since_last({**BEFORE, "hip": None}, BEFORE) == []


def test_change_is_informational() -> None:
    found = change_since_last({**BEFORE, "hip": 900}, BEFORE)
    assert found[0]["kind"] == "change_since_last" and found[0]["severity"] == "info"


def test_height_mismatch_over_3_percent() -> None:
    assert height_mismatch(1752, 1700)[0]["kind"] == "height_mismatch"
    assert height_mismatch(1751, 1700) == []
    assert height_mismatch(1648, 1700)[0]["severity"] == "check"


def test_height_needs_both_numbers() -> None:
    assert height_mismatch(None, 1700) == [] and height_mismatch(1700, None) == []
