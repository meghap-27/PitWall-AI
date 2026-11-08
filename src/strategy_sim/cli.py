"""Command line entry point.

    python -m strategy_sim.cli simulate --params params/example_generic.json
    python -m strategy_sim.cli fit --year 2024 --event Bahrain --out params/bahrain_2024.json
    python -m strategy_sim.cli undercut --params params/bahrain_2024.json --old MEDIUM --new HARD --age 18
"""
from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

import pandas as pd

from .montecarlo import best_per_family, draw_scenarios, sc_summary, screen_strategies, simulate_many
from .params import RaceParams, example_params
from .strategies import enumerate_strategies
from .undercut import undercut_grid

COLS = ["strategy", "gap_to_best_s", "risk_sd_s", "p_fastest", "p_beats_best", "deterministic_s"]


def _load(path: str | None) -> RaceParams:
    if not path:
        return example_params()
    if not Path(path).exists():
        raise SystemExit(
            f"\nParameter file not found: {path}\n"
            "Create it first with the `fit` command, for example:\n"
            "  python -m strategy_sim.cli fit --year 2024 --event Bahrain --sc-from 2019 "
            f"--out {path}\n"
            "Or run without --params to use the illustrative example values."
        )
    return RaceParams.from_json(path)


def cmd_simulate(a):
    p = _load(a.params)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    all_s = enumerate_strategies(p.total_laps, tuple(p.compounds), a.max_stops, p.min_stint, a.step)
    cands = screen_strategies(all_s, p, keep=a.keep)
    df, _ = simulate_many(cands, p, a.runs, a.seed)
    fam = best_per_family(df)
    dt = time.perf_counter() - t0

    pd.set_option("display.width", 160)
    print(f"\n{p.circuit}: {len(all_s):,} legal strategies -> {len(cands)} simulated x {a.runs:,} races "
          f"in {dt:.1f}s")
    print("Scenario check:", {k: round(v, 3) for k, v in sc_summary(draw_scenarios(p, a.runs, a.seed)).items()})
    print("\nTop plans")
    print(df[COLS].head(10).round(3).to_string(index=False))
    print("\nBest plan per tyre sequence")
    print(fam[COLS].head(10).round(3).to_string(index=False))

    df.to_csv(out / "strategies.csv", index=False)
    fam.to_csv(out / "best_per_family.csv", index=False)
    if not a.no_plots:
        from .plots import plot_families, plot_pit_window
        plot_families(fam, out / "best_per_family.png")
        plot_pit_window(p, out / "pit_window.png")
    print(f"\nSaved results to {out.resolve()}")


def cmd_fit(a):
    from .estimate import build_params
    seasons = range(a.sc_from, a.year + 1) if a.sc_from else None
    p = build_params(a.year, a.event, seasons, fuel_coef=a.fuel_coef, cache_dir=a.cache)
    p.to_json(a.out)
    print(f"Saved fitted parameters to {a.out}\n{p.notes}")
    for c, m in p.compounds.items():
        print(f"  {c:<7} offset {m.offset:+.2f}s  deg {m.deg_lin:.3f}s/lap  quad {m.deg_quad:.4f}")
    print(f"  pit loss {p.pit_loss_mean:.1f}s ± {p.pit_loss_sd:.1f}  P(SC) {p.p_sc:.0%}  P(VSC) {p.p_vsc:.0%}")


def cmd_undercut(a):
    p = _load(a.params)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    g = undercut_grid(p, tyre_age=a.age, old_compound=a.old, new_compound=a.new, n_runs=a.runs)
    print(g.pivot(index="gap_s", columns="laps_b_stays_out", values="p_success").round(2).to_string())
    g.to_csv(out / "undercut.csv", index=False)
    if not a.no_plots:
        from .plots import plot_undercut
        plot_undercut(g, out / "undercut.png", f"{a.old.title()} ({a.age} laps old) → {a.new.title()}, {p.circuit}")
    print(f"\nSaved to {out.resolve()}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="strategy_sim", description="F1 race strategy & pit-window risk simulator")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("simulate", help="rank strategies with Monte Carlo")
    s.add_argument("--params", help="JSON from `fit` (default: illustrative example)")
    s.add_argument("--runs", type=int, default=5000)
    s.add_argument("--max-stops", type=int, default=2)
    s.add_argument("--step", type=int, default=1, help="pit-lap grid step")
    s.add_argument("--keep", type=int, default=40, help="plans kept after deterministic screen")
    s.add_argument("--seed", type=int, default=42)
    s.add_argument("--out", default="results")
    s.add_argument("--no-plots", action="store_true")
    s.set_defaults(func=cmd_simulate)

    f = sub.add_parser("fit", help="fit parameters from a real race with FastF1")
    f.add_argument("--year", type=int, required=True)
    f.add_argument("--event", required=True, help='e.g. "Bahrain" or "Monza"')
    f.add_argument("--sc-from", type=int, help="first season for Safety Car history (default year-5)")
    f.add_argument("--fuel-coef", type=float, default=0.055)
    f.add_argument("--cache", default="cache")
    f.add_argument("--out", required=True)
    f.set_defaults(func=cmd_fit)

    u = sub.add_parser("undercut", help="undercut success probability grid")
    u.add_argument("--params")
    u.add_argument("--old", default="MEDIUM")
    u.add_argument("--new", default="HARD")
    u.add_argument("--age", type=int, default=20)
    u.add_argument("--runs", type=int, default=4000)
    u.add_argument("--out", default="results")
    u.add_argument("--no-plots", action="store_true")
    u.set_defaults(func=cmd_undercut)

    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    a.func(a)


if __name__ == "__main__":
    main()
