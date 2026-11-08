"""Undercut evaluator: does pitting first get the chasing car ahead?

Set-up: car A is `gap` seconds behind car B. Both are on `old_compound`, `tyre_age` laps old.
A pits on lap 0. B stays out `k` more laps, pits on lap k, and both end up on `new_compound`.
We compare the two cars from A's in-lap until B's out-lap is complete (laps 0..k+1).

    delta = (time_B - time_A) - gap        > 0  ->  undercut works, A comes out ahead

Fuel effects cancel (both cars carry the same fuel), so they are ignored here.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .params import RaceParams


def undercut_delta(p: RaceParams, gap: float, k: int, tyre_age: int,
                   old_compound: str = "MEDIUM", new_compound: str = "HARD",
                   n_runs: int = 0, seed: int = 0) -> np.ndarray | float:
    """Deterministic delta (n_runs=0) or an array of simulated deltas."""
    old, new = p.compounds[old_compound], p.compounds[new_compound]
    window = np.arange(k + 2)                                # laps 0..k+1

    # A: in-lap on old tyres, then fresh tyres from lap 1
    a = np.where(window == 0, old.penalty(tyre_age + 1), new.penalty(window))
    a = a + np.where(window == 1, p.out_lap_penalty, 0.0)
    # B: old tyres until its in-lap on lap k, fresh tyres on lap k+1
    b = np.where(window <= k, old.penalty(tyre_age + 1 + window), new.penalty(1))
    b = b + np.where(window == k + 1, p.out_lap_penalty, 0.0)

    if n_runs == 0:
        return float(b.sum() - a.sum() - gap)

    rng = np.random.default_rng(seed)
    noise_a = rng.standard_normal((n_runs, window.size)) * p.lap_noise_sd
    noise_b = rng.standard_normal((n_runs, window.size)) * p.lap_noise_sd
    pit_a = p.pit_loss_sd * rng.standard_normal(n_runs) + np.where(
        rng.random(n_runs) < p.slow_stop_prob, rng.exponential(p.slow_stop_mean, n_runs), 0.0)
    pit_b = p.pit_loss_sd * rng.standard_normal(n_runs) + np.where(
        rng.random(n_runs) < p.slow_stop_prob, rng.exponential(p.slow_stop_mean, n_runs), 0.0)
    t_a = (a + noise_a).sum(axis=1) + pit_a
    t_b = (b + noise_b).sum(axis=1) + pit_b
    return t_b - t_a - gap


def undercut_grid(p: RaceParams, gaps=None, ks=range(1, 6), tyre_age: int = 20,
                  old_compound: str = "MEDIUM", new_compound: str = "HARD",
                  n_runs: int = 4000, seed: int = 7) -> pd.DataFrame:
    """P(undercut succeeds) for every (gap, laps-B-stays-out) pair."""
    gaps = np.round(np.arange(0.5, 5.01, 0.5), 2) if gaps is None else gaps
    rows = []
    for g in gaps:
        for k in ks:
            d = undercut_delta(p, g, k, tyre_age, old_compound, new_compound, n_runs, seed)
            rows.append({"gap_s": g, "laps_b_stays_out": k,
                         "p_success": float((d > 0).mean()), "mean_delta_s": float(d.mean())})
    return pd.DataFrame(rows)
