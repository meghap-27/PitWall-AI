"""Strategy definition and enumeration of every legal 1- and 2-stop plan."""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product

ABBR = {"SOFT": "S", "MEDIUM": "M", "HARD": "H"}


@dataclass(frozen=True)
class Strategy:
    compounds: tuple[str, ...]   # one per stint, e.g. ("MEDIUM", "HARD")
    pit_laps: tuple[int, ...]    # lap on which each stop is made (in-lap), len = stints - 1

    def __post_init__(self):
        if len(self.pit_laps) != len(self.compounds) - 1:
            raise ValueError("need exactly one pit lap per compound change")
        if list(self.pit_laps) != sorted(self.pit_laps):
            raise ValueError("pit laps must be increasing")

    @property
    def stops(self) -> int:
        return len(self.pit_laps)

    @property
    def label(self) -> str:
        comp = "-".join(ABBR.get(c, c[0]) for c in self.compounds)
        laps = ",".join(str(l) for l in self.pit_laps)
        return f"{comp} (L{laps})"

    def is_legal(self, total_laps: int, min_stint: int) -> bool:
        # Dry-race rule: at least two different compounds
        if len(set(self.compounds)) < 2:
            return False
        bounds = (0, *self.pit_laps, total_laps)
        return all(b - a >= min_stint for a, b in zip(bounds, bounds[1:]))


def enumerate_strategies(
    total_laps: int,
    compounds=("SOFT", "MEDIUM", "HARD"),
    max_stops: int = 2,
    min_stint: int = 8,
    step: int = 1,
) -> list[Strategy]:
    """All legal strategies with 1..max_stops stops.

    `step` > 1 thins the pit-lap grid (e.g. every 2nd lap) to keep 2-stop runs fast.
    """
    out: list[Strategy] = []
    laps = range(min_stint, total_laps - min_stint + 1, step)
    for n_stops in range(1, max_stops + 1):
        for comps in product(compounds, repeat=n_stops + 1):
            if len(set(comps)) < 2:
                continue
            for pits in product(laps, repeat=n_stops):
                if list(pits) != sorted(set(pits)) or len(set(pits)) != n_stops:
                    continue
                s = Strategy(tuple(comps), tuple(pits))
                if s.is_legal(total_laps, min_stint):
                    out.append(s)
    return out
