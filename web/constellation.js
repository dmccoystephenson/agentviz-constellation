/* agentviz-constellation page: polls /api/agents, lays the sessions out as a
   star map (places = nebulae, sessions = stars, subagents = planets), eases
   between snapshots and hands the scene rows of floats every frame. */
"use strict";
(function () {
  const PLACE_STRIDE = 8, STAR_STRIDE = 20, PLANET_STRIDE = 12;
  const STATE_CODE = {offline: 0, dim: 1, idle: 2, busy: 3, waiting: 4};
  const ACTION_CODE = {none: 0, edit: 1, run: 2, read: 3, web: 4, delegate: 5, think: 6, other: 7};
  const STAR_R = {offline: 0.45, dim: 0.5, idle: 0.65, busy: 0.9, waiting: 1.0};
  const ACTION_INFO = {
    edit: ["Editing", "#ff7326"], run: ["Running", "#73ff80"], read: ["Reading", "#80b8ff"],
    web: ["On the web", "#c780ff"], delegate: ["Delegating", "#ffd966"], think: ["Thinking", "#dbd1ff"],
    other: ["Busy (other)", "#ff99d1"], none: ["Resting", "#8a8f99"],
  };
  const STATE_INFO = {
    busy: ["Busy", "#fff3c4"], waiting: ["Needs you", "#59f2ff"], idle: ["Idle", "#ff9e47"],
    dim: ["Dim", "#99a3b8"], offline: ["Offline", "#8a3a2c"],
  };
  const q = new URLSearchParams(location.search);
  const FIXTURE = q.get("fixture") === "1";
  const FEED_URL = "/api/agents" + (FIXTURE ? "?fixture=1" : "");

  function seedOf(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  const ease = (cur, target, k) => cur + (target - cur) * k;

  /* ---------------------------------------------------------------- model */
  const placeSlots = new Map();  // place id -> slot index (first seen, stable)
  const places = new Map();      // id -> {id, label, seed, x,y,z, tx,ty,tz, R, tR, alpha, live}
  const stars = new Map();       // id -> star
  let feed = null, lastT = null;

  function orbitBasis(seed) {
    // A slightly tilted orbit plane per star, from its seed.
    const ax = (seed - 0.5) * 0.7, az = (((seed * 7.3) % 1) - 0.5) * 0.7;
    const n = norm([Math.sin(az), 1, Math.sin(ax)]);
    let u = norm(cross(n, [0, 0, 1]));
    const v = norm(cross(n, u));
    u = norm(cross(v, n));
    return {u, v};
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  function orbitRadius(slot, r) { return r + 1.6 + slot * 1.15; }
  function planetSize(toolCount) { return Math.min(0.75, 0.2 + 0.06 * Math.sqrt(Math.max(0, toolCount || 0))); }
  function systemRadius(n) { return orbitRadius(Math.max(n, 1) - 1, 1.0) + 1.2; }

  function ingest(doc) {
    feed = doc;
    const seen = new Set();
    for (const s of doc.sessions) {
      seen.add(s.id);
      let st = stars.get(s.id);
      if (!st) {
        st = {id: s.id, x: 0, y: 0, z: 0, placed: false, alpha: 0, r: STAR_R[s.state] || 0.6,
              seed: s.seed != null ? s.seed : seedOf(s.id), planets: new Map(), slots: []};
        Object.assign(st, orbitBasis(st.seed));
        stars.set(s.id, st);
      }
      st.data = s;
      st.live = true;
      const fseen = new Set();
      (s.followers || []).forEach((f) => {
        fseen.add(f.id);
        let p = st.planets.get(f.id);
        if (!p) {
          let slot = st.slots.indexOf(null);
          if (slot < 0) slot = st.slots.length;
          st.slots[slot] = f.id;
          const fs = f.seed != null ? f.seed : seedOf(f.id);
          p = {id: f.id, slot, seed: fs, angle: fs * Math.PI * 2, speed: 0, active: 0, alpha: 0, size: planetSize(f.toolCount)};
          st.planets.set(f.id, p);
        }
        p.data = f;
        p.live = true;
      });
      for (const p of st.planets.values()) if (!fseen.has(p.id)) p.live = false;
    }
    for (const st of stars.values()) if (!seen.has(st.id)) st.live = false;
    layout();
    renderHud();
    if (selected) renderPanel();
  }

  /* Places on a golden-angle spiral (slot order = first seen); sessions on a
     small spiral inside their place, spaced by their systems' sizes. */
  function layout() {
    const byPlace = new Map();
    for (const st of stars.values()) {
      if (!st.live) continue;
      const pid = st.data.place || "~";
      if (!byPlace.has(pid)) byPlace.set(pid, []);
      byPlace.get(pid).push(st);
    }
    for (const pid of byPlace.keys()) if (!placeSlots.has(pid)) placeSlots.set(pid, placeSlots.size);
    const info = new Map((feed.places || []).map((p) => [p.id, p]));
    let maxR = 6;
    const sizes = new Map();
    for (const [pid, list] of byPlace) {
      const sys = Math.max(...list.map((st) => systemRadius(st.slots.length)));
      const local = list.length === 1 ? 0 : sys * 1.25 * Math.sqrt(list.length);
      const R = local + sys + 1.5;
      sizes.set(pid, {R, sys});
      maxR = Math.max(maxR, R);
    }
    const spacing = maxR * 1.9;
    for (const [pid, list] of byPlace) {
      const slot = placeSlots.get(pid), {R, sys} = sizes.get(pid);
      const a = slot * 2.39996, d = slot === 0 ? 0 : spacing * Math.sqrt(slot + 0.3);
      const pseed = info.get(pid) ? info.get(pid).seed : seedOf(pid);
      let pl = places.get(pid);
      const tx = Math.cos(a) * d, tz = Math.sin(a) * d, ty = (pseed - 0.5) * 4;
      if (!pl) {
        pl = {id: pid, x: tx, y: ty, z: tz, R, alpha: 0};
        places.set(pid, pl);
      }
      Object.assign(pl, {tx, ty, tz, tR: R, seed: pseed, live: true,
        label: info.get(pid) ? info.get(pid).label : pid,
        waiting: list.some((st) => st.data.state === "waiting") ? 1 : 0,
        busyFrac: list.filter((st) => st.data.state === "busy").length / list.length});
      list.sort((x, y) => (x.data.startedAt || 0) - (y.data.startedAt || 0) || (x.id < y.id ? -1 : 1));
      list.forEach((st, j) => {
        const aa = j * 2.39996 + pseed * 6.28, dd = j === 0 && list.length > 1 ? sys * 0.6 : sys * 1.25 * Math.sqrt(j + 0.4);
        st.tx = tx + (list.length === 1 ? 0 : Math.cos(aa) * dd);
        st.tz = tz + (list.length === 1 ? 0 : Math.sin(aa) * dd);
        st.ty = ty + (st.seed - 0.5) * 2.5;
        if (!st.placed) { st.x = st.tx; st.y = st.ty; st.z = st.tz; st.placed = true; }
      });
    }
    for (const [pid, pl] of places) if (!byPlace.has(pid)) pl.live = false;
  }

  /* Per frame: ease toward targets, advance orbits, write rows. */
  let placePtr = 0, placeCap = 0, starPtr = 0, starCap = 0, planetPtr = 0, planetCap = 0;
  let frameStars = [], framePlanets = [], framePlaces = [];

  function alloc(mod, ptr, cap, need) {
    if (need <= cap) return [ptr, cap];
    if (ptr) mod._free(ptr);
    const c = need + 64;
    return [mod._malloc(c * 4), c];
  }

  function step(mod, t) {
    const dt = lastT == null ? 0.016 : Math.min(Math.max(t - lastT, 0), 0.25);
    lastT = t;
    const k = 1 - Math.exp(-dt * 2.5), kf = 1 - Math.exp(-dt * 1.5);
    const motion = kit && kit.reducedMotion ? 0.2 : 1;

    framePlaces = [];
    for (const [id, pl] of places) {
      pl.x = ease(pl.x, pl.tx, k); pl.y = ease(pl.y, pl.ty, k); pl.z = ease(pl.z, pl.tz, k);
      pl.R = ease(pl.R, pl.tR, k);
      pl.alpha = ease(pl.alpha, pl.live ? 1 : 0, kf);
      if (!pl.live && pl.alpha < 0.02) { places.delete(id); continue; }
      framePlaces.push(pl);
    }
    frameStars = [];
    framePlanets = [];
    for (const [id, st] of stars) {
      const s = st.data;
      st.x = ease(st.x, st.tx, k); st.y = ease(st.y, st.ty, k); st.z = ease(st.z, st.tz, k);
      st.r = ease(st.r, STAR_R[s.state] || 0.6, k);
      st.alpha = ease(st.alpha, st.live ? 1 : 0, kf);
      if (!st.live && st.alpha < 0.02) { stars.delete(id); continue; }
      st.index = frameStars.length;
      frameStars.push(st);
      for (const [pid, p] of st.planets) {
        const f = p.data, on = f.state === "active" ? 1 : 0;
        p.active = ease(p.active, on, kf);
        p.alpha = ease(p.alpha, p.live ? 1 : 0, kf);
        p.size = ease(p.size, planetSize(f.toolCount), k);
        if (!p.live && p.alpha < 0.02) { st.planets.delete(pid); st.slots[p.slot] = null; continue; }
        // Faster when active, slow when resting; outer orbits a little slower.
        const target = (on ? 0.9 : 0.07) / Math.sqrt(1 + p.slot * 0.35);
        p.speed = ease(p.speed, target, k);
        p.angle += p.speed * dt * motion;
        p.orbitR = orbitRadius(p.slot, st.r);
        const ca = Math.cos(p.angle) * p.orbitR, sa = Math.sin(p.angle) * p.orbitR;
        p.x = st.x + st.u[0] * ca + st.v[0] * sa;
        p.y = st.y + st.u[1] * ca + st.v[1] * sa;
        p.z = st.z + st.u[2] * ca + st.v[2] * sa;
        p.star = st;
        framePlanets.push(p);
      }
    }

    [placePtr, placeCap] = alloc(mod, placePtr, placeCap, framePlaces.length * PLACE_STRIDE);
    [starPtr, starCap] = alloc(mod, starPtr, starCap, frameStars.length * STAR_STRIDE);
    [planetPtr, planetCap] = alloc(mod, planetPtr, planetCap, framePlanets.length * PLANET_STRIDE);
    let H = mod.HEAPF32, o = placePtr >> 2;
    framePlaces.forEach((pl, i) => H.set([pl.x, pl.y, pl.z, pl.R, pl.seed, pl.alpha, pl.waiting, pl.busyFrac], o + i * PLACE_STRIDE));
    o = starPtr >> 2;
    frameStars.forEach((st, i) => {
      const s = st.data;
      H.set([st.x, st.y, st.z, STATE_CODE[s.state] != null ? STATE_CODE[s.state] : 1, ACTION_CODE[s.action] || 0,
        s.stalled ? 1 : 0, st.seed, selected === st ? 1 : 0, st.r, st.alpha,
        st.u[0], st.u[1], st.u[2], st.v[0], st.v[1], st.v[2], 0, systemRadius(st.slots.length), 0, 0], o + i * STAR_STRIDE);
    });
    o = planetPtr >> 2;
    framePlanets.forEach((p, i) => {
      H.set([p.x, p.y, p.z, p.star.index, p.orbitR, p.size, p.active, ACTION_CODE[p.data.action] || 0, p.seed,
        selected === p ? 1 : 0, p.alpha, p.angle], o + i * PLANET_STRIDE);
    });
    mod._cv_set_places(placePtr, framePlaces.length);
    mod._cv_set_stars(starPtr, frameStars.length);
    mod._cv_set_planets(planetPtr, framePlanets.length);

    // Camera: fly toward the selected thing, or frame the whole map.
    if (flyTo) {
      const c = kit.cam, f = 1 - Math.exp(-dt * 3);
      const tgt = flyTo.target();
      c.tx = ease(c.tx, tgt[0], f); c.ty = ease(c.ty, tgt[1], f); c.tz = ease(c.tz, tgt[2], f);
      if (flyTo.dist) c.dist = ease(c.dist, flyTo.dist, f);
      if (Math.hypot(c.tx - tgt[0], c.ty - tgt[1], c.tz - tgt[2]) < 0.05 && (!flyTo.dist || Math.abs(c.dist - flyTo.dist) < 0.1) && !flyTo.follow) flyTo = null;
    }
  }

  function extent() {
    let cx = 0, cz = 0, n = 0;
    for (const pl of places.values()) { cx += pl.tx; cz += pl.tz; n++; }
    if (!n) return {c: [0, 0, 0], r: 20};
    cx /= n; cz /= n;
    let r = 10;
    for (const pl of places.values()) r = Math.max(r, Math.hypot(pl.tx - cx, pl.tz - cz) + pl.tR);
    return {c: [cx, 0, cz], r};
  }

  /* ----------------------------------------------------------- page bits */
  let kit = null, mod = null, selected = null, flyTo = null, firstFrame = true;
  const labelsEl = document.getElementById("labels");
  const labelEls = new Map();

  function labelFor(key, cls, text) {
    let el = labelEls.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "label " + cls;
      labelsEl.appendChild(el);
      labelEls.set(key, el);
    }
    if (el.textContent !== text) el.textContent = text;
    el.used = true;
    return el;
  }

  function placeLabels() {
    for (const el of labelEls.values()) el.used = false;
    const items = [];
    for (const pl of framePlaces) {
      items.push({el: labelFor("p:" + pl.id, "place", pl.label), q: kit.project(pl.x, pl.y + pl.R * 0.5, pl.z), rank: 5});
    }
    for (const st of frameStars) {
      const s = st.data;
      const el = labelFor("s:" + st.id, "star " + s.state + (s.stalled ? " stalled" : ""), s.name || st.id.slice(0, 8));
      el.style.opacity = st.alpha;
      items.push({el, q: kit.project(st.x, st.y + st.r * 2.2 + 0.4, st.z),
        rank: selected === st ? 0 : s.state === "waiting" ? 1 : s.state === "offline" ? 4 : 2});
    }
    for (const p of framePlanets) {
      const near = selected === p || selected === p.star || (selected && selected.star === p.star);
      if (!near) continue;
      const el = labelFor("f:" + p.star.id + ":" + p.id, "planet", p.data.label || p.id);
      items.push({el, q: kit.project(p.x, p.y + p.size + 0.3, p.z), rank: selected === p ? 0 : 3});
    }
    for (const [key, el] of labelEls) if (!el.used) { el.remove(); labelEls.delete(key); }
    StrataKit.placeLabels(items);
  }

  function pick(x, y, radius) {
    let best = null, bestD = Infinity;
    const consider = (thing, wx, wy, wz, worldR, bias) => {
      const s = kit.project(wx, wy, wz);
      if (!s) return;
      const e = kit.project(wx + worldR, wy, wz);
      const pr = e ? Math.max(Math.hypot(e.x - s.x, e.y - s.y), 0) : 0;
      const d = Math.hypot(s.x - x, s.y - y) - pr * bias;
      if (d < radius && d < bestD) { bestD = d; best = thing; }
    };
    for (const st of frameStars) if (st.alpha > 0.3) consider(st, st.x, st.y, st.z, st.r * 1.6, 1);
    for (const p of framePlanets) if (p.alpha > 0.3) consider(p, p.x, p.y, p.z, p.size * 1.5, 1);
    return best;
  }

  function select(thing, fly) {
    selected = thing;
    if (kit) kit.selected = thing;
    if (thing && fly) {
      const isStar = !thing.star;
      flyTo = {target: () => [thing.x, thing.y, thing.z],
        dist: isStar ? Math.max(14, systemRadius(thing.slots.length) * 3.2) : 9, follow: false};
    }
    renderPanel();
  }

  function chip(info) { return `<span class="chip" style="--c:${info[1]}">${info[0]}</span>`; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c])); }

  function renderPanel() {
    const panel = document.getElementById("panel");
    if (!selected || (!selected.live && selected.alpha < 0.05)) {
      panel.hidden = true;
      document.body.classList.remove("sheet");
      return;
    }
    panel.hidden = false;
    document.body.classList.add("sheet");
    let html;
    if (!selected.star) {
      const s = selected.data;
      const act = ACTION_INFO[s.action] || ACTION_INFO.none;
      const fl = [...selected.planets.values()].sort((a, b) => a.slot - b.slot);
      html = `<div class="head"><span class="dot star-dot" style="--c:${(STATE_INFO[s.state] || STATE_INFO.dim)[1]}"></span>
        <h2>${esc(s.name || s.id.slice(0, 8))}</h2>${chip(STATE_INFO[s.state] || STATE_INFO.dim)}${s.stalled ? chip(["Stalled", "#c9a0a0"]) : ""}</div>
        <div class="row"><span class="act" style="--c:${act[1]}"></span><b>${act[0]}</b>
          ${s.activity && s.activity.label ? `<span class="muted">${esc(s.activity.label)}</span>` : ""}</div>
        <div class="row meta"><span title="Place">&#x2726; ${esc(s.placeLabel || s.place)}</span>
          ${s.branch ? `<span title="Branch">&#x2387; ${esc(s.branch)}</span>` : ""}</div>
        ${fl.length ? `<div class="planets">${fl.map((p) => {
          const f = p.data, a = ACTION_INFO[f.action] || ACTION_INFO.none;
          return `<button class="planet-row" data-id="${esc(p.id)}"><span class="pdot ${f.state}" style="--c:${a[1]}"></span>
            <span class="pl">${esc(f.label || p.id)}</span><span class="muted">${a[0]}</span></button>`;
        }).join("")}</div>` : `<div class="row muted">No subagents in the last 15 min</div>`}`;
    } else {
      const f = selected.data, s = selected.star.data, a = ACTION_INFO[f.action] || ACTION_INFO.none;
      html = `<div class="head"><span class="dot" style="--c:${a[1]}"></span><h2>${esc(f.label || f.id)}</h2>
        ${chip(f.state === "active" ? ["Active", "#9fe0a8"] : ["Resting", "#8a8f99"])}</div>
        <div class="row"><span class="act" style="--c:${a[1]}"></span><b>${a[0]}</b>
          <span class="muted">${esc(f.tool || "")}${f.toolLabel ? " " + esc(f.toolLabel) : ""}</span></div>
        <div class="row meta"><button class="link" data-star="${esc(selected.star.id)}">&#x2600; orbits ${esc(s.name || s.id.slice(0, 8))}</button>
          <span>${f.toolCount || 0} tool calls</span></div>`;
    }
    panel.querySelector(".body").innerHTML = html;
    panel.querySelectorAll(".planet-row").forEach((b) => b.addEventListener("click", () => {
      const p = selected && selected.planets && selected.planets.get(b.dataset.id);
      if (p) select(p, true);
    }));
    panel.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => {
      const st = stars.get(b.dataset.star);
      if (st) select(st, true);
    }));
  }

  function renderHud() {
    const c = feed.counts || {};
    const hud = document.getElementById("hud");
    const cell = (n, info, title) => `<span class="hc" title="${title}"><span class="dot" style="--c:${info[1]}"></span>${n}</span>`;
    hud.innerHTML = cell(c.busy || 0, STATE_INFO.busy, "busy") + cell(c.idle || 0, STATE_INFO.idle, "idle") +
      cell(c.offline || 0, STATE_INFO.offline, "offline") +
      `<span class="hc" title="subagents"><span class="pdot active" style="--c:#b8c4e0"></span>${c.followers || 0}</span>` +
      (FIXTURE || feed.fixture ? `<span class="hc demo">demo</span>` : "");
    const waiting = [...stars.values()].filter((st) => st.live && st.data.state === "waiting");
    const bar = document.getElementById("beacons");
    bar.innerHTML = waiting.map((st) => `<button class="beacon" data-id="${esc(st.id)}"><span class="ping"></span>${esc(st.data.name || st.id.slice(0, 8))} needs you</button>`).join("");
    bar.querySelectorAll(".beacon").forEach((b) => b.addEventListener("click", () => {
      const st = stars.get(b.dataset.id);
      if (st) select(st, true);
    }));
  }

  async function poll() {
    try {
      const r = await fetch(FEED_URL, {cache: "no-store"});
      if (r.ok) ingest(await r.json());
    } catch (e) { /* keep the last snapshot */ }
  }

  document.getElementById("close").addEventListener("click", () => select(null));
  document.getElementById("home").addEventListener("click", () => {
    select(null);
    const e = extent();
    flyTo = {target: () => e.c, dist: e.r * 2.1};
  });

  (async () => {
    try {
      mod = await StrataLoader.load({script: "constellation-engine.js", factory: "createConstellation",
        wasm: "constellation-engine.wasm", title: "the constellation"});
    } catch (e) { return; }
    const canvas = document.getElementById("view");
    await poll();
    const e = extent();
    try {
      kit = StrataKit.create({
        module: mod, canvas,
        camera: {yaw: 0.6, pitch: 0.62, dist: e.r * 2.1, tx: e.c[0], ty: 0, tz: e.c[2]},
        limits: {minDist: 3, maxDist: 400, minPitch: -1.3, maxPitch: 1.5},
        frame(t) { step(mod, t); },
        after() { placeLabels(); },
        pick,
        idOf: (h) => (h ? (h.star ? h.star.id + "/" + h.id : h.id) : null),
        onTap(hit) { select(hit, !!hit); },
        onSlow: () => StrataLoader.slow(),
        onFatal: (code, msg) => StrataLoader.fallback(code, msg),
        targets: () => {
          const r = canvas.getBoundingClientRect();
          return frameStars.map((st) => {
            const s = kit.project(st.x, st.y, st.z);
            return s && {id: st.id, x: s.x + r.left, y: s.y + r.top};
          }).filter(Boolean);
        },
      });
    } catch (err) {
      return StrataLoader.fallback(err.code === "no-webgl2" ? "no-webgl2" : "engine");
    }
    window.__constellation = {kit, select: (id) => { const st = stars.get(id); select(st || null, !!st); },
      selectPlanet: (sid, pid) => { const st = stars.get(sid); const p = st && st.planets.get(pid); select(p || null, !!p); },
      look: (cam) => { flyTo = null; Object.assign(kit.cam, cam); },
      stars: () => frameStars.map((st) => ({id: st.id, name: st.data.name, state: st.data.state, x: st.x, y: st.y, z: st.z})),
      places: () => framePlaces.map((pl) => ({id: pl.id, x: pl.x, y: pl.y, z: pl.z, R: pl.R})),
      extent};
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
    setInterval(poll, 2000);
  })();
})();
