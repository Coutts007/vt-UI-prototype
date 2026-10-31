import json
from dataclasses import replace
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from vt_measure.derive import derive, ellipse_perimeter
from vt_measure.synthetic import Body, make_input

RULES = json.loads(
    (Path(__file__).parents[3] / "rules" / "rules-0.1-uncalibrated.json").read_text()
)
half = st.floats(min_value=15, max_value=400, allow_nan=False)
LENGTHS = ("stature", "shoulder", "sleeve", "outleg", "inleg")


@given(half, half, st.floats(min_value=0, max_value=50))
def test_larger_half_width_never_gives_a_smaller_girth(a, b, extra):
    assert ellipse_perimeter(a + extra, b) >= ellipse_perimeter(a, b) - 1e-9


@given(half, half)
def test_perimeter_is_symmetric(a, b):
    assert ellipse_perimeter(a, b) == pytest.approx(ellipse_perimeter(b, a))


@given(half, half, st.floats(min_value=0.1, max_value=2))
def test_perimeter_scales_linearly(a, b, k):
    assert ellipse_perimeter(a * k, b * k) == pytest.approx(k * ellipse_perimeter(a, b))


@settings(max_examples=40)
@given(st.floats(min_value=0.8, max_value=1.25))
def test_lengths_scale_with_the_marker(k):
    data = make_input(Body())
    base = derive(data, RULES)
    for name in ("marker_front", "marker_side"):
        centre = data[name]["corners"][0]
        data[name]["corners"] = [
            [centre[0] + (x - centre[0]) / k, centre[1] + (y - centre[1]) / k]
            for x, y in data[name]["corners"]
        ]
    scaled = derive(data, RULES)
    assert scaled.scale_front == pytest.approx(base.scale_front * k, rel=1e-6)
    for code in LENGTHS:
        assert scaled.sites[code].raw_mm == pytest.approx(base.sites[code].raw_mm * k, rel=1e-4)


@settings(max_examples=40)
@given(st.integers(min_value=-90, max_value=90), st.integers(min_value=-90, max_value=90))
def test_moving_the_person_in_the_frame_changes_nothing(dx, dy):
    base = derive(make_input(Body()), RULES)
    moved = derive(make_input(Body(), offset=(dx, dy)), RULES)
    for code, row in base.sites.items():
        assert moved.sites[code].raw_mm == pytest.approx(row.raw_mm, abs=0.1), code
        assert moved.sites[code].flag == row.flag


@settings(max_examples=40)
@given(st.floats(min_value=120, max_value=190), st.floats(min_value=1, max_value=20))
def test_wider_waist_gives_a_larger_waist(a, extra):
    small = derive(make_input(replace(Body(), waist_a=a)), RULES).sites["waist"]
    large = derive(make_input(replace(Body(), waist_a=a + extra)), RULES).sites["waist"]
    assert large.raw_mm > small.raw_mm
