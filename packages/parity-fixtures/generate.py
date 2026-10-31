"""Write the parity cases from vt_measure. Never edit a case by hand: python generate.py."""

import copy
import json
import random
from dataclasses import asdict
from pathlib import Path
from typing import Any

from vt_measure.derive import derive
from vt_measure.synthetic import Body, asymmetric_input, make_input

ROOT = Path(__file__).parent
RULES = json.loads((ROOT.parent / "rules" / "rules-0.1-uncalibrated.json").read_text())


def changed_rules(path: list[str], value: Any) -> dict[str, Any]:
    rules = copy.deepcopy(RULES)
    target = rules
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return rules


def edited(change: Any, **options: Any) -> dict[str, Any]:
    data = make_input(Body(), **options)
    change(data)
    return data


def set_visibility(index: int, value: float) -> Any:
    def change(data: dict[str, Any]) -> None:
        data["landmarks_front"][index]["visibility"] = value

    return change


def set_marker_rectangle(long_side: float) -> Any:
    def change(data: dict[str, Any]) -> None:
        marker = data["marker_side"]
        short = marker["side_px"]
        x, y = marker["corners"][0]
        marker["corners"] = [
            [x, y],
            [x + short * long_side, y],
            [x + short * long_side, y + short],
            [x, y + short],
        ]

    return change


def set_stature_exactly(height_px: float) -> Any:
    """A 150 px marker makes one pixel exactly 1 mm, so stature can land on a half."""

    def change(data: dict[str, Any]) -> None:
        marker = data["marker_front"]
        x, y = 400, 500
        marker["corners"] = [[x, y], [x + 150, y], [x + 150, y + 150], [x, y + 150]]
        silhouette = data["silhouette_front"]
        silhouette["mask_bottom_px"] = silhouette["mask_top_px"] + height_px

    return change


def set_profile(view: str, field: str, values: dict[int, float | None]) -> Any:
    def change(data: dict[str, Any]) -> None:
        for index, value in values.items():
            data[f"silhouette_{view}"][field][index] = value

    return change


def set_key(key: str, value: Any) -> Any:
    def change(data: dict[str, Any]) -> None:
        data[key] = value

    return change


def unknown_free_arm(data: dict[str, Any]) -> None:
    data["session"]["free_arm"] = None


def larger_scale_image(data: dict[str, Any]) -> None:
    marker = data["marker_front"]
    marker["corners"] = [[x * 2, y * 2] for x, y in marker["corners"]]
    marker["image_w"], marker["image_h"] = marker["image_w"] * 2, marker["image_h"] * 2


def asymmetric(change: Any = None) -> dict[str, Any]:
    data = asymmetric_input()
    if change:
        change(data)
    return data


def clearer_left_side(data: dict[str, Any]) -> None:
    for index, value in ((12, 0.55), (24, 0.55), (26, 0.55), (11, 0.95), (23, 0.95), (25, 0.95)):
        data["landmarks_side"][index]["visibility"] = value


def hip_on_shoulder(data: dict[str, Any]) -> None:
    for index in (23, 24):
        data["landmarks_front"][index]["y"] = data["landmarks_front"][11]["y"]


def knee_above_hip(data: dict[str, Any]) -> None:
    data["landmarks_side"][26]["y"] = 0.45


def narrow_at_limit(data: dict[str, Any]) -> None:
    data["silhouette_front"]["half_width_mm"][40] = 50.0


def narrow_past_limit(data: dict[str, Any]) -> None:
    data["silhouette_front"]["half_width_mm"][39] = 50.0
    data["silhouette_front"]["half_width_mm"][40] = 50.0


def arm_tie(data: dict[str, Any]) -> None:
    data["session"]["free_arm"] = None
    values = (0.83, 0.75, 0.95, 0.95, 0.75, 0.83)
    for index, value in zip((11, 13, 15, 12, 14, 16), values, strict=True):
        data["landmarks_front"][index]["visibility"] = value


def analytic_cases() -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    bodies = {
        "default": Body(),
        "round-waist": Body(waist_a=120.0, waist_b=120.0),
        "tall": Body(stature=2000.0),
        "short": Body(stature=1450.0),
        "male": Body(sex="male"),
        "unspecified": Body(sex="unspecified"),
    }
    cases = [(f"analytic-{k}", make_input(v), RULES) for k, v in bodies.items()]
    cases.append(("analytic-views-differ", asymmetric(), RULES))
    return cases


