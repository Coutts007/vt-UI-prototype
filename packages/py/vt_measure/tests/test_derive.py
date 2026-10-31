"""Hand-checkable tests, written before the code."""

import copy
import json
import math
from pathlib import Path

import pytest
from vt_measure.derive import (
    derive,
    ellipse_perimeter,
    identify_free_arm,
    marker_scale,
    round_half_even,
    sample_profile,
)
from vt_measure.synthetic import Body, asymmetric_input, expected_values, make_input

RULES = json.loads(
    (Path(__file__).parents[3] / "rules" / "rules-0.1-uncalibrated.json").read_text()
)
BODY = Body()
GIRTHS = {"chest", "waist", "hip", "neck"}
ALL = {"stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck"}


def site(result, code):
    return result.sites[code]


def rules_with(path, value):
    rules = copy.deepcopy(RULES)
    target = rules
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return rules


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(100, 100, 2 * math.pi * 100), (150, 100, 793.27), (200, 100, 968.84), (130, 100, 725.64)],
)
def test_ellipse_perimeter(a, b, expected):
    assert ellipse_perimeter(a, b) == pytest.approx(expected, abs=0.1)


def test_round_half_even():
    assert [round_half_even(v) for v in (0.5, 1.5, 2.5, 803.5, 804.5)] == [0, 2, 2, 804, 804]


def test_sample_profile_interpolates_linearly():
    profile = [float(i) for i in range(101)]
    assert sample_profile(profile, 0.255) == pytest.approx(25.5)
    assert sample_profile(profile, 0.25) == pytest.approx(25.0)


def test_sample_profile_null_neighbour_or_outside_is_undefined():
    profile = [float(i) for i in range(101)]
    profile[26] = None
    assert sample_profile(profile, 0.255) is None
    assert sample_profile(profile, 0.26) is None
    assert sample_profile(profile, 0.25) == pytest.approx(25.0)
    assert sample_profile(profile, -0.01) is None
    assert sample_profile(profile, 1.01) is None


def square(side, x=100.0, y=100.0):
    return [[x, y], [x + side, y], [x + side, y + side], [x, y + side]]


def marker(corners, w=1080, h=1920):
    return {"corners": corners, "image_w": w, "image_h": h, "side_px": 0, "confidence": 0.95}


def test_marker_scale_is_side_over_mean_length():
    # 150 mm across 150 px is exactly 1 mm per pixel.
    assert marker_scale(marker(square(150)), 1080, RULES) == pytest.approx(1.0)
    assert marker_scale(marker(square(100)), 1080, RULES) == pytest.approx(1.5)


def test_marker_scale_converts_a_larger_scale_image_to_mask_pixels():
    # The marker image has twice the mask's resolution, so one mask pixel covers twice the mm.
    assert marker_scale(marker(square(150), 2160, 3840), 1080, RULES) == pytest.approx(2.0)


def test_marker_aspect_limit_is_inclusive():
    def rectangle(long_side):
        return marker([[0, 0], [long_side, 0], [long_side, 100], [0, 100]])

    assert marker_scale(rectangle(103), 1080, RULES) is not None
    assert marker_scale(rectangle(103.1), 1080, RULES) is None


def test_marker_missing_or_degenerate_fails():
    assert marker_scale(None, 1080, RULES) is None
    assert marker_scale(marker(square(150)[:3]), 1080, RULES) is None
    assert marker_scale(marker(square(0)), 1080, RULES) is None


def test_depth_correction_defaults_to_nothing_and_scales_when_set():
    rules = rules_with(["scale", "depth_correction_mm", "front"], 225)
    # 225 / 2250 = 10% more millimetres per pixel.
    assert derive(make_input(BODY), rules).scale_front == pytest.approx(
        derive(make_input(BODY), RULES).scale_front * 1.1
    )
    assert derive(make_input(BODY), rules).scale_side == pytest.approx(
        derive(make_input(BODY), RULES).scale_side
    )


def test_synthetic_body_recovers_every_known_value():
    result = derive(make_input(BODY), RULES)
    for code, value in expected_values(BODY).items():
        assert site(result, code).raw_mm == pytest.approx(value, abs=0.1), code
        assert site(result, code).flag == "pass", code
        assert site(result, code).reasons == []


def test_values_are_rounded_only_at_the_end():
    row = site(derive(make_input(BODY), RULES), "waist")
    assert row.value_mm == round_half_even(row.raw_mm)
    assert isinstance(row.value_mm, int)


