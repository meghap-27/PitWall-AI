"""One command to go from a real race to updated charts, CSVs and microsite data.

    python scripts/refresh_race.py                      # Bahrain 2024 (default)
    python scripts/refresh_race.py Monza 2024
    python scripts/refresh_race.py "Abu Dhabi" 2024

Steps: fit parameters from FastF1 -> simulate strategies -> undercut grid -> export site data.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from strategy_sim.cli import main as cli  # noqa: E402


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    event = argv[0] if len(argv) > 0 else "Bahrain"
    year = int(argv[1]) if len(argv) > 1 else 2024
    slug = f"{event.lower().replace(' ', '_')}_{year}"
    params = ROOT / "params" / f"{slug}.json"
    out = ROOT / "results" / slug

    print(f"\n=== 1/4  Fitting {event} {year} from FastF1 (first run downloads data, a few minutes) ===")
    cli(["fit", "--year", str(year), "--event", event, "--sc-from", str(year - 5),
         "--cache", str(ROOT / "cache"), "--out", str(params)])

    print("\n=== 2/4  Simulating strategies ===")
    cli(["simulate", "--params", str(params), "--out", str(out)])

    print("\n=== 3/4  Undercut grid ===")
    cli(["undercut", "--params", str(params), "--old", "MEDIUM", "--new", "HARD", "--age", "18", "--out", str(out)])

    print("\n=== 4/4  Exporting data for the microsite ===")
    import export_site_data
    export_site_data.main([])

    print(f"\nDone. Charts and CSVs: {out}\nRefresh site/index.html to see {event} {year}.")


if __name__ == "__main__":
    main()
