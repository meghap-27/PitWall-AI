import numpy as np
import pandas as pd
import pytest

from strategy_sim.estimate import clean_laps, estimate_pit_loss, fit_degradation, neutralisation_flags
from strategy_sim.model import lap_trace, race_time, stint_and_age
from strategy_sim.montecarlo import (SC, best_per_family, draw_scenarios, screen_strategies,
                                     simulate, simulate_many)
from strategy_sim.params import CompoundModel, RaceParams, example_params
from strategy_sim.strategies import Strategy, enumerate_strategies
from strategy_sim.undercut import undercut_delta


@pytest.fixture
def p():
    return example_params()


# ---------------------------------------------------------------- strategies
def test_strategy_rules():
    assert Strategy(("MEDIUM", "HARD"), (25,)).is_legal(57, 8)
    assert not Strategy(("MEDIUM", "MEDIUM"), (25,)).is_legal(57, 8)       # one compound only
    assert not Strategy(("SOFT", "HARD"), (5,)).is_legal(57, 8)           # stint too short
    with pytest.raises(ValueError):
        Strategy(("SOFT", "HARD"), (10, 20))


def test_enumeration_all_legal(p):
    s = enumerate_strategies(p.total_laps, min_stint=p.min_stint)
    assert len(s) > 1000
    assert all(x.is_legal(p.total_laps, p.min_stint) for x in s)
    assert {x.stops for x in s} == {1, 2}


# ---------------------------------------------------------------- deterministic model
def test_stint_and_age():
    stint, age = stint_and_age(np.array([[3, 6]]), 8)
    assert stint[0].tolist() == [0, 0, 0, 1, 1, 1, 2, 2]
    assert age[0].tolist() == [1, 2, 3, 1, 2, 3, 1, 2]


def test_race_time_matches_lap_trace(p):
    s = Strategy(("MEDIUM", "HARD"), (25,))
    assert race_time(s, p) == pytest.approx(lap_trace(s, p).sum())


def test_more_degradation_is_slower(p):
    s = Strategy(("MEDIUM", "HARD"), (25,))
    worse = example_params()
    worse.compounds["HARD"] = CompoundModel(0.45, 0.08)
    assert race_time(s, worse) > race_time(s, p)


def test_each_stop_pays_pit_loss(p):
    """Lap 20 is a pit lap for the 2-stop but a normal lap for the 1-stop."""
    s1, s2 = Strategy(("MEDIUM", "HARD"), (28,)), Strategy(("MEDIUM", "HARD", "HARD"), (20, 40))
    t1, t2 = lap_trace(s1, p), lap_trace(s2, p)
    assert t2[19] - t1[19] == pytest.approx(p.pit_loss_mean, abs=0.5)
    assert race_time(s2, p) - race_time(s1, p) > p.pit_loss_mean - 15   # extra stop isn't free


# ---------------------------------------------------------------- Monte Carlo
def test_scenario_rates_match_inputs(p):
    sc = draw_scenarios(p, 20000, seed=1)
    assert (sc.status == SC).any(axis=1).mean() == pytest.approx(p.p_sc, abs=0.03)
    assert (sc.status[:, 0] == 0).all()                                  # never on lap 1


def test_no_randomness_equals_deterministic(p):
    q = example_params()
    q.p_sc = q.p_vsc = q.slow_stop_prob = 0.0
    q.lap_noise_sd = q.pit_loss_sd = 0.0
    s = Strategy(("MEDIUM", "HARD"), (25,))
    t = simulate(s, q, draw_scenarios(q, 50))
    assert np.allclose(t, race_time(s, q))


def test_common_random_numbers_reproducible(p):
    s = [Strategy(("MEDIUM", "HARD"), (25,)), Strategy(("SOFT", "HARD"), (18,))]
    a, _ = simulate_many(s, p, 500, seed=3)
    b, _ = simulate_many(s, p, 500, seed=3)
    pd.testing.assert_frame_equal(a, b)
    assert a["p_fastest"].sum() == pytest.approx(1.0)


def test_safety_car_makes_stops_cheaper(p):
    """Same scenario, SC at the pit lap: the stop must cost sc_pit_factor x the normal loss."""
    q = example_params(); q.lap_noise_sd = 0; q.pit_loss_sd = 0; q.slow_stop_prob = 0
    sc = draw_scenarios(q, 1, seed=0)
    sc.status[:] = 0
    sc.status[0, 23:27] = SC                       # SC on laps 24-27
    s = Strategy(("MEDIUM", "HARD"), (26,))        # planned stop inside the SC
    cheap = simulate(s, q, sc)[0]
    q.sc_pit_factor = 1.0
    full = simulate(s, q, sc)[0]
    assert full - cheap == pytest.approx(0.5 * q.pit_loss_mean, abs=1e-6)


