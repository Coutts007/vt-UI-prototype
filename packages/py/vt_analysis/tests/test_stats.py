"""Each statistic against a worked example (backend-spec 12.3) and the verdicts at their edges."""

import math

import numpy as np
import pytest
from vt_analysis import stats
from vt_analysis.verdicts import tier_1, tier_2, tier_3

# Shrout and Fleiss (1979), Table 2: six targets rated by four judges.
SHROUT_FLEISS = np.array([
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
])  # fmt: skip


def test_icc_2_1_matches_shrout_and_fleiss():
    out = stats.icc_2_1(SHROUT_FLEISS)
    assert out["icc"] == pytest.approx(0.29, abs=0.005)
    # The McGraw and Wong (1996) interval, as psych::ICC prints it for these data.
    assert out["lower"] == pytest.approx(0.019, abs=0.001)
    assert out["upper"] == pytest.approx(0.761, abs=0.001)


def test_icc_is_one_for_identical_raters_and_falls_with_a_constant_offset():
    x = np.array([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]])
    assert stats.icc_2_1(x)["icc"] == pytest.approx(1.0)
    shifted = x.copy()
    shifted[:, 1] += 1.0  # absolute agreement is penalised by a constant offset
    assert stats.icc_2_1(shifted)["icc"] < 1.0


def test_lins_ccc_by_hand():
    # x = 1..5, y = x + 1: r = 1, s_x^2 = s_y^2 = 2, offset 1 -> ccc = 2*2 / (2 + 2 + 1) = 0.8.
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    out = stats.lins_ccc(x, x + 1)
    assert out["ccc"] == pytest.approx(0.8)
    assert stats.lins_ccc(x, x)["ccc"] == pytest.approx(1.0)
    # A perfect scale error of 2: s_y^2 = 8, s_xy = 4, means 3 and 6 -> 8 / (2 + 8 + 9) = 0.421.
    assert stats.lins_ccc(x, 2 * x)["ccc"] == pytest.approx(8 / 19)
    assert out["lower"] <= out["ccc"] <= out["upper"]
    # Lin's variance by hand for y = x + 1: r = 1 so the first term is 0, u = 1 / sqrt(2),
    # ccc = 0.8: se^2 = (2 * 0.512 * 0.2 * 0.5 / 0.1296 - 0.4096 * 0.25 / (2 * 0.1296)) / 3.
    se2 = (2 * 0.8**3 * 0.2 * 0.5 / (1 - 0.64) ** 2 - 0.8**4 * 0.25 / (2 * (1 - 0.64) ** 2)) / 3
    z = math.atanh(0.8)
    assert out["lower"] == pytest.approx(math.tanh(z - 1.96 * math.sqrt(se2)), abs=1e-9)
    assert out["upper"] == pytest.approx(math.tanh(z + 1.96 * math.sqrt(se2)), abs=1e-9)


def test_tem_formulas_by_hand():
    # Paired readings 100/102, 200/198, 300/301: d^2 = 4, 4, 1 -> sqrt(9 / 6) = 1.2247.
    assert stats.tem_two_readings([100, 200, 300], [102, 198, 301]) == pytest.approx(math.sqrt(1.5))
    # The multi-reading form with K = 2 equals the paired form.
    matrix = np.array([[100, 102], [200, 198], [300, 301]], dtype=float)
    assert stats.tem_multi_reading(matrix) == pytest.approx(math.sqrt(1.5))
    # K = 3 by hand: subject [10, 12, 14]: sum M^2 = 440, (sum M)^2 / 3 = 432 -> 8; one subject,
    # N(K-1) = 2 -> sqrt(4) = 2.
    assert stats.tem_multi_reading(np.array([[10.0, 12.0, 14.0]])) == pytest.approx(2.0)
    summary = stats.tem_summary(2.0, np.array([100.0, 200.0, 300.0]))
    assert summary["pct_tem"] == pytest.approx(1.0)
    assert summary["reliability"] == pytest.approx(1 - 4 / 10000)


def test_sus_by_hand_and_grades():
    # Brooke's scoring: odd items score - 1, even items 5 - score, times 2.5.
    assert stats.sus_score([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]) == 100.0
    assert stats.sus_score([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]) == 0.0
    assert stats.sus_score([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]) == 75.0
    assert stats.sus_score([3] * 10) == 50.0
    with pytest.raises(ValueError):
        stats.sus_score([3] * 9)
    # Adjective bands at the midpoints between Bangor, Kortum and Miller's (2009) means.
    assert stats.sus_grade(68) == "good" and stats.sus_grade(71.4) == "good"
    assert stats.sus_grade(85) == "excellent" and stats.sus_grade(90) == "best imaginable"
    assert stats.sus_grade(50) == "ok" and stats.sus_grade(20) == "awful"
    assert stats.sus_grade(10) == "worst imaginable"