def test_girth_reports_its_working():
    row = site(derive(make_input(BODY), RULES), "waist")
    assert row.a_mm == pytest.approx(BODY.waist_a)
    assert row.b_mm == pytest.approx(BODY.waist_b)
    assert row.level_fraction == 0.6
    assert row.correction_factor == 1.0
    assert row.perimeter_mm == pytest.approx(ellipse_perimeter(BODY.waist_a, BODY.waist_b))


def test_correction_factor_multiplies_the_girth():
    rules = rules_with(["girth_model", "correction_factors", "waist"], 1.1)
    base = site(derive(make_input(BODY), RULES), "waist").raw_mm
    assert site(derive(make_input(BODY), rules), "waist").raw_mm == pytest.approx(base * 1.1)


def test_offsets_add_to_lengths():
    for path, code, change in (
        (["offsets_mm", "sleeve"], "sleeve", 7),
        (["offsets_mm", "outleg"], "outleg", 7),
        (["offsets_mm", "inleg"], "inleg", 7),
        (["offsets_mm", "shoulder"], "shoulder", 7),
        (["offsets_mm", "acromion"], "shoulder", 14),
    ):
        base = site(derive(make_input(BODY), RULES), code).raw_mm
        changed = site(derive(make_input(BODY), rules_with(path, 7)), code).raw_mm
        assert changed - base == pytest.approx(change), path


def test_level_moves_between_views_by_span_fraction():
    # The side view stands lower in the frame, yet the same fraction finds the same body level.
    data = make_input(BODY, side_shift_px=40)
    row = site(derive(data, RULES), "waist")
    assert row.a_mm == pytest.approx(BODY.waist_a)
    assert row.b_mm == pytest.approx(BODY.waist_b, abs=0.5)


def test_side_view_uses_near_side_landmarks_with_higher_visibility():
    data = make_input(BODY)
    for i in (12, 24, 26):
        data["landmarks_side"][i]["visibility"] = 0.55
    assert derive(data, RULES).sites["waist"].flag == "pass"


def test_missing_crotch_fails_inleg_only():
    result = derive(make_input(BODY, crotch=False), RULES)
    assert site(result, "inleg").value_mm is None
    assert site(result, "inleg").flag == "fail"
    assert site(result, "inleg").reasons == ["crotch_not_found"]
    assert all(site(result, c).flag == "pass" for c in ALL - {"inleg"})


@pytest.mark.parametrize(
    ("height", "girth_flag", "length_flag"),
    [(1530, "pass", "pass"), (1560, "check", "pass"), (1561, "check", "check")],
)
def test_scale_disagreement_limits(height, girth_flag, length_flag):
    """Above 2% the girths and stature get check, and above 4% every site does."""
    body = Body(stature=1500.0)
    result = derive(make_input(body, height_mm=height), RULES)
    assert result.disagreement_pct == pytest.approx((height - 1500) / 15, abs=1e-6)
    assert site(result, "waist").flag == girth_flag
    assert site(result, "stature").flag == girth_flag
    assert site(result, "sleeve").flag == length_flag


def test_visibility_limits():
    def flag(value):
        data = make_input(BODY)
        data["landmarks_front"][11]["visibility"] = value
        return site(derive(data, RULES), "shoulder")

    assert flag(0.49).flag == "fail"
    assert flag(0.49).value_mm is None
    assert flag(0.49).reasons == ["landmark_low"]
    assert flag(0.5).flag == "check"
    assert flag(0.69).flag == "check"
    assert flag(0.7).flag == "pass"


def test_low_visibility_on_one_landmark_only_touches_sites_that_use_it():
    data = make_input(BODY)
    data["landmarks_front"][27]["visibility"] = 0.2
    result = derive(data, RULES)
    assert site(result, "inleg").flag == "fail"
    assert site(result, "waist").flag == "pass"


def test_weak_marker_flags_sites_using_that_view():
    result = derive(make_input(BODY, side_marker_confidence=0.79), RULES)
    assert site(result, "waist").reasons == ["marker_weak"]
    assert site(result, "outleg").reasons == ["marker_weak"]
    assert site(result, "sleeve").flag == "pass"
    good = derive(make_input(BODY, side_marker_confidence=0.8), RULES)
    assert site(good, "waist").flag == "pass"


