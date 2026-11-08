"""Fit simulator inputs from real FastF1 data.

The fitting functions take plain pandas DataFrames with FastF1's column names,
so they can be unit-tested without downloading anything. `build_params()` is the
one function that actually talks to FastF1.

Model for clean green-flag laps (per lap i of driver d):

    fuel_corrected_time = driver_effect[d] + compound_offset[c]
                          + deg_lin[c] * tyre_age + deg_quad[c] * tyre_age^2 + noise

Driver fixed effects remove car/driver pace differences, so the tyre curves are
not biased by which teams happened to run which compound.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .params import CompoundModel, RaceParams

log = logging.getLogger(__name__)
DRY = ("SOFT", "MEDIUM", "HARD")


# ---------------------------------------------------------------- lap cleaning
def _seconds(s: pd.Series) -> pd.Series:
    return s.dt.total_seconds() if pd.api.types.is_timedelta64_dtype(s) else s.astype(float)


def clean_laps(laps: pd.DataFrame, total_laps: int, fuel_coef: float) -> pd.DataFrame:
    """Keep representative racing laps and add fuel-corrected lap times (seconds)."""
    df = laps.copy()
    df["LapTimeS"] = _seconds(df["LapTime"])
    keep = (
        df["LapTimeS"].notna()
        & df["Compound"].isin(DRY)
        & (df["TrackStatus"].astype(str) == "1")          # pure green flag lap
        & df["PitInTime"].isna() & df["PitOutTime"].isna()
        & (df["LapNumber"] > 1)
        & df["TyreLife"].notna()
    )
    if "IsAccurate" in df:
        keep &= df["IsAccurate"].fillna(False).astype(bool)
    if "Deleted" in df:
        keep &= ~df["Deleted"].fillna(False).astype(bool)
    df = df[keep].copy()

    # Drop traffic / mistake laps: > 3% slower than that driver's stint median
    med = df.groupby(["Driver", "Stint"])["LapTimeS"].transform("median")
    df = df[df["LapTimeS"] <= med * 1.03].copy()

    df["FuelCorrS"] = df["LapTimeS"] - fuel_coef * (total_laps - df["LapNumber"])
    return df


# ---------------------------------------------------------------- degradation
def fit_degradation(clean: pd.DataFrame, quadratic: bool = True, min_laps: int = 25):
    """Least-squares fit with driver fixed effects.

    Returns (compound models dict, base_lap, residual sd). MEDIUM is the reference
    compound when present. base_lap = the fastest driver's effect (clean air, new
    reference tyre, empty tank).
    """
    df = clean[clean["Compound"].isin(DRY)].copy()
    counts = df["Compound"].value_counts()
    comps = [c for c in DRY if counts.get(c, 0) >= min_laps]
    if len(comps) < 2:
        raise ValueError(f"need >=2 compounds with >= {min_laps} clean laps, got {counts.to_dict()}")
    df = df[df["Compound"].isin(comps)]
    ref = "MEDIUM" if "MEDIUM" in comps else comps[0]

    drivers = sorted(df["Driver"].unique())
    cols, names = [], []
    for d in drivers:                                   # one intercept per driver
        cols.append((df["Driver"] == d).astype(float).to_numpy()); names.append(("drv", d))
    age = df["TyreLife"].astype(float).to_numpy()
    for c in comps:
        is_c = (df["Compound"] == c).astype(float).to_numpy()
        if c != ref:
            cols.append(is_c); names.append(("off", c))
        cols.append(is_c * age); names.append(("lin", c))
        if quadratic:
            cols.append(is_c * age**2); names.append(("quad", c))

    X = np.column_stack(cols)
    y = df["FuelCorrS"].to_numpy()
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    coef = dict(zip(names, beta))
    resid_sd = float(np.std(y - X @ beta))

    models = {}
    for c in comps:
        lin = max(coef[("lin", c)], 0.0)                # tyres don't get faster with age
        quad = max(coef.get(("quad", c), 0.0), 0.0)
        models[c] = CompoundModel(offset=float(coef.get(("off", c), 0.0)),
                                  deg_lin=float(lin), deg_quad=float(quad))
    base = float(min(v for (k, _), v in coef.items() if k == "drv"))
    return models, base, resid_sd


# ---------------------------------------------------------------- pit loss
def estimate_pit_loss(laps: pd.DataFrame, clean: pd.DataFrame) -> tuple[float, float, int]:
    """Time lost per green-flag stop = in-lap + out-lap - 2 x driver's median clean lap."""
    df = laps.copy()
    df["LapTimeS"] = _seconds(df["LapTime"])
    ref = clean.groupby("Driver")["LapTimeS"].median()
    losses = []
    for drv, g in df.sort_values("LapNumber").groupby("Driver"):
        if drv not in ref:
            continue
        g = g.set_index("LapNumber")
        for lap in g.index[g["PitInTime"].notna()]:
            if lap + 1 not in g.index:
                continue
            inl, outl = g.loc[lap], g.loc[lap + 1]
            green = str(inl["TrackStatus"]) == "1" and str(outl["TrackStatus"]) == "1"
            if not green or pd.isna(inl["LapTimeS"]) or pd.isna(outl["LapTimeS"]):
                continue
            losses.append(inl["LapTimeS"] + outl["LapTimeS"] - 2 * ref[drv])
    losses = np.array(losses)
    if losses.size == 0:
        raise ValueError("no green-flag pit stops found")
    # Trim the slowest 10% (botched stops are modelled separately)
    losses = np.sort(losses)[: max(1, int(len(losses) * 0.9))]
    return float(losses.mean()), float(losses.std(ddof=1) if losses.size > 1 else 1.0), int(losses.size)


