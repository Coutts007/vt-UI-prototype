"""A synthetic person with known answers, drawn as stacked ellipses (M2).

Plateaus cover two whole samples at each body level, so interpolating there returns the exact
half-width and half-depth. Used by tests, parity fixtures and the demo seed. Never real data.
"""

import math
from dataclasses import dataclass
from typing import Any

IMAGE_W, IMAGE_H = 1080, 1920
MASK_TOP, MASK_BOTTOM = 200.0, 1800.0
U_SHOULDER, U_HIP, U_KNEE, U_CROTCH = 0.18, 0.52, 0.73, 0.53
U_WAIST = U_SHOULDER + 0.6 * (U_HIP - U_SHOULDER)
ARM_ANGLE = math.radians(20)


@dataclass(frozen=True)
class Body:
    stature: float = 1700.0
    shoulder: float = 420.0
    upper_arm: float = 300.0
    forearm: float = 300.0
    chest_a: float = 160.0
    chest_b: float = 115.0
    waist_a: float = 135.0
    waist_b: float = 100.0
    hip_a: float = 175.0
    hip_b: float = 120.0
    neck_a: float = 60.0
    neck_b: float = 55.0
    sex: str = "female"


def _interpolate(points: list[tuple[float, float]], u: float) -> float:
    for (u0, v0), (u1, v1) in zip(points, points[1:], strict=False):
        if u0 <= u <= u1:
            return v0 + (v1 - v0) * (u - u0) / (u1 - u0)
    return points[-1][1]


def _outlines(body: Body) -> tuple[list[float], list[float]]:
    width = [
        (0.0, 30.0),
        (0.06, body.neck_a + 25),
        (0.14, body.neck_a),
        (0.15, body.neck_a),
        (U_SHOULDER, body.shoulder / 2),
        (0.26, body.chest_a),
        (0.27, body.chest_a),
        (0.38, body.waist_a),
        (0.39, body.waist_a),
        (0.54, body.hip_a),
        (0.55, body.hip_a),
        (U_KNEE, body.hip_a * 0.6),
        (1.0, 60.0),
    ]
    depth = [
        (0.0, 30.0),
        (0.06, body.neck_b + 30),
        (0.14, body.neck_b),
        (0.15, body.neck_b),
        (U_SHOULDER, body.chest_b * 0.8),
        (0.26, body.chest_b),
        (0.27, body.chest_b),
        (0.38, body.waist_b),
        (0.39, body.waist_b),
        (0.54, body.hip_b),
        (0.55, body.hip_b),
        (U_KNEE, body.hip_b * 0.6),
        (1.0, 55.0),
    ]
    return (
        [round(_interpolate(width, i / 100), 3) for i in range(101)],
        [round(_interpolate(depth, i / 100), 3) for i in range(101)],
    )


def _landmarks(
    points: dict[int, tuple[float, float]], visibility: float, width: int, height: int
) -> list[dict[str, float]]:
    return [
        {
            "x": round(points[i][0] / width, 6),
            "y": round(points[i][1] / height, 6),
            "z": 0.0,
            "visibility": visibility,
        }
        for i in range(33)
    ]


def _front_points(body: Body, scale: float, free_arm: str, cx: float, top: float,
                  marker_y: float) -> dict[int, tuple[float, float]]:  # fmt: skip
    height = MASK_BOTTOM - MASK_TOP

    def y(u: float) -> float:
        return top + u * height

    half_shoulder = body.shoulder / 2 / scale
    half_hip = body.hip_a * 0.55 / scale
    points: dict[int, tuple[float, float]] = {0: (cx, y(0.04))}
    for i in range(1, 11):
        side = -1 if i % 2 else 1
        points[i] = (cx + side * (10 + i * 4), y(0.03 + i * 0.003))
    # Landmark 11 is the person's left, which is on the image's right when facing the camera.
    points[11] = (cx + half_shoulder, y(U_SHOULDER))
    points[12] = (cx - half_shoulder, y(U_SHOULDER))
    for name, side, elbow, wrist in (("left", 1, 13, 15), ("right", -1, 14, 16)):
        sx, sy = points[11 if side == 1 else 12]
        upper, fore = body.upper_arm / scale, body.forearm / scale
        if name == free_arm:
            ex = sx + side * upper * math.sin(ARM_ANGLE)
            ey = sy + upper * math.cos(ARM_ANGLE)
            wx = ex + side * fore * math.sin(ARM_ANGLE)
            wy = ey + fore * math.cos(ARM_ANGLE)
        else:
            # The holding arm bends so the hand reaches the sheet on the chest.
            ex = sx + side * upper * 0.35
            ey = sy + upper * 0.9
            wx, wy = cx + side * 12, marker_y + 40
        points[elbow], points[wrist] = (ex, ey), (wx, wy)
    for i, (base, dy) in enumerate(((15, 12), (16, 12), (15, 18), (16, 18), (15, 8), (16, 8))):
        points[17 + i] = (points[base][0], points[base][1] + dy)
    for left, right, u, half in (
        (23, 24, U_HIP, half_hip),
        (25, 26, U_KNEE, half_hip),
        (27, 28, 0.95, half_hip),
        (29, 30, 0.97, half_hip),
        (31, 32, 0.985, half_hip + 20),
    ):
        points[left] = (cx + half, y(u))
        points[right] = (cx - half, y(u))
    return points