def test_failed_side_view_fails_only_sites_needing_it():
    data = make_input(BODY)
    data["marker_side"] = None
    result = derive(data, RULES)
    for code in ("chest", "waist", "hip", "neck", "outleg"):
        assert site(result, code).value_mm is None
        assert site(result, code).reasons == ["view_failed"]
    for code in ("stature", "shoulder", "sleeve", "inleg"):
        assert site(result, code).flag == "pass"


def test_failed_front_view_fails_its_sites():
    data = make_input(BODY)
    data["silhouette_front"] = None
    result = derive(data, RULES)
    assert site(result, "stature").reasons == ["view_failed"]
    assert site(result, "outleg").flag == "pass"
    assert result.disagreement_pct is None


def test_flat_mask_fails_the_view():
    data = make_input(BODY)
    data["silhouette_side"]["mask_bottom_px"] = data["silhouette_side"]["mask_top_px"]
    assert site(derive(data, RULES), "outleg").reasons == ["view_failed"]


def test_gap_in_the_outline_fails_that_girth():
    data = make_input(BODY)
    data["silhouette_front"]["half_width_mm"][38] = None
    row = site(derive(data, RULES), "waist")
    assert row.value_mm is None and row.reasons == ["mask_gap"]


def test_half_width_below_15_mm_fails():
    data = make_input(BODY)
    data["silhouette_front"]["half_width_mm"][14] = 14.9
    data["silhouette_front"]["half_width_mm"][15] = 14.9
    assert site(derive(data, RULES), "neck").reasons == ["mask_gap"]


def test_hip_with_no_depth_in_its_band_fails():
    data = make_input(BODY)
    data["silhouette_side"]["half_depth_mm"] = [None] * 101
    data["marker_side"] = make_input(BODY)["marker_side"]
    assert site(derive(data, RULES), "hip").reasons == ["mask_gap"]


def test_out_of_range_value_is_null():
    rules = rules_with(["plausible_mm", "waist"], [450, 500])
    row = site(derive(make_input(BODY), rules), "waist")
    assert row.value_mm is None and row.reasons == ["out_of_range"]


def test_plausible_limits_are_inclusive():
    raw = site(derive(make_input(BODY), RULES), "waist").raw_mm
    rules = rules_with(["plausible_mm", "waist"], [raw, raw])
    assert site(derive(make_input(BODY), rules), "waist").flag == "pass"


def test_level_unchecked_flags_every_site():
    result = derive(make_input(BODY, level_unchecked=True), RULES)
    assert all(site(result, c).reasons == ["level_unchecked"] for c in ALL)


def test_loose_clothing_flags_torso_girths_only():
    result = derive(make_input(BODY, clothing_fit="loose"), RULES)
    assert {c for c in ALL if site(result, c).flag == "check"} == {"chest", "waist", "hip"}


def test_waist_narrowest_point_is_a_check_only():
    data = make_input(BODY)
    # Make the narrowest point sit near fraction 0.5, far from the 0.6 used.
    data["silhouette_front"]["half_width_mm"][35] = 60.0
    row = site(derive(data, RULES), "waist")
    assert row.flag == "check" and row.reasons == ["waist_level_mismatch"]
    assert row.level_fraction == 0.6
    assert row.value_mm is not None


def test_chest_level_check_is_for_women_only():
    def result(sex):
        data = make_input(Body(sex=sex))
        data["silhouette_side"]["anterior_mm"][30] = 390.0
        return site(derive(data, RULES), "chest")

    assert result("female").reasons == ["chest_level_mismatch"]
    assert result("male").flag == "pass"


def test_reasons_keep_one_fixed_order():
    result = derive(make_input(BODY, clothing_fit="loose", level_unchecked=True), RULES)
    assert site(result, "waist").reasons == ["level_unchecked", "loose_clothing"]


def test_a14_sleeve_uses_the_free_arm():
    left = site(derive(make_input(BODY, free_arm="left"), RULES), "sleeve").raw_mm
    right = site(derive(make_input(BODY, free_arm="right"), RULES), "sleeve").raw_mm
    assert left == pytest.approx(right, abs=0.1)
    assert left == pytest.approx(BODY.upper_arm + BODY.forearm, abs=0.1)


def test_a14_low_visibility_on_the_holding_arm_does_not_matter():
    data = make_input(BODY, free_arm="right")
    for i in (13, 15):
        data["landmarks_front"][i]["visibility"] = 0.1
    assert site(derive(data, RULES), "sleeve").flag == "pass"


