"""Generate seed.json, the single demo seed. Output is byte-identical on every run.

All data is synthetic. Measurement values come from a simple stacked-ellipse body so that the
silhouettes and values agree; M2 replaces them with values derived by vt_measure.
"""

import json
import math
import random
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

NAMESPACE = uuid.UUID("6f1d3c52-8a44-5e0b-9a7c-1f2e3d4c5b6a")
ANCHOR = date(2026, 11, 2)
RULES_VERSION = "0.1-uncalibrated"
CONSENT_VERSION = "1.0"
APP_VERSION = "0.1.0"
SITES = ["stature", "shoulder", "chest", "waist", "hip", "sleeve", "outleg", "inleg", "neck"]

IMAGE_W, IMAGE_H = 1080, 1920
MASK_TOP, MASK_BOTTOM = 200.0, 1800.0
U_NECK, U_SHOULDER, U_HIP, U_CROTCH, U_KNEE = 0.15, 0.18, 0.52, 0.53, 0.73


def uid(name: str) -> str:
    return str(uuid.uuid5(NAMESPACE, name))


def at(days: int, hour: int = 9) -> str:
    moment = datetime(ANCHOR.year, ANCHOR.month, ANCHOR.day, hour, tzinfo=UTC) + timedelta(
        days=days
    )
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def day(days: int) -> str:
    return (ANCHOR + timedelta(days=days)).isoformat()


def interpolate(points: list[tuple[float, float]], u: float) -> float:
    for (u0, v0), (u1, v1) in zip(points, points[1:], strict=False):
        if u0 <= u <= u1:
            return v0 + (v1 - v0) * (u - u0) / (u1 - u0)
    return points[-1][1]


def ellipse_perimeter(a: float, b: float) -> float:
    """Ramanujan's second approximation."""
    h = ((a - b) / (a + b)) ** 2
    return math.pi * (a + b) * (1 + 3 * h / (10 + math.sqrt(4 - 3 * h)))


def body_profiles(body: dict[str, Any]) -> tuple[list[float], list[float]]:
    k = body["stature"] / 1650
    width = [
        (0.0, 40),
        (0.06, 75),
        (U_NECK, 58),
        (U_SHOULDER, body["shoulder"] / k / 2),
        (0.27, body["chest_w"]),
        (0.39, body["waist_w"]),
        (U_HIP, body["hip_w"]),
        (U_KNEE, 110),
        (1.0, 80),
    ]
    depth = [
        (0.0, 40),
        (0.06, 90),
        (U_NECK, 55),
        (U_SHOULDER, 90),
        (0.27, body["chest_d"]),
        (0.39, body["waist_d"]),
        (U_HIP, body["hip_d"]),
        (U_KNEE, 70),
        (1.0, 60),
    ]
    half_width = [round(interpolate(width, i / 100) * k, 1) for i in range(101)]
    half_depth = [round(interpolate(depth, i / 100) * k, 1) for i in range(101)]
    return half_width, half_depth


def landmarks(body: dict[str, Any], view: str, visibility: float, rng: random.Random) -> list[dict]:
    """The 33 BlazePose landmarks of a person standing centred in the frame."""
    scale = body["stature"] / (MASK_BOTTOM - MASK_TOP)
    half_width, half_depth = body_profiles(body)

    def point(u: float, offset_mm: float) -> tuple[float, float]:
        x = (IMAGE_W / 2 + offset_mm / scale) / IMAGE_W
        y = (MASK_TOP + u * (MASK_BOTTOM - MASK_TOP)) / IMAGE_H
        return x, y

    shoulder = half_width[18] if view == "front" else half_depth[18] * 0.4
    hip = half_width[52] * 0.55 if view == "front" else half_depth[52] * 0.3
    spread = 1.0 if view == "front" else 0.3
    pairs = [
        (0.03, 25 * spread),
        (0.03, 35 * spread),
        (0.03, 45 * spread),
        (0.05, 70 * spread),
        (0.08, 20 * spread),
    ]
    points = [point(0.04, 0.0)]
    for u, offset in pairs[:3]:
        points.append(point(u, -offset))
    for u, offset in pairs[:3]:
        points.append(point(u, offset))
    points += [point(pairs[3][0], -pairs[3][1]), point(pairs[3][0], pairs[3][1])]
    points += [point(pairs[4][0], -pairs[4][1]), point(pairs[4][0], pairs[4][1])]
    arm = shoulder + 110 * spread
    for u, off in [
        (U_SHOULDER, shoulder),
        (0.33, arm),
        (0.46, arm + 40 * spread),
        (0.48, arm + 45 * spread),
        (0.48, arm + 30 * spread),
        (0.47, arm + 35 * spread),
    ]:
        points += [point(u, -off), point(u, off)]
    for u, off in [
        (U_HIP, hip),
        (U_KNEE, hip),
        (0.95, hip),
        (0.97, hip),
        (0.985, hip + 40 * spread),
    ]:
        points += [point(u, -off), point(u, off)]
    return [
        {
            "x": round(x, 5),
            "y": round(y, 5),
            "z": round(rng.uniform(-0.1, 0.1), 4),
            "visibility": round(min(1.0, visibility + rng.uniform(0, 0.04)), 3),
        }
        for x, y in points
    ]