def _side_points(body: Body, scale: float, cx: float, top: float) -> dict[int, tuple[float, float]]:
    height = MASK_BOTTOM - MASK_TOP

    def y(u: float) -> float:
        return top + u * height

    points: dict[int, tuple[float, float]] = {i: (cx + 25, y(0.03)) for i in range(11)}
    arm = body.waist_b * 0.2 / scale
    for left, right, u in (
        (11, 12, U_SHOULDER),
        (13, 14, 0.34),
        (15, 16, 0.47),
        (17, 18, 0.48),
        (19, 20, 0.485),
        (21, 22, 0.48),
        (23, 24, U_HIP),
        (25, 26, U_KNEE),
        (27, 28, 0.95),
        (29, 30, 0.97),
        (31, 32, 0.985),
    ):
        points[left] = (cx - arm, y(u))
        points[right] = (cx + arm, y(u))
    return points


def _marker(scale: float, cx: float, cy: float, confidence: float) -> dict[str, Any]:
    half = 150 / scale / 2
    return {
        "corners": [
            [round(cx - half, 3), round(cy - half, 3)],
            [round(cx + half, 3), round(cy - half, 3)],
            [round(cx + half, 3), round(cy + half, 3)],
            [round(cx - half, 3), round(cy + half, 3)],
        ],
        "image_w": IMAGE_W,
        "image_h": IMAGE_H,
        "side_px": round(2 * half, 3),
        "confidence": confidence,
    }


def make_input(
    body: Body,
    *,
    free_arm: str = "right",
    offset: tuple[int, int] = (0, 0),
    side_shift_px: int = 0,
    visibility: float = 0.95,
    height_mm: int | None = None,
    clothing_fit: str = "fitted",
    level_unchecked: bool = False,
    crotch: bool = True,
    side_marker_confidence: float = 0.95,
) -> dict[str, Any]:
    """Build the numbers a phone would send for this body. Its scale is stature / mask height."""
    dx, dy = offset
    scale = body.stature / (MASK_BOTTOM - MASK_TOP)
    front_top, side_top = MASK_TOP + dy, MASK_TOP + dy + side_shift_px
    span = MASK_BOTTOM - MASK_TOP
    cx = IMAGE_W / 2 + dx
    half_width, half_depth = _outlines(body)
    marker_y = front_top + 0.27 * span

    def silhouette(top: float) -> dict[str, Any]:
        return {
            "samples": 101,
            "mask_top_px": top,
            "mask_bottom_px": top + span,
            "image_w": IMAGE_W,
            "image_h": IMAGE_H,
        }

    return {
        "covariates": {
            "height_mm_entered": round(body.stature) if height_mm is None else height_mm,
            "sex": body.sex,
            "clothing_fit": clothing_fit,
            "code_verified": True,
        },
        "session": {"level_unchecked": level_unchecked, "free_arm": free_arm},
        "landmarks_front": _landmarks(
            _front_points(body, scale, free_arm, cx, front_top, marker_y),
            visibility,
            IMAGE_W,
            IMAGE_H,
        ),  # fmt: skip
        "landmarks_side": _landmarks(
            _side_points(body, scale, cx, side_top), visibility, IMAGE_W, IMAGE_H
        ),
        "marker_front": _marker(scale, cx, marker_y, 0.95),
        "marker_side": _marker(scale, cx, side_top + U_HIP * span, side_marker_confidence),
        "silhouette_front": {
            **silhouette(front_top),
            "half_width_mm": half_width,
            "centre_x_px": [cx] * 101,
            "crotch_y_px": front_top + U_CROTCH * span if crotch else None,
        },
        "silhouette_side": {
            **silhouette(side_top),
            "half_depth_mm": half_depth,
            "anterior_mm": [round(v * 1.05, 3) for v in half_depth],
        },
    }