def test_a14_unknown_free_arm_uses_the_clearer_arm_and_warns():
    data = make_input(BODY, free_arm="right")
    data["session"]["free_arm"] = None
    for i in (13, 15):
        data["landmarks_front"][i]["visibility"] = 0.6
    result = derive(data, RULES)
    assert site(result, "sleeve").raw_mm == pytest.approx(BODY.upper_arm + BODY.forearm, abs=0.1)
    for code in ("sleeve", "chest", "waist"):
        assert site(result, code).reasons == ["free_arm_unknown"], code
    assert site(result, "hip").flag == "pass"


def test_identify_free_arm_picks_the_wrist_farther_from_the_marker():
    for arm in ("left", "right"):
        data = make_input(BODY, free_arm=arm)
        assert identify_free_arm(data["landmarks_front"], data["marker_front"], RULES) == arm


def test_identify_free_arm_gives_none_when_too_close_to_call():
    data = make_input(BODY)
    landmarks = data["landmarks_front"]
    centre_x = sum(c[0] for c in data["marker_front"]["corners"]) / 4 / 1080
    landmarks[15]["x"] = centre_x + 0.1
    landmarks[16]["x"] = centre_x - 0.1
    landmarks[15]["y"] = landmarks[16]["y"]
    assert identify_free_arm(landmarks, data["marker_front"], RULES) is None


def test_identify_free_arm_with_a_wrist_on_the_marker():
    data = make_input(BODY, free_arm="right")
    corners = data["marker_front"]["corners"]
    data["landmarks_front"][15]["x"] = sum(c[0] for c in corners) / 4 / 1080
    data["landmarks_front"][15]["y"] = sum(c[1] for c in corners) / 4 / 1920
    assert identify_free_arm(data["landmarks_front"], data["marker_front"], RULES) == "right"


def test_identify_free_arm_without_a_marker():
    assert identify_free_arm(make_input(BODY)["landmarks_front"], None, RULES) is None


def test_ridge_model_is_refused_until_it_exists():
    rules = rules_with(["girth_model", "type"], "ridge")
    with pytest.raises(NotImplementedError):
        derive(make_input(BODY), rules)


def test_derive_does_not_change_its_input():
    data = make_input(BODY)
    before = copy.deepcopy(data)
    derive(data, RULES)
    assert data == before


def test_waist_level_moves_between_views_worked_by_hand():
    # Front: y = 300 + 0.6 x 800 = 780, u = 680 / 1600 = 0.425, half-width = 100 + 42.5.
    # Side: y = 400 + 0.6 x 600 = 760, u = 560 / 1600 = 0.35, half-depth = 50 + 35.
    row = site(derive(asymmetric_input(), RULES), "waist")
    assert row.a_mm == pytest.approx(142.5)
    assert row.b_mm == pytest.approx(85.0)
    assert row.raw_mm == pytest.approx(ellipse_perimeter(142.5, 85.0))


def test_other_levels_worked_by_hand():
    result = derive(asymmetric_input(), RULES)
    # Chest 0.25: front y 500, u 0.25. Side y 550, u 0.21875.
    assert (site(result, "chest").a_mm, site(result, "chest").b_mm) == (
        pytest.approx(125.0),
        pytest.approx(71.875),
    )
    # Neck 0.1 above the shoulder: front y 220, u 0.075. Side y 340, u 0.0875.
    assert (site(result, "neck").a_mm, site(result, "neck").b_mm) == (
        pytest.approx(107.5),
        pytest.approx(58.75),
    )
    # Hip: depth grows downward, so the band's end wins, g = 0.25.
    # Side y 1100, u 0.5625. Front y 1200, u 0.6875.
    assert (site(result, "hip").a_mm, site(result, "hip").b_mm) == (
        pytest.approx(168.75),
        pytest.approx(106.25),
    )
    assert site(result, "hip").level_fraction == pytest.approx(0.25)


def test_lengths_worked_by_hand():
    result = derive(asymmetric_input(), RULES)
    assert site(result, "stature").raw_mm == pytest.approx(1600)
    assert site(result, "shoulder").raw_mm == pytest.approx(400)
    assert site(result, "sleeve").raw_mm == pytest.approx(math.sqrt(100000) + 300)
    assert site(result, "outleg").raw_mm == pytest.approx(1040)  # 1800 - 760
    assert site(result, "inleg").raw_mm == pytest.approx(800)  # 1700 - 900


