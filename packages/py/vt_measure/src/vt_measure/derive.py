"""Turn the numbers in a profile into nine measurements and flags (backend-spec 10, A14).

The TypeScript module must match this exactly, so every search and tie-break here is deliberate.
Lengths are millimetres. Pure functions only: no I/O and no global state.
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

SITES = ("stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck")
GIRTHS = ("chest", "waist", "hip", "neck")
REASONS = (
    "scale_disagree",
    "level_unchecked",
    "loose_clothing",
    "landmark_low",
    "mask_gap",
    "out_of_range",
    "crotch_not_found",
    "marker_weak",
    "waist_level_mismatch",
    "chest_level_mismatch",
    "view_failed",
    "free_arm_unknown",
)
FRONT_SITES = frozenset({"stature", "shoulder", "chest", "waist", "hip", "sleeve", "inleg", "neck"})
SIDE_SITES = frozenset({"chest", "waist", "hip", "outleg", "neck"})
LOOSE_SITES = frozenset({"chest", "waist", "hip"})
SCALE_BAND_SITES = frozenset({"stature", *GIRTHS})
FREE_ARM_SITES = frozenset({"sleeve", "chest", "waist"})
ARMS = {"left": (11, 13, 15), "right": (12, 14, 16)}

MIN_HALF_MM = 15.0
SEARCH_STEP = 0.01
CHEST_ANTERIOR_BAND = (0.15, 0.35)
CHEST_ANTERIOR_TOL = 0.05
LIMIT_DECIMALS = 6

Profile = Sequence[float | None]
Data = Mapping[str, Any]


@dataclass
class SiteResult:
    site_code: str
    value_mm: int | None
    raw_mm: float | None
    flag: str
    reasons: list[str]
    level_fraction: float | None = None
    a_mm: float | None = None
    b_mm: float | None = None
    perimeter_mm: float | None = None
    correction_factor: float | None = None


@dataclass
class Derivation:
    sites: dict[str, SiteResult]
    scale_front: float | None
    scale_side: float | None
    scale_stature: float | None
    disagreement_pct: float | None


@dataclass
class View:
    silhouette: Data | None
    landmarks: Sequence[Data] | None
    scale: float | None
    shoulder: tuple[int, ...] = ()
    hip: tuple[int, ...] = ()
    knee: tuple[int, ...] = ()

    @property
    def ok(self) -> bool:
        return self.scale is not None

    def y(self, indices: tuple[int, ...]) -> float:
        assert self.silhouette is not None and self.landmarks is not None
        image_h = self.silhouette["image_h"]
        return float(_add(self.landmarks[i]["y"] * image_h for i in indices) / len(indices))

    @property
    def shoulder_y(self) -> float:
        return self.y(self.shoulder)

    @property
    def span(self) -> float:
        return self.y(self.hip) - self.shoulder_y

    def level_y(self, fraction: float) -> float:
        return self.shoulder_y + fraction * self.span

    def hip_band_y(self, fraction: float) -> float:
        return self.y(self.hip) + fraction * (self.y(self.knee) - self.y(self.hip))

    def u(self, y_px: float) -> float:
        assert self.silhouette is not None
        top = self.silhouette["mask_top_px"]
        return float((y_px - top) / (self.silhouette["mask_bottom_px"] - top))


@dataclass
class Notes:
    """What each site has collected so far."""

    reasons: dict[str, set[str]] = field(default_factory=lambda: {site: set() for site in SITES})
    failed: set[str] = field(default_factory=set)

    def warn(self, site: str, reason: str) -> None:
        self.reasons[site].add(reason)

    def fail(self, site: str, reason: str) -> None:
        self.reasons[site].add(reason)
        self.failed.add(site)


def _add(values: Iterable[float]) -> float:
    """Plain left-to-right addition. Python's sum() compensates, and JavaScript cannot match it."""
    total = 0.0
    for value in values:
        total = total + value
    return total


def _distance(dx: float, dy: float) -> float:
    """Written out because hypot may differ in the last digit between languages."""
    return math.sqrt(dx * dx + dy * dy)


def round_for_limit(value: float) -> float:
    """Round before comparing with a limit, so a value exactly on it stays on it."""
    factor = 10.0**LIMIT_DECIMALS
    return math.floor(value * factor + 0.5) / factor


def ellipse_perimeter(a: float, b: float) -> float:
    """Ramanujan's first approximation."""
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))


def round_half_even(value: float) -> int:
    return round(value)