def marker(scale: float, u: float, rng: random.Random) -> dict[str, Any]:
    side = 150 / scale
    cx = IMAGE_W / 2 + rng.uniform(-3, 3)
    cy = MASK_TOP + u * (MASK_BOTTOM - MASK_TOP)
    half = side / 2
    return {
        "corners": [
            [round(cx - half, 2), round(cy - half, 2)],
            [round(cx + half, 2), round(cy - half, 2)],
            [round(cx + half, 2), round(cy + half, 2)],
            [round(cx - half, 2), round(cy + half, 2)],
        ],
        "image_w": IMAGE_W,
        "image_h": IMAGE_H,
        "side_px": round(side, 3),
        "confidence": 0.95,
    }


def base_measurements(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    half_width, half_depth = body_profiles(body)
    out: dict[str, dict[str, Any]] = {}

    def add(site: str, value: float, **extra: Any) -> None:
        out[site] = {
            "site_code": site,
            "value_mm": round(value),
            "method": "auto",
            "confidence_flag": "pass",
            "flag_reasons": [],
            **extra,
        }

    def girth(site: str, index: int, fraction: float) -> None:
        a, b = half_width[index], half_depth[index]
        add(
            site,
            ellipse_perimeter(a, b),
            correction_factor=1.0,
            level_fraction=fraction,
            half_width_mm=a,
            half_depth_mm=b,
        )

    stature = body["stature"]
    add("stature", stature)
    add("shoulder", half_width[18] * 2)
    girth("chest", 27, 0.25)
    girth("waist", 38, 0.6)
    girth("hip", 52, 1.0)
    add("sleeve", stature * 0.355)
    add("outleg", stature * 0.61)
    add("inleg", stature * 0.46)
    girth("neck", 15, 0.1)
    return out


def flag(rows: dict[str, dict], sites: list[str], severity: str, reason: str) -> None:
    for site in sites:
        row = rows[site]
        row["confidence_flag"] = severity
        row["flag_reasons"].append(reason)
        if severity == "fail":
            row["value_mm"] = None


def checks(**overrides: str) -> dict[str, str]:
    names = ["level", "frame", "distance", "symmetry", "arms", "marker", "light", "sharpness"]
    return {name: overrides.get(name, "pass") for name in names}


BODIES = {
    "a": dict(stature=1640, shoulder=400, chest_w=150, waist_w=128, hip_w=172,
              chest_d=112, waist_d=98, hip_d=118, sex="female"),
    "b": dict(stature=1775, shoulder=450, chest_w=165, waist_w=145, hip_w=165,
              chest_d=120, waist_d=110, hip_d=115, sex="male"),
    "c": dict(stature=1590, shoulder=385, chest_w=158, waist_w=148, hip_w=182,
              chest_d=120, waist_d=112, hip_d=128, sex="female"),
    "d": dict(stature=1710, shoulder=430, chest_w=155, waist_w=132, hip_w=160,
              chest_d=110, waist_d=98, hip_d=108, sex="unspecified"),
}  # fmt: skip

TAILORS = {"wanjiru": uid("user:wanjiru"), "otieno": uid("user:otieno")}
CLIENTS = [
    ("W1", "wanjiru", "AB1001", "Akinyi", 1640),
    ("W2", "wanjiru", "AB1002", None, 1590),
    ("W3", "wanjiru", "AB1003", "Njeri", 1710),
    ("W4", "wanjiru", "AB1004", None, 1775),
    ("W5", "wanjiru", "AB1005", "Chebet", 1640),
    ("W6", "wanjiru", "AB1006", "Mwende", 1590),
    ("W7", "wanjiru", "AB1007", None, 1710),
    ("W8", "wanjiru", "AB1008", "Halima", None),
    ("O1", "otieno", "CD2001", "Ouma", 1775),
    ("O2", "otieno", "CD2002", None, 1710),
    ("O3", "otieno", "CD2003", "Atieno", 1640),
]
CLIENT_BY_KEY = {c[0]: c for c in CLIENTS}
STUDY = {"O1": "P001", "O2": "P002", "O3": "P003", "W7": "P004", "W8": "P005"}


def build_users() -> list[dict[str, Any]]:
    def user(key: str, role: str, status: str = "active", **extra: Any) -> dict[str, Any]:
        return {
            "user_id": uid(f"user:{key}"),
            "email": f"{key}@vt.test",
            "role": role,
            "status": status,
            "locale": "en",
            "unit_pref": "cm",
            "created_at": at(-120),
            **extra,
        }

    return [
        user("admin", "admin"),
        user("wanjiru", "tailor", business_name="Mama Wanjiru Tailors", phone="0700000001",
             area="Gikomba"),
        user("otieno", "tailor", business_name="Otieno Bespoke", phone="0700000002", area="CBD"),
        user("pending", "tailor", "pending", business_name="Pending Tailors", phone="0700000003",
             area="Thika"),
        user("measurer-a", "measurer", measurer_code="A", trained_on=day(-100)),
        user("measurer-b", "measurer", measurer_code="B", trained_on=day(-100)),
    ]  # fmt: skip


def build_clients() -> list[dict[str, Any]]:
    return [
        {
            "client_id": uid(f"client:{key}"),
            "client_code": code,
            "tailor_id": TAILORS[owner],
            "display_name": name,
            "height_mm": height,
            "created_at": at(-90 + i),
            "deletion_requested": False,
        }
        for i, (key, owner, code, name, height) in enumerate(CLIENTS)
    ]


# key, client, version, body, days ago, status, scenario
PROFILES = [
    ("p01", "W1", 1, "a", -40, "superseded", "all_pass"),
    ("p02", "W1", 2, "a", -5, "final", "all_pass"),
    ("p03", "W2", 1, "c", -12, "final", "waist_check"),
    ("p04", "W3", 1, "d", -10, "final", "inleg_fail"),
    ("p05", "W4", 1, "b", -9, "final", "level_unchecked"),
    ("p06", "W5", 1, "a", -8, "final", "loose"),
    ("p07", "W6", 3, "c", -7, "final", "all_pass"),
    ("p08", "W6", 3, "c", -6, "conflict", "all_pass"),
    ("p09", "W7", 1, "d", -20, "final", "assisted"),
    ("p10", "O1", 1, "b", -22, "final", "all_pass"),
    ("p11", "O2", 1, "d", -21, "final", "all_pass"),
    ("p12", "O3", 1, "a", -19, "final", "all_pass"),
]


def build_profile(entry: tuple, rng: random.Random) -> dict[str, Any]:
    key, client_key, version, body_key, days, status, scenario = entry
    body = BODIES[body_key]
    client_code = CLIENT_BY_KEY[client_key][2]
    scale = body["stature"] / (MASK_BOTTOM - MASK_TOP)
    disagreement = 3.2 if scenario == "waist_check" else 0.4
    rows = base_measurements(body)
    half_width, half_depth = body_profiles(body)
    crotch_y: float | None = MASK_TOP + U_CROTCH * (MASK_BOTTOM - MASK_TOP)
    level_state = "pass"
    fit = "fitted"
    server_checks: list[dict[str, Any]] = []

    if scenario == "waist_check":
        flag(rows, ["waist"], "check", "scale_disagree")
    elif scenario == "inleg_fail":
        flag(rows, ["inleg"], "fail", "crotch_not_found")
        crotch_y = None
    elif scenario == "level_unchecked":
        flag(rows, SITES, "check", "level_unchecked")
        level_state = "skipped"
    elif scenario == "loose":
        flag(rows, ["chest", "waist", "hip"], "check", "loose_clothing")
        fit = "loose"
    if key == "p02":
        server_checks.append(
            {
                "kind": "change_since_last",
                "severity": "info",
                "site_code": "waist",
                "detail": {"delta_mm": 12, "days": 35},
            }
        )

    study: dict[str, Any] = {}
    if client_key in STUDY:
        study["study"] = {
            "participant_code": STUDY[client_key],
            "set_no": 1,
            "lighting": "window",
            "distance_m": 2.2,
            "clothing_fit_observed": "fitted",
        }
    captured = at(days)
    return {
        "profile_id": uid(f"profile:{key}"),
        "client_id": uid(f"client:{client_key}"),
        "client_code": client_code,
        "version": version,
        "captured_at": captured,
        "received_at": at(days, 10),
        "status": status,
        "rules_version": RULES_VERSION,
        "covariates": {
            "height_mm_entered": body["stature"],
            "sex": body["sex"],
            "clothing_fit": fit,
            "code_verified": True,
        },
        "consent": {
            "consent_version": CONSENT_VERSION,
            "language": "en",
            "scope": ["measure", "measurements_only", "retention"]
            + (["study_paper"] if client_key in STUDY else []),
            "given_at": captured,
        },
        "session": {
            "session_id": uid(f"session:{key}"),
            "started_at": captured,
            "capture_mode": "assisted" if scenario == "assisted" else "self",
            "camera_facing": "environment",
            "guidance_mode": "visual" if scenario == "assisted" else "voice",
            "free_arm": "right",
            "app_version": APP_VERSION,
            "device_model": "Synthetic phone",
            "os": "Android 14",
            "browser": "Chrome 126",
            "memory_gb": 4,
            "model_variant": "lite",
            "stream_w": IMAGE_W,
            "stream_h": IMAGE_H,
            "still_source": "imagecapture",
            "level_unchecked": scenario == "level_unchecked",
            "capture_fallback": False,
            "front_checks": checks(level=level_state),
            "side_checks": checks(level=level_state),
            "scale_front_mm_px": round(scale, 5),
            "scale_side_mm_px": round(scale * 1.002, 5),
            "scale_stature_mm_px": round(scale * (1 + disagreement / 100), 5),
            "scale_disagreement_pct": disagreement,
            "processing_ms": 6200 + rng.randrange(1500),
            "retake_count": 0,
            "config_hash": "sha256:synthetic",
            **study,
        },
        "landmarks_front": landmarks(body, "front", 0.9, rng),
        "landmarks_side": landmarks(body, "side", 0.9, rng),
        "marker_front": marker(scale, 0.27, rng),
        "marker_side": marker(scale, 0.52, rng),
        "silhouette_front": {
            "samples": 101,
            "mask_top_px": MASK_TOP,
            "mask_bottom_px": MASK_BOTTOM,
            "image_w": IMAGE_W,
            "image_h": IMAGE_H,
            "half_width_mm": half_width,
            "centre_x_px": [IMAGE_W / 2] * 101,
            "crotch_y_px": crotch_y,
        },
        "silhouette_side": {
            "samples": 101,
            "mask_top_px": MASK_TOP,
            "mask_bottom_px": MASK_BOTTOM,
            "image_w": IMAGE_W,
            "image_h": IMAGE_H,
            "half_depth_mm": half_depth,
            "anterior_mm": [round(v * 1.05, 1) for v in half_depth],
        },
        "measurements": [rows[site] for site in SITES],
        "server_checks": server_checks,
    }


def build_conflict(profiles: dict[str, dict]) -> dict[str, Any]:
    def side(profile: dict) -> dict[str, Any]:
        return {k: profile[k] for k in ("profile_id", "version", "captured_at", "measurements")}

    server, incoming = profiles["p07"], profiles["p08"]
    return {
        "conflict_id": uid("conflict:W6"),
        "client_id": server["client_id"],
        "client_code": server["client_code"],
        "server_profile": side(server),
        "incoming_profile": side(incoming),
        "created_at": at(-6, 10),
        "resolved_at": None,
        "resolution": None,
    }


EASE = {"shoulder": 10, "chest": 80, "waist": 60, "hip": 50, "sleeve": 15, "neck": 15, "outleg": 0}
# no, profile, tailor, garment, status, due in days, scenario
ORDERS = [
    (1, "p02", "wanjiru", "shirt", "new", 14, "plain"),
    (2, "p03", "wanjiru", "dress", "new", 21, "flagged"),
    (3, "p06", "wanjiru", "dress", "cutting", -2, "plain"),
    (4, "p04", "wanjiru", "trousers", "cutting", 9, "pending_fitting"),
    (5, "p05", "wanjiru", "suit_jacket", "fitting", 6, "override"),
    (6, "p09", "wanjiru", "shirt", "fitting", 5, "plain"),
    (7, "p02", "wanjiru", "skirt", "ready", 2, "plain"),
    (8, "p07", "wanjiru", "shirt", "collected", -15, "plain"),
    (9, "p10", "otieno", "suit_jacket", "ready", 3, "plain"),
    (10, "p11", "otieno", "shirt", "collected", -12, "plain"),
]
GARMENT_SITES = {
    "shirt": ["shoulder", "chest", "waist", "sleeve", "neck"],
    "dress": ["shoulder", "chest", "waist", "hip", "sleeve"],
    "trousers": ["waist", "hip", "outleg", "inleg"],
    "suit_jacket": ["shoulder", "chest", "waist", "hip", "sleeve", "neck"],
    "skirt": ["waist", "hip"],
}
STATUS_ORDER = ["new", "cutting", "fitting", "ready", "collected"]


def build_order(entry: tuple, profiles: dict[str, dict]) -> dict[str, Any]:
    no, profile_key, tailor, garment, status, due, scenario = entry
    number = sum(1 for o in ORDERS if o[2] == tailor and o[0] <= no)
    profile = profiles[profile_key]
    client = CLIENT_BY_KEY[next(c[0] for c in CLIENTS if c[2] == profile["client_code"])]
    rows = {m["site_code"]: m for m in profile["measurements"]}
    items = []
    for site in GARMENT_SITES[garment]:
        row = rows[site]
        body_mm = row["value_mm"]
        ease = 0 if site == "inleg" else EASE[site]
        item: dict[str, Any] = {
            "site_code": site,
            "body_mm": body_mm,
            "ease_mm": ease,
            "finished_mm": None if body_mm is None else body_mm + ease,
            "overridden": False,
            "confidence_flag": row["confidence_flag"],
        }
        if row["confidence_flag"] == "check":
            item["flag_confirmed"] = True
        if body_mm is None:
            item["pending_fitting"] = True
        if scenario == "override" and site == "chest":
            item.update(
                body_mm=body_mm + 15,
                finished_mm=body_mm + 15 + ease,
                overridden=True,
                override_reason="Re-measured by tape at fitting",
            )
        items.append(item)
    created = -30 + no
    history = [
        {"status": s, "at": at(created + i)}
        for i, s in enumerate(STATUS_ORDER[: STATUS_ORDER.index(status) + 1])
    ]
    return {
        "order_id": uid(f"order:{no}"),
        "order_no": f"ORD-{number:04d}",
        "client_id": profile["client_id"],
        "client_code": profile["client_code"],
        "display_name": client[3],
        "profile_id": profile["profile_id"],
        "profile_version": profile["version"],
        "garment_type": garment,
        "status": status,
        "due_date": day(due),
        "notes": "",
        "items": items,
        "created_at": history[0]["at"],
        "updated_at": history[-1]["at"],
        "status_history": history,
    }


def build_audit(users: list[dict], orders: list[dict]) -> list[dict[str, Any]]:
    wanjiru = next(u for u in users if u["email"].startswith("wanjiru"))
    admin = next(u for u in users if u["role"] == "admin")
    measurer = next(u for u in users if u["role"] == "measurer")
    entries: list[tuple] = []
    entries.append((admin, "login", "user", admin["user_id"], "Signed in"))
    entries.append((admin, "approve", "user", TAILORS["wanjiru"], "Approved a tailor"))
    entries.append((admin, "approve", "user", TAILORS["otieno"], "Approved a tailor"))
    entries.append((admin, "account_create", "user", measurer["user_id"], "Added a measurer"))
    entries.append((admin, "settings_change", "settings", "study_mode", "Turned study mode on"))
    for client in CLIENTS[:8]:
        entries.append(
            (wanjiru, "code_issue", "client", uid(f"client:{client[0]}"), "Issued a client code")
        )
    for order in orders[:8]:
        entries.append(
            (wanjiru, "order_create", "order", order["order_id"], f"Created {order['order_no']}")
        )
    for order in orders[2:8]:
        entries.append(
            (wanjiru, "status_change", "order", order["order_id"],
             f"{order['order_no']} moved to {order['status']}")
        )  # fmt: skip
    entries.append((wanjiru, "override", "order", orders[4]["order_id"], "Overrode the chest"))
    for key, *_ in PROFILES[:4]:
        entries.append((None, "profile_ingest", "profile", uid(f"profile:{key}"), "Synced"))
    for key, *_ in PROFILES[1:4]:
        entries.append((wanjiru, "profile_view", "profile", uid(f"profile:{key}"), "Opened"))
    entries.append((wanjiru, "export", "sheet", uid("sheet:1"), "Generated a sheet"))
    entries.append((wanjiru, "share", "sheet", uid("sheet:1"), "Shared on WhatsApp"))
    entries.append((measurer, "reference_entry", "participant", uid("participant:P001"), "Saved"))
    entries.append((wanjiru, "logout", "user", wanjiru["user_id"], "Signed out"))
    entries.append((None, "login_failed", "user", "unknown", "Wrong password"))
    assert len(entries) == 40, len(entries)
    rows = []
    for i, (user, action, entity, entity_id, summary) in enumerate(entries):
        rows.append(
            {
                "log_id": f"L{i + 1:05d}",
                "occurred_at": at(-60 + i),
                "actor_type": "user"
                if user
                else ("system" if action == "login_failed" else "client"),
                "user_email": user["email"] if user else None,
                "role": user["role"] if user else None,
                "action": action,
                "entity_type": entity,
                "entity_id": entity_id,
                "summary": summary,
            }
        )
    return rows


def build_study(profiles: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    plan = [
        ("P001", "O1", "male", "25-34", "pilot", 1, [("A", 1), ("A", 2), ("B", 1), ("B", 2)]),
        ("P002", "O2", "unspecified", "35-44", "calibration", 1, [("A", 1), ("A", 2)]),
        ("P003", "O3", "female", "18-24", "calibration", 1, [("A", 1)]),
        ("P004", "W7", "unspecified", "45-54", "test", 1, []),
        ("P005", "W8", "female", "25-34", "test", 0, []),
    ]
    rng = random.Random(2026)
    participants, readings = [], []
    for code, client_key, sex, age, cohort, sets, plan_readings in plan:
        participants.append(
            {
                "participant_id": uid(f"participant:{code}"),
                "participant_code": code,
                "client_code": CLIENT_BY_KEY[client_key][2],
                "sex": sex,
                "age_band": age,
                "venue": "Synthetic venue",
                "cohort": cohort,
                "enrolled_at": at(-30),
                "sets_captured": sets,
                "readings_entered": len(plan_readings),
            }
        )
        profile = next((p for p in profiles.values() if p["client_code"] ==
                        CLIENT_BY_KEY[client_key][2]), None)  # fmt: skip
        for measurer, reading_no in plan_readings:
            assert profile is not None
            for row in profile["measurements"]:
                readings.append(
                    {
                        "ref_id": uid(f"reading:{code}:{measurer}:{reading_no}:{row['site_code']}"),
                        "participant_code": code,
                        "measurer_code": measurer,
                        "reading_no": reading_no,
                        "site_code": row["site_code"],
                        "value_mm": row["value_mm"] + rng.randint(-6, 6),
                        "taken_at": at(-18),
                        "out_of_order": False,
                        "correction": None,
                    }
                )
    return participants, readings


def build_seed() -> dict[str, Any]:
    rng = random.Random(20261031)
    users = build_users()
    profiles = {entry[0]: build_profile(entry, rng) for entry in PROFILES}
    orders = [build_order(entry, profiles) for entry in ORDERS]
    participants, readings = build_study(profiles)
    return {
        "anchor_date": ANCHOR.isoformat(),
        "demo_password": "vt-demo-2026",
        "users": users,
        "clients": build_clients(),
        "profiles": list(profiles.values()),
        "conflicts": [build_conflict(profiles)],
        "orders": orders,
        "ease_presets": [
            {
                "tailor_id": TAILORS["wanjiru"],
                "presets": [{"garment_type": "shirt", "site_code": "chest", "ease_mm": 90}],
            }
        ],
        "audit": build_audit(users, orders),
        "participants": participants,
        "reference_readings": readings,
        "deletion_requests": [],
        "settings": {
            "retention_months": 24,
            "audit_retention_months": 24,
            "study_mode": True,
            "study_collection_end": None,
            "current_rules_version": RULES_VERSION,
            "min_app_version": APP_VERSION,
            "consent_version": CONSENT_VERSION,
            "approvals": {
                "ierc_ref": None,
                "nacosti_licence_no": None,
                "dpia_submitted_on": None,
                "approvals_confirmed_by": None,
                "confirmed_at": None,
                "odpc_response_on": None,
                "odpc_response_ref": None,
            },
            "approvals_missing": [
                "ierc_ref",
                "nacosti_licence_no",
                "dpia_submitted_on",
                "approvals_confirmed_by",
                "confirmed_at",
            ],
            "earliest_collection_date": None,
        },
    }


def render() -> str:
    return json.dumps(build_seed(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    Path(__file__).with_name("seed.json").write_text(render())