# ---------------------------------------------------------------- SC / VSC history
def neutralisation_flags(track_status: pd.DataFrame) -> dict:
    """Did a race have a Safety Car ('4') / VSC ('6') at any point? Uses session.track_status."""
    st = track_status["Status"].astype(str)
    return {"sc": bool((st == "4").any()), "vsc": bool((st == "6").any())}


def estimate_sc_rates(event: str, seasons, load_session=None) -> dict:
    """Share of past races at this event with >=1 SC and >=1 VSC."""
    import fastf1
    load_session = load_session or (lambda y: fastf1.get_session(y, event, "R"))
    flags = []
    for year in seasons:
        try:
            s = load_session(year)
            s.load(laps=False, telemetry=False, weather=False, messages=False)
            flags.append(neutralisation_flags(s.track_status))
        except Exception as exc:                        # event not held that year, etc.
            log.warning("skipping %s %s: %s", year, event, exc)
    if not flags:
        raise ValueError("no seasons could be loaded")
    n = len(flags)
    # Laplace smoothing so 0/5 doesn't become "impossible"
    return {"p_sc": (sum(f["sc"] for f in flags) + 1) / (n + 2),
            "p_vsc": (sum(f["vsc"] for f in flags) + 1) / (n + 2),
            "races": n}


# ---------------------------------------------------------------- one-shot builder
def build_params(year: int, event: str, sc_seasons=None, fuel_coef: float = 0.055,
                 cache_dir: str = "cache") -> RaceParams:
    """Load a race with FastF1 and fit every input the simulator needs."""
    import fastf1
    fastf1.Cache.configure(cache_dir=cache_dir) if hasattr(fastf1.Cache, "configure") \
        else fastf1.Cache.enable_cache(cache_dir)

    session = fastf1.get_session(year, event, "R")
    session.load(laps=True, telemetry=False, weather=False, messages=False)
    try:
        laps = session.laps
    except Exception as exc:
        raise RuntimeError(
            f"FastF1 could not load lap data for {year} {event}. Check your internet connection, "
            "the event name, and that the race has finished. See the log above for the cause."
        ) from exc
    if laps.empty:
        raise RuntimeError(f"No laps returned for {year} {event}.")
    total = int(laps["LapNumber"].max())

    clean = clean_laps(laps, total, fuel_coef)
    models, base, resid_sd = fit_degradation(clean)
    pit_mean, pit_sd, n_stops = estimate_pit_loss(laps, clean)
    seasons = sc_seasons or range(year - 5, year + 1)
    sc = estimate_sc_rates(event, seasons)

    circuit = str(session.event["EventName"])
    log.info("fitted %s %s: %d clean laps, %d stops, %d SC seasons", year, circuit,
             len(clean), n_stops, sc["races"])
    return RaceParams(
        circuit=f"{circuit} {year}",
        total_laps=total,
        base_lap=base,
        fuel_coef=fuel_coef,
        compounds=models,
        pit_loss_mean=pit_mean,
        pit_loss_sd=pit_sd,
        p_sc=sc["p_sc"],
        p_vsc=sc["p_vsc"],
        lap_noise_sd=resid_sd,
        notes=(f"Fitted from FastF1: {len(clean)} clean laps, {n_stops} green-flag stops, "
               f"SC history from {sc['races']} races. fuel_coef is an assumption."),
    )