def test_moments_loa_matches_the_single_measurement_case_without_repeats():
    # One difference per participant: the moments estimate is the plain SD of differences
    # with the between component carrying everything (within variance has no degrees of freedom).
    d = np.array([-2.0, 1.0, 3.0, -1.0, 4.0, 0.0])
    out = stats.method_of_moments_loa(np.arange(6), d)
    assert out["mean"] == pytest.approx(d.mean())
    assert out["sd"] == pytest.approx(d.std(ddof=1))


def test_moments_loa_and_mixed_model_agree_on_repeated_differences():
    rng = np.random.default_rng(3)
    n, m = 40, 3
    u = rng.normal(0, 5, n)
    groups = np.repeat(np.arange(n), m)
    d = 2.0 + u[groups] + rng.normal(0, 3, n * m)
    moments = stats.method_of_moments_loa(groups, d)
    mixed = stats.mixed_model_loa(groups, d)
    assert moments["sd"] == pytest.approx(mixed["sd"], rel=0.05)
    assert moments["mean"] == pytest.approx(mixed["mean"], abs=0.5)
    # The total SD is near sqrt(25 + 9) = 5.83 for this design.
    assert 4.8 < mixed["sd"] < 7.0
    assert mixed["sigma_within"] == pytest.approx(3.0, rel=0.25)


def test_agreement_is_deterministic_and_recovers_a_known_bias():
    rng = np.random.default_rng(11)
    n, m = 30, 3
    groups = np.repeat([f"P{i:03d}" for i in range(n)], m)
    tape = np.repeat(rng.uniform(700, 1100, n), m)
    system = tape + 6.0 + rng.normal(0, 4, n * m)
    one = stats.agreement(groups, system, tape, resamples=300, seed=1)
    two = stats.agreement(groups, system, tape, resamples=300, seed=1)
    assert one == two
    assert one.bias_ci[0] < 6.0 < one.bias_ci[1]
    assert one.loa_lower_ci[0] <= one.loa_lower <= one.loa_lower_ci[1]
    assert one.loa_upper_ci[0] <= one.loa_upper <= one.loa_upper_ci[1]
    assert one.n_participants == n and one.n_pairs == n * m


def test_cluster_bootstrap_keeps_a_participants_rows_together():
    groups = np.array(["a", "a", "b", "b", "c", "c"])
    seen = []

    def statistic(rows, clusters):
        seen.append((groups[rows].tolist(), clusters.tolist()))
        return 0.0

    stats.cluster_bootstrap(groups, statistic, resamples=5, seed=0)
    for codes, clusters in seen:
        assert len(codes) == 6
        # Each cluster is one draw with both rows of one participant.
        for c in set(clusters):
            members = [codes[i] for i in range(6) if clusters[i] == c]
            assert len(members) == 2 and len(set(members)) == 1


def test_repeatability_by_hand():
    groups = np.array(["a", "a", "a", "b", "b", "b"])
    values = np.array([10.0, 12.0, 14.0, 20.0, 20.0, 20.0])
    out = stats.repeatability(groups, values)
    # Within SS: a -> 8, b -> 0; df = 6 - 2 = 4 -> s_w = sqrt(2).
    assert out["s_within"] == pytest.approx(math.sqrt(2))
    assert out["coefficient"] == pytest.approx(2.77 * math.sqrt(2))


def test_magnitudes_and_tolerances_by_hand():
    system, tape = np.array([110.0, 95.0, 130.0, 100.0]), np.array([100.0] * 4)
    m = stats.magnitudes(system, tape)
    # |d| = 10, 5, 30, 0: MAE 11.25; RMSE sqrt((100 + 25 + 900 + 0) / 4); MAPE 11.25% of 100.
    assert m["mae"] == pytest.approx(11.25) and m["rmse"] == pytest.approx(math.sqrt(1025 / 4))
    assert m["mape_pct"] == pytest.approx(11.25)
    assert m["p50_abs"] == pytest.approx(7.5) and m["p90_abs"] == pytest.approx(24.0)
    w = stats.within_tolerance(system, tape)
    assert w["within_10mm"] == 0.75 and w["within_30mm"] == 1.0 and w["within_15mm"] == 0.75


# ---- the acceptance tiers at their exact boundaries (12.4) ----


def test_tier_1_boundary():
    assert tier_1("chest", 9.0).passed and tier_1("chest", -9.0).passed
    assert not tier_1("chest", 9.01).passed and not tier_1("chest", -9.01).passed


def test_tier_2_boundary_and_limits_per_site_group():
    assert tier_2("sleeve", 0.90).passed and not tier_2("sleeve", 0.8999).passed
    assert "15 mm" in tier_2("sleeve", 0.9).target and "30 mm" in tier_2("hip", 0.9).target


def test_tier_3_uses_the_outer_confidence_bounds():
    assert tier_3("shoulder", -30.0, 30.0).passed
    assert not tier_3("shoulder", -30.01, 29.0).passed
    assert not tier_3("shoulder", -29.0, 30.01).passed
    assert tier_3("waist", -40.0, 40.0).passed and not tier_3("waist", -40.0, 40.01).passed
