"""Race parameters: everything the simulator needs to know about one circuit.

Parameters can come from three places:
  1. `params/example_generic.json` - illustrative numbers so the code runs out of the box
  2. `strategy_sim.estimate`       - fitted from real FastF1 data (recommended)
  3. Project 1's PostgreSQL tables  - load them into this same structure
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class CompoundModel:
    """Lap-time model for one tyre compound.

    extra lap time (s) at tyre age a =
        offset + deg_lin * a + deg_quad * a^2 + cliff_rate * max(0, a - cliff_age)^2
    """
    offset: float          # pace vs. the reference compound (MEDIUM = 0) on a new tyre, seconds
    deg_lin: float         # seconds lost per lap of tyre age
    deg_quad: float = 0.0  # curvature of the wear curve
    cliff_age: int = 99    # lap after which the tyre falls off a cliff
    cliff_rate: float = 0.0

    def penalty(self, age):
        """Works on scalars and NumPy arrays."""
        import numpy as np
        age = np.asarray(age, dtype=float)
        over = np.clip(age - self.cliff_age, 0, None)
        return self.offset + self.deg_lin * age + self.deg_quad * age**2 + self.cliff_rate * over**2


@dataclass
class RaceParams:
    circuit: str
    total_laps: int
    base_lap: float                 # clean-air lap on a new MEDIUM with an empty tank, seconds
    fuel_coef: float                # seconds per lap of fuel still on board
    compounds: dict[str, CompoundModel]

    # Pit stops
    pit_loss_mean: float            # total time lost by stopping under green (lane + stationary), s
    pit_loss_sd: float
    slow_stop_prob: float = 0.04    # chance of a botched stop
    slow_stop_mean: float = 3.0     # mean extra seconds when a stop goes wrong (exponential)
    out_lap_penalty: float = 0.8    # cold tyres on the out-lap, s

    # Neutralisations
    p_sc: float = 0.5               # P(at least one Safety Car in the race)
    p_vsc: float = 0.4              # P(at least one Virtual Safety Car)
    sc_laps: tuple[int, int] = (3, 5)
    vsc_laps: tuple[int, int] = (2, 3)
    sc_lap_factor: float = 1.40     # lap time under SC relative to base lap
    vsc_lap_factor: float = 1.30
    sc_pit_factor: float = 0.50     # pit loss multiplier when stopping under SC
    vsc_pit_factor: float = 0.65

    # Randomness and rules
    lap_noise_sd: float = 0.35      # driver/lap-to-lap variation, s
    min_stint: int = 8
    sc_react_window: int = 6        # pit early if an SC/VSC appears this many laps before a planned stop
    notes: str = ""

    # ---------- IO ----------
    def to_json(self, path: str | Path) -> None:
        d = asdict(self)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(d, indent=2))

    @classmethod
    def from_json(cls, path: str | Path) -> "RaceParams":
        d = json.loads(Path(path).read_text())
        d["compounds"] = {k: CompoundModel(**v) for k, v in d["compounds"].items()}
        d["sc_laps"] = tuple(d.get("sc_laps", (3, 5)))
        d["vsc_laps"] = tuple(d.get("vsc_laps", (2, 3)))
        return cls(**d)


def example_params() -> RaceParams:
    """Illustrative numbers for a generic ~57-lap circuit. NOT fitted to a real race."""
    return RaceParams(
        circuit="Generic (illustrative)",
        total_laps=57,
        base_lap=92.0,
        fuel_coef=0.055,
        compounds={
            "SOFT":   CompoundModel(offset=-0.60, deg_lin=0.090, deg_quad=0.0015, cliff_age=18, cliff_rate=0.05),
            "MEDIUM": CompoundModel(offset=0.00,  deg_lin=0.050, deg_quad=0.0006, cliff_age=30, cliff_rate=0.03),
            "HARD":   CompoundModel(offset=0.45,  deg_lin=0.030, deg_quad=0.0003, cliff_age=42, cliff_rate=0.02),
        },
        pit_loss_mean=22.0,
        pit_loss_sd=0.8,
        notes="Illustrative defaults. Run `python -m strategy_sim.cli fit ...` to fit real values.",
    )
