/* JavaScript port of the Python simulator (src/strategy_sim) so the Strategy Lab
   sliders can re-run strategies live in the browser. Same lap convention:
   laps 1..L, pit lap P = in-lap, fresh tyres from P+1, tyre age starts at 1.
   tests: compare raceTime() against strategy_sim.model.race_time (see README). */
(function (global) {
  "use strict";
  const GREEN = 0, VSC = 1, SC = 2;
  const ABBR = { SOFT: "S", MEDIUM: "M", HARD: "H" };

  function penalty(cm, age) {
    const over = Math.max(0, age - cm.cliff_age);
    return cm.offset + cm.deg_lin * age + cm.deg_quad * age * age + cm.cliff_rate * over * over;
  }

  /* Clean-air lap times for one plan, pits = array of in-laps. */
  function greenLaps(p, compounds, pits) {
    const L = p.total_laps, out = new Float64Array(L);
    let stint = 0, start = 0;
    for (let lap = 1; lap <= L; lap++) {
      while (stint < pits.length && lap > pits[stint]) { start = pits[stint]; stint++; }
      const age = lap - start;
      out[lap - 1] = p.base_lap + penalty(p.compounds[compounds[stint]], age) + p.fuel_coef * (L - lap);
    }
    return out;
  }

  function raceTime(p, compounds, pits) {
    const laps = greenLaps(p, compounds, pits);
    let t = 0;
    for (let i = 0; i < laps.length; i++) t += laps[i];
    return t + pits.length * (p.pit_loss_mean + p.out_lap_penalty);
  }

  function label(compounds, pits) {
    return compounds.map(c => ABBR[c] || c[0]).join("-") + " (L" + pits.join(",") + ")";
  }

  /* All legal 1- and 2-stop plans (>= 2 compounds, every stint >= min_stint). */
  function enumerate(p, step = 1) {
    const comps = Object.keys(p.compounds), L = p.total_laps, m = p.min_stint, out = [];
    for (const a of comps) for (const b of comps) {
      if (a === b) continue;
      for (let x = m; x <= L - m; x += step) out.push({ compounds: [a, b], pits: [x] });
    }
    for (const a of comps) for (const b of comps) for (const c of comps) {
      if (a === b && b === c) continue;
      for (let x = m; x <= L - 2 * m; x += step)
        for (let y = x + m; y <= L - m; y += step) out.push({ compounds: [a, b, c], pits: [x, y] });
    }
    return out;
  }

  /* Stage 1: deterministic screen - overall top `keep` + best `perFamily` of each tyre sequence. */
  function screen(p, keep = 24, perFamily = 1, step = 1) {
    const all = enumerate(p, step).map(s => ({ ...s, det: raceTime(p, s.compounds, s.pits) }));
    all.sort((u, v) => u.det - v.det);
    const chosen = new Map(), seen = new Map();
    all.slice(0, keep).forEach(s => chosen.set(label(s.compounds, s.pits), s));
    for (const s of all) {
      const fam = s.compounds.join("-"), c = seen.get(fam) || 0;
      if (c < perFamily) { chosen.set(label(s.compounds, s.pits), s); seen.set(fam, c + 1); }
    }
    return { total: all.length, list: [...chosen.values()] };
  }

  /* Seeded RNG so a slider change re-runs the SAME races (common random numbers). */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    next.normal = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = next();
      v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.exp = mean => -mean * Math.log(1 - next());
    return next;
  }

  function hazard(pAtLeastOne, eligible) {
    if (pAtLeastOne <= 0) return 0;
    return -Math.log(1 - Math.min(pAtLeastOne, 0.999)) / eligible;
  }

  function drawScenarios(p, n, seed = 42, maxStops = 2) {
    const r = rng(seed), L = p.total_laps;
    const hSc = hazard(p.p_sc, L - 3), hVsc = hazard(p.p_vsc, L - 3);
    const status = [], noise = [], pitNoise = [], slow = [];
    for (let i = 0; i < n; i++) {
      const st = new Int8Array(L);
      let remaining = 0, kind = 0;
      for (let lap = 1; lap <= L; lap++) {
        if (remaining > 0) { st[lap - 1] = kind; remaining--; continue; }
        if (lap >= 2 && lap <= L - 2) {
          const u = r();
          if (u < hSc) { kind = SC; st[lap - 1] = SC; remaining = r.int(p.sc_laps[0], p.sc_laps[1]) - 1; }
          else if (u < hSc + hVsc) { kind = VSC; st[lap - 1] = VSC; remaining = r.int(p.vsc_laps[0], p.vsc_laps[1]) - 1; }
        }
      }
      const nz = new Float64Array(L);
      for (let j = 0; j < L; j++) nz[j] = r.normal();
      const pn = [], sl = [];
      for (let k = 0; k < maxStops; k++) {
        pn.push(r.normal());
        sl.push(r() < p.slow_stop_prob ? r.exp(p.slow_stop_mean) : 0);
      }
      status.push(st); noise.push(nz); pitNoise.push(pn); slow.push(sl);
    }
    return { n, status, noise, pitNoise, slow };
  }

  /* One plan across all scenarios -> Float64Array of race times. */
  function simulate(p, plan, sc) {
    const L = p.total_laps, out = new Float64Array(sc.n);
    const cacheKey = new Map();
    for (let i = 0; i < sc.n; i++) {
      const st = sc.status[i];
      // React to SC/VSC: pit early if neutralised inside the window before a planned stop
      const pits = [];
      let prev = 0;
      for (const planned of plan.pits) {
        let moved = planned;
        if (p.sc_react_window > 0) {
          for (let lap = Math.max(planned - p.sc_react_window, 1); lap <= planned; lap++)
            if (st[lap - 1] > 0) { moved = lap; break; }
        }
        moved = Math.min(Math.max(moved, prev + p.min_stint), planned);
        pits.push(moved); prev = moved;
      }
      const key = pits.join(",");
      let laps = cacheKey.get(key);
      if (!laps) { laps = greenLaps(p, plan.compounds, pits); cacheKey.set(key, laps); }

      let t = 0;
      for (let j = 0; j < L; j++) {
        if (st[j] === SC) t += p.base_lap * p.sc_lap_factor;
        else if (st[j] === VSC) t += p.base_lap * p.vsc_lap_factor;
        else t += laps[j] + p.lap_noise_sd * sc.noise[i][j];
      }
      pits.forEach((lap, k) => {
        const s = st[lap - 1];
        const f = s === SC ? p.sc_pit_factor : s === VSC ? p.vsc_pit_factor : 1;
        t += (p.pit_loss_mean + p.pit_loss_sd * sc.pitNoise[i][k]) * f + sc.slow[i][k];
        const o = Math.min(lap, L - 1);
        if (st[o] === GREEN) t += p.out_lap_penalty;
      });
      out[i] = t;
    }
    return out;
  }

  /* Full lab run: screen, simulate shortlist on shared scenarios, rank. */
  function runLab(p, n = 1500, seed = 42) {
    const { total, list } = screen(p, 24, 1);
    const sc = drawScenarios(p, n, seed);
    const T = list.map(plan => simulate(p, plan, sc));
    const means = T.map(arr => arr.reduce((a, b) => a + b, 0) / n);
    const ref = means.indexOf(Math.min(...means));
    const wins = new Array(list.length).fill(0);
    for (let i = 0; i < n; i++) {
      let b = 0;
      for (let s = 1; s < list.length; s++) if (T[s][i] < T[b][i]) b = s;
      wins[b]++;
    }
    const rows = list.map((plan, s) => {
      let m = 0, m2 = 0, beats = 0;
      for (let i = 0; i < n; i++) {
        const d = T[s][i] - T[ref][i];
        m += d; m2 += d * d; if (d < 0) beats++;
      }
      m /= n;
      return {
        strategy: label(plan.compounds, plan.pits), compounds: plan.compounds, pits: plan.pits,
        stops: plan.pits.length, gap: m, risk: Math.sqrt(Math.max(0, m2 / n - m * m)),
        pFastest: wins[s] / n, pBeats: beats / n, det: plan.det,
      };
    }).sort((a, b) => a.gap - b.gap);
    let neutral = 0, withSc = 0;
    sc.status.forEach(st => { let any = false; st.forEach(v => { if (v) neutral++; if (v === SC) any = true; }); if (any) withSc++; });
    return { rows, total, simulated: list.length, n, shareSc: withSc / n, meanNeutral: neutral / n };
  }

  /* Undercut: A is `gap` s behind B, pits on lap 0; B pits k laps later. P(A ends up ahead). */
  function undercutP(p, gap, k, age, oldC, newC, n = 1200, seed = 7) {
    const o = p.compounds[oldC], w = p.compounds[newC], r = rng(seed + Math.round(gap * 10) * 31 + k);
    let a0 = 0, b0 = 0;
    for (let i = 0; i <= k + 1; i++) {
      a0 += (i === 0 ? penalty(o, age + 1) : penalty(w, i)) + (i === 1 ? p.out_lap_penalty : 0);
      b0 += (i <= k ? penalty(o, age + 1 + i) : penalty(w, 1)) + (i === k + 1 ? p.out_lap_penalty : 0);
    }
    let wins = 0;
    const sd = p.lap_noise_sd * Math.sqrt(k + 2);
    for (let s = 0; s < n; s++) {
      const pa = p.pit_loss_sd * r.normal() + (r() < p.slow_stop_prob ? r.exp(p.slow_stop_mean) : 0);
      const pb = p.pit_loss_sd * r.normal() + (r() < p.slow_stop_prob ? r.exp(p.slow_stop_mean) : 0);
      const d = (b0 + sd * r.normal() + pb) - (a0 + sd * r.normal() + pa) - gap;
      if (d > 0) wins++;
    }
    return wins / n;
  }

  global.StrategyModel = { penalty, greenLaps, raceTime, label, enumerate, screen, drawScenarios, simulate, runLab, undercutP };
  if (typeof module !== "undefined") module.exports = global.StrategyModel;
})(typeof window !== "undefined" ? window : globalThis);
