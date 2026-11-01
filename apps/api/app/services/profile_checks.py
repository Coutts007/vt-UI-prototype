"""Server checks after a profile is stored (backend-spec 9.5, 11.5). Pure functions.

They warn the tailor and never refuse a profile. Details hold numbers only; the UI builds the words.
"""

from collections.abc import Mapping
from typing import Any

from vt_measure.derive import GIRTHS, SITES, derive

Check = dict[str, Any]
Values = Mapping[str, int | None]

MISMATCH_MM = 2
GIRTH_CHANGE_PCT = 5
LENGTH_CHANGE_PCT = 2
HEIGHT_PCT = 3
# Each static bound: (numerator site, denominator site), reported on the numerator.
RATIOS = {
    "inleg_stature": ("inleg", "stature"),
    "sleeve_stature": ("sleeve", "stature"),
    "waist_hip": ("waist", "hip"),
    "chest_stature": ("chest", "stature"),
}


def check(kind: str, severity: str, site: str | None, **detail: Any) -> Check:
    return {"kind": kind, "severity": severity, "site_code": site, "detail": detail}


def rederive_checks(profile: Mapping[str, Any], rules: Mapping[str, Any]) -> list[Check]:
    """Auto rows only: an override is a person's decision, not a calculation."""
    derived = derive(profile, rules).sites
    found = []
    for row in profile["measurements"]:
        if row["method"] != "auto":
            continue
        site, client_mm, client_flag = row["site_code"], row["value_mm"], row["confidence_flag"]
        server_mm, server_flag = derived[site].value_mm, derived[site].flag
        apart = (
            client_mm != server_mm
            if client_mm is None or server_mm is None
            else abs(client_mm - server_mm) > MISMATCH_MM
        )
        if apart or client_flag != server_flag:
            found.append(
                check(
                    "client_server_mismatch",
                    "check",
                    site,
                    client_mm=client_mm,
                    server_mm=server_mm,
                    client_flag=client_flag,
                    server_flag=server_flag,
                )  # fmt: skip
            )
    return found


def static_bounds(values: Values, bounds: Mapping[str, Any]) -> list[Check]:
    found = []
    for name, (low, high) in bounds.items():
        top, bottom = RATIOS[name]
        over, under = values.get(top), values.get(bottom)
        if not over or not under:
            continue
        ratio = round(over / under, 6)
        if not low <= ratio <= high:
            found.append(
                check("unusual_proportion", "check", top, ratio=round(ratio, 3), low=low, high=high)
            )
    return found


def change_since_last(values: Values, before: Values) -> list[Check]:
    found = []
    for site in SITES:
        new, old = values.get(site), before.get(site)
        if not new or not old:
            continue
        limit = GIRTH_CHANGE_PCT if site in GIRTHS else LENGTH_CHANGE_PCT
        # Whole numbers, so a change of exactly the limit is never tipped over by rounding.
        if abs(new - old) * 100 > limit * old:
            found.append(check("change_since_last", "info", site, before_mm=old, now_mm=new))
    return found


def height_mismatch(stature: int | None, recorded: int | None) -> list[Check]:
    if not stature or not recorded or abs(stature - recorded) * 100 <= HEIGHT_PCT * recorded:
        return []
    return [check("height_mismatch", "check", "stature", stature_mm=stature, recorded_mm=recorded)]
