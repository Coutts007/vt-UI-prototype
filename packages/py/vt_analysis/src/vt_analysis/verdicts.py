"""The acceptance tiers of proposal Table 1.1 (backend-spec 12.4). A FAIL is never rounded up."""

from dataclasses import dataclass

from vt_analysis.data import GIRTHS, LENGTHS
from vt_analysis.stats import Agreement

BIAS_MM = 9.0
WITHIN_MM = {**dict.fromkeys(LENGTHS, 15.0), **dict.fromkeys(GIRTHS, 30.0)}
SHARE = 0.90
LOA_MM = {**dict.fromkeys(LENGTHS, 30.0), **dict.fromkeys(GIRTHS, 40.0)}


@dataclass(frozen=True)
class Tier:
    name: str
    passed: bool
    value: str
    target: str


@dataclass(frozen=True)
class Verdict:
    site: str
    tiers: tuple[Tier, Tier, Tier]

    @property
    def passed(self) -> bool:
        return all(t.passed for t in self.tiers)


def tier_1(site: str, bias_mm: float) -> Tier:
    """|bias| <= 9 mm, on the number as computed (no rounding before the comparison)."""
    return Tier(
        "mean bias", abs(bias_mm) <= BIAS_MM, f"{bias_mm:+.1f} mm", f"|bias| <= {BIAS_MM:.0f} mm"
    )


def tier_2(site: str, share_within: float) -> Tier:
    limit = WITHIN_MM[site]
    return Tier(
        "individual differences",
        share_within >= SHARE,
        f"{share_within * 100:.1f}% within {limit:.0f} mm",
        f">= {SHARE * 100:.0f}% within {limit:.0f} mm",
    )


def tier_3(site: str, lower_ci_of_lower: float, upper_ci_of_upper: float) -> Tier:
    """Both outer confidence bounds of the limits of agreement inside +/- 30 or 40 mm."""
    limit = LOA_MM[site]
    passed = lower_ci_of_lower >= -limit and upper_ci_of_upper <= limit
    return Tier(
        "limits of agreement",
        passed,
        f"outer bounds {lower_ci_of_lower:+.1f} to {upper_ci_of_upper:+.1f} mm",
        f"within +/- {limit:.0f} mm, confidence bounds included",
    )


def verdict(site: str, agreement: Agreement, share_within: float) -> Verdict:
    return Verdict(
        site,
        (
            tier_1(site, agreement.bias),
            tier_2(site, share_within),
            tier_3(site, agreement.loa_lower_ci[0], agreement.loa_upper_ci[1]),
        ),
    )
