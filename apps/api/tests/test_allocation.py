"""Cohort allocation: deterministic, balanced by sex, and in the planned proportions."""

from collections import Counter

from app.services.allocation import BLOCK, cohort_for


def test_the_same_seed_gives_the_same_cohorts() -> None:
    first = [cohort_for(7, "female", i) for i in range(40)]
    assert first == [cohort_for(7, "female", i) for i in range(40)]


def test_another_seed_gives_another_order() -> None:
    assert [cohort_for(7, "male", i) for i in range(40)] != [
        cohort_for(8, "male", i) for i in range(40)
    ]


def test_each_block_of_eight_holds_the_planned_mix() -> None:
    for sex in ("female", "male", "unspecified"):
        for block in range(5):
            mix = Counter(cohort_for(11, sex, block * 8 + i) for i in range(8))
            assert mix == Counter(BLOCK)


def test_each_sex_is_balanced_on_its_own() -> None:
    women = Counter(cohort_for(3, "female", i) for i in range(48))
    men = Counter(cohort_for(3, "male", i) for i in range(48))
    assert women == men == {"pilot": 6, "calibration": 12, "test": 30}


def test_a_hundred_people_come_close_to_the_study_plan() -> None:
    people = [cohort_for(2026, "female", i) for i in range(50)]
    people += [cohort_for(2026, "male", i) for i in range(50)]
    counts = Counter(people)
    assert 10 <= counts["pilot"] <= 15
    assert 23 <= counts["calibration"] <= 27
    assert counts["pilot"] + counts["calibration"] + counts["test"] == 100
