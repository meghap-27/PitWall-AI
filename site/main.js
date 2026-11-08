/* VR-25 Strategy Lab - interactions. Vanilla JS, no build step.
   Data: window.STRATEGY_DATA (site/data/results.js, from scripts/export_site_data.py)
   Model: window.StrategyModel (site/model.js, live re-runs for the sliders) */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const M = window.StrategyModel;
  const DATA = window.STRATEGY_DATA || { races: [] };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const ABBR = { SOFT: "S", MEDIUM: "M", HARD: "H" };
  const TYRE = { SOFT: "#DC0000", MEDIUM: "#FFF200", HARD: "#F4F1EA" };
  const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);
  const pct = x => Math.round(x * 100) + "%";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const use3D = !!(window.VR3D && window.VR3D.supported()) && !reduce;
  document.body.classList.add(use3D ? "has-3d" : "no-3d");
  const mouse = { x: 0, y: 0 };
  addEventListener("pointermove", e => {
    mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1;
    if (window.VR3D) { VR3D.mouse.x = mouse.x; VR3D.mouse.y = mouse.y; }
    document.documentElement.style.setProperty("--cx", e.clientX + "px");
    document.documentElement.style.setProperty("--cy", e.clientY + "px");
  }, { passive: true });
  const carSvg = (cls = "") => `<svg viewBox="0 0 120 300" class="${cls}"><use href="#car"/></svg>`;

  if (!DATA.races.length) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="padding:20px;background:#DC0000;color:#fff;position:relative;z-index:300">No data found. Run <code>python scripts/export_site_data.py</code> first.</p>');
    return;
  }
  let raceIdx = 0;
  const race = () => DATA.races[raceIdx];
  const season = () => (race().circuit.match(/(19|20)\d\d/) || ["2025"])[0];
  const place = () => race().circuit.replace(/\s*(19|20)\d\d\s*/, "").replace(/\(illustrative\)/i, "").trim() || "Test track";

  /* ---------------- Loader ---------------- */
  const loader = $("#loader");
  $("#loadBtn").addEventListener("click", () => {
    loader.classList.add("is-gone");
    document.body.classList.remove("is-loading");
    setTimeout(() => loader.remove(), 1100);
  });

  /* ---------------- Cursor + magnetic buttons ---------------- */
  if (fine && !reduce) {
    const cur = $(".cursor"), dot = $(".cursor__dot"), ring = $(".cursor__ring");
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    addEventListener("mousemove", e => { x = e.clientX; y = e.clientY; dot.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`; });
    (function loop() { rx += (x - rx) * .18; ry += (y - ry) * .18; ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`; requestAnimationFrame(loop); })();
    document.addEventListener("mouseover", e => cur.classList.toggle("is-hover", !!e.target.closest("a,button,select,input,.liv,.tile,.shot")));
    document.addEventListener("mousemove", e => {
      $$(".magnetic").forEach(b => {
        const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy);
        b.style.transform = d < 90 ? `translate(${dx * .25}px,${dy * .35}px)` : "";
      });
    });
  } else { $(".cursor").remove(); }

  /* ---------------- Menu ---------------- */
  const LIVERIES = [
    { name: "Season", year: "2025", glow: "#4a0000", v: { body: "#DC0000", accent: "#FFF200", stripe: "#0B0B0C", wing: "#111", num: "#F4F1EA" },
      alt: { body: "#DC0000", accent: "#F4F1EA", stripe: "#111", wing: "#0B0B0C", num: "#FFF200" } },
    { name: "Monza Special", year: "2025", glow: "#2a2a6a", v: { body: "#1b2a8a", accent: "#DC0000", stripe: "#F4F1EA", wing: "#0d1240", num: "#F4F1EA" },
      alt: { body: "#F4F1EA", accent: "#1b2a8a", stripe: "#DC0000", wing: "#0d1240", num: "#1b2a8a" } },
    { name: "Dark Mode", year: "2025", glow: "#2b2b2b", v: { body: "#1c1c1e", accent: "#DC0000", stripe: "#0B0B0C", wing: "#000", num: "#DC0000" },
      alt: { body: "#0B0B0C", accent: "#FFF200", stripe: "#2a2a2a", wing: "#000", num: "#FFF200" } },
    { name: "Night Race", year: "2025", glow: "#4a003a", v: { body: "#5b0a4d", accent: "#ff4fd8", stripe: "#0B0B0C", wing: "#1a0016", num: "#F4F1EA" },
      alt: { body: "#ff4fd8", accent: "#5b0a4d", stripe: "#1a0016", wing: "#1a0016", num: "#0B0B0C" } },
    { name: "Heritage", year: "1975 tribute", glow: "#5a3a00", v: { body: "#b30000", accent: "#F4F1EA", stripe: "#F4F1EA", wing: "#b30000", num: "#0B0B0C" },
      alt: { body: "#F4F1EA", accent: "#b30000", stripe: "#b30000", wing: "#F4F1EA", num: "#b30000" } },
    { name: "Test Day", year: "Pre-season", glow: "#333", v: { body: "#6b6b6b", accent: "#FFF200", stripe: "#0B0B0C", wing: "#222", num: "#FFF200" },
      alt: { body: "#0B0B0C", accent: "#6b6b6b", stripe: "#FFF200", wing: "#222", num: "#F4F1EA" } },
  ];
  const vars = v => Object.entries(v).map(([k, c]) => `--${k}:${c}`).join(";");

  const menu = $("#menu"), menuBtn = $("#menuBtn"), collage = $("#collage");
  const spots = [[4, 6, -8], [42, 0, 6], [18, 44, 4], [58, 38, -5], [32, 70, -12]];
  collage.innerHTML = spots.map(([l, t, r], i) => {
    const L = LIVERIES[i];
    return `<div class="menu__tile" style="left:${l}%;top:${t}%;--tile:${L.glow};transform:rotate(${r}deg)" data-r="${r}">
      <div style="${vars(L.v)}">${carSvg()}</div><span class="label">${esc(L.name)}</span></div>`;
  }).join("");
  const setMenu = open => {
    menu.classList.toggle("is-open", open); menu.setAttribute("aria-hidden", !open);
    menuBtn.setAttribute("aria-expanded", open); menuBtn.textContent = open ? "Close" : "Menu";
  };
  menuBtn.addEventListener("click", () => setMenu(!menu.classList.contains("is-open")));
  $$(".menu__links a").forEach(a => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
  if (!reduce) menu.addEventListener("mousemove", e => {
    const dx = e.clientX / innerWidth - .5, dy = e.clientY / innerHeight - .5;
    $$(".menu__tile", collage).forEach((t, i) => {
      const k = (i + 1) * 10;
      t.style.transform = `translate(${dx * k}px,${dy * k}px) rotate(${t.dataset.r}deg)`;
    });
  });

  /* ---------------- Hero: vertical drive ---------------- */
  const hero = $("#hero"), car = $("#heroCar"), lines = $("#trackLines"), box = $("#boxbox");
  const kerbs = $$(".track__kerb");
  const lockBtn = $("#lockBtn");
  let locked = false, lockedProgress = 0;
  let hero3d = null;
  if (use3D) { try { hero3d = VR3D.mountHero($("#heroCanvas")); } catch (err) { console.warn("3D hero disabled:", err); document.body.classList.replace("has-3d", "no-3d"); } }

  function heroStints() {
    const r = race(), L = r.params.total_laps;
    $("#heroStints").innerHTML = r.bestTrace.stints.map(s =>
      `<span style="width:${((s.to - s.from + 1) / L) * 100}%;background:${TYRE[s.compound]}" title="${s.compound} laps ${s.from}-${s.to}"></span>`).join("")
      + '<i class="stintbar__marker" id="marker"></i>';
    $("#hudTotal").textContent = L;
    $("#hudPlan").textContent = r.bestTrace.label.split(" ")[0];
    $("#raceName").textContent = place();
  }

  function heroFrame() {
    const r = race(), L = r.params.total_laps;
    const rect = hero.getBoundingClientRect();
    const total = hero.offsetHeight - innerHeight;
    let prog = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
    if (locked) prog = lockedProgress;
    const lap = Math.max(1, Math.min(L, Math.ceil(prog * L) || 1));
    const stint = r.bestTrace.stints.find(s => lap >= s.from && lap <= s.to) || r.bestTrace.stints[0];
    $("#hudLap").textContent = lap;
    $("#hudTyre").textContent = ABBR[stint.compound];
    $("#hudTyre").style.color = TYRE[stint.compound];
    car.style.setProperty("--band", TYRE[stint.compound]);
    const mk = $("#marker"); if (mk) mk.style.left = (prog * 100) + "%";
    const travel = prog * 6000;                                      // track scroll offset in px
    lines.style.backgroundPosition = `0 ${travel}px`;
    kerbs.forEach(k => k.style.backgroundPosition = `0 ${travel}px`);
    const y = 18 + prog * 46;                                        // car drifts down the screen
    const weave = Math.sin(prog * 40) * 14;
    car.style.transform = `translate(calc(-50% + ${weave}px), 0) rotate(${Math.cos(prog * 40) * 4}deg)`;
    car.style.top = y + "%";
    const pits = r.bestTrace.stints.slice(1).map(s => s.from - 1);
    const boxOn = pits.some(p => lap === p || lap === p + 1) && prog > 0 && prog < 1;
    box.classList.toggle("is-on", boxOn);
    if (hero3d) hero3d.update({ prog, tyre: TYRE[stint.compound], pitting: boxOn });
    return prog;
  }
  lockBtn.addEventListener("click", () => {
    locked = !locked;
    if (locked) { locked = false; lockedProgress = heroFrame(); locked = true; }
    lockBtn.setAttribute("aria-pressed", locked);
    lockBtn.textContent = locked ? "Back to scroll" : "Tap to lock";
  });
  const raceChip = $("#raceChip");
  raceChip.addEventListener("click", () => { if (DATA.races.length > 1) setRace((raceIdx + 1) % DATA.races.length); else location.hash = "#lab"; });

  /* ---------------- Drifting strip ---------------- */
  function buildStrip() {
    const r = race(), best = r.bestTrace, cap = `${place()}, ${season()}`;
    const pits = best.stints.slice(1).map(s => s.from - 1);
    const shots = [
      { big: "Lights<br>out", sub: `${r.params.total_laps} laps · ${best.stints[0].compound.toLowerCase()} start`, rot: 0, bg: "radial-gradient(90% 80% at 30% 20%,#5a0000,#0f0f10)", v: LIVERIES[0].v },
      { big: `Lap ${pits[0]}`, sub: "Box, box. First stop", rot: -18, bg: "radial-gradient(90% 80% at 70% 30%,#3d3a00,#0f0f10)", wide: true, v: LIVERIES[0].alt },
      { quote: true },
      { big: pct(r.scenario.share_with_sc), sub: "of simulated races see a Safety Car", rot: 12, bg: "radial-gradient(90% 80% at 50% 10%,#2a2a2a,#0f0f10)", v: LIVERIES[2].v },
      { big: fmt(r.params.pit_loss_mean, 1) + "s", sub: "lost in the pit lane per stop", rot: 90, bg: "radial-gradient(90% 80% at 20% 70%,#4a0000,#0f0f10)", wide: true, v: LIVERIES[4].v },
      { big: pits.length > 1 ? `Lap ${pits[1]}` : "Final stint", sub: pits.length > 1 ? "Second stop. Fresh rubber to the flag" : "Bring it home", rot: -6, bg: "radial-gradient(90% 80% at 60% 60%,#2a0030,#0f0f10)", v: LIVERIES[3].v },
      { big: "Flag", sub: best.label, rot: 4, bg: "repeating-conic-gradient(#151516 0 25%,#0f0f10 0 50%) 0 0/60px 60px", v: LIVERIES[0].v },
    ];
    $("#stripRow").innerHTML = shots.map(s => s.quote
      ? `<div class="quote"><p>The fastest car doesn't always win. <b>The best-timed stop</b> usually does.</p><span class="label">Volta Racing pit wall</span></div>`
      : `<figure class="shot ${s.wide ? "shot--wide" : ""}" style="--shot:${s.bg}">
          <div class="shot__art"><div class="shot__big">${s.big}<small>${esc(s.sub)}</small></div></div>
          <div class="shot__cap"><span class="chip">${esc(cap)}</span><div style="${vars(s.v)};--rot:${s.rot}deg;width:46px">${carSvg("shot__car")}</div></div>
        </figure>`).join("");
    $$(".shot__car").forEach(svg => svg.style.width = "100%");
  }
  const strip = $("#strip"), row = $("#stripRow");
  function stripFrame() {
    if (reduce || innerWidth <= 900) return;
    const r = strip.getBoundingClientRect();
    const p = 1 - (r.top + r.height) / (innerHeight + r.height);
    const max = row.scrollWidth - innerWidth * .9;
    row.style.transform = `translateX(${-Math.max(0, Math.min(1, p)) * max}px)`;
  }

  /* ---------------- Scroll loop + reveals ---------------- */
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { heroFrame(); stripFrame(); ticking = false; });
  }, { passive: true });
  addEventListener("resize", () => { heroFrame(); stripFrame(); });
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: .12 });
  $$(".reveal").forEach(el => io.observe(el));
  $$(".portal").forEach(p => p.addEventListener("mousemove", e => {
    const r = p.getBoundingClientRect();
    p.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
    p.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
  }));

  /* ---------------- Strategy Lab (live) ---------------- */
  const S = { sc: $("#sSc"), pit: $("#sPit"), deg: $("#sDeg"), fuel: $("#sFuel"), runs: $("#sRuns") };
  const O = { sc: $("#oSc"), pit: $("#oPit"), deg: $("#oDeg"), fuel: $("#oFuel"), runs: $("#oRuns") };
  const raceSelect = $("#raceSelect");
  raceSelect.innerHTML = DATA.races.map((r, i) => `<option value="${i}">${esc(r.circuit)}</option>`).join("");
  raceSelect.addEventListener("change", () => setRace(+raceSelect.value));

  function resetSliders() {
    const p = race().params;
    S.sc.value = p.p_sc; S.pit.value = p.pit_loss_mean; S.deg.value = 1; S.fuel.value = p.fuel_coef; S.runs.value = 1500;
    syncOutputs();
  }
  function syncOutputs() {
    O.sc.textContent = pct(+S.sc.value); O.pit.textContent = fmt(+S.pit.value) + " s";
    O.deg.textContent = fmt(+S.deg.value, 2) + "×"; O.fuel.textContent = fmt(+S.fuel.value, 3) + " s/lap";
    O.runs.textContent = (+S.runs.value).toLocaleString();
  }
  function effectiveParams() {
    const p = JSON.parse(JSON.stringify(race().params)), k = +S.deg.value;
    p.p_sc = +S.sc.value; p.pit_loss_mean = +S.pit.value; p.fuel_coef = +S.fuel.value;
    Object.values(p.compounds).forEach(c => { c.deg_lin *= k; c.deg_quad *= k; c.cliff_rate *= k; });
    return p;
  }

  let timer = null;
  function scheduleRun() {
    syncOutputs();
    $("#callCard").classList.add("is-busy");
    $("#labStatus").textContent = `Simulating ${(+S.runs.value).toLocaleString()} races…`;
    clearTimeout(timer);
    timer = setTimeout(runLab, 180);
  }
  Object.values(S).forEach(s => s.addEventListener("input", scheduleRun));
  $("#resetBtn").addEventListener("click", () => { resetSliders(); scheduleRun(); });

  function stintBar(compounds, pits, L) {
    const b = [0, ...pits, L];
    return compounds.map((c, i) => `<span class="s-${c}" style="flex:${b[i + 1] - b[i]}">${ABBR[c]}</span>`).join("");
  }

  function runLab() {
    const p = effectiveParams(), t0 = performance.now();
    const res = M.runLab(p, +S.runs.value, 42);
    const ms = performance.now() - t0;
    const fam = []; const seen = new Set();
    res.rows.forEach(r => { const k = r.compounds.join("-"); if (!seen.has(k)) { seen.add(k); fam.push(r); } });
    const best = fam[0], next = fam[1];
    $("#callPlan").textContent = best.strategy;
    const lead = next ? next.gap - best.gap : null;
    $("#callGap").textContent = lead === null ? "-" : (lead < 1 ? fmt(lead, 2) : fmt(lead, 1)) + " s";
    $("#callP").textContent = pct(res.rows.filter(r => r.compounds.join("-") === best.compounds.join("-")).reduce((a, r) => a + r.pFastest, 0));
    $("#callSc").textContent = pct(res.shareSc);
    $("#callCard").classList.remove("is-busy");
    $("#labStatus").textContent = `${res.total.toLocaleString()} plans screened · ${res.simulated} simulated × ${res.n.toLocaleString()} races · ${Math.round(ms)} ms`;

    $("#plans").innerHTML = fam.slice(0, 8).map((r, i) => `
      <div class="plan">
        <div class="plan__name">${i === 0 ? '<svg><use href="#flags"/></svg>' : ""}${esc(r.strategy)}</div>
        <div class="plan__bar">${stintBar(r.compounds, r.pits, p.total_laps)}</div>
        <div class="plan__nums">${i === 0 ? "<b>Best</b>" : `<b>+${fmt(r.gap, 1)} s</b>`}<br>±${fmt(r.risk, 1)} s risk</div>
      </div>`).join("");
    drawPitChart(p);
    buildMosaic(res, fam, p);
  }

  function drawPitChart(p) {
    const comps = Object.keys(p.compounds), L = p.total_laps, m = p.min_stint;
    const laps = []; for (let x = m; x <= L - m; x++) laps.push(x);
    const curves = [];
    comps.forEach(a => comps.forEach(b => { if (a !== b) curves.push({ a, b, t: laps.map(x => M.raceTime(p, [a, b], [x])) }); }));
    const best = Math.min(...curves.flatMap(c => c.t)), ymax = 25;
    const W = 760, H = 300, pl = 40, pr = 20, pt = 14, pb = 34;
    const X = x => pl + (x - laps[0]) / (laps[laps.length - 1] - laps[0]) * (W - pl - pr);
    const Y = v => pt + (1 - Math.min(v, ymax) / ymax) * (H - pt - pb);
    const dash = { SOFT: "", MEDIUM: "8 5", HARD: "2 5" };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1-stop pit window chart">`;
    for (let g = 0; g <= ymax; g += 5) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(g)}" y2="${Y(g)}" stroke="rgba(244,241,234,.08)"/><text x="${pl - 8}" y="${Y(g) + 4}" text-anchor="end">${g}s</text>`;
    for (let x = Math.ceil(laps[0] / 5) * 5; x <= laps[laps.length - 1]; x += 5) s += `<text x="${X(x)}" y="${H - 10}" text-anchor="middle">L${x}</text>`;
    const labels = [];
    curves.forEach(c => {
      const d = c.t.map((v, i) => `${i ? "L" : "M"}${X(laps[i]).toFixed(1)},${Y(v - best).toFixed(1)}`).join("");
      s += `<path d="${d}" fill="none" stroke="${TYRE[c.a]}" stroke-width="2" stroke-dasharray="${dash[c.b]}" opacity=".9"/>`;
      const j = c.t.indexOf(Math.min(...c.t));
      if (c.t[j] - best < ymax) labels.push({ x: X(laps[j]), y: Y(c.t[j] - best), txt: `${ABBR[c.a]}→${ABBR[c.b]} L${laps[j]}`, col: TYRE[c.a] });
    });
    labels.sort((a, b) => a.y - b.y);
    labels.forEach((l, i) => {
      s += `<circle cx="${l.x}" cy="${l.y}" r="5" fill="${l.col}" stroke="#141415" stroke-width="2"/>`;
      s += `<text x="${l.x + 8}" y="${l.y - 8 - (i % 2) * 12}" style="fill:#F4F1EA;font-weight:600">${l.txt}</text>`;
    });
    $("#pitChart").innerHTML = s + "</svg>";
  }

  /* ---------------- Undercut heatmap ---------------- */
  const ucOld = $("#ucOld"), ucNew = $("#ucNew"), sAge = $("#sAge");
  function ucOptions() {
    const comps = Object.keys(race().params.compounds);
    const opt = sel => comps.map(c => `<option ${c === sel ? "selected" : ""}>${c}</option>`).join("");
    ucOld.innerHTML = opt(comps.includes("MEDIUM") ? "MEDIUM" : comps[0]);
    ucNew.innerHTML = opt(comps.includes("HARD") ? "HARD" : comps[comps.length - 1]);
  }
  function drawHeat() {
    const p = race().params, age = +sAge.value, gaps = [], ks = [1, 2, 3, 4, 5];
    for (let g = 0.5; g <= 5.01; g += 0.5) gaps.push(+g.toFixed(1));
    $("#oAge").textContent = age + " laps";
    const col = v => {
      const a = [[11, 11, 12], [90, 0, 0], [220, 0, 0], [255, 242, 0]];
      const t = Math.min(.999, v) * (a.length - 1), i = Math.floor(t), f = t - i;
      const c = a[i].map((x, k) => Math.round(x + (a[i + 1][k] - x) * f));
      return `rgb(${c})`;
    };
    let h = `<div class="heat__row" style="--k:${ks.length}"><span></span>${ks.map(k => `<span class="heat__lab">${k} lap${k > 1 ? "s" : ""}</span>`).join("")}</div>`;
    gaps.forEach(g => {
      h += `<div class="heat__row" style="--k:${ks.length}"><span class="heat__lab">${g}s</span>`;
      ks.forEach(k => {
        const v = M.undercutP(p, g, k, age, ucOld.value, ucNew.value, 900);
        h += `<span class="heat__cell" style="background:${col(v)};color:${v > .8 ? "#0B0B0C" : "#F4F1EA"}" title="${pct(v)}">${pct(v)}</span>`;
      });
      h += "</div>";
    });
    $("#heat").innerHTML = h;
  }
  [ucOld, ucNew, sAge].forEach(el => el.addEventListener("input", drawHeat));

  /* ---------------- Liveries ---------------- */
  $("#livGrid").innerHTML = LIVERIES.map(L => `
    <article class="liv reveal" style="--glow:${L.glow}">
      <div class="liv__img liv__img--base" style="${vars(L.v)}">${carSvg()}</div>
      <div class="liv__img liv__img--hover" style="${vars(L.alt)}">${carSvg()}</div>
      <div class="liv__meta"><h3>${esc(L.name)}</h3><span class="label">${esc(L.year)}</span></div>
    </article>`).join("");
  $$("#livGrid .reveal").forEach(el => io.observe(el));
  let showroom = null;
  if (use3D && document.body.classList.contains("has-3d")) { try { showroom = VR3D.mountShowroom($("#showroomCanvas"), LIVERIES[0].v); } catch (err) { console.warn(err); } }
  const pickLivery = i => {
    const L = LIVERIES[i];
    $$("#livGrid .liv").forEach((el, k) => el.classList.toggle("is-active", k === i));
    $("#showroomName").textContent = L.name; $("#showroomYear").textContent = L.year;
    $("#showroom").style.background = `radial-gradient(70% 70% at 50% 62%, ${L.glow}, #0d0d0e 70%)`;
    if (showroom) showroom.setLivery(L.v);
  };
  $$("#livGrid .liv").forEach((el, i) => {
    el.tabIndex = 0;
    el.addEventListener("mouseenter", () => pickLivery(i));
    el.addEventListener("focus", () => pickLivery(i));
    el.addEventListener("click", () => { pickLivery(i); if (showroom) $("#showroom").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); });
  });
  pickLivery(0);

  /* ---------------- Marquee + footer row ---------------- */
  const TECH = ["Python", "NumPy", "pandas", "FastF1", "Jolpica-F1", "Monte Carlo", "Matplotlib", "Streamlit", "pytest"];
  $("#marquee").innerHTML = [...TECH, ...TECH].map(t => `<span class="marquee__item">${t}</span>`).join("");
  $("#footRow").innerHTML = TECH.slice(0, 6).map(t => `<span>${t}</span>`).join("");

  /* ---------------- Pit wall mosaic ---------------- */
  function buildMosaic(res, fam, p) {
    const r = race();
    const oneStop = fam.find(x => x.stops === 1), twoStop = fam.find(x => x.stops === 2);
    const split = oneStop && twoStop ? fmt(Math.abs(oneStop.gap - twoStop.gap), 1) + " s" : "-";
    let breakEven = "-";
    for (let g = 5; g >= 0.5; g -= 0.5) if (M.undercutP(p, g, 2, 20, ucOld.value || "MEDIUM", ucNew.value || "HARD", 600) >= .5) { breakEven = fmt(g, 1) + " s"; break; }
    const famShare = rows => res.rows.filter(x => x.compounds.join("-") === rows.compounds.join("-")).reduce((a, x) => a + x.pFastest, 0);
    $("#mosaic").innerHTML = `
      <div class="tile tile--big"><span class="label">The call · ${esc(r.circuit)}</span><b>${esc(fam[0].strategy.split(" ")[0])}</b><p>Pit on lap ${fam[0].pits.join(" and ")}. This tyre sequence was the fastest choice in ${pct(famShare(fam[0]))} of simulated races.</p>${carSvg("tile__car")}<svg class="tile__badge"><use href="#flags"/></svg></div>
      <div class="tile tile--red"><span class="label">Plans screened</span><b>${res.total.toLocaleString()}</b><p>every legal 1- and 2-stop</p></div>
      <div class="tile"><span class="label">Races simulated</span><b>${res.n.toLocaleString()}</b><p>per shortlisted plan</p></div>
      <div class="tile tile--wide"><span class="label">1-stop vs 2-stop</span><b>${split}</b><p>between the best 1-stop and the best 2-stop</p></div>
      <div class="tile tile--yellow"><span class="label">Safety Car</span><b>${pct(p.p_sc)}</b><p>chance of at least one</p></div>
      <div class="tile"><span class="label">Undercut break-even</span><b>${breakEven}</b><p>max gap that still works 50% of the time (2 laps)</p></div>
      <div class="tile tile--wide"><span class="label">Best 1-stop</span><b>${oneStop ? esc(oneStop.strategy) : "-"}</b><p>${oneStop ? `+${fmt(oneStop.gap, 1)} s on average vs the call, ±${fmt(oneStop.risk, 1)} s risk` : ""}</p></div>`;
  }

  /* ---------------- Turntable (360°): real 3D when available ---------------- */
  if (use3D && document.body.classList.contains("has-3d")) { try { VR3D.mountOrbit($("#orbitCanvas")); } catch (err) { console.warn(err); } }
  const plate = $(".turntable__plate"), tt = $("#turntable");
  let spin = 0, vel = reduce ? 0 : .25, drag = null;
  tt.addEventListener("pointerdown", e => { drag = { x: e.clientX, s: spin }; tt.setPointerCapture(e.pointerId); vel = 0; });
  tt.addEventListener("pointermove", e => { if (drag) spin = drag.s + (e.clientX - drag.x) * .6; });
  tt.addEventListener("pointerup", () => { drag = null; vel = reduce ? 0 : .25; });
  (function turn() { if (!drag) spin += vel; plate.style.setProperty("--spin", spin + "deg"); requestAnimationFrame(turn); })();

  /* ---------------- Mouse-sensitive depth: tilt cards, parallax copy, 3D type ---------------- */
  if (fine && !reduce) {
    const TILT = ".shot, .tile, .liv, .portal, .call, .steps li";
    let cur = null;
    const reset = el => { el.classList.remove("is-tilting"); el.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1), box-shadow .4s"; el.style.transform = ""; };
    document.addEventListener("mousemove", e => {
      const el = e.target.closest(TILT);
      if (cur && cur !== el) reset(cur);
      cur = el;
      if (!el) return;
      if (!el.querySelector(":scope > .tilt-glare")) el.insertAdjacentHTML("beforeend", '<span class="tilt-glare"></span>');
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      const max = el.classList.contains("portal") ? 5 : 9;
      el.classList.add("is-tilting");
      el.style.transition = "transform .12s ease-out, box-shadow .3s";
      el.style.transform = `perspective(900px) rotateX(${(.5 - py) * max}deg) rotateY(${(px - .5) * max}deg) translateZ(10px)`;
      el.style.setProperty("--gx", px * 100 + "%"); el.style.setProperty("--gy", py * 100 + "%");
    }, { passive: true });
    document.addEventListener("mouseleave", () => { if (cur) reset(cur); cur = null; });

    const heroCopy = $(".hero__copy"), hud = $(".hero__hud"), heroTitle = $(".hero__copy .display");
    const heads = $$(".sec-head .display");
    let sm = { x: 0, y: 0 };
    (function depth() {
      sm.x += (mouse.x - sm.x) * .08; sm.y += (mouse.y - sm.y) * .08;
      heroCopy.style.transform = `translate3d(${sm.x * -22}px, ${sm.y * -14}px, 0)`;
      hud.style.transform = `translate3d(${sm.x * 12}px, ${sm.y * 8}px, 0)`;
      heroTitle.style.transform = `perspective(700px) rotateY(${sm.x * 10}deg) rotateX(${-sm.y * 7}deg)`;
      heads.forEach(h => {
        const r = h.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        h.style.transform = `perspective(900px) rotateY(${sm.x * 6}deg) rotateX(${-sm.y * 4}deg) translateZ(0)`;
      });
      requestAnimationFrame(depth);
    })();
  }

  /* ---------------- Race switching ---------------- */
  function setRace(i) {
    raceIdx = i; raceSelect.value = i;
    $("#msgRuns").textContent = race().runs.toLocaleString();
    heroStints(); buildStrip(); resetSliders(); ucOptions(); drawHeat(); heroFrame(); scheduleRun();
  }
  setRace(0);
})();