def test_reacts_to_safety_car(p):
    """A stop planned on lap 30 moves forward to an SC that starts on lap 26."""
    from strategy_sim.montecarlo import _reactive_pit_laps
    sc = draw_scenarios(p, 1, seed=0)
    sc.status[:] = 0
    sc.status[0, 25:28] = SC
    assert _reactive_pit_laps(Strategy(("MEDIUM", "HARD"), (30,)), p, sc)[0, 0] == 26
    assert _reactive_pit_laps(Strategy(("MEDIUM", "HARD"), (40,)), p, sc)[0, 0] == 40


def test_screen_and_family(p):
    cands = screen_strategies(enumerate_strategies(p.total_laps, min_stint=8, step=3), p, keep=10)
    df, T = simulate_many(cands, p, 300)
    fam = best_per_family(df)
    assert T.shape == (300, len(cands))
    assert fam["compounds"].is_unique
    assert df["gap_to_best_s"].iloc[0] == pytest.approx(0.0)


# ---------------------------------------------------------------- undercut
def test_undercut_monotonic(p):
    d_small = undercut_delta(p, gap=0.5, k=2, tyre_age=20)
    d_big = undercut_delta(p, gap=4.0, k=2, tyre_age=20)
    assert d_small > d_big
    assert undercut_delta(p, 1.0, 4, 20) > undercut_delta(p, 1.0, 1, 20)


# ---------------------------------------------------------------- estimation on synthetic data
def _synthetic_race(seed=0):
    """FastF1-shaped laps from known tyre curves, to check the fitter recovers them."""
    rng = np.random.default_rng(seed)
    truth = {"MEDIUM": (0.0, 0.05), "HARD": (0.5, 0.03)}
    rows, total = [], 50
    for i, drv in enumerate(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]):
        pace = 90 + 0.2 * i
        pit = 20 + i
        plan = [("MEDIUM", 1, pit), ("HARD", pit + 1, total)] if i % 2 == 0 else \
               [("HARD", 1, pit), ("MEDIUM", pit + 1, total)]
        for stint, (comp, a, b) in enumerate(plan, start=1):
            off, deg = truth[comp]
            for lap in range(a, b + 1):
                age = lap - a + 1
                t = pace + off + deg * age + 0.055 * (total - lap) + rng.normal(0, 0.15)
                in_lap = lap == pit
                out_lap = lap == pit + 1
                if in_lap:
                    t += 10
                if out_lap:
                    t += 12
                rows.append({"Driver": drv, "LapNumber": lap, "Stint": stint, "Compound": comp,
                             "TyreLife": float(age), "LapTimeSec": t,
                             "TrackStatus": "1", "IsAccurate": not (in_lap or out_lap),
                             "PitInSec": 1.0 if in_lap else np.nan,
                             "PitOutSec": 1.0 if out_lap else np.nan})
    df = pd.DataFrame(rows)
    for src, dst in (("LapTimeSec", "LapTime"), ("PitInSec", "PitInTime"), ("PitOutSec", "PitOutTime")):
        df[dst] = pd.to_timedelta(df.pop(src), unit="s")
    return df, truth, total


def test_fit_recovers_known_degradation():
    laps, truth, total = _synthetic_race()
    clean = clean_laps(laps, total, 0.055)
    models, base, sd = fit_degradation(clean, quadratic=False)
    assert models["MEDIUM"].deg_lin == pytest.approx(truth["MEDIUM"][1], abs=0.01)
    assert models["HARD"].deg_lin == pytest.approx(truth["HARD"][1], abs=0.01)
    assert models["HARD"].offset == pytest.approx(0.5, abs=0.15)
    assert base == pytest.approx(90.0, abs=0.3)
    assert sd < 0.3


def test_pit_loss_estimate():
    laps, _, total = _synthetic_race()
    clean = clean_laps(laps, total, 0.055)
    mean, sd, n = estimate_pit_loss(laps, clean)
    assert n >= 5
    assert mean == pytest.approx(22, abs=2.5)


def test_neutralisation_flags():
    ts = pd.DataFrame({"Status": ["1", "2", "1", "4", "1"]})
    assert neutralisation_flags(ts) == {"sc": True, "vsc": False}


def test_params_roundtrip(tmp_path, p):
    path = tmp_path / "p.json"
    p.to_json(path)
    q = RaceParams.from_json(path)
    assert q.compounds["SOFT"] == p.compounds["SOFT"]
    assert q.total_laps == p.total_laps
