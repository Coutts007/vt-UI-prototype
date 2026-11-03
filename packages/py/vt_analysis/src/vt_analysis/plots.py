"""Figures (backend-spec 12.6): 300 dpi PNG and SVG, one colour-blind-safe palette, deterministic.

Matplotlib writes a date into SVG metadata and a software tag into PNG by default; both are
removed so two runs on the same inputs give identical files.
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

# Okabe and Ito palette.
BLUE, ORANGE, GREEN, VERMILION, GREY = "#0072B2", "#E69F00", "#009E73", "#D55E00", "#666666"
DPI = 300
NO_METADATA = {"png": {"Software": None}, "svg": {"Date": None, "Creator": None}}

matplotlib.rcParams.update({
    "svg.hashsalt": "virtual-tailor",
    "font.family": "DejaVu Sans",
    "font.size": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
})  # fmt: skip


def save(fig: Any, folder: Path, name: str) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    written = []
    for ext in ("png", "svg"):
        path = folder / f"{name}.{ext}"
        fig.savefig(path, dpi=DPI, metadata=NO_METADATA[ext], bbox_inches="tight")
        written.append(path.name)
    plt.close(fig)
    return written


def bland_altman(
    folder: Path,
    site: str,
    means: np.ndarray,
    differences: np.ndarray,
    bias: float,
    loa: tuple[float, float],
    bias_ci: tuple[float, float],
    loa_ci: tuple[tuple[float, float], tuple[float, float]],
    slope: tuple[float, float] | None,
) -> list[str]:
    fig, ax = plt.subplots(figsize=(5, 3.6))
    ax.scatter(means, differences, s=18, color=BLUE, alpha=0.8, label="participant means")
    ax.axhline(bias, color=VERMILION, lw=1.2, label=f"bias {bias:+.1f} mm")
    ax.axhspan(*bias_ci, color=VERMILION, alpha=0.12, lw=0)
    for limit, ci in zip(loa, loa_ci, strict=True):
        ax.axhline(limit, color=ORANGE, lw=1, ls="--")
        ax.axhspan(*ci, color=ORANGE, alpha=0.12, lw=0)
    ax.axhline(0, color=GREY, lw=0.6)
    if slope is not None and len(means) > 1:
        x = np.array([means.min(), means.max()])
        ax.plot(x, slope[1] + slope[0] * x, color=GREEN, lw=1, label=f"slope {slope[0]:+.3f}")
    ax.set_xlabel("mean of system and tape (mm)")
    ax.set_ylabel("system − tape (mm)")
    ax.set_title(f"{site}: Bland–Altman, participant means")
    ax.legend(loc="best", frameon=False, fontsize=7)
    return save(fig, folder, f"bland-altman-{site}")


def scatter(folder: Path, site: str, tape: np.ndarray, system: np.ndarray) -> list[str]:
    fig, ax = plt.subplots(figsize=(3.8, 3.8))
    low = float(min(tape.min(), system.min())) - 10
    high = float(max(tape.max(), system.max())) + 10
    ax.plot([low, high], [low, high], color=GREY, lw=0.8, label="identity")
    ax.scatter(tape, system, s=14, color=BLUE, alpha=0.8)
    ax.set_xlabel("tape (mm)")
    ax.set_ylabel("system (mm)")
    ax.set_title(f"{site}: system against tape")
    ax.set_aspect("equal")
    ax.legend(loc="lower right", frameon=False, fontsize=7)
    return save(fig, folder, f"scatter-{site}")


def residuals_by_class(
    folder: Path, site: str, classes: Sequence[str], residuals: Sequence[np.ndarray]
) -> list[str]:
    fig, ax = plt.subplots(figsize=(4.2, 3.2))
    ax.boxplot(
        list(residuals), tick_labels=list(classes), widths=0.5,
        medianprops={"color": VERMILION}, boxprops={"color": BLUE},
        whiskerprops={"color": BLUE}, capprops={"color": BLUE}, flierprops={"ms": 3},
    )  # fmt: skip
    ax.axhline(0, color=GREY, lw=0.6)
    ax.set_ylabel("system − tape (mm)")
    ax.set_title(f"{site}: residuals by BMI class (exploratory)")
    return save(fig, folder, f"residuals-bmi-{site}")


def repeatability_plot(folder: Path, site: str, first: np.ndarray, third: np.ndarray) -> list[str]:
    fig, ax = plt.subplots(figsize=(3.8, 3.8))
    low = float(min(first.min(), third.min())) - 10
    high = float(max(first.max(), third.max())) + 10
    ax.plot([low, high], [low, high], color=GREY, lw=0.8)
    ax.scatter(first, third, s=14, color=GREEN, alpha=0.8)
    ax.set_xlabel("set 1 (mm)")
    ax.set_ylabel("set 3 (mm)")
    ax.set_title(f"{site}: repeatability, set 1 against set 3")
    ax.set_aspect("equal")
    return save(fig, folder, f"repeatability-{site}")


def level_curves(folder: Path, rows: Sequence[dict[str, Any]]) -> list[str]:
    """The calibration's LOO MAE against level per girth, from the fit report's level_curves.csv."""
    sites = sorted({r["site"] for r in rows})
    if not sites:
        return []
    fig, axes = plt.subplots(1, len(sites), figsize=(2.6 * len(sites), 2.8), squeeze=False)
    for ax, site in zip(axes[0], sites, strict=True):
        pts = sorted((float(r["level"]), float(r["loo_mae_mm"])) for r in rows
                     if r["site"] == site and r.get("loo_mae_mm") not in ("", None))  # fmt: skip
        if pts:
            ax.plot([p[0] for p in pts], [p[1] for p in pts], color=BLUE, lw=1.2)
        ax.set_title(site)
        ax.set_xlabel("level fraction")
        ax.set_ylabel("LOO MAE (mm)")
    fig.suptitle("calibration level curves")
    return save(fig, folder, "calibration-level-curves")
