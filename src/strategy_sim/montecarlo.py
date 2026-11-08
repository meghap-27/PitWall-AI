"""Monte Carlo race simulation with Safety Cars, VSCs, pit-stop variance and lap noise.

Key design choice - *common random numbers*: every strategy is simulated against
the SAME set of random race scenarios (same SC timings, same slow stops, same
lap noise). Differences between strategies are then caused by the strategy, not
by luck, which makes comparisons far sharper and lets us compute
"probability this strategy is the fastest" run by run.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .model import green_lap_times, race_time
from .params import RaceParams
from .strategies import Strategy

GREEN, VSC, SC = 0, 1, 2


@dataclass
class Scenarios:
    """One shared set of random race scenarios."""
    status: np.ndarray       # (n, L) int: 0 green, 1 VSC, 2 SC
    lap_noise: np.ndarray    # (n, L) standard normals
    pit_noise: np.ndarray    # (n, max_stops) standard normals
    slow_extra: np.ndarray   # (n, max_stops) seconds added by botched stops (mostly 0)

    @property
    def n(self) -> int:
        return self.status.shape[0]


def _per_lap_hazard(p_at_least_one: float, eligible_laps: int) -> float:
    """Convert P(>=1 event in race) into a per-lap start probability (Poisson process)."""
    if p_at_least_one <= 0:
        return 0.0
    rate = -np.log(1 - min(p_at_least_one, 0.999))
    return rate / eligible_laps


def draw_scenarios(p: RaceParams, n_runs: int, seed: int = 42, max_stops: int = 3) -> Scenarios:
    rng = np.random.default_rng(seed)
    L = p.total_laps
    eligible = range(2, L - 1)                 # no neutralisation starting on lap 1 or the last 2 laps
    h_sc = _per_lap_hazard(p.p_sc, len(eligible))
    h_vsc = _per_lap_hazard(p.p_vsc, len(eligible))

    status = np.zeros((n_runs, L), dtype=np.int8)
    remaining = np.zeros(n_runs, dtype=int)
    kind = np.zeros(n_runs, dtype=np.int8)
    for lap in range(1, L + 1):
        active = remaining > 0
        status[active, lap - 1] = kind[active]
        remaining[active] -= 1
        if lap in eligible:
            free = ~active
            u = rng.random(n_runs)
            start_sc = free & (u < h_sc)
            start_vsc = free & ~start_sc & (u < h_sc + h_vsc)
            for mask, k, (lo, hi) in ((start_sc, SC, p.sc_laps), (start_vsc, VSC, p.vsc_laps)):
                if mask.any():
                    dur = rng.integers(lo, hi + 1, size=mask.sum())
                    kind[mask] = k
                    status[mask, lap - 1] = k
                    remaining[mask] = dur - 1

    lap_noise = rng.standard_normal((n_runs, L))
    pit_noise = rng.standard_normal((n_runs, max_stops))
    slow = rng.random((n_runs, max_stops)) < p.slow_stop_prob
    slow_extra = np.where(slow, rng.exponential(p.slow_stop_mean, (n_runs, max_stops)), 0.0)
    return Scenarios(status, lap_noise, pit_noise, slow_extra)


def _reactive_pit_laps(strategy: Strategy, p: RaceParams, sc: Scenarios) -> np.ndarray:
    """Planned pit laps, moved earlier when an SC/VSC appears inside the reaction window."""
    pits = np.tile(np.array(strategy.pit_laps, dtype=int), (sc.n, 1))
    if p.sc_react_window <= 0:
        return pits
    neutral = sc.status > 0
    prev = np.zeros(sc.n, dtype=int)
    for k, planned in enumerate(strategy.pit_laps):
        lo = max(planned - p.sc_react_window, 1)
        window = neutral[:, lo - 1:planned]              # laps lo..planned
        has = window.any(axis=1)
        first = lo + window.argmax(axis=1)
        new = np.where(has, first, planned)
        new = np.maximum(new, prev + p.min_stint)        # keep the stint legal
        new = np.minimum(new, planned)
        pits[:, k] = new
        prev = new
    return pits


def simulate(strategy: Strategy, p: RaceParams, sc: Scenarios) -> np.ndarray:
    """Total race time for each scenario, shape (n_runs,)."""
    pits = _reactive_pit_laps(strategy, p, sc)
    times = green_lap_times(strategy, p, pits)
    times = times + p.lap_noise_sd * sc.lap_noise

    # Neutralised laps: everyone circulates slowly, tyre and fuel effects mostly vanish
    times = np.where(sc.status == SC, p.base_lap * p.sc_lap_factor, times)
    times = np.where(sc.status == VSC, p.base_lap * p.vsc_lap_factor, times)

    rows = np.arange(sc.n)
    for k in range(strategy.stops):
        lap_idx = pits[:, k] - 1
        st = sc.status[rows, lap_idx]
        factor = np.select([st == SC, st == VSC], [p.sc_pit_factor, p.vsc_pit_factor], 1.0)
        cost = (p.pit_loss_mean + p.pit_loss_sd * sc.pit_noise[:, k]) * factor + sc.slow_extra[:, k]
        times[rows, lap_idx] += cost
        out_idx = np.minimum(lap_idx + 1, p.total_laps - 1)
        green_out = sc.status[rows, out_idx] == GREEN
        times[rows, out_idx] += np.where(green_out, p.out_lap_penalty, 0.0)
    return times.sum(axis=1)


def simulate_many(strategies: list[Strategy], p: RaceParams, n_runs: int = 5000, seed: int = 42):
    """Simulate every strategy on the same scenarios. Returns (summary DataFrame, times matrix)."""
    max_stops = max(s.stops for s in strategies)
    sc = draw_scenarios(p, n_runs, seed, max_stops=max(max_stops, 1))
    T = np.column_stack([simulate(s, p, sc) for s in strategies])      # (n, S)

    best = T.argmin(axis=1)
    p_best = np.bincount(best, minlength=len(strategies)) / n_runs
    df = pd.DataFrame({
        "strategy": [s.label for s in strategies],
        "stops": [s.stops for s in strategies],
        "compounds": ["-".join(s.compounds) for s in strategies],
        "pit_laps": [s.pit_laps for s in strategies],
        "deterministic_s": [race_time(s, p) for s in strategies],
        "mean_s": T.mean(axis=0),
        "sd_s": T.std(axis=0),
        "p10_s": np.percentile(T, 10, axis=0),
        "p90_s": np.percentile(T, 90, axis=0),
        "p_fastest": p_best,
    })
    # Absolute race time swings by minutes depending on Safety Cars, which hit every plan.
    # Strategy *risk* is better measured relative to the plan with the best average.
    ref = int(np.argmin(T.mean(axis=0)))
    D = T - T[:, [ref]]
    df["gap_to_best_s"] = D.mean(axis=0)
    df["risk_sd_s"] = D.std(axis=0)                 # how much the gap to the reference plan varies
    df["p_beats_best"] = (D < 0).mean(axis=0)
    df = df.sort_values("mean_s").reset_index(drop=True)
    return df, T


def best_per_family(df: pd.DataFrame) -> pd.DataFrame:
    """Best pit laps for each compound sequence - the table a strategist actually reads."""
    return (df.sort_values("mean_s").groupby("compounds", as_index=False).first()
              .sort_values("mean_s").reset_index(drop=True))


def screen_strategies(strategies: list[Strategy], p: RaceParams, keep: int = 40,
                      per_family: int = 2) -> list[Strategy]:
    """Stage 1 of the search: rank thousands of plans with the cheap deterministic model,
    keep the overall top `keep` plus the best `per_family` of every compound sequence
    (so an unusual plan that only shines with Safety Cars isn't thrown away)."""
    scored = sorted(((race_time(s, p), s) for s in strategies), key=lambda x: x[0])
    chosen: dict[Strategy, None] = {s: None for _, s in scored[:keep]}
    seen: dict[tuple, int] = {}
    for _, s in scored:
        c = seen.get(s.compounds, 0)
        if c < per_family:
            chosen[s] = None
            seen[s.compounds] = c + 1
    return list(chosen)


def sc_summary(sc: Scenarios) -> dict:
    """Quick sanity check that the scenario generator matches the inputs."""
    return {
        "share_with_sc": float((sc.status == SC).any(axis=1).mean()),
        "share_with_vsc": float((sc.status == VSC).any(axis=1).mean()),
        "mean_neutral_laps": float((sc.status > 0).sum(axis=1).mean()),
    }
