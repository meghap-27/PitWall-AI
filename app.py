"""VR-25 Strategy Lab - Streamlit dashboard on top of the real Python simulator.

    streamlit run app.py
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from strategy_sim.model import race_time  # noqa: E402
from strategy_sim.montecarlo import best_per_family, screen_strategies, simulate_many  # noqa: E402
from strategy_sim.params import RaceParams, example_params  # noqa: E402
from strategy_sim.strategies import Strategy, enumerate_strategies  # noqa: E402
from strategy_sim.undercut import undercut_grid  # noqa: E402

RED, YELLOW, INK, INK2, BG2, LINE = "#DC0000", "#FFF200", "#F4F1EA", "#b9b5ac", "#141415", "rgba(244,241,234,.12)"
TYRE = {"SOFT": RED, "MEDIUM": YELLOW, "HARD": INK}
ABBR = {"SOFT": "S", "MEDIUM": "M", "HARD": "H"}

st.set_page_config(page_title="VR-25 Strategy Lab", page_icon="🏁", layout="wide")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&family=Mr+Dafoe&display=swap');
html, body, [class*="css"], .stMarkdown, p, label { font-family: 'Inter', sans-serif; }
h1, h2, h3 { font-family: 'Anton', Impact, sans-serif !important; text-transform: uppercase; letter-spacing: .01em; font-weight: 400 !important; }
.block-container { padding-top: 3.4rem; max-width: 1300px; }
.vr-label { font: 600 11px/1.3 Inter, sans-serif; letter-spacing: .22em; text-transform: uppercase; color: #7d7a73; margin: 0; }
.vr-hero { font: 400 clamp(64px, 9vw, 130px)/.86 Anton, Impact, sans-serif; text-transform: uppercase; margin: 10px 0 0; }
.vr-hero span { color: #DC0000; display: block; }
.vr-sign { font-family: 'Mr Dafoe', cursive; color: #DC0000; font-size: 44px; transform: rotate(-6deg); display: inline-block; }
.vr-stamp { display: inline-block; font: 600 10px/1 Inter; letter-spacing: .2em; color: #DC0000; border: 2px solid #DC0000; padding: 6px 10px; border-radius: 6px; transform: rotate(-4deg); margin-left: 14px; }
.vr-call { background: linear-gradient(135deg, #DC0000, #8a0000 60%, #2a0000); border-radius: 22px; padding: 26px 30px; margin: 6px 0 18px; }
.vr-call .vr-label { color: rgba(244,241,234,.75); }
.vr-call h2 { font-size: clamp(44px, 5vw, 80px) !important; margin: 6px 0 14px !important; line-height: .95; color: #F4F1EA; }
.vr-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.vr-stats b { display: block; font: 400 36px/1 Anton, Impact, sans-serif; color: #F4F1EA; }
.vr-stats span { font-size: 13px; color: rgba(244,241,234,.8); }
div[data-testid="stMetric"] { background: #141415; border: 1px solid rgba(244,241,234,.12); border-radius: 18px; padding: 16px 18px; }
div[data-testid="stMetricValue"] { font-family: 'Anton', Impact, sans-serif; }
section[data-testid="stSidebar"] { border-right: 1px solid rgba(244,241,234,.12); }
.stTabs [data-baseweb="tab"] { text-transform: uppercase; letter-spacing: .14em; font-size: 12px; }
</style>
""", unsafe_allow_html=True)


# ------------------------------------------------------------------ data
def param_files() -> dict[str, Path | None]:
    files = sorted((ROOT / "params").glob("*.json"), key=lambda f: (f.stem.startswith("example"), f.stem))
    return {f.stem: f for f in files} or {"example (built-in)": None}


@st.cache_data(show_spinner=False)
def load_params(path: str | None) -> RaceParams:
    return RaceParams.from_json(path) if path else example_params()


@st.cache_data(show_spinner=False)
def run(p_json: str, runs: int, seed: int):
    p = _from_str(p_json)
    all_s = enumerate_strategies(p.total_laps, tuple(p.compounds), 2, p.min_stint)
    cands = screen_strategies(all_s, p, keep=40)
    df, _ = simulate_many(cands, p, runs, seed)
    return df, len(all_s), len(cands)


def _from_str(s: str) -> RaceParams:
    import os
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        fh.write(s)
    try:
        return RaceParams.from_json(fh.name)
    finally:
        os.unlink(fh.name)


def to_json_str(p: RaceParams) -> str:
    import json
    from dataclasses import asdict
    return json.dumps(asdict(p), sort_keys=True)


@st.cache_data(show_spinner=False)
def run_undercut(p_json: str, age: int, old: str, new: str):
    return undercut_grid(_from_str(p_json), tyre_age=age, old_compound=old, new_compound=new, n_runs=3000)