def _perimeter(a: float, b: float) -> float:
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))


def expected_values(body: Body) -> dict[str, float]:
    """The right answers, worked out from the body alone under uncalibrated rules."""
    return {
        "stature": body.stature,
        "shoulder": body.shoulder,
        "chest": _perimeter(body.chest_a, body.chest_b),
        "waist": _perimeter(body.waist_a, body.waist_b),
        "hip": _perimeter(body.hip_a, body.hip_b),
        "sleeve": body.upper_arm + body.forearm,
        "outleg": (1 - U_WAIST) * body.stature,
        "inleg": (1 - U_CROTCH) * body.stature,
        "neck": _perimeter(body.neck_a, body.neck_b),
    }


def asymmetric_input() -> dict[str, Any]:
    """Two views that disagree on purpose, so a level can only be found by moving it correctly.

    One pixel is exactly 1 mm. The outlines are straight ramps: half-width is 100 + sample and
    half-depth is 50 + sample. Every answer can be worked out by hand (see test_derive.py).
    """
    width, height = 1000, 2000

    def view(
        points: dict[int, tuple[float, float]], weak: tuple[int, ...]
    ) -> list[dict[str, float]]:
        return [
            {
                "x": points.get(i, (500.0, 1000.0))[0] / width,
                "y": points.get(i, (500.0, 1000.0))[1] / height,
                "z": 0.0,
                "visibility": 0.6 if i in weak else 0.95,
            }
            for i in range(33)
        ]

    def marker(x: int, y: int) -> dict[str, Any]:
        return {
            "corners": [[x, y], [x + 150, y], [x + 150, y + 150], [x, y + 150]],
            "image_w": width,
            "image_h": height,
            "side_px": 150.0,
            "confidence": 0.95,
        }

    def mask(top: float, bottom: float) -> dict[str, Any]:
        return {
            "samples": 101,
            "mask_top_px": top,
            "mask_bottom_px": bottom,
            "image_w": width,
            "image_h": height,
        }

    front_points = {
        11: (700.0, 300.0), 12: (300.0, 300.0),
        13: (600.0, 500.0), 15: (520.0, 520.0),
        14: (200.0, 600.0), 16: (200.0, 900.0),
        23: (650.0, 1100.0), 24: (350.0, 1100.0),
        25: (650.0, 1500.0), 26: (350.0, 1500.0),
        27: (650.0, 1650.0), 28: (350.0, 1650.0),
    }  # fmt: skip
    # The far side sits elsewhere on purpose. It must only be used if it is the clearer side.
    side_points = {
        12: (500.0, 400.0), 24: (500.0, 1000.0), 26: (500.0, 1400.0),
        11: (500.0, 500.0), 23: (500.0, 1300.0), 25: (500.0, 1500.0),
    }  # fmt: skip
    return {
        "covariates": {
            "height_mm_entered": 1600,
            "sex": "male",
            "clothing_fit": "fitted",
            "code_verified": True,
        },
        "session": {"level_unchecked": False, "free_arm": "right"},
        "landmarks_front": view(front_points, ()),
        "landmarks_side": view(side_points, (11, 23, 25)),
        "marker_front": marker(425, 425),
        "marker_side": marker(425, 925),
        "silhouette_front": {
            **mask(100.0, 1700.0),
            "half_width_mm": [100.0 + i for i in range(101)],
            "centre_x_px": [500.0] * 101,
            "crotch_y_px": 900.0,
        },
        "silhouette_side": {
            **mask(200.0, 1800.0),
            "half_depth_mm": [50.0 + i for i in range(101)],
            "anterior_mm": [50.0 + i for i in range(101)],
        },
    }
