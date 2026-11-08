"""Deterministic race model: one car, clean air, no randomness.

Get this right before adding probability - if the best deterministic strategy
doesn't look like what teams actually did, the Monte Carlo layer won't save you.

Lap convention (matches FastF1):
  * laps are numbered 1..total_laps
  * a pit lap value P means lap P is the in-lap; fresh tyres from lap P+1
  * tyre age on the first lap of a stint is 1 (same as FastF1's TyreLife)
"""
from __future__ import annotations

import numpy as np

from .params import RaceParams
from .strategies import Strategy


def stint_and_age(pit_laps: np.ndarray, total_laps: int) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised stint index and tyre age.

    pit_laps: (n_runs, n_stops) int array. Returns two (n_runs, total_laps) arrays.
    """
    pit_laps = np.atleast_2d(pit_laps)
    laps = np.arange(1, total_laps + 1)
    stint = (laps[None, :, None] > pit_laps[:, None, :]).sum(axis=2)     # (n, L)
    starts = np.concatenate([np.zeros((pit_laps.shape[0], 1), int), pit_laps], axis=1)
    age = laps[None, :] - np.take_along_axis(starts, stint, axis=1)
    return stint, age


def green_lap_times(strategy: Strategy, p: RaceParams, pit_laps: np.ndarray | None = None) -> np.ndarray:
    """Clean-air green-flag lap times, (n_runs, total_laps), excluding pit costs."""
    if pit_laps is None:
        pit_laps = np.array([strategy.pit_laps])
    stint, age = stint_and_age(pit_laps, p.total_laps)
    laps = np.arange(1, p.total_laps + 1)
    tyre = np.zeros(stint.shape)
    for s, comp in enumerate(strategy.compounds):
        mask = stint == s
        tyre[mask] = p.compounds[comp].penalty(age[mask])
    fuel = p.fuel_coef * (p.total_laps - laps)
    return p.base_lap + tyre + fuel[None, :]


def race_time(strategy: Strategy, p: RaceParams) -> float:
    """Expected race time with average pit stops and no Safety Car."""
    laps = green_lap_times(strategy, p)[0]
    total = laps.sum()
    total += strategy.stops * p.pit_loss_mean
    total += strategy.stops * p.out_lap_penalty
    return float(total)


def lap_trace(strategy: Strategy, p: RaceParams) -> np.ndarray:
    """Per-lap times including pit costs - handy for plotting a single plan."""
    laps = green_lap_times(strategy, p)[0].copy()
    for lap in strategy.pit_laps:
        laps[lap - 1] += p.pit_loss_mean
        if lap < p.total_laps:
            laps[lap] += p.out_lap_penalty
    return laps
