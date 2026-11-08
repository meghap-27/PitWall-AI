"""F1 race strategy and pit-window risk simulator."""
from .montecarlo import best_per_family, draw_scenarios, screen_strategies, simulate, simulate_many
from .params import CompoundModel, RaceParams, example_params
from .strategies import Strategy, enumerate_strategies
from .undercut import undercut_delta, undercut_grid

__version__ = "0.1.0"
