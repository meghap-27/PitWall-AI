/* VR-25 Strategy Engine - HUD dashboard.
   Every number on screen comes from the simulator (site/model.js) or the exported
   Python results (site/data/results.js). Nothing is live telemetry. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const M = window.StrategyModel;
  const DATA = window.STRATEGY_DATA || { races: [] };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const TYRE = { SOFT: "#ff2a2a", MEDIUM: "#FFF200", HARD: "#f2efe9" };
  const AB = { SOFT: "S", MEDIUM: "M", HARD: "H" };
  const f = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);
  const pct = x => Math.round(x * 100) + "%";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lapStr = s => { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`; };
  if (!DATA.races.length) { document.body.insertAdjacentHTML("afterbegin", "<p style='padding:16px;background:#c00'>Run python scripts/export_site_data.py first.</p>"); return; }

  const S = { raceIdx: 0, p: null, res: null, fam: [], A: null, B: null, trA: null, trB: null, lap: 1, playing: !reduce, timer: null };
  const race = () => DATA.races[S.raceIdx];
  const season = () => (race().circuit.match(/(19|20)\d\d/) || ["2025"])[0];

  /* ---------------- helpers ---------------- */
  function trace(p, plan) {
    const t = Array.from(M.greenLaps(p, plan.compounds, plan.pits));
    plan.pits.forEach(l => { t[l - 1] += p.pit_loss_mean; if (l < p.total_laps) t[l] += p.out_lap_penalty; });
    return t;
  }
  function stintAt(plan, lap) {
    const b = [0, ...plan.pits, Infinity];
    for (let i = 0; i < plan.compounds.length; i++) if (lap > b[i] && lap <= b[i + 1]) return { i, comp: plan.compounds[i], age: lap - b[i] };
    return { i: 0, comp: plan.compounds[0], age: lap };
  }
  function bar(plan, L, letters = true) {
    const b = [0, ...plan.pits, L];
    return plan.compounds.map((c, i) => `<span style="flex:${b[i + 1] - b[i]};background:${TYRE[c]}" title="${c} laps ${b[i] + 1}-${b[i + 1]}">${letters && b[i + 1] - b[i] > 6 ? AB[c] : ""}</span>`).join("");
  }
  function line(svg, series, opt = {}) {
    const W = svg.clientWidth || 300, H = svg.clientHeight || 80, pl = opt.pl ?? 30, pr = 6, pt = 6, pb = opt.pb ?? 14;
    const xs = series[0].y.length, all = series.flatMap(s => s.y).filter(Number.isFinite);
    let lo = opt.min ?? Math.min(...all), hi = opt.max ?? Math.max(...all);
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const X = i => pl + i / (xs - 1) * (W - pl - pr), Y = v => pt + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - pt - pb);
    let s = "";
    for (let k = 0; k <= 2; k++) { const v = lo + (hi - lo) * k / 2; s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${pl - 4}" y="${Y(v) + 3}" text-anchor="end">${f(v, opt.dec ?? 1)}</text>`; }
    if (opt.xticks) opt.xticks.forEach(i => s += `<text x="${X(i)}" y="${H - 2}" text-anchor="middle">${i + 1}</text>`);
    series.forEach(se => {
      let d = "", pen = false, first = -1, last = -1;
      se.y.forEach((v, i) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true;
        if (first < 0) first = i; last = i;
      });
      const gaps = se.y.some(v => !Number.isFinite(v));
      if (se.fill && !gaps && first >= 0) s += `<path d="${d}L${X(last)},${H - pb}L${X(first)},${H - pb}Z" fill="${se.color}" opacity=".12"/>`;
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.w || 1.8}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""}/>`;
    });
    if (opt.marker != null) {
      const i = opt.marker; let v = series[0].y[i];
      if (!Number.isFinite(v)) { const near = series[0].y.map((u, k) => [Math.abs(k - i), u]).filter(([, u]) => Number.isFinite(u)).sort((p, q) => p[0] - q[0])[0]; v = near ? near[1] : (lo + hi) / 2; }
      s += `<line x1="${X(i)}" x2="${X(i)}" y1="${pt}" y2="${H - pb}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3"/><circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${series[0].color}" stroke="#121214" stroke-width="2"/>`;
    }
    if (opt.extra) s += opt.extra(X, Y, W, H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = s;
  }

  /* ---------------- sliders / effective params ---------------- */
  const SL = { sc: $("#sSc"), pit: $("#sPit"), deg: $("#sDeg"), fuel: $("#sFuel"), runs: $("#sRuns") };
  const OUT = { sc: $("#oSc"), pit: $("#oPit"), deg: $("#oDeg"), fuel: $("#oFuel"), runs: $("#oRuns") };
  function resetSliders() {
    const p = race().params;
    SL.sc.value = p.p_sc; SL.pit.value = p.pit_loss_mean; SL.deg.value = 1; SL.fuel.value = p.fuel_coef; SL.runs.value = 1500; syncOut();
  }
  function syncOut() {
    OUT.sc.textContent = pct(+SL.sc.value); OUT.pit.textContent = f(+SL.pit.value) + " s"; OUT.deg.textContent = f(+SL.deg.value, 2) + "×";
    OUT.fuel.textContent = f(+SL.fuel.value, 3) + " s/lap"; OUT.runs.textContent = (+SL.runs.value).toLocaleString();
  }
  function effective() {
    const p = JSON.parse(JSON.stringify(race().params)), k = +SL.deg.value;
    p.p_sc = +SL.sc.value; p.pit_loss_mean = +SL.pit.value; p.fuel_coef = +SL.fuel.value;
    Object.values(p.compounds).forEach(c => { c.deg_lin *= k; c.deg_quad *= k; c.cliff_rate *= k; });
    return p;
  }

  /* ---------------- main compute ---------------- */
  function compute() {
    const t0 = performance.now();
    S.p = effective();
    S.res = M.runLab(S.p, +SL.runs.value, 42);
    const seen = new Set(); S.fam = [];
    S.res.rows.forEach(r => { const k = r.compounds.join("-"); if (!seen.has(k)) { seen.add(k); S.fam.push(r); } });
    S.A = S.fam[0]; S.B = S.fam[1] || S.fam[0];
    S.trA = trace(S.p, S.A); S.trB = trace(S.p, S.B);
    S.famShare = fam => S.res.rows.filter(r => r.compounds.join("-") === fam.compounds.join("-")).reduce((a, r) => a + r.pFastest, 0);
    $("#labStatus").textContent = `${S.res.total.toLocaleString()} plans screened · ${S.res.simulated} simulated × ${S.res.n.toLocaleString()} races · ${Math.round(performance.now() - t0)} ms`;
    renderAll();
  }

  function renderAll() {
    const p = S.p, L = p.total_laps;
    $("#chromePath").textContent = `volta-lab · strategy-engine · ${race().id}`;
    $("#metaSession").textContent = `Race - ${race().circuit.replace(/\(illustrative\)/i, "").trim()}`;
    $("#rpScrub").max = L;
    // ranking
    $("#rankTag").textContent = `${S.res.n.toLocaleString()} sims`;
    $("#rank").innerHTML = S.fam.slice(0, 5).map((r, i) => `<li><div>${esc(r.strategy)}<div class="bar">${bar(r, L, false)}</div></div><span class="gap">${i ? "+" + f(r.gap - S.A.gap, 2) + "s" : "BEST"}</span></li>`).join("");
    // call card (strategy tab)
    $("#callPlan").textContent = S.A.strategy;
    $("#callGap").textContent = f(S.B.gap - S.A.gap, 2) + " s";
    $("#callP").textContent = pct(S.famShare(S.A));
    $("#callRisk").textContent = "±" + f(S.B.risk, 1) + " s";
    $("#famList").innerHTML = S.fam.slice(0, 7).map((r, i) => `<div class="fam"><span>${esc(r.strategy)}</span><div class="bar">${bar(r, L)}</div><span class="g">${i ? "+" + f(r.gap - S.A.gap, 1) + " s" : "best"}</span></div>`).join("");
    renderEngine(); renderDeg(); renderGauges(); renderPit(); renderStat(); renderHeat();
    setLap(Math.min(S.lap, L));
  }

  /* ---------------- engine timeline ---------------- */
  function renderEngine() {
    const L = S.p.total_laps;
    const rows = S.fam.slice(0, 3).map((r, i) => `<div class="eng-row"><span>${i === 0 ? "▶ " : ""}${esc(r.strategy.split(" ")[0])} ${i ? "+" + f(r.gap - S.A.gap, 1) + "s" : ""}</span><div class="eng-track">${bar(r, L)}</div></div>`).join("");
    const ticks = []; for (let l = 0; l <= L; l += 10) ticks.push(`<i style="left:${l / L * 100}%">${l || 1}</i>`);
    $("#engine").innerHTML = rows + `<div class="eng-axis">${ticks.join("")}</div><div class="eng-cursor" id="engCursor"></div>`;
  }

  /* ---------------- tyre degradation ---------------- */
  let degSel = "ALL";
  function renderDeg() {
    const comps = Object.keys(S.p.compounds);
    $("#degSeg").innerHTML = ["ALL", ...comps].map(c => `<button data-c="${c}" class="${c === degSel ? "is-on" : ""}" style="--c:${TYRE[c] || "#ff2a2a"}">${c === "ALL" ? "ALL" : c[0] + c.slice(1).toLowerCase()}</button>`).join("");
    $$("#degSeg button").forEach(b => b.onclick = () => { degSel = b.dataset.c; renderDeg(); });
    const ages = Array.from({ length: 41 }, (_, i) => i);
    const series = comps.map(c => ({ y: ages.map(a => M.penalty(S.p.compounds[c], Math.max(a, 1))), color: TYRE[c], w: degSel === "ALL" || degSel === c ? 2.2 : 1, dash: degSel === "ALL" || degSel === c ? "" : "2 4" }));
    const one = S.fam.find(r => r.stops === 1);
    line($("#degChart"), series, {
      pl: 34, pb: 18, dec: 1, xticks: [0, 9, 19, 29, 39].map(i => i), min: Math.min(...series.flatMap(s => s.y)) - 0.2,
      max: Math.min(6, Math.max(...series.flatMap(s => s.y))),
      extra: (X, Y, W, H) => {
        let s = comps.map((c, i) => `<text x="${40}" y="${16 + i * 13}" style="fill:${TYRE[c]};font-size:11px">${c[0] + c.slice(1).toLowerCase()}</text>`).join("");
        if (one) {
          const x = X(Math.min(40, one.pits[0]));
          s += `<line x1="${x}" x2="${x}" y1="6" y2="${H - 18}" stroke="#f2efe9" stroke-dasharray="4 4" opacity=".7"/><text x="${Math.min(x, W - 120)}" y="16" style="fill:#f2efe9;font-size:11px;font-weight:700">MODEL: 1-STOP PIT LAP ${one.pits[0]}</text>`;
        }
        return s;
      },
    });
  }

  /* ---------------- gauges ---------------- */
  function gauge(label, v, bars) {
    const a0 = -210, a1 = 30, R = 40, cx = 55, cy = 50;
    const pt = a => [cx + R * Math.cos(a * Math.PI / 180), cy + R * Math.sin(a * Math.PI / 180)];
    const arc = (from, to) => { const [x0, y0] = pt(from), [x1, y1] = pt(to); return `M${x0},${y0} A${R},${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1},${y1}`; };
    const av = a0 + (a1 - a0) * Math.max(0, Math.min(1, v)), [nx, ny] = [cx + (R - 12) * Math.cos(av * Math.PI / 180), cy + (R - 12) * Math.sin(av * Math.PI / 180)];
    return `<div class="gauge"><span>${label}</span><svg viewBox="0 0 110 70">
      <path d="${arc(a0, a1)}" stroke="#26262a" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="${arc(a0, av)}" stroke="#ff2a2a" stroke-width="7" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 4px #ff2a2a)"/>
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#f2efe9" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#f2efe9"/></svg>
      <b>${(v * 100).toFixed(1)}%</b><div class="bars">${bars.map(([c, w, t]) => `<i title="${esc(t)}"><em style="width:${Math.round(w * 100)}%;background:${c}"></em></i>`).join("")}</div></div>`;
  }
  function renderGauges() {
    const p = S.p, old = p.compounds.MEDIUM ? "MEDIUM" : Object.keys(p.compounds)[0], nw = p.compounds.HARD ? "HARD" : Object.keys(p.compounds).slice(-1)[0];
    const uc2 = M.undercutP(p, 2, 2, 20, old, nw, 1500), uc1 = M.undercutP(p, 2, 1, 20, old, nw, 1500);
    $("#probTag").textContent = `${S.res.n.toLocaleString()} races`;
    $("#gauges").innerHTML =
      gauge("Plan A fastest", S.famShare(S.A), [["#ff2a2a", S.famShare(S.A), "plan A sequence"], ["#f2efe9", S.famShare(S.B), "plan B sequence"]]) +
      gauge("Safety Car", S.res.shareSc, [["#ff2a2a", S.res.shareSc, "share of races with an SC"], ["#f2efe9", p.p_vsc, "VSC chance input"]]) +
      gauge("Undercut @2s", uc2, [["#ff2a2a", uc2, "rival stays out 2 laps"], ["#f2efe9", uc1, "rival stays out 1 lap"]]);
  }

  /* ---------------- pit window + facts (analysis tab) ---------------- */
  function renderPit() {
    const p = S.p, comps = Object.keys(p.compounds), L = p.total_laps, m = p.min_stint, laps = [];
    for (let x = m; x <= L - m; x++) laps.push(x);
    const curves = []; comps.forEach(a => comps.forEach(b => { if (a !== b) curves.push({ a, b, t: laps.map(x => M.raceTime(p, [a, b], [x])) }); }));
    const best = Math.min(...curves.flatMap(c => c.t)), ymax = 25, W = 820, H = 300, pl = 40, pr = 16, pt = 10, pb = 28;
    const X = x => pl + (x - laps[0]) / (laps[laps.length - 1] - laps[0]) * (W - pl - pr), Y = v => pt + (1 - Math.min(v, ymax) / ymax) * (H - pt - pb);
    const dash = { SOFT: "", MEDIUM: "8 5", HARD: "2 5" };
    let s = `<svg viewBox="0 0 ${W} ${H}">`;
    for (let g = 0; g <= ymax; g += 5) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(g)}" y2="${Y(g)}" stroke="rgba(255,255,255,.07)"/><text x="${pl - 6}" y="${Y(g) + 4}" text-anchor="end">${g}s</text>`;
    for (let x = Math.ceil(laps[0] / 5) * 5; x <= laps[laps.length - 1]; x += 5) s += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle">L${x}</text>`;
    const labs = [];
    curves.forEach(c => {
      s += `<path d="${c.t.map((v, i) => `${i ? "L" : "M"}${X(laps[i])},${Y(v - best)}`).join("")}" fill="none" stroke="${TYRE[c.a]}" stroke-width="2" stroke-dasharray="${dash[c.b]}" style="filter:drop-shadow(0 0 3px ${TYRE[c.a]}55)"/>`;
      const j = c.t.indexOf(Math.min(...c.t)); if (c.t[j] - best < ymax) labs.push([X(laps[j]), Y(c.t[j] - best), `${AB[c.a]}→${AB[c.b]} L${laps[j]}`, TYRE[c.a]]);
    });
    labs.sort((a, b) => a[1] - b[1]).forEach(([x, y, t, c], i) => s += `<circle cx="${x}" cy="${y}" r="5" fill="${c}" stroke="#0d0d0f" stroke-width="2"/><text x="${x + 8}" y="${y - 8 - (i % 2) * 12}" style="fill:#f2efe9;font-size:12px">${t}</text>`);
    $("#pitChart").innerHTML = s + "</svg>";
    const one = S.fam.find(r => r.stops === 1), two = S.fam.find(r => r.stops === 2);
    $("#facts").innerHTML = [
      [one ? one.strategy : "-", "best 1-stop"], [two ? two.strategy : "-", "best 2-stop"],
      [one && two ? f(Math.abs(one.gap - two.gap), 2) + " s" : "-", "1-stop vs 2-stop"], [f(p.pit_loss_mean, 1) + " s", "pit-stop loss"],
    ].map(([b, t]) => `<div><b>${esc(b)}</b><span>${t}</span></div>`).join("");
  }

  /* ---------------- undercut heat (predictions tab) ---------------- */
  const ucOld = $("#ucOld"), ucNew = $("#ucNew"), sAge = $("#sAge");
  function ucOptions() {
    const c = Object.keys(race().params.compounds), o = s => c.map(x => `<option ${x === s ? "selected" : ""}>${x}</option>`).join("");
    ucOld.innerHTML = o(c.includes("MEDIUM") ? "MEDIUM" : c[0]); ucNew.innerHTML = o(c.includes("HARD") ? "HARD" : c[c.length - 1]);
  }
  function renderHeat() {
    const age = +sAge.value, ks = [1, 2, 3, 4, 5], gaps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    $("#oAge").textContent = age + " laps";
    const col = v => { const a = [[13, 13, 15], [90, 0, 0], [255, 42, 42], [255, 242, 0]], t = Math.min(.999, v) * 3, i = Math.floor(t), q = t - i; return `rgb(${a[i].map((x, k) => Math.round(x + (a[i + 1][k] - x) * q))})`; };
    let h = `<div class="heat__row"><span></span>${ks.map(k => `<span class="heat__lab">${k} lap${k > 1 ? "s" : ""}</span>`).join("")}</div>`;
    gaps.forEach(g => {
      h += `<div class="heat__row"><span class="heat__lab">${g}s</span>`;
      ks.forEach(k => { const v = M.undercutP(S.p, g, k, age, ucOld.value, ucNew.value, 800); h += `<span class="heat__cell" style="background:${col(v)};color:${v > .8 ? "#111" : "#f2efe9"}">${pct(v)}</span>`; });
      h += "</div>";
    });
    $("#heat").innerHTML = h;
  }
  [ucOld, ucNew, sAge].forEach(el => el.addEventListener("input", renderHeat));

  /* ---------------- stat bar ---------------- */
  function renderStat() {
    $("#statbar").innerHTML = [["Season", season()], ["Race file", race().id], ["Plans screened", S.res.total.toLocaleString()], ["Races simulated", S.res.n.toLocaleString()], ["Model", "v0.1 · Monte Carlo"]]
      .map(([a, b]) => `<div><span>${a}</span><b>${esc(b)}</b></div>`).join("") + `<a class="btn btn--red" href="showcase.html">Open showcase →</a>`;
  }

  /* ---------------- replay + callouts ---------------- */
  const CALL = [
    { key: "rearWing", label: "Lap time", off: [70, -110] },
    { key: "cockpit", label: "Stint", off: [-70, -170] },
    { key: "frontWheel", label: "Tyre", off: [-240, -80] },
    { key: "nose", label: "Fuel effect", off: [-230, 60] },
    { key: "sidepod", label: "Wear penalty", off: [110, 40] },
    { key: "rearWheel", label: "Gap to plan B", off: [60, 120] },
  ];
  const callEl = $("#callouts");
  callEl.innerHTML = CALL.map(c => `<div class="callout" data-k="${c.key}"><span>${c.label}</span><b>-</b></div>`).join("");
  const cards = Object.fromEntries($$(".callout", callEl).map(el => [el.dataset.k, el]));

  function setLap(lap) {
    const p = S.p, L = p.total_laps; S.lap = lap;
    const st = stintAt(S.A, lap), cm = p.compounds[st.comp];
    const isPit = S.A.pits.includes(lap) || S.A.pits.includes(lap - 1);
    const cum = (tr) => tr.slice(0, lap).reduce((a, b) => a + b, 0);
    const gapB = cum(S.trB) - cum(S.trA);
    $("#rpLap").textContent = `Lap ${lap} / ${L}`; $("#rpTime").textContent = lapStr(S.trA[lap - 1]); $("#rpScrub").value = lap;
    $("#rpPos").textContent = isPit ? "PIT" : "PLAN A";
    const vals = {
      rearWing: lapStr(S.trA[lap - 1]),
      cockpit: `${st.i + 1}<small>/ ${S.A.compounds.length}</small>`,
      frontWheel: `${AB[st.comp]}<small>· ${st.age} laps</small>`,
      nose: `+${f(p.fuel_coef * (L - lap), 2)}<small>s</small>`,
      sidepod: `+${f(M.penalty(cm, st.age) - cm.offset, 2)}<small>s</small>`,
      rearWheel: `${gapB >= 0 ? "+" : ""}${f(gapB, 1)}<small>s</small>`,
    };
    for (const [k, v] of Object.entries(vals)) { cards[k].querySelector("b").innerHTML = v; cards[k].classList.toggle("is-hot", isPit && (k === "rearWing" || k === "frontWheel")); }
    $("#boxbox").classList.toggle("is-on", S.A.pits.includes(lap));
    if (wire) { wire.setTyre(TYRE[st.comp]); if (S.A.pits.includes(lap)) wire.pulse(); }
    const cur = $("#engCursor"); if (cur) cur.style.left = `calc(132px + (100% - 132px) * ${(lap - 0.5) / L})`;
    if (innerWidth <= 900 && cur) cur.style.left = `calc(96px + (100% - 96px) * ${(lap - 0.5) / L})`;
    // mini charts
    const idx = lap - 1, noPit = (tr, plan) => tr.map((v, i) => (plan.pits.includes(i + 1) || plan.pits.includes(i)) ? NaN : v);
    const raw = noPit(S.trA, S.A), clean = raw.map((v, i) => {
      if (Number.isFinite(v)) return v;
      let l = i - 1, r = i + 1; while (l >= 0 && !Number.isFinite(raw[l])) l--; while (r < raw.length && !Number.isFinite(raw[r])) r++;
      return l < 0 ? raw[r] : r >= raw.length ? raw[l] : raw[l] + (raw[r] - raw[l]) * (i - l) / (r - l);
    });
    const wear = Array.from({ length: L }, (_, i) => { const s2 = stintAt(S.A, i + 1), c2 = p.compounds[s2.comp]; return M.penalty(c2, s2.age) - c2.offset; });
    let acc = 0; const gaps = S.trA.map((v, i) => (acc += S.trB[i] - v));
    line($("#mLap"), [{ y: clean, color: "#ff2a2a", fill: true }], { marker: idx, dec: 1 });
    line($("#mWear"), [{ y: wear, color: "#FFF200", fill: true }], { marker: idx, dec: 1, min: 0 });
    line($("#mGap"), [{ y: gaps, color: "#f2efe9", fill: true }], { marker: idx, dec: 0 });
    $("#mtLap").textContent = f(S.trA[idx], 2); $("#mtWear").textContent = "+" + f(wear[idx], 2); $("#mtGap").textContent = (gaps[idx] >= 0 ? "+" : "") + f(gaps[idx], 1);
    // projection
    const cA = noPit(S.trA, S.A), cB = noPit(S.trB, S.B);
    const fin = [...cA, ...cB].filter(Number.isFinite);
    const nxt = Math.min(L - 1, idx + 1);
    $("#projTag").textContent = `lap ${lap} → ${nxt + 1}: ${Number.isFinite(cA[nxt]) ? lapStr(cA[nxt]) : "pit"}`;
    line($("#projChart"), [{ y: cA, color: "#ff2a2a", w: 2.2, fill: true }, { y: cB, color: "#f2efe9", w: 1.6 }], {
      marker: idx, dec: 1, pl: 38, pb: 18, min: Math.min(...fin) - 0.2, max: Math.max(...fin) + 0.2, xticks: [0, Math.round(L / 4), Math.round(L / 2), Math.round(3 * L / 4), L - 1],
      extra: (X, Y, W) => `<text x="${W - 8}" y="16" text-anchor="end" style="fill:#ff2a2a;font-size:11px">${esc(S.A.strategy)}</text><text x="${W - 8}" y="30" text-anchor="end" style="fill:#f2efe9;font-size:11px">${esc(S.B.strategy)}</text>`,
    });
  }

  function play() {
    clearInterval(S.timer);
    $("#rpPlay").textContent = S.playing ? "❚❚" : "▶"; $("#rpPlay").setAttribute("aria-label", S.playing ? "Pause replay" : "Play replay");
    if (!S.playing) return;
    S.timer = setInterval(() => setLap(S.lap >= S.p.total_laps ? 1 : S.lap + 1), 900 / +$("#rpSpeed").value);
  }
  $("#rpPlay").onclick = () => { S.playing = !S.playing; play(); };
  $("#rpSpeed").onchange = play;
  $("#rpScrub").oninput = e => { S.playing = false; play(); setLap(+e.target.value); };

  /* ---------------- 3D wireframe + leader lines ---------------- */
  let wire = null;
  const use3D = !!(window.VR3D && VR3D.supported());
  if (use3D) { try { wire = VR3D.mountWireframe($("#wire")); } catch (e) { console.warn(e); } }
  if (!wire) document.body.classList.add("no-3d");
  const stage = $("#stage"), leaders = $("#leaders");
  let sm = { x: 0, y: 0 }, mouse = { x: 0, y: 0 };
  addEventListener("pointermove", e => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; }, { passive: true });

  function placeCallouts() {
    const W = stage.clientWidth, H = stage.clientHeight, narrow = W < 620, k = narrow ? 0.55 : 1;
    sm.x += (mouse.x - sm.x) * .08; sm.y += (mouse.y - sm.y) * .08;
    const anchors = wire ? wire.project() : null;
    let paths = "";
    const boxes = CALL.map((c, i) => {
      const el = cards[c.key], w = el.offsetWidth, h = el.offsetHeight;
      let ax, ay;
      if (anchors) { ax = anchors[c.key].x; ay = anchors[c.key].y; }
      else { ax = W / 2 + (c.off[0] > 0 ? 40 : -40); ay = H / 2 + (i - 2.5) * 30; }
      const depth = (i % 3 + 1) * 4, left = ax < W / 2;            // cards sit on the side of the car their anchor is on
      let x = left ? ax - Math.abs(c.off[0]) * k - w : ax + Math.abs(c.off[0]) * k;
      x += sm.x * depth;
      x = Math.max(8, Math.min(W - w - 8, x));
      return { c, el, w, h, ax, ay, x, y: ay + c.off[1] * k + sm.y * depth - h / 2, left };
    });
    [true, false].forEach(side => {                                   // push overlapping cards apart, per side
      const g = boxes.filter(b => b.left === side).sort((p, q) => p.y - q.y);
      g.forEach((b, i) => { b.y = Math.max(8, b.y); if (i && b.y < g[i - 1].y + g[i - 1].h + 10) b.y = g[i - 1].y + g[i - 1].h + 10; });
      const over = g.length ? g[g.length - 1].y + g[g.length - 1].h - (H - 34) : 0;
      if (over > 0) g.forEach(b => b.y = Math.max(8, b.y - over));
    });
    boxes.forEach(b => {
      b.el.style.transform = `translate3d(${b.x}px,${b.y}px,0) perspective(600px) rotateY(${sm.x * 8}deg) rotateX(${-sm.y * 6}deg)`;
      const ex = b.left ? b.x + b.w : b.x, ey = b.y + b.h / 2, kx = b.ax + (ex - b.ax) * 0.55;
      if (anchors) paths += `<path d="M${b.ax},${b.ay} L${kx},${ey} L${ex},${ey}"/><circle cx="${b.ax}" cy="${b.ay}" r="5"/>`;
    });
    leaders.innerHTML = paths;
    requestAnimationFrame(placeCallouts);
  }

  /* ---------------- panel tilt (mouse-sensitive) ---------------- */
  if (fine && !reduce) {
    let cur = null;
    const reset = el => { el.classList.remove("is-tilt"); el.style.transform = ""; };
    document.addEventListener("mousemove", e => {
      const el = e.target.closest(".panel, .callcard, .facts div");
      if (cur && cur !== el) reset(cur);
      cur = el; if (!el) return;
      if (!el.querySelector(":scope > .glare")) el.insertAdjacentHTML("beforeend", '<span class="glare"></span>');
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.classList.add("is-tilt");
      el.style.transform = `perspective(1000px) rotateX(${(.5 - py) * 4}deg) rotateY(${(px - .5) * 5}deg) translateZ(4px)`;
      el.style.setProperty("--gx", px * 100 + "%"); el.style.setProperty("--gy", py * 100 + "%");
    }, { passive: true });
  }

  /* ---------------- tabs, controls, race switching ---------------- */
  function setTab(t) {
    $$("[data-tab]").forEach(b => b.classList.toggle("is-on", b.dataset.tab === t));
    $$(".view").forEach(v => v.classList.toggle("is-on", v.dataset.view === t));
    $("#stage").classList.toggle("is-covered", t !== "overview");
    if (t === "predictions") renderHeat();
  }
  $$("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  let deb = null;
  Object.values(SL).forEach(s => s.addEventListener("input", () => { syncOut(); $("#labStatus").textContent = "Simulating…"; clearTimeout(deb); deb = setTimeout(compute, 200); }));
  $("#resetBtn").onclick = () => { resetSliders(); compute(); };
  $("#runBtn").onclick = () => { $("#runBtn").textContent = "Simulating…"; setTimeout(() => { compute(); $("#runBtn").textContent = "Run simulation"; if (wire) wire.pulse(); }, 30); };
  const sel = $("#raceSelect");
  sel.innerHTML = DATA.races.map((r, i) => `<option value="${i}">${esc(r.circuit)}</option>`).join("");
  sel.onchange = () => { S.raceIdx = +sel.value; resetSliders(); ucOptions(); S.lap = 1; compute(); };

  resetSliders(); ucOptions(); compute(); play();
  requestAnimationFrame(placeCallouts);
  addEventListener("resize", () => setLap(S.lap));
})();
