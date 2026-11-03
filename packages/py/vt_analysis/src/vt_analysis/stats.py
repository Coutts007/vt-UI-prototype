"""The agreement statistics of backend-spec 12.3, written out rather than taken from a library.

Each function takes plain numpy arrays and returns plain numbers, so every one can be checked
against a published worked example in the tests. Units are whatever comes in (millimetres here).
"""

import math
import warnings
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import stats as sp

Z95 = 1.96
TOLERANCES_MM = (10.0, 15.0, 20.0, 30.0)
REPEATABILITY_FACTOR = 2.77  # 1.96 * sqrt(2)


# ---- grouping helpers -------------------------------------------------------------------


def group_means(groups: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Mean of `values` per distinct group, with the group labels in sorted order."""
    labels, inverse = np.unique(groups, return_inverse=True)
    sums = np.bincount(inverse, weights=values, minlength=len(labels))
    counts = np.bincount(inverse, minlength=len(labels))
    return labels, sums / counts


def participant_differences(groups: np.ndarray, system: np.ndarray, tape: np.ndarray) -> np.ndarray:
    """One difference per participant: the mean over their sets of (system - tape)."""
    _, means = group_means(groups, system - tape)
    return means


# ---- bias and limits of agreement ----------------------------------------------------------


def cluster_bootstrap(
    groups: np.ndarray,
    statistic: Any,
    *,
    resamples: int,
    seed: int,
) -> np.ndarray:
    """Resample whole participants with replacement and recompute `statistic(rows, clusters)`.

    `rows` are the row indices of one resample (a participant drawn twice contributes its rows
    twice) and `clusters` labels each draw, so a repeated participant counts as two clusters.
    Participant-level resampling keeps a participant's sets together (12.3).
    """
    rng = np.random.default_rng(seed)
    labels, inverse = np.unique(groups, return_inverse=True)
    members = [np.flatnonzero(inverse == i) for i in range(len(labels))]
    out = []
    for _ in range(resamples):
        picked = rng.integers(0, len(labels), len(labels))
        rows = np.concatenate([members[i] for i in picked])
        clusters = np.repeat(np.arange(len(picked)), [len(members[i]) for i in picked])
        out.append(statistic(rows, clusters))
    return np.asarray(out, dtype=float)


def percentile_ci(samples: np.ndarray) -> tuple[float, float]:
    samples = samples[np.isfinite(samples)]
    if len(samples) == 0:
        return math.nan, math.nan
    low, high = np.percentile(samples, [2.5, 97.5])
    return float(low), float(high)


def method_of_moments_loa(groups: np.ndarray, differences: np.ndarray) -> dict[str, float]:
    """Bland and Altman (1999, section 5.2): repeated differences, true value constant.

    One-way ANOVA of the differences by participant. The within-participant variance is the
    residual mean square; the between-participant component is (MSB - MSE) / m0, where m0 is the
    adjusted mean number of sets. The SD of a single difference is the square root of their sum.
    """
    labels, inverse = np.unique(groups, return_inverse=True)
    n = len(labels)
    counts = np.bincount(inverse, minlength=n).astype(float)
    means = np.bincount(inverse, weights=differences, minlength=n) / counts
    grand = float(differences.mean())
    total = len(differences)
    if n < 2:
        return {"mean": grand, "sd": math.nan, "sigma_between": math.nan,
                "sigma_within": math.nan, "lower": math.nan, "upper": math.nan}  # fmt: skip
    ss_between = float((counts * (means - grand) ** 2).sum())
    ss_within = float(((differences - means[inverse]) ** 2).sum())
    msb = ss_between / (n - 1)
    mse = ss_within / (total - n) if total > n else 0.0
    m0 = (counts.sum() - (counts**2).sum() / counts.sum()) / (n - 1)
    sigma_b2 = max((msb - mse) / m0, 0.0)
    sd = math.sqrt(sigma_b2 + mse)
    return {
        "mean": grand,
        "sd": sd,
        "sigma_between": math.sqrt(sigma_b2),
        "sigma_within": math.sqrt(mse),
        "lower": grand - Z95 * sd,
        "upper": grand + Z95 * sd,
    }


def mixed_model_loa(groups: np.ndarray, differences: np.ndarray) -> dict[str, float]:
    """d_ij = mu + u_i + e_ij by REML (statsmodels MixedLM); LoA = mu +/- 1.96 sqrt(su^2 + se^2)."""
    import pandas as pd
    import statsmodels.formula.api as smf

    frame = pd.DataFrame({"d": differences, "g": groups})
    if frame["g"].nunique() < 2 or len(frame) == frame["g"].nunique():
        # No repeats: the model cannot separate the two variances. Fall back to the moments.
        return method_of_moments_loa(groups, differences)
    with warnings.catch_warnings():
        # A between-participant variance at zero is a legitimate answer; statsmodels warns about
        # the boundary and about retrying its optimiser, which is noise in a report run.
        from statsmodels.tools.sm_exceptions import ConvergenceWarning, SingularMatrixWarning

        warnings.simplefilter("ignore", ConvergenceWarning)
        warnings.simplefilter("ignore", SingularMatrixWarning)
        model = smf.mixedlm("d ~ 1", frame, groups=frame["g"]).fit(reml=True)
    mu = float(model.params["Intercept"])
    su2 = float(model.cov_re.iloc[0, 0])
    se2 = float(model.scale)
    sd = math.sqrt(max(su2, 0.0) + se2)
    return {
        "mean": mu,
        "sd": sd,
        "sigma_between": math.sqrt(max(su2, 0.0)),
        "sigma_within": math.sqrt(se2),
        "lower": mu - Z95 * sd,
        "upper": mu + Z95 * sd,
    }


@dataclass
class Agreement:
    n_participants: int
    n_pairs: int
    bias: float
    bias_ci: tuple[float, float]
    sd_differences: float
    loa_lower: float
    loa_upper: float
    loa_lower_ci: tuple[float, float]
    loa_upper_ci: tuple[float, float]
    loa_moments_lower: float
    loa_moments_upper: float
    sigma_between: float
    sigma_within: float


def agreement(
    groups: np.ndarray,
    system: np.ndarray,
    tape: np.ndarray,
    *,
    resamples: int,
    seed: int,
) -> Agreement:
    """Bias on participant means with a cluster-bootstrap CI; LoA from the mixed model with
    cluster-bootstrap CIs on each limit (the bootstrap refits the moments estimate, which is the
    same quantity and fast enough for 2,000 resamples)."""
    d = system - tape
    bias = float(participant_differences(groups, system, tape).mean())
    mixed = mixed_model_loa(groups, d)
    moments = method_of_moments_loa(groups, d)

    def boot(rows: np.ndarray, clusters: np.ndarray) -> np.ndarray:
        _, means = group_means(clusters, d[rows])
        moments = method_of_moments_loa(clusters, d[rows])
        return np.array([means.mean(), moments["lower"], moments["upper"]])

    samples = cluster_bootstrap(groups, boot, resamples=resamples, seed=seed)
    return Agreement(
        n_participants=int(len(np.unique(groups))),
        n_pairs=int(len(d)),
        bias=bias,
        bias_ci=percentile_ci(samples[:, 0]),
        sd_differences=mixed["sd"],
        loa_lower=mixed["lower"],
        loa_upper=mixed["upper"],
        loa_lower_ci=percentile_ci(samples[:, 1]),
        loa_upper_ci=percentile_ci(samples[:, 2]),
        loa_moments_lower=moments["lower"],
        loa_moments_upper=moments["upper"],
        sigma_between=mixed["sigma_between"],
        sigma_within=mixed["sigma_within"],
    )


# ---- error magnitudes --------------------------------------------------------------------------


def magnitudes(system: np.ndarray, tape: np.ndarray) -> dict[str, float]:
    d = system - tape
    return {
        "mae": float(np.abs(d).mean()),
        "rmse": float(math.sqrt((d**2).mean())),
        "mape_pct": float((np.abs(d) / tape).mean() * 100),
        "p50_abs": float(np.percentile(np.abs(d), 50)),
        "p75_abs": float(np.percentile(np.abs(d), 75)),
        "p90_abs": float(np.percentile(np.abs(d), 90)),
    }


def within_tolerance(system: np.ndarray, tape: np.ndarray) -> dict[str, float]:
    d = np.abs(system - tape)
    return {f"within_{int(t)}mm": float((d <= t).mean()) for t in TOLERANCES_MM}


# ---- reliability ----------------------------------------------------------------------------


def icc_2_1(matrix: np.ndarray) -> dict[str, float]:
    """ICC(2,1), two-way random effects, single measurement, absolute agreement.

    `matrix` is n targets x k raters. Point estimate (MSR - MSE) / (MSR + (k-1)MSE + k(MSC - MSE)/n)
    and the F-based 95% interval of McGraw and Wong (1996, Table 7, case 2A).
    """
    x = np.asarray(matrix, dtype=float)
    n, k = x.shape
    grand = x.mean()
    row_means, col_means = x.mean(axis=1), x.mean(axis=0)
    ssr = k * ((row_means - grand) ** 2).sum()
    ssc = n * ((col_means - grand) ** 2).sum()
    sse = ((x - row_means[:, None] - col_means[None, :] + grand) ** 2).sum()
    msr, msc, mse = ssr / (n - 1), ssc / (k - 1), sse / ((n - 1) * (k - 1))
    icc = (msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n)
    if mse <= 0:
        # Perfect agreement: no residual variance, so the interval collapses on the estimate.
        return {"icc": float(icc), "lower": float(icc), "upper": float(icc), "n": n, "k": k}
    fj = msc / mse
    a = k * icc * fj + n * (1 + (k - 1) * icc) - k * icc
    vn = (k - 1) * (n - 1) * a**2
    vd = (n - 1) * k**2 * icc**2 * fj**2 + (n * (1 + (k - 1) * icc) - k * icc) ** 2
    v = vn / vd if vd > 0 else math.inf
    f_low = sp.f.ppf(0.975, n - 1, v)
    f_high = sp.f.ppf(0.975, v, n - 1)
    lower = n * (msr - f_low * mse) / (f_low * (k * msc + (k * n - k - n) * mse) + n * msr)
    upper = n * (f_high * msr - mse) / (k * msc + (k * n - k - n) * mse + n * f_high * msr)
    return {"icc": float(icc), "lower": float(lower), "upper": float(upper), "n": n, "k": k}


def lins_ccc(x: np.ndarray, y: np.ndarray) -> dict[str, float]:
    """Lin's concordance correlation coefficient with the Fisher-z interval (Lin 1989, 2000)."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    n = len(x)
    mx, my = x.mean(), y.mean()
    sx2, sy2 = ((x - mx) ** 2).mean(), ((y - my) ** 2).mean()
    sxy = ((x - mx) * (y - my)).mean()
    ccc = 2 * sxy / (sx2 + sy2 + (mx - my) ** 2)
    r = sxy / math.sqrt(sx2 * sy2) if sx2 > 0 and sy2 > 0 else math.nan
    if n < 3 or not math.isfinite(r) or abs(ccc) >= 1 or r == 0:
        return {"ccc": float(ccc), "lower": math.nan, "upper": math.nan, "n": n}
    u = (mx - my) / math.sqrt(math.sqrt(sx2 * sy2))
    se2 = (
        (1 - r**2) * ccc**2 / ((1 - ccc**2) * r**2)
        + 2 * ccc**3 * (1 - ccc) * u**2 / (r * (1 - ccc**2) ** 2)
        - ccc**4 * u**4 / (2 * r**2 * (1 - ccc**2) ** 2)
    ) / (n - 2)
    z = math.atanh(ccc)
    half = Z95 * math.sqrt(max(se2, 0.0))
    return {"ccc": float(ccc), "lower": math.tanh(z - half), "upper": math.tanh(z + half), "n": n}


def proportional_bias(groups: np.ndarray, system: np.ndarray, tape: np.ndarray) -> dict[str, float]:
    """OLS of the difference on the pair mean, cluster-robust by participant (12.3)."""
    import statsmodels.api as sm

    d = system - tape
    mean = (system + tape) / 2
    if len(np.unique(groups)) < 3:
        return {"slope": math.nan, "lower": math.nan, "upper": math.nan, "intercept": math.nan}
    design = sm.add_constant(mean)
    # t quantiles with G - 1 degrees of freedom: the usual choice with a few dozen clusters.
    fit = sm.OLS(d, design).fit(cov_type="cluster", cov_kwds={"groups": groups}, use_t=True)
    ci = fit.conf_int(alpha=0.05)
    return {
        "slope": float(fit.params[1]),
        "lower": float(ci[1][0]),
        "upper": float(ci[1][1]),
        "intercept": float(fit.params[0]),
    }


def repeatability(groups: np.ndarray, system: np.ndarray) -> dict[str, float]:
    """Within-participant SD across sets (one-way ANOVA residual) and 2.77 s_w (12.3)."""
    labels, inverse = np.unique(groups, return_inverse=True)
    counts = np.bincount(inverse, minlength=len(labels))
    keep = counts[inverse] > 1
    if keep.sum() == 0:
        return {"s_within": math.nan, "coefficient": math.nan, "n_participants": 0}
    g, v = inverse[keep], system[keep]
    labels2, inv2 = np.unique(g, return_inverse=True)
    means = np.bincount(inv2, weights=v) / np.bincount(inv2)
    ss = ((v - means[inv2]) ** 2).sum()
    df = len(v) - len(labels2)
    s_w = math.sqrt(ss / df) if df > 0 else math.nan
    return {"s_within": s_w, "coefficient": REPEATABILITY_FACTOR * s_w,
            "n_participants": int(len(labels2))}  # fmt: skip


def paired_difference(a: np.ndarray, b: np.ndarray) -> dict[str, float]:
    """Mean of a - b with a t-based 95% interval (self-capture against assisted, 12.3)."""
    d = np.asarray(a, dtype=float) - np.asarray(b, dtype=float)
    n = len(d)
    if n < 2:
        return {"mean": float(d.mean()) if n else math.nan, "lower": math.nan, "upper": math.nan,
                "n": n}  # fmt: skip
    half = sp.t.ppf(0.975, n - 1) * d.std(ddof=1) / math.sqrt(n)
    return {"mean": float(d.mean()), "lower": float(d.mean() - half),
            "upper": float(d.mean() + half), "n": n}  # fmt: skip


# ---- technical error of measurement ------------------------------------------------------------


def tem_two_readings(first: np.ndarray, second: np.ndarray) -> float:
    """TEM = sqrt(sum d^2 / 2n) for paired readings (intra- or inter-observer)."""
    d = np.asarray(first, dtype=float) - np.asarray(second, dtype=float)
    return float(math.sqrt((d**2).sum() / (2 * len(d)))) if len(d) else math.nan


def tem_multi_reading(matrix: np.ndarray) -> float:
    """Pooled TEM over K readings: sqrt(sum_i(sum_k M^2 - (sum_k M)^2 / K) / (N(K-1)))."""
    m = np.asarray(matrix, dtype=float)
    n, k = m.shape
    inner = (m**2).sum(axis=1) - m.sum(axis=1) ** 2 / k
    return float(math.sqrt(inner.sum() / (n * (k - 1))))


def tem_summary(tem: float, values: np.ndarray) -> dict[str, float]:
    """%TEM against the mean of the measurements and R = 1 - TEM^2 / SD^2.

    SD is the standard deviation of all the readings, the total inter-subject variance including
    the measurement error (Ulijaszek and Kerr, 1999).
    """
    v = np.asarray(values, dtype=float)
    mean = float(v.mean())
    sd = float(v.std(ddof=1)) if len(v) > 1 else math.nan
    return {
        "tem": tem,
        "pct_tem": tem / mean * 100 if mean else math.nan,
        "reliability": 1 - tem**2 / sd**2 if sd and math.isfinite(sd) else math.nan,
    }


# ---- usability ------------------------------------------------------------------------------


def sus_score(items: Sequence[int]) -> float:
    """System Usability Scale (Brooke): odd items score - 1, even items 5 - score, sum x 2.5."""
    if len(items) != 10:
        raise ValueError("SUS has ten items")
    total = 0
    for i, value in enumerate(items, start=1):
        if not 1 <= value <= 5:
            raise ValueError("SUS answers are 1 to 5")
        total += value - 1 if i % 2 else 5 - value
    return total * 2.5


# Mean SUS score per adjective in Bangor, Kortum and Miller (2009): worst imaginable 12.5,
# awful 20.3, poor 35.7, OK 50.9, good 71.4, excellent 85.5, best imaginable 90.9. A score takes
# the adjective whose mean is nearest, so the bands meet at the midpoints.
ADJECTIVE_MEANS = (
    ("worst imaginable", 12.5), ("awful", 20.3), ("poor", 35.7), ("ok", 50.9),
    ("good", 71.4), ("excellent", 85.5), ("best imaginable", 90.9),
)  # fmt: skip


def sus_grade(score: float) -> str:
    """The nearest adjective rating of Bangor, Kortum and Miller (2009)."""
    return min(ADJECTIVE_MEANS, key=lambda item: abs(item[1] - score))[0]


def mean_t_ci(values: Sequence[float]) -> dict[str, float]:
    v = np.asarray(values, dtype=float)
    n = len(v)
    if n < 2:
        return {"mean": float(v.mean()) if n else math.nan, "lower": math.nan, "upper": math.nan,
                "n": n}  # fmt: skip
    half = sp.t.ppf(0.975, n - 1) * v.std(ddof=1) / math.sqrt(n)
    return {"mean": float(v.mean()), "lower": float(v.mean() - half),
            "upper": float(v.mean() + half), "n": n}  # fmt: skip
