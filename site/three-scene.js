/* VR-25 in 3D - an original low-poly open-wheel car built from three.js primitives,
   plus three scenes: hero chase-cam drive, liveries showroom, footer orbit.
   Global (non-module) script so it works when index.html is opened from disk. */
(function (global) {
  "use strict";
  const THREE = global.THREE;
  const VR3D = { mouse: { x: 0, y: 0 } };
  global.VR3D = VR3D;

  VR3D.supported = function () {
    if (!THREE) return false;
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }
    catch (e) { return false; }
  };
  if (!THREE) return;

  const S = 5.6 / 300;                                   // svg units -> metres (car is 5.6 m long)
  const sx = x => (x - 60) / 60;                         // svg x -> metres (2 m wide incl. tyres)
  const sz = y => (y - 150) * S;                         // svg y -> metres (nose at -z)
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- shared studio environment for glossy reflections ---------------- */
  function studioEnv(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x050505);
    const box = (w, h, color, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(...pos); if (rot) m.rotation.set(...rot); env.add(m);
    };
    box(10, 2, new THREE.Color(4, 4, 4), [0, 8, 0], [Math.PI / 2, 0, 0]);          // overhead softbox
    box(6, 3, new THREE.Color(2.4, 2.3, 2.2), [-9, 3, 2], [0, Math.PI / 2, 0]);
    box(6, 3, new THREE.Color(2.6, 0.1, 0.1), [9, 2, -2], [0, -Math.PI / 2, 0]);    // red kicker
    box(14, 1, new THREE.Color(1.2, 1.2, 1.2), [0, 2, -10]);
    const tex = pm.fromScene(env, 0.04).texture;
    pm.dispose();
    return tex;
  }

  /* ---------------- the car ---------------- */
  function shapeFromSvg(cmds) {
    // cmds: [["M",x,y],["C",x1,y1,x2,y2,x,y],["L",x,y]] in svg units -> THREE.Shape in (x, -z)
    const sh = new THREE.Shape();
    cmds.forEach(c => {
      const P = (i) => [sx(c[i]), -sz(c[i + 1])];
      if (c[0] === "M") sh.moveTo(...P(1));
      else if (c[0] === "L") sh.lineTo(...P(1));
      else if (c[0] === "C") sh.bezierCurveTo(...P(1), ...P(3), ...P(5));
    });
    return sh;
  }
  function extrudeTop(shape, depth, bevel, y) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 18 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }

  VR3D.createCar = function (livery) {
    const L = Object.assign({ body: "#DC0000", accent: "#FFF200", stripe: "#0B0B0C", wing: "#111111", num: "#F4F1EA" }, livery || {});
    const g = new THREE.Group();
    const mats = {
      body: new THREE.MeshPhysicalMaterial({ color: L.body, metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 }),
      accent: new THREE.MeshPhysicalMaterial({ color: L.accent, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
      stripe: new THREE.MeshPhysicalMaterial({ color: L.stripe, metalness: 0.4, roughness: 0.3, clearcoat: 0.8 }),
      carbon: new THREE.MeshStandardMaterial({ color: L.wing, metalness: 0.5, roughness: 0.45 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.9, roughness: 0.3 }),
      band: new THREE.MeshStandardMaterial({ color: "#DC0000", roughness: 0.5, emissive: "#DC0000", emissiveIntensity: 0.25 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.1, roughness: 0.05, clearcoat: 1 }),
      halo: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 0.9, roughness: 0.25 }),
    };
    const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };

    // Main body + sidepods
    add(extrudeTop(shapeFromSvg([["M", 44, 96], ["C", 26, 116, 22, 150, 26, 200], ["C", 28, 222, 40, 240, 48, 256], ["L", 72, 256],
      ["C", 80, 240, 92, 222, 94, 200], ["C", 98, 150, 94, 116, 76, 96], ["L", 44, 96]]), 0.26, 0.06, 0.14), mats.body);
    // Dark sidepod inlets
    [[30, 46], [90, 74]].forEach(([outer, inner]) => {
      const sh = shapeFromSvg([["M", outer, 152], ["C", outer + (inner - outer) * .2, 128, inner - (inner - outer) * .3, 116, inner, 110], ["L", inner, 206], ["C", inner - (inner - outer) * .4, 200, outer, 186, outer, 168], ["L", outer, 152]]);
      add(extrudeTop(sh, 0.02, 0, 0.47), mats.stripe, false);
    });
    // Nose (tapered)
    add(extrudeTop(shapeFromSvg([["M", 54, 18], ["L", 66, 18], ["L", 70, 98], ["L", 50, 98], ["L", 54, 18]]), 0.14, 0.04, 0.2), mats.body);
    // Engine cover / fin (side profile extruded across x)
    const fin = new THREE.Shape();
    const fz = [-0.25, 0.4, 1.4, 2.35, 2.35, 0.2, -0.25], fy = [0.5, 0.95, 0.82, 0.62, 0.42, 0.42, 0.5];
    fin.moveTo(-fz[0], fy[0]); for (let i = 1; i < fz.length; i++) fin.lineTo(-fz[i], fy[i]);
    const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.34, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 3 });
    finG.rotateY(Math.PI / 2); finG.translate(-0.17, 0, 0);
    add(finG, mats.body);
    add(new THREE.BoxGeometry(0.08, 0.06, 1.5), mats.accent).position.set(0, 0.96, 0.75);      // spine stripe
    add(new THREE.BoxGeometry(0.1, 0.03, 1.4), mats.accent).position.set(0, 0.36, -1.7);       // nose stripe
    // Cockpit + halo
    const cock = add(new THREE.SphereGeometry(1, 24, 16), mats.glass);
    cock.scale.set(0.24, 0.16, 0.42); cock.position.set(0, 0.46, sz(128));
    const halo = add(new THREE.TorusGeometry(0.26, 0.03, 10, 30, Math.PI), mats.halo);
    halo.rotation.x = -Math.PI / 2; halo.position.set(0, 0.68, sz(122));
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), mats.halo).position.set(0, 0.55, sz(106));
    const helmet = add(new THREE.SphereGeometry(0.15, 20, 14), mats.accent); helmet.position.set(0, 0.6, sz(132));
    // Front wing
    add(new THREE.BoxGeometry(2.0, 0.04, 0.34), mats.carbon).position.set(0, 0.12, sz(11));
    add(new THREE.BoxGeometry(1.8, 0.035, 0.16), mats.accent).position.set(0, 0.2, sz(22));
    [-1, 1].forEach(s => add(new THREE.BoxGeometry(0.04, 0.22, 0.5), mats.carbon).position.set(s * 1.0, 0.18, sz(14)));
    // Rear wing
    add(new THREE.BoxGeometry(1.5, 0.05, 0.36), mats.carbon).position.set(0, 0.98, sz(278));
    add(new THREE.BoxGeometry(1.5, 0.04, 0.18), mats.accent).position.set(0, 1.08, sz(270));
    [-1, 1].forEach(s => add(new THREE.BoxGeometry(0.04, 0.62, 0.6), mats.carbon).position.set(s * 0.76, 0.78, sz(276)));
    add(new THREE.BoxGeometry(0.06, 0.5, 0.12), mats.carbon).position.set(0, 0.7, sz(272));
    add(new THREE.BoxGeometry(1.1, 0.12, 0.3), mats.carbon).position.set(0, 0.22, sz(282));    // diffuser
    // Floor
    add(extrudeTop(shapeFromSvg([["M", 40, 100], ["L", 80, 100], ["L", 98, 160], ["L", 96, 250], ["L", 24, 250], ["L", 22, 160], ["L", 40, 100]]), 0.03, 0, 0.08), mats.carbon);

    // Wheels
    const wheels = [];
    function wheel(x, z, r, w) {
      const wg = new THREE.Group(); wg.position.set(x, r, z);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 36, 1), mats.tyre); t.rotation.z = Math.PI / 2; t.castShadow = true; wg.add(t);
      const side = Math.sign(x);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.01, 24), mats.rim); rim.rotation.z = Math.PI / 2; wg.add(rim);
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, 0.022, 8, 40), mats.band); band.rotation.y = Math.PI / 2; band.position.x = side * (w / 2 + 0.006); wg.add(band);
      const spokes = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, r * 1.1, 0.06), mats.carbon); wg.add(spokes);
      const spokes2 = spokes.clone(); spokes2.rotation.x = Math.PI / 2; wg.add(spokes2);
      g.add(wg); wheels.push(wg);
      // suspension arms
      [0.12, -0.12].forEach(dz => {
        const len = Math.abs(x) - 0.3;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 6), mats.carbon);
        arm.rotation.z = Math.PI / 2; arm.position.set(side * (0.3 + len / 2), r + 0.04, z + dz); g.add(arm);
      });
    }
    wheel(-0.84, sz(64), 0.34, 0.36); wheel(0.84, sz(64), 0.34, 0.36);
    wheel(-0.8, sz(231), 0.37, 0.46); wheel(0.8, sz(231), 0.37, 0.46);

    // Race number on the nose
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 128;
    const ctx = cv.getContext("2d");
    const drawNum = col => { ctx.clearRect(0, 0, 256, 128); ctx.fillStyle = col; ctx.font = "bold 104px Anton, Impact, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("05", 128, 70); };
    drawNum(L.num);
    const numTex = new THREE.CanvasTexture(cv); numTex.colorSpace = THREE.SRGBColorSpace;
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
    num.rotation.set(-Math.PI / 2, 0, 0); num.position.set(0, 0.78, 1.95); g.add(num);

    const target = {};
    const api = {
      group: g, wheels, mats,
      setLivery(v, instant) {
        ["body", "accent", "stripe"].forEach(k => { if (v[k]) target[k] = new THREE.Color(v[k]); });
        if (v.wing) target.carbon = new THREE.Color(v.wing);
        if (v.num) { drawNum(v.num); numTex.needsUpdate = true; }
        if (instant) api.tick(1, 1);
      },
      setTyre(hex) { mats.band.color.set(hex); mats.band.emissive.set(hex); },
      tick(dt, k = 0.08) { Object.entries(target).forEach(([m, c]) => mats[m].color.lerp(c, Math.min(1, k * 60 * dt))); },
    };
    return api;
  };

  /* ---------------- renderer helper ---------------- */
  const scenes = [];
  function makeRenderer(canvas, opts = {}) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !!opts.alpha, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.75));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = opts.exposure || 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    if (opts.shadows) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; }
    return r;
  }
  function register(entry) {
    entry.visible = true;
    const io = new IntersectionObserver(es => es.forEach(e => entry.visible = e.isIntersecting), { rootMargin: "100px" });
    io.observe(entry.canvas);
    const fit = () => {
      const w = entry.canvas.clientWidth, h = entry.canvas.clientHeight;
      if (!w || !h) return;
      entry.renderer.setSize(w, h, false); entry.camera.aspect = w / h; entry.camera.updateProjectionMatrix();
    };
    new ResizeObserver(fit).observe(entry.canvas); fit();
    scenes.push(entry);
    return entry;
  }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    scenes.forEach(s => { if (s.visible) { s.update(dt, now / 1000); s.renderer.render(s.scene, s.camera); } });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function stripeTexture(draw, w = 256, h = 256) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  /* ---------------- 1. Hero: chase-cam drive ---------------- */
  VR3D.mountHero = function (canvas) {
    const renderer = makeRenderer(canvas, { shadows: true, exposure: 1.1 });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0B0B0C);
    scene.fog = new THREE.Fog(0x0B0B0C, 18, 70);
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

    const asphalt = stripeTexture((c, w, h) => {
      c.fillStyle = "#18181a"; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { const v = 22 + Math.random() * 18; c.fillStyle = `rgb(${v},${v},${v + 2})`; c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      c.fillStyle = "rgba(244,241,234,.85)"; c.fillRect(w / 2 - 3, 0, 6, h * 0.45);       // centre dash
      c.fillStyle = "rgba(244,241,234,.9)"; c.fillRect(10, 0, 5, h); c.fillRect(w - 15, 0, 5, h); // edge lines
    });
    asphalt.repeat.set(1, 30);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 240), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.75, metalness: 0.05 }));
    road.rotation.x = -Math.PI / 2; road.position.z = -90; road.receiveShadow = true; scene.add(road);

    const kerbTex = stripeTexture((c, w, h) => { c.fillStyle = "#DC0000"; c.fillRect(0, 0, w, h / 2); c.fillStyle = "#F4F1EA"; c.fillRect(0, h / 2, w, h / 2); }, 16, 64);
    kerbTex.repeat.set(1, 120);
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6 });
    [-1, 1].forEach(s => { const k = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 240), kerbMat); k.rotation.x = -Math.PI / 2; k.position.set(s * 4.9, 0.01, -90); k.receiveShadow = true; scene.add(k); });

    const grid = stripeTexture((c, w, h) => { c.fillStyle = "#0d0d0e"; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(220,0,0,.18)"; c.lineWidth = 2; c.strokeRect(0, 0, w, h); }, 64, 64);
    grid.repeat.set(30, 60);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 240), new THREE.MeshStandardMaterial({ map: grid, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.01, -90); scene.add(ground);

    // Light posts that stream past for a sense of speed
    const postGeo = new THREE.BoxGeometry(0.12, 1.6, 0.12);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x222224, emissive: 0xDC0000, emissiveIntensity: 0.0 });
    const capMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.3) });
    const N = 28, SP = 6, posts = new THREE.InstancedMesh(postGeo, postMat, N * 2), caps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.08, 0.5), capMat, N * 2);
    scene.add(posts, caps);
    const dummy = new THREE.Object3D();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x220000, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 9, 5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -6, near: 1, far: 30 });
    scene.add(key);
    const rim = new THREE.PointLight(0xDC0000, 30, 14); rim.position.set(0, 2, 4.5); scene.add(rim);

    const car = VR3D.createCar();
    scene.add(car.group);

    const st = { prog: 0, lastProg: 0, speed: 0, offset: 0, yaw: 0, pitch: 0, steer: 0, x: 0, pitting: false };
    const entry = register({
      canvas, renderer, scene, camera,
      update(dt, t) {
        const m = VR3D.mouse;
        const scrollV = (st.prog - st.lastProg) / Math.max(dt, 1e-3); st.lastProg = st.prog;
        const want = (st.pitting ? 6 : 22) + Math.min(80, Math.abs(scrollV) * 900);
        st.speed = lerp(st.speed, want, 0.05);
        const d = st.speed * dt; st.offset += d;
        asphalt.offset.y = -st.offset / 8; kerbTex.offset.y = -st.offset / 2; grid.offset.y = -st.offset / 4;
        for (let i = 0; i < N; i++) {
          const z = 6 - ((i * SP + st.offset) % (N * SP));
          [-1, 1].forEach((s, j) => {
            dummy.position.set(s * 6.2, 0.8, z); dummy.updateMatrix(); posts.setMatrixAt(i * 2 + j, dummy.matrix);
            dummy.position.set(s * 6.05, 1.62, z); dummy.updateMatrix(); caps.setMatrixAt(i * 2 + j, dummy.matrix);
          });
        }
        posts.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true;
        // Car follows the cursor: lateral weave + steer, slight bob
        st.x = lerp(st.x, m.x * 2.2, 0.06);
        st.steer = lerp(st.steer, -m.x * 0.25 + (st.x - car.group.position.x) * -0.6, 0.12);
        car.group.position.x = st.x;
        car.group.rotation.y = st.steer;
        car.group.position.y = Math.sin(t * 18) * 0.004;
        car.wheels.slice(0, 2).forEach(w => w.rotation.y = st.steer * 1.4);
        car.wheels.forEach((w, i) => { w.rotation.x -= d / (i < 2 ? 0.34 : 0.37); });
        car.tick(dt);
        // Camera orbits with the mouse
        st.yaw = lerp(st.yaw, m.x * 0.55, 0.05); st.pitch = lerp(st.pitch, m.y, 0.05);
        const narrow = camera.aspect < 1;
        const R = (narrow ? 14 : 8.6) - st.prog * 1.5, h = (narrow ? 5.2 : 3.0) + st.pitch * 1.8;
        camera.position.set(Math.sin(st.yaw) * R + st.x * 0.6, h, Math.cos(st.yaw) * R);
        camera.lookAt(st.x * 0.7, 0.5, narrow ? 1.2 : -2.4);
        rim.intensity = 18 + Math.sin(t * 3) * 6;
        key.position.x = 4 + st.x;
      },
    });
    return {
      entry,
      update(o) { st.prog = o.prog; st.pitting = !!o.pitting; if (o.tyre) car.setTyre(o.tyre); },
    };
  };

  /* ---------------- 2. Liveries showroom ---------------- */
  VR3D.mountShowroom = function (canvas, livery) {
    const renderer = makeRenderer(canvas, { alpha: true, exposure: 1.15, shadows: true });
    const scene = new THREE.Scene();
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.6, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.36, 3.44, 96), new THREE.MeshBasicMaterial({ color: 0xDC0000 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; scene.add(ring);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x200000, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 8, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(key);
    const red = new THREE.PointLight(0xDC0000, 40, 12); red.position.set(-4, 1.5, -2); scene.add(red);
    const car = VR3D.createCar(livery); car.setLivery(livery || {}, true); scene.add(car.group);
    let ang = 0.7, local = { x: 0, y: 0 };
    canvas.addEventListener("pointermove", e => { const r = canvas.getBoundingClientRect(); local.x = (e.clientX - r.left) / r.width * 2 - 1; local.y = (e.clientY - r.top) / r.height * 2 - 1; });
    canvas.addEventListener("pointerleave", () => { local.x = 0; local.y = 0; });
    register({
      canvas, renderer, scene, camera,
      update(dt) {
        ang += dt * 0.25 + local.x * dt * 1.6;
        const el = 0.35 + (-local.y + 1) * 0.25;
        const D = 10.5 * Math.max(1, 1.5 / camera.aspect);
        camera.position.set(Math.sin(ang) * D, 1.0 + el * 3.2, Math.cos(ang) * D);
        camera.lookAt(0, 0.45, 0);
        car.tick(dt, 0.05);
      },
    });
    return { setLivery: v => car.setLivery(v) };
  };

  /* ---------------- 3. Footer orbit ---------------- */
  VR3D.mountOrbit = function (canvas) {
    const renderer = makeRenderer(canvas, { alpha: true, exposure: 1.1 });
    const scene = new THREE.Scene();
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x330000, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(2, 6, 4); scene.add(key);
    const disc = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.26, 96), new THREE.MeshBasicMaterial({ color: 0xDC0000, transparent: true, opacity: 0.8 }));
    disc.rotation.x = -Math.PI / 2; scene.add(disc);
    const car = VR3D.createCar(); scene.add(car.group);
    let spin = 0, vel = 0.35, drag = null, tilt = 0;
    canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, s: spin }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => { if (drag) { const nv = drag.s + (e.clientX - drag.x) * 0.01; vel = (nv - spin) * 60; spin = nv; } });
    canvas.addEventListener("pointerup", () => { drag = null; });
    register({
      canvas, renderer, scene, camera,
      update(dt) {
        if (!drag) { spin += vel * dt; vel = lerp(vel, 0.35, 0.02); }
        car.group.rotation.y = spin;
        tilt = lerp(tilt, VR3D.mouse.y, 0.05);
        camera.position.set(0, 2.6 + tilt * 1.6, 9 * Math.max(1, 1.4 / camera.aspect));
        camera.lookAt(0, 0.4, 0);
      },
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