def sample_profile(profile: Profile, u: float) -> float | None:
    """Interpolate linearly. Undefined outside the mask, or if either neighbour is null."""
    index = u * 100
    if index < 0 or index > 100:
        return None
    low = math.floor(index)
    high = math.ceil(index)
    low_value, high_value = profile[low], profile[high]
    if low_value is None or high_value is None:
        return None
    return low_value + (high_value - low_value) * (index - low)


def band_fractions(low: float, high: float) -> list[float]:
    count = math.floor((high - low) / SEARCH_STEP + 0.5)
    if count <= 0:
        return [low]
    return [low + (high - low) * i / count for i in range(count + 1)]


def marker_scale(marker: Data | None, mask_image_w: int, rules: Data) -> float | None:
    """Millimetres per mask pixel, or None if the marker cannot be trusted."""
    if marker is None or len(marker["corners"]) != 4:
        return None
    corners = marker["corners"]
    sides = [
        _distance(corners[(i + 1) % 4][0] - corners[i][0], corners[(i + 1) % 4][1] - corners[i][1])
        for i in range(4)
    ]
    if min(sides) <= 0:
        return None
    if round_for_limit(max(sides) / min(sides)) > rules["marker"]["max_corner_aspect"]:
        return None
    mean_side = _add(sides) / 4
    result: float = rules["marker"]["side_mm"] / mean_side * (marker["image_w"] / mask_image_w)
    return result


def identify_free_arm(landmarks: Sequence[Data], marker: Data | None, rules: Data) -> str | None:
    """A14: the free arm's wrist is clearly farther from the marker centre."""
    if marker is None:
        return None
    width, height = marker["image_w"], marker["image_h"]
    centre_x = _add(c[0] for c in marker["corners"]) / len(marker["corners"])
    centre_y = _add(c[1] for c in marker["corners"]) / len(marker["corners"])

    def distance(index: int) -> float:
        point = landmarks[index]
        return _distance(point["x"] * width - centre_x, point["y"] * height - centre_y)

    left, right = distance(15), distance(16)
    ratio = rules["flags"]["free_arm_min_distance_ratio"]
    if left >= right * ratio and left > right:
        return "left"
    if right >= left * ratio and right > left:
        return "right"
    return None


def _view_scale(silhouette: Data | None, landmarks: Any, marker: Data | None, rules: Data,
                correction_mm: float) -> float | None:  # fmt: skip
    if silhouette is None or landmarks is None:
        return None
    if silhouette["mask_bottom_px"] <= silhouette["mask_top_px"]:
        return None
    scale = marker_scale(marker, silhouette["image_w"], rules)
    if scale is None:
        return None
    result: float = scale * (1 + correction_mm / rules["scale"]["nominal_distance_mm"])
    return result


def _build_views(data: Data, rules: Data) -> tuple[View, View]:
    correction = rules["scale"]["depth_correction_mm"]
    front_landmarks = data["landmarks_front"]
    side_landmarks = data["landmarks_side"]
    front = View(
        data["silhouette_front"],
        front_landmarks,
        _view_scale(data["silhouette_front"], front_landmarks, data["marker_front"], rules,
                    correction["front"]),
        (11, 12), (23, 24), (25, 26),
    )  # fmt: skip
    side = View(
        data["silhouette_side"],
        side_landmarks,
        _view_scale(data["silhouette_side"], side_landmarks, data["marker_side"], rules,
                    correction["side"]),
    )  # fmt: skip
    if side_landmarks is not None:
        right = side_landmarks[12]["visibility"] + side_landmarks[24]["visibility"]
        left = side_landmarks[11]["visibility"] + side_landmarks[23]["visibility"]
        side.shoulder, side.hip, side.knee = ((12,), (24,), (26,)) if right >= left else (
            (11,), (23,), (25,))  # fmt: skip
    # A hip at or above the shoulder means the pose data cannot be used.
    for view in (front, side):
        if view.ok and view.span <= 0:
            view.scale = None
    return front, side


def _required_landmarks(site: str, front: View, side: View, arm: str) -> list[tuple[View, int]]:
    def use(view: View, *groups: tuple[int, ...]) -> list[tuple[View, int]]:
        return [(view, i) for group in groups for i in group]

    torso = use(front, front.shoulder, front.hip) + use(side, side.shoulder, side.hip)
    if site == "shoulder":
        return use(front, front.shoulder)
    if site == "sleeve":
        return use(front, ARMS[arm])
    if site == "outleg":
        return use(side, side.shoulder, side.hip)
    if site == "inleg":
        return use(front, (27, 28))
    if site == "hip":
        return torso + use(front, front.knee) + use(side, side.knee)
    if site in GIRTHS:
        return torso
    return []


