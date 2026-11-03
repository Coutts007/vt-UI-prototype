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


# ---- the fitted reference (backend-spec 11.5.2 and 11.5.3) ----

import math  # noqa: E402

from app.services.profile_checks import mahalanobis, reference_checks, robust_z  # noqa: E402

GROUP = {
    "n": 20,
    "sites": {
        site: {"median": math.log(ratio), "mad": 0.05}
        for site, ratio in {
            "shoulder": 0.25,
            "chest": 0.56,
            "waist": 0.47,
            "hip": 0.59,
            "sleeve": 0.35,
            "outleg": 0.60,
            "inleg": 0.45,
            "neck": 0.22,
        }.items()
    },  # fmt: skip
    "waist_hip": {"median": math.log(0.8), "mad": 0.05},
    "mahalanobis": {
        "sites": ["stature", "waist"],
        "mean": [math.log(1700), math.log(800)],
        # Independent log-sds of 0.05: precision = 1 / 0.0025 on the diagonal.
        "precision": [[400.0, 0.0], [0.0, 400.0]],
        "threshold": 13.816,  # chi-square 0.999 with 2 degrees of freedom
    },
}
ANOMALY = {"z_limit": 3.5, "per_sex": {"female": GROUP}}
TYPICAL = {"stature": 1700, "shoulder": 425, "chest": 952, "waist": 799, "hip": 1003, "sleeve": 595,
           "outleg": 1020, "inleg": 765, "neck": 374}  # fmt: skip


def test_a_typical_body_passes_the_reference() -> None:
    assert reference_checks(TYPICAL, "female", ANOMALY) == []


def test_without_a_group_for_the_sex_the_pooled_one_is_used_or_nothing() -> None:
    assert reference_checks(TYPICAL, "male", ANOMALY) == []  # no male, no pooled: nothing to say
    pooled = {"z_limit": 3.5, "per_sex": {"unspecified": GROUP}}
    assert reference_checks(TYPICAL, "male", pooled) == []
    assert reference_checks({**TYPICAL, "waist": 1300}, "male", pooled)[0]["site_code"] == "waist"


def test_a_large_waist_is_an_unusual_proportion_with_its_z() -> None:
    found = [
        c
        for c in reference_checks({**TYPICAL, "waist": 1000}, "female", ANOMALY)
        if c["kind"] == "unusual_proportion"
    ]
    kinds = {(c["kind"], c["site_code"], c["detail"]["ratio"]) for c in found}
    # waist / stature: log(1000/1700) - log(0.47) = 0.223 -> z 4.46; waist / hip -> z 4.4
    assert ("unusual_proportion", "waist", "waist") in kinds
    assert ("unusual_proportion", "waist", "waist_hip") in kinds
    waist = next(c for c in found if c["detail"]["ratio"] == "waist")
    assert waist["severity"] == "check"
    assert waist["detail"]["z"] == pytest.approx(
        (math.log(1000 / 1700) - math.log(0.47)) / 0.05, abs=0.01
    )


def test_z_exactly_at_the_limit_is_not_flagged() -> None:
    waist = 1700 * 0.47 * math.exp(3.5 * 0.05)
    values = {**TYPICAL, "waist": round(waist), "hip": round(waist / 0.8)}
    found = [
        c for c in reference_checks(values, "female", ANOMALY) if c["kind"] == "unusual_proportion"
    ]
    assert all(abs(c["detail"]["z"]) <= 3.5 + 0.02 for c in found)
    assert not any(c for c in found if abs(c["detail"]["z"]) < 3.5)


def test_an_outlier_profile_names_the_sites_that_drive_it() -> None:
    # Both logs 0.2 away: d2 = 400 * 0.04 * 2 = 32 > 13.8.
    values = {
        **TYPICAL,
        "stature": round(1700 * math.exp(0.2)),
        "waist": round(800 * math.exp(-0.2)),
    }
    values["hip"] = round(values["waist"] / 0.8)
    found = [
        c for c in reference_checks(values, "female", ANOMALY) if c["kind"] == "outlier_profile"
    ]
    assert len(found) == 1
    assert found[0]["severity"] == "info" and found[0]["site_code"] is None
    assert found[0]["detail"]["d2"] == pytest.approx(32, abs=0.5)
    assert found[0]["detail"]["sites"] in ("stature,waist", "waist,stature")


def test_a_missing_site_skips_the_whole_profile_check_but_not_the_ratios() -> None:
    found = reference_checks({**TYPICAL, "stature": None, "waist": 1300}, "female", ANOMALY)
    assert [c["kind"] for c in found] == ["unusual_proportion"]
    assert found[0]["detail"]["ratio"] == "waist_hip"


def test_the_detail_holds_numbers_and_short_strings_only() -> None:
    found = reference_checks({**TYPICAL, "waist": 1300}, "female", ANOMALY)
    for check in found:
        assert len(check["detail"]) <= 16
        for value in check["detail"].values():
            assert value is None or isinstance(value, int | float | str)
            if isinstance(value, str):
                assert len(value) <= 64


def test_the_server_agrees_with_vt_ml_on_the_same_reference() -> None:
    """The API has no numpy; vt_ml does. Both must compute the same z and d2."""
    from vt_ml import anomaly as ml

    for waist in (700, 800, 1000, 1300):
        values = {**TYPICAL, "waist": waist}
        ours = {k: z for k, (z, _) in robust_z(values, GROUP).items()}
        theirs = ml.site_z(values, GROUP)
        assert ours == pytest.approx(theirs)
        d2_ours = mahalanobis(values, GROUP)
        assert d2_ours is not None
        assert d2_ours[0] == pytest.approx(ml.mahalanobis(values, GROUP))