def dark(fig: go.Figure, h=380) -> go.Figure:
    fig.update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", height=h,
                      font=dict(family="Inter, sans-serif", color=INK2, size=12), margin=dict(l=10, r=10, t=10, b=10),
                      hoverlabel=dict(bgcolor=BG2, font_color=INK, bordercolor=RED))
    fig.update_xaxes(gridcolor="rgba(244,241,234,.06)", zeroline=False)
    fig.update_yaxes(gridcolor="rgba(244,241,234,.06)", zeroline=False)
    return fig


# ------------------------------------------------------------------ sidebar
with st.sidebar:
    st.markdown('<span class="vr-sign">Volta</span><span class="vr-stamp">VR-25 / Chassis 05</span>', unsafe_allow_html=True)
    st.markdown('<p class="vr-label" style="margin-top:14px">Race inputs</p>', unsafe_allow_html=True)
    files = param_files()
    choice = st.selectbox("Race file", list(files), help="Create more with: python -m strategy_sim.cli fit ...")
    base = load_params(str(files[choice]) if files[choice] else None)

    p_sc = st.slider("Safety Car chance", 0.0, 0.95, float(round(base.p_sc, 2)), 0.05, format="%.2f")
    pit = st.slider("Pit-stop loss (s)", 14.0, 34.0, float(round(base.pit_loss_mean * 2) / 2), 0.5)
    deg = st.slider("Tyre wear multiplier", 0.5, 1.6, 1.0, 0.05)
    fuel = st.slider("Fuel effect (s per lap of fuel)", 0.0, 0.10, float(base.fuel_coef), 0.005, format="%.3f")
    runs = st.select_slider("Simulated races", [1000, 2000, 3000, 5000, 8000], value=3000)
    st.caption("Volta Racing and the VR-25 are fictional. Independent student project, not affiliated with Formula 1 or any team.")

p = copy.deepcopy(base)
p.p_sc, p.pit_loss_mean, p.fuel_coef = p_sc, pit, fuel
for c in p.compounds.values():
    c.deg_lin *= deg; c.deg_quad *= deg; c.cliff_rate *= deg
pj = to_json_str(p)

with st.spinner(f"Simulating {runs:,} races…"):
    df, n_all, n_sim = run(pj, runs, 42)
fam = best_per_family(df)

# ------------------------------------------------------------------ header + the call
st.markdown(f'<p class="vr-label">Volta Racing · Strategy Lab · 2025 Season · {p.circuit}</p>'
            '<h1 class="vr-hero">Strategy<span>Lab</span></h1>', unsafe_allow_html=True)

best, nxt = fam.iloc[0], (fam.iloc[1] if len(fam) > 1 else None)
fam_share = df[df["compounds"] == best["compounds"]]["p_fastest"].sum()
lead = (nxt["gap_to_best_s"] - best["gap_to_best_s"]) if nxt is not None else float("nan")
st.markdown(f"""
<div class="vr-call"><p class="vr-label">The call</p><h2>{best['strategy']}</h2>
<div class="vr-stats">
  <div><b>{lead:.2f} s</b><span>ahead of the next tyre plan</span></div>
  <div><b>{fam_share:.0%}</b><span>of races this tyre sequence was fastest</span></div>
  <div><b>{p.p_sc:.0%}</b><span>chance of a Safety Car</span></div>
</div></div>""", unsafe_allow_html=True)

m1, m2, m3, m4 = st.columns(4)
m1.metric("Plans screened", f"{n_all:,}")
m2.metric("Simulated", f"{n_sim} × {runs:,}")
one = fam[fam["stops"] == 1].head(1)
m3.metric("Best 1-stop", one["strategy"].iloc[0] if len(one) else "-",
          f"+{one['gap_to_best_s'].iloc[0]:.1f} s" if len(one) else None, delta_color="inverse")
m4.metric("Pit-stop loss", f"{p.pit_loss_mean:.1f} s")

tab1, tab2, tab3, tab4 = st.tabs(["Strategies", "Pit window", "Undercut", "Inputs"])

# ------------------------------------------------------------------ tab 1: strategies
with tab1:
    top = fam.head(10).iloc[::-1]
    fig = go.Figure()
    for _, r in top.iterrows():
        bounds = (0, *r["pit_laps"], p.total_laps)
        for comp, a, b in zip(r["compounds"].split("-"), bounds, bounds[1:]):
            fig.add_trace(go.Bar(y=[r["strategy"]], x=[b - a], base=[a], orientation="h", marker_color=TYRE[comp],
                                 marker_line=dict(color="#0B0B0C", width=2), showlegend=False,
                                 hovertemplate=f"{comp.title()} · laps {a + 1}–{b}<extra></extra>"))
    for comp, col in TYRE.items():
        if comp in p.compounds:
            fig.add_trace(go.Bar(y=[None], x=[None], marker_color=col, name=comp.title()))
    fig.update_layout(barmode="overlay", bargap=.35, legend=dict(orientation="h", y=1.08, x=0))
    fig.update_xaxes(title="Lap", range=[0, p.total_laps])
    st.markdown("### Best plan per tyre sequence")
    st.plotly_chart(dark(fig, 420), use_container_width=True)

    view = fam[["strategy", "stops", "gap_to_best_s", "risk_sd_s", "p_fastest", "p_beats_best"]].head(12).copy()
    view.columns = ["Plan", "Stops", "Gap to best (s)", "Risk ±sd (s)", "P(fastest)", "P(beats best)"]
    st.dataframe(view.style.format({"Gap to best (s)": "{:+.2f}", "Risk ±sd (s)": "{:.2f}",
                                    "P(fastest)": "{:.1%}", "P(beats best)": "{:.1%}"}),
                 use_container_width=True, hide_index=True)
    st.download_button("Download all simulated plans (CSV)", df.to_csv(index=False), "strategies.csv", "text/csv")