def edge_cases() -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    body = Body(stature=1500.0)
    return [
        ("edge-near-side-left", asymmetric(clearer_left_side), RULES),
        ("edge-levels-waist-050", asymmetric(), changed_rules(["levels", "waist"], 0.5)),
        ("edge-levels-chest-050", asymmetric(), changed_rules(["levels", "chest", "male"], 0.5)),
        ("edge-levels-hip-050", asymmetric(),
         changed_rules(["levels", "hip_band_knee_fraction"], 0.5)),
        ("edge-levels-neck-020", asymmetric(),
         changed_rules(["levels", "neck_above_shoulder_frac"], 0.2)),
        ("edge-hip-on-shoulder", asymmetric(hip_on_shoulder), RULES),
        ("edge-knee-above-hip", asymmetric(knee_above_hip), RULES),
        ("edge-waist-tol-on-limit", asymmetric(narrow_at_limit), RULES),
        ("edge-waist-tol-past-limit", asymmetric(narrow_past_limit), RULES),
        ("edge-arm-visibility-tie", edited(arm_tie), RULES),
        ("edge-side-shift", make_input(Body(), side_shift_px=40), RULES),
        ("edge-visibility-049", edited(set_visibility(11, 0.49)), RULES),
        ("edge-visibility-050", edited(set_visibility(11, 0.5)), RULES),
        ("edge-visibility-069", edited(set_visibility(11, 0.69)), RULES),
        ("edge-visibility-070", edited(set_visibility(11, 0.7)), RULES),
        ("edge-aspect-1030", edited(set_marker_rectangle(1.03)), RULES),
        ("edge-aspect-1031", edited(set_marker_rectangle(1.031)), RULES),
        ("edge-disagree-2pct", make_input(body, height_mm=1530), RULES),
        ("edge-disagree-3pct", make_input(body, height_mm=1545), RULES),
        ("edge-disagree-4pct", make_input(body, height_mm=1560), RULES),
        ("edge-disagree-over-4pct", make_input(body, height_mm=1561), RULES),
        ("edge-crotch-missing", make_input(Body(), crotch=False), RULES),
        ("edge-null-sample", edited(set_profile("front", "half_width_mm", {38: None})), RULES),
        ("edge-half-below-15", edited(set_profile("front", "half_width_mm", {14: 14.9, 15: 14.9})),
         RULES),
        ("edge-waist-mismatch", edited(set_profile("front", "half_width_mm", {35: 60.0})), RULES),
        ("edge-chest-mismatch", edited(set_profile("side", "anterior_mm", {30: 390.0})), RULES),
        ("edge-level-unchecked", make_input(Body(), level_unchecked=True), RULES),
        ("edge-loose", make_input(Body(), clothing_fit="loose"), RULES),
        ("edge-marker-weak-079", make_input(Body(), side_marker_confidence=0.79), RULES),
        ("edge-marker-weak-080", make_input(Body(), side_marker_confidence=0.8), RULES),
        ("edge-free-arm-left", make_input(Body(), free_arm="left"), RULES),
        ("edge-free-arm-unknown", edited(unknown_free_arm), RULES),
        ("edge-side-marker-missing", edited(set_key("marker_side", None)), RULES),
        ("edge-front-silhouette-missing", edited(set_key("silhouette_front", None)), RULES),
        ("edge-larger-scale-image", edited(larger_scale_image), RULES),
        ("edge-round-half-down", edited(set_stature_exactly(1700.5)), RULES),
        ("edge-round-half-up", edited(set_stature_exactly(1701.5)), RULES),
        ("edge-out-of-range", make_input(Body()),
         changed_rules(["plausible_mm", "waist"], [450, 500])),
        ("edge-correction-factor", make_input(Body()),
         changed_rules(["girth_model", "correction_factors", "waist"], 1.1)),
        ("edge-offsets", make_input(Body()), changed_rules(["offsets_mm", "sleeve"], 7)),
        ("edge-depth-correction", make_input(Body()),
         changed_rules(["scale", "depth_correction_mm", "front"], 100)),
    ]  # fmt: skip


def random_cases() -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    rng = random.Random(20261031)
    cases = []
    for i in range(20):
        waist_a = rng.uniform(110, 190)
        waist_b = rng.uniform(85, 150)
        body = Body(
            stature=rng.uniform(1450, 1950),
            shoulder=rng.uniform(340, 520),
            upper_arm=rng.uniform(260, 350),
            forearm=rng.uniform(240, 330),
            chest_a=waist_a + rng.uniform(5, 40),
            chest_b=waist_b + rng.uniform(5, 30),
            waist_a=waist_a,
            waist_b=waist_b,
            hip_a=waist_a + rng.uniform(5, 50),
            hip_b=waist_b + rng.uniform(5, 40),
            neck_a=rng.uniform(50, 75),
            neck_b=rng.uniform(45, 70),
            sex=rng.choice(["female", "male", "unspecified"]),
        )
        data = make_input(
            body,
            free_arm=rng.choice(["left", "right"]),
            offset=(rng.randint(-60, 60), rng.randint(-60, 60)),
            height_mm=round(body.stature * rng.uniform(0.97, 1.03)),
            clothing_fit=rng.choice(["fitted", "fitted", "loose"]),
            level_unchecked=rng.random() < 0.15,
        )
        cases.append((f"random-{i + 1:02d}", data, RULES))
    return cases


def render(name: str, data: dict[str, Any], rules: dict[str, Any]) -> str:
    expected = asdict(derive(data, rules))
    case = {"name": name, "input": data, "rules": rules, "expected": expected}
    return json.dumps(case, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def all_cases() -> dict[str, str]:
    cases = analytic_cases() + edge_cases() + random_cases()
    return {name: render(name, data, rules) for name, data, rules in cases}


if __name__ == "__main__":
    folder = ROOT / "cases"
    for old in folder.glob("*.json"):
        old.unlink()
    for name, text in all_cases().items():
        (folder / f"{name}.json").write_text(text)