def test_rules_really_choose_the_levels():
    waist = site(derive(asymmetric_input(), rules_with(["levels", "waist"], 0.5)), "waist")
    # Front y 700, u 0.375. Side y 700, u 0.3125.
    assert (waist.a_mm, waist.b_mm) == (pytest.approx(137.5), pytest.approx(81.25))
    chest_rules = rules_with(["levels", "chest", "male"], 0.5)
    chest = site(derive(asymmetric_input(), chest_rules), "chest")
    # Front y 700, u 0.375. Side y 700, u 0.3125.
    assert (chest.a_mm, chest.b_mm) == (pytest.approx(137.5), pytest.approx(81.25))
    hip = site(
        derive(asymmetric_input(), rules_with(["levels", "hip_band_knee_fraction"], 0.5)), "hip"
    )
    # g = 0.5: side y 1200, u 0.625. Front y 1300, u 0.75.
    assert (hip.a_mm, hip.b_mm) == (pytest.approx(175.0), pytest.approx(112.5))


def test_side_view_really_uses_the_clearer_side():
    data = asymmetric_input()
    for i, value in ((12, 0.55), (24, 0.55), (26, 0.55), (11, 0.95), (23, 0.95), (25, 0.95)):
        data["landmarks_side"][i]["visibility"] = value
    # Left side: y = 500 + 0.6 x 800 = 980, u = 780 / 1600 = 0.4875.
    assert site(derive(data, RULES), "waist").b_mm == pytest.approx(98.75)


def test_waist_tolerance_exactly_on_the_limit_is_allowed():
    def result(samples):
        data = asymmetric_input()
        for index in samples:
            data["silhouette_front"]["half_width_mm"][index] = 50.0
        return site(derive(data, RULES), "waist").reasons

    # Fraction 0.55 is y 740, u 0.4 exactly, 0.05 from the level used.
    assert result([40]) == []
    # Adding sample 39 makes 0.54 the narrowest, which is too far.
    assert result([39, 40]) == ["waist_level_mismatch"]


@pytest.mark.parametrize("hip_y", [300.0, 250.0])
def test_hip_at_or_above_the_shoulder_fails_the_view(hip_y):
    data = asymmetric_input()
    for i in (23, 24):
        data["landmarks_front"][i]["y"] = hip_y / 2000
    result = derive(data, RULES)
    assert site(result, "chest").reasons == ["view_failed"]
    assert site(result, "outleg").flag == "pass"


def test_knee_above_hip_fails_only_the_hip():
    data = asymmetric_input()
    data["landmarks_side"][26]["y"] = 900 / 2000
    result = derive(data, RULES)
    assert site(result, "hip").reasons == ["mask_gap"]
    assert site(result, "waist").value_mm is not None


def test_empty_or_reversed_band_tests_one_point_without_crashing():
    for band in ([0.6, 0.6], [0.7, 0.5]):
        rules = rules_with(["levels", "waist_check_band"], band)
        assert site(derive(asymmetric_input(), rules), "waist").value_mm is not None
    rules = rules_with(["levels", "hip_band_knee_fraction"], 0)
    assert site(derive(asymmetric_input(), rules), "hip").level_fraction == 0


def test_aspect_exactly_on_the_limit_passes_despite_float_noise():
    x, y = 12.3, 45.6
    corners = [[x, y], [x + 103, y], [x + 103, y + 100], [x, y + 100]]
    assert marker_scale(marker(corners), 1080, RULES) is not None


def test_arm_choice_uses_plain_addition():
    """Python's sum() calls this a tie, but plain addition, as in JavaScript, does not."""
    data = make_input(Body(), free_arm="right")
    data["session"]["free_arm"] = None
    for i, value in zip(
        (11, 13, 15, 12, 14, 16), (0.83, 0.75, 0.95, 0.95, 0.75, 0.83), strict=True
    ):
        data["landmarks_front"][i]["visibility"] = value
    left = 0.83 + 0.75 + 0.95
    right = 0.95 + 0.75 + 0.83
    assert left != right
    picked = derive(data, RULES).sites["sleeve"].raw_mm
    data["session"]["free_arm"] = "left" if left > right else "right"
    assert derive(data, RULES).sites["sleeve"].raw_mm == picked