# ------------------------------------------------------------------ tab 2: pit window
with tab2:
    comps = [c for c in ("SOFT", "MEDIUM", "HARD") if c in p.compounds]
    laps = np.arange(p.min_stint, p.total_laps - p.min_stint + 1)
    curves = {(a, b): np.array([race_time(Strategy((a, b), (int(l),)), p) for l in laps]) for a in comps for b in comps if a != b}
    floor = min(c.min() for c in curves.values())
    fig = go.Figure()
    dash = {"SOFT": "solid", "MEDIUM": "dash", "HARD": "dot"}
    for (a, b), c in curves.items():
        name = f"{ABBR[a]}→{ABBR[b]}"
        fig.add_trace(go.Scatter(x=laps, y=c - floor, name=name, line=dict(color=TYRE[a], width=2.5, dash=dash[b]),
                                 hovertemplate=name + " · pit lap %{x}: +%{y:.1f} s<extra></extra>"))
        j = int(c.argmin())
        fig.add_trace(go.Scatter(x=[laps[j]], y=[c[j] - floor], mode="markers+text", text=[f"{name} L{laps[j]}"],
                                 textposition="top center", marker=dict(size=10, color=TYRE[a], line=dict(color=BG2, width=2)),
                                 showlegend=False, hoverinfo="skip", textfont=dict(color=INK)))
    fig.update_yaxes(title="Time lost vs best 1-stop (s)", range=[0, 25])
    fig.update_xaxes(title="Pit lap")
    fig.update_layout(legend=dict(orientation="h", y=1.08, x=0))
    st.markdown("### 1-stop pit window")
    st.caption("Line colour = starting tyre, dash = second tyre. Deterministic model, average pit stop, no Safety Car.")
    st.plotly_chart(dark(fig, 440), use_container_width=True)

# ------------------------------------------------------------------ tab 3: undercut
with tab3:
    c1, c2, c3 = st.columns(3)
    old = c1.selectbox("Tyres now", comps, index=comps.index("MEDIUM") if "MEDIUM" in comps else 0)
    new = c2.selectbox("Fit", comps, index=comps.index("HARD") if "HARD" in comps else len(comps) - 1)
    age = c3.slider("Tyre age (laps)", 5, 35, 20)
    g = run_undercut(pj, age, old, new)
    piv = g.pivot(index="gap_s", columns="laps_b_stays_out", values="p_success")
    fig = go.Figure(go.Heatmap(z=piv.values, x=[f"{k} lap{'s' if k > 1 else ''}" for k in piv.columns], y=[f"{v:g} s" for v in piv.index],
                               zmin=0, zmax=1, colorscale=[[0, "#0B0B0C"], [.33, "#5a0000"], [.66, RED], [1, YELLOW]],
                               text=np.vectorize(lambda v: f"{v:.0%}")(piv.values), texttemplate="%{text}",
                               hovertemplate="Gap %{y}, they stay out %{x}: %{z:.0%}<extra></extra>", colorbar=dict(tickformat=".0%")))
    fig.update_xaxes(title="Laps the car ahead stays out after you pit", side="top")
    fig.update_yaxes(title="Gap to car ahead", autorange="reversed")
    st.markdown("### Probability the undercut works")
    st.plotly_chart(dark(fig, 460), use_container_width=True)

# ------------------------------------------------------------------ tab 4: inputs
with tab4:
    st.markdown("### Fitted inputs")
    rows = [{"Compound": k.title(), "Pace vs medium (s)": v.offset, "Wear (s/lap)": v.deg_lin, "Wear curve (s/lap²)": v.deg_quad}
            for k, v in p.compounds.items()]
    st.dataframe(pd.DataFrame(rows).style.format(precision=3), use_container_width=True, hide_index=True)
    st.json({k: getattr(p, k) for k in ("total_laps", "base_lap", "fuel_coef", "pit_loss_mean", "pit_loss_sd",
                                        "p_sc", "p_vsc", "lap_noise_sd", "sc_react_window")}, expanded=False)
    st.caption(base.notes)