def _clearer_arm(landmarks: Sequence[Data]) -> str:
    def mean(indices: tuple[int, ...]) -> float:
        return _add(landmarks[i]["visibility"] for i in indices) / 3

    return "left" if mean(ARMS["left"]) > mean(ARMS["right"]) else "right"


def _girth(
    site: str, a: float | None, b: float | None, fraction: float, rules: Data, notes: Notes
) -> SiteResult:
    if a is None or b is None or a < MIN_HALF_MM or b < MIN_HALF_MM:
        notes.fail(site, "mask_gap")
        return SiteResult(site, None, None, "fail", [], fraction, a, b)
    perimeter = ellipse_perimeter(a, b)
    factor = rules["girth_model"]["correction_factors"][site]
    return SiteResult(site, None, perimeter * factor, "pass", [], fraction, a, b, perimeter, factor)


def _front_half(front: View, y_px: float) -> float | None:
    assert front.silhouette is not None
    return sample_profile(front.silhouette["half_width_mm"], front.u(y_px))


def _side_half(side: View, y_px: float) -> float | None:
    assert side.silhouette is not None
    return sample_profile(side.silhouette["half_depth_mm"], side.u(y_px))


def _chest(front: View, side: View, data: Data, rules: Data, notes: Notes) -> SiteResult:
    sex = data["covariates"]["sex"]
    fraction = rules["levels"]["chest"][sex]
    if sex == "female":
        assert side.silhouette is not None
        best, best_value = None, -math.inf
        for candidate in band_fractions(*CHEST_ANTERIOR_BAND):
            value = sample_profile(side.silhouette["anterior_mm"], side.u(side.level_y(candidate)))
            if value is not None and value > best_value:
                best, best_value = candidate, value
        if best is not None and round_for_limit(abs(best - fraction)) > CHEST_ANTERIOR_TOL:
            notes.warn("chest", "chest_level_mismatch")
    a = _front_half(front, front.level_y(fraction))
    b = _side_half(side, side.level_y(fraction))
    return _girth("chest", a, b, fraction, rules, notes)


def _waist(front: View, side: View, rules: Data, notes: Notes) -> SiteResult:
    levels = rules["levels"]
    fraction = levels["waist"]
    best, best_value = None, math.inf
    for candidate in band_fractions(*levels["waist_check_band"]):
        value = _front_half(front, front.level_y(candidate))
        if value is not None and value < best_value:
            best, best_value = candidate, value
    if best is not None and round_for_limit(abs(best - fraction)) > levels["waist_check_tol"]:
        notes.warn("waist", "waist_level_mismatch")
    a = _front_half(front, front.level_y(fraction))
    b = _side_half(side, side.level_y(fraction))
    return _girth("waist", a, b, fraction, rules, notes)


def _hip(front: View, side: View, rules: Data, notes: Notes) -> SiteResult:
    if front.y(front.knee) <= front.y(front.hip) or side.y(side.knee) <= side.y(side.hip):
        notes.fail("hip", "mask_gap")
        return SiteResult("hip", None, None, "fail", [])
    best, best_value = None, -math.inf
    for candidate in band_fractions(0.0, rules["levels"]["hip_band_knee_fraction"]):
        value = _side_half(side, side.hip_band_y(candidate))
        if value is not None and value > best_value:
            best, best_value = candidate, value
    if best is None:
        notes.fail("hip", "mask_gap")
        return SiteResult("hip", None, None, "fail", [])
    a = _front_half(front, front.hip_band_y(best))
    return _girth("hip", a, best_value, best, rules, notes)


def _neck(front: View, side: View, rules: Data, notes: Notes) -> SiteResult:
    fraction = rules["levels"]["neck_above_shoulder_frac"]
    a = _front_half(front, front.level_y(-fraction))
    b = _side_half(side, side.level_y(-fraction))
    return _girth("neck", a, b, fraction, rules, notes)


def _pixels(view: View, first: int, second: int) -> float:
    assert view.silhouette is not None and view.landmarks is not None
    width, height = view.silhouette["image_w"], view.silhouette["image_h"]
    p, q = view.landmarks[first], view.landmarks[second]
    return _distance((p["x"] - q["x"]) * width, (p["y"] - q["y"]) * height)


