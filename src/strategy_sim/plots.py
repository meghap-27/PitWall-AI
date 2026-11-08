"""Static charts (PNG) for the README and write-up."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap

from .model import race_time
from .params import RaceParams
from .strategies import Strategy

SURFACE, INK, INK2, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e6e5e1"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
BLUES = LinearSegmentedColormap.from_list(
    "blues", ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"])


def _style(ax, title, subtitle=None):
    ax.set_facecolor(SURFACE)
    ax.figure.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.xaxis.label.set_color(INK2)
    ax.yaxis.label.set_color(INK2)
    ax.set_title(title, loc="left", color=INK, fontsize=12, fontweight="bold", pad=22 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.02, subtitle, transform=ax.transAxes, color=INK2, fontsize=9)


def plot_families(families: pd.DataFrame, path: str | Path, top: int = 10):
    """Best plan per compound sequence: average gap to the best plan, +/- 1 sd of that gap."""
    d = families.head(top).iloc[::-1]
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(d) + 1.6))
    y = np.arange(len(d))
    ax.errorbar(d["gap_to_best_s"], y, xerr=d["risk_sd_s"], fmt="o", color=SERIES[0],
                ecolor="#86b6ef", elinewidth=2, capsize=0, markersize=8)
    ax.set_yticks(y, d["strategy"])
    ax.axvline(0, color=GRID, lw=1, zorder=0)
    ax.grid(axis="x", color=GRID, lw=0.6)
    ax.set_xlabel("Average time lost vs best plan (s)  -  whisker = ±1 sd across simulated races")
    _style(ax, "Best plan for each tyre sequence", "Monte Carlo, Safety Cars and pit-stop variance included")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def plot_pit_window(p: RaceParams, path: str | Path, compounds=("SOFT", "MEDIUM", "HARD")):
    """1-stop plans: time lost vs the optimum for every pit lap, one line per tyre pair."""
    pairs = [(a, b) for a in compounds for b in compounds if a != b and a in p.compounds and b in p.compounds]
    laps = np.arange(p.min_stint, p.total_laps - p.min_stint + 1)
    curves = {f"{a[0]}→{b[0]}": np.array([race_time(Strategy((a, b), (int(l),)), p) for l in laps])
              for a, b in pairs}
    best = min(c.min() for c in curves.values())
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for i, (name, c) in enumerate(curves.items()):
        ax.plot(laps, c - best, color=SERIES[i % len(SERIES)], lw=2, label=name)
        j = int(c.argmin())
        ax.plot(laps[j], c[j] - best, "o", color=SERIES[i % len(SERIES)], ms=8,
                markeredgecolor=SURFACE, markeredgewidth=2)
    ax.set_ylim(0, min(30, max(c.max() for c in curves.values()) - best))
    ax.set_xlabel("Pit lap")
    ax.set_ylabel("Time lost vs best 1-stop (s)")
    ax.grid(color=GRID, lw=0.6)
    ax.legend(frameon=False, ncol=3, fontsize=9, labelcolor=INK2)
    _style(ax, "1-stop pit window", f"{p.circuit} - deterministic model, dot = best lap for each tyre pair")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def plot_undercut(grid: pd.DataFrame, path: str | Path, title_note: str = ""):
    m = grid.pivot(index="gap_s", columns="laps_b_stays_out", values="p_success")
    fig, ax = plt.subplots(figsize=(7, 5))
    im = ax.imshow(m.values, cmap=BLUES, vmin=0, vmax=1, aspect="auto", origin="lower")
    for i in range(m.shape[0]):
        for j in range(m.shape[1]):
            v = m.values[i, j]
            ax.text(j, i, f"{v:.0%}", ha="center", va="center", fontsize=8,
                    color="#ffffff" if v > 0.55 else INK)
    ax.set_xticks(range(m.shape[1]), m.columns)
    ax.set_yticks(range(m.shape[0]), [f"{g:g}" for g in m.index])
    ax.set_xlabel("Laps the car ahead stays out after you pit")
    ax.set_ylabel("Gap to car ahead (s)")
    cb = fig.colorbar(im, ax=ax, fraction=0.04)
    cb.ax.tick_params(colors=MUTED, labelsize=8)
    cb.outline.set_visible(False)
    _style(ax, "Probability the undercut works", title_note)
    for s in ax.spines.values():
        s.set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