def _compute(site: str, front: View, side: View, data: Data, rules: Data, arm: str,
             notes: Notes) -> SiteResult:  # fmt: skip
    offsets = rules["offsets_mm"]
    if site in GIRTHS:
        if site == "chest":
            return _chest(front, side, data, rules, notes)
        if site == "waist":
            return _waist(front, side, rules, notes)
        if site == "hip":
            return _hip(front, side, rules, notes)
        return _neck(front, side, rules, notes)
    raw: float
    if site == "stature":
        assert front.silhouette is not None and front.scale is not None
        raw = (front.silhouette["mask_bottom_px"] - front.silhouette["mask_top_px"]) * front.scale
    elif site == "shoulder":
        assert front.scale is not None
        raw = _pixels(front, 11, 12) * front.scale + 2 * offsets["acromion"] + offsets["shoulder"]
    elif site == "sleeve":
        assert front.scale is not None
        shoulder, elbow, wrist = ARMS[arm]
        pixels = _pixels(front, shoulder, elbow) + _pixels(front, elbow, wrist)
        raw = pixels * front.scale + offsets["sleeve"]
    elif site == "outleg":
        assert side.silhouette is not None and side.scale is not None
        waist_y = side.level_y(rules["levels"]["waist"])
        raw = (side.silhouette["mask_bottom_px"] - waist_y) * side.scale + offsets["outleg"]
    else:
        assert front.silhouette is not None and front.scale is not None
        crotch = front.silhouette["crotch_y_px"]
        if crotch is None:
            notes.fail("inleg", "crotch_not_found")
            return SiteResult("inleg", None, None, "fail", [])
        raw = (front.silhouette["mask_bottom_px"] - crotch) * front.scale + offsets["inleg"]
    return SiteResult(site, None, raw, "pass", [])


def derive(data: Data, rules: Data) -> Derivation:
    """Derive all nine sites from a profile's numbers under one rules artifact."""
    if rules["girth_model"]["type"] != "ellipse_cf":
        raise NotImplementedError("The ridge girth model arrives only if it is promoted (11.4)")

    front, side = _build_views(data, rules)
    notes = Notes()
    flags = rules["flags"]
    session, covariates = data["session"], data["covariates"]

    stature_scale: float | None = None
    disagreement: float | None = None
    if front.ok:
        assert front.silhouette is not None and front.scale is not None
        height_px = front.silhouette["mask_bottom_px"] - front.silhouette["mask_top_px"]
        stature_scale = covariates["height_mm_entered"] / height_px
        disagreement = round_for_limit(abs(front.scale - stature_scale) / front.scale * 100)

    free_arm = session.get("free_arm")
    arm = free_arm
    if arm is None:
        arm = _clearer_arm(data["landmarks_front"]) if data["landmarks_front"] else "right"
        for site in FREE_ARM_SITES:
            notes.warn(site, "free_arm_unknown")

    results: dict[str, SiteResult] = {}
    scale_cfg = rules["scale"]
    for site in SITES:
        view_failed = (site in FRONT_SITES and not front.ok) or (site in SIDE_SITES and not side.ok)
        if view_failed:
            notes.reasons[site].clear()
            notes.fail(site, "view_failed")
            results[site] = SiteResult(site, None, None, "fail", [])
            continue

        for view, index in _required_landmarks(site, front, side, arm):
            assert view.landmarks is not None
            visibility = view.landmarks[index]["visibility"]
            if visibility < flags["visibility_fail"]:
                notes.fail(site, "landmark_low")
            elif visibility < flags["visibility_check"]:
                notes.warn(site, "landmark_low")

        for name, used in (("marker_front", FRONT_SITES), ("marker_side", SIDE_SITES)):
            if site in used and data[name]["confidence"] < flags["marker_conf_check"]:
                notes.warn(site, "marker_weak")
        if disagreement is not None:
            over_retake = disagreement > scale_cfg["stature_disagree_retake_pct"]
            over_check = disagreement > scale_cfg["stature_disagree_check_pct"]
            if over_retake or (over_check and site in SCALE_BAND_SITES):
                notes.warn(site, "scale_disagree")
        if session["level_unchecked"]:
            notes.warn(site, "level_unchecked")
        if covariates["clothing_fit"] == "loose" and site in LOOSE_SITES:
            notes.warn(site, "loose_clothing")

        result = _compute(site, front, side, data, rules, arm, notes)
        if result.raw_mm is not None and site not in notes.failed:
            low, high = rules["plausible_mm"][site]
            if not low <= result.raw_mm <= high:
                notes.fail(site, "out_of_range")
        results[site] = result

    for site, result in results.items():
        result.reasons = [reason for reason in REASONS if reason in notes.reasons[site]]
        if site in notes.failed:
            result.flag = "fail"
            result.value_mm = None
        else:
            assert result.raw_mm is not None
            result.flag = "check" if result.reasons else "pass"
            result.value_mm = round_half_even(result.raw_mm)
    return Derivation(results, front.scale, side.scale, stature_scale, disagreement)
