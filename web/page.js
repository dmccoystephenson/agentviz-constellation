/* page.js: boots the star map. The feed client, HUD, labels and wire come
   from the agentviz kit (agentviz-*.js); this file wires them to the
   Constellation model and the Strata kit, and owns the camera. */
(function () {
  "use strict";
  const DEFAULT_YAW = 0.6, DEFAULT_PITCH = 0.62;
  // On a portrait screen the map is framed from higher up, so its depth
  // spreads over the tall screen instead of a thin band across the middle.
  const PORTRAIT_PITCH = 1.05;
  const PHONE = window.matchMedia("(max-width: 640px)");
  const REASON = {question: "has a question", permission: "needs permission"};
  const canvas = document.getElementById("view");
  const map = new window.Constellation();
  const wire = AgentvizWire.create();
  const labels = AgentvizScreen.labels(document.getElementById("labels"));
  let kit = null, mod = null, feed = null, selectedId = null, hoveredId = null, flight = null, fitted = false;
  let sceneTime = 0;

  /* ------------------------------------------------------------ camera */
  // The whole map: its width decides on any screen narrower than 16:9.
  function fitView() {
    const e = map.extent();
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const pitch = aspect < 1 ? PORTRAIT_PITCH : DEFAULT_PITCH;
    return {yaw: DEFAULT_YAW, pitch, dist: e.r * 2.5 / Math.min(aspect, 1.78),
      tx: e.c[0], ty: 0, tz: e.c[2]};
  }
  function fit(instant) {
    if (!map.places.size) return;
    const view = fitView();
    if (instant || kit.driven) { flight = null; Object.assign(kit.cam, view); return; }
    flight = {target: () => [view.tx, view.ty, view.tz], dist: view.dist, pitch: view.pitch};
  }
  // Fly to a star or planet and keep easing after it until it is reached. A
  // waiting star is framed a little above its centre and from further out, so
  // its beacon rings and the "?" or padlock over it stay in view.
  function focusOn(thing) {
    const isStar = !thing.star, waiting = isStar && thing.session.state === "waiting";
    const lift = waiting ? thing.r * 1.3 + 1.2 : 0;
    flight = {target: () => [thing.x, thing.y + lift, thing.z],
      dist: isStar ? Math.max(waiting ? 20 : 14, thing.systemR * 3.2) : 9};
  }
  function stepCamera(dt) {
    if (!flight) return;
    const cam = kit.cam, to = flight.target(), rate = 3;
    cam.tx = AgentvizFeed.ease(cam.tx, to[0], dt, rate);
    cam.ty = AgentvizFeed.ease(cam.ty, to[1], dt, rate);
    cam.tz = AgentvizFeed.ease(cam.tz, to[2], dt, rate);
    cam.dist = AgentvizFeed.ease(cam.dist, flight.dist, dt, rate);
    if (flight.pitch != null) cam.pitch = AgentvizFeed.ease(cam.pitch, flight.pitch, dt, rate);
    const near = Math.hypot(cam.tx - to[0], cam.ty - to[1], cam.tz - to[2]) < 0.05 && Math.abs(cam.dist - flight.dist) < 0.1 &&
      (flight.pitch == null || Math.abs(cam.pitch - flight.pitch) < 0.01);
    if (near) flight = null;
  }

  /* ------------------------------------------------------------ labels */
  function starLabel(star) {
    const s = star.session, waiting = s.state === "waiting";
    const name = s.name || s.id.slice(0, 8);
    const cls = "star " + s.state + (s.stalled ? " stalled" : "");
    const el = labels.set("s:" + star.id, {cls, action: s.state === "busy" ? s.action : null,
      text: waiting ? name + " " + (REASON[s.waitingReason] || "needs you") : name});
    el.style.opacity = String(star.appear);
    // Who needs you, then who is stuck, then everyone else: a stalled star's
    // warning sign wins over a busy neighbour's name.
    const rank = star.id === selectedId ? 0 : waiting || s.stalled ? 1 : s.state === "offline" ? 4 : 2;
    // A waiting star's label sits over its "?" or padlock (scene/star.h draws
    // it at r * 2.6 + 2.4 above the centre, 2.2 tall), not across it.
    const lift = waiting ? star.r * 2.6 + 4.8 : star.r * 2.2 + 0.4;
    // A stalled star may stack its label over a waiting neighbour's instead of hiding.
    return {el, q: kit.project(star.x, star.y + lift, star.z), rank, tries: s.stalled && rank > 0 ? 4 : undefined};
  }
  // Planet labels show round the selected system, and always for a stalled
  // subagent. They sit over the selection ring (planet.h: size * 2.2 + 0.2).
  function planetLabel(planet) {
    const f = planet.follower, selected = map.find(selectedId);
    const near = selected && (selected === planet || selected === planet.star || selected.star === planet.star);
    if (!near && !f.stalled) return null;
    const el = labels.set("f:" + planet.id, {cls: "planet" + (f.stalled ? " stalled" : ""),
      action: f.state === "active" ? f.action : "none", text: f.label || f.id});
    return {el, q: kit.project(planet.x, planet.y + planet.size * 2.2 + 0.4, planet.z), rank: planet.id === selectedId ? 0 : 3};
  }
  function placeLabels() {
    const items = [];
    labels.begin();
    for (const place of map.places.values()) {
      if (place.appear < 0.5) continue;
      const el = labels.set("p:" + place.id, {cls: "place", text: place.label});
      items.push({el, q: kit.project(place.x, place.y + place.R * 0.5, place.z), rank: 5});
    }
    for (const star of map.visibleStars()) items.push(starLabel(star));
    for (const planet of map.visiblePlanets()) {
      const item = planetLabel(planet);
      if (item) items.push(item);
    }
    labels.end();
    StrataKit.placeLabels(keepClearOfBar(items));
  }
  // A world label that would slide under the kit's top bar is hidden instead.
  const LABEL_HEIGHT = 22;
  function keepClearOfBar(items) {
    const bar = document.querySelector(".av-bar");
    const limit = bar ? bar.getBoundingClientRect().bottom + LABEL_HEIGHT : 0;
    for (const item of items) if (item.q && item.q.y < limit) item.q = null;
    return items;
  }

  /* ------------------------------------------------------------ picking + selection */
  function pick(x, y, radius) {
    const candidates = map.visibleStars().map((s) => ({item: s, points: [[s.x, s.y, s.z], [s.x, s.y + s.r, s.z]]}))
      .concat(map.visiblePlanets().map((p) => ({item: p, points: [[p.x, p.y, p.z]]})));
    return AgentvizScreen.pick(kit.project, candidates, x, y, radius);
  }
  const targetOf = (thing) => (!thing ? null : thing.star ? {session: thing.star.session, follower: thing.follower}
    : {session: thing.session, follower: null});
  const idOf = (target) => (target ? (target.follower ? AgentvizFeed.followerKey(target.session, target.follower) : target.session.id) : null);

  function onSelect(target, how) {
    selectedId = idOf(target);
    const thing = selectedId && map.find(selectedId);
    if (kit) kit.selected = thing || null;
    // On a phone the map shrinks to the space above the bottom sheet.
    document.body.classList.toggle("sheet", !!thing);
    fitClearBand();
    if (thing && how !== "api") focusOn(thing);
  }

  const hud = AgentvizHud.create({
    title: "Agent Constellation",
    legend: document.getElementById("legend"),
    buttons: [{icon: "home", label: "Show the whole map", onClick: () => { hud.select(null); fit(false); }}],
    onSelect,
    oneRow: true,
    rows: ({session, follower}) => (follower ? [] : [["tool calls", session.toolCount != null ? session.toolCount : "—"]]),
  });

  // The bottom sheet's height follows its content, so the map's clear band
  // (CSS --cv-clear, the canvas height while the sheet is up) follows the
  // sheet's top where it will rest (hud.panelRect ignores the slide-in).
  let clearBand = null;
  function fitClearBand() {
    const sheet = PHONE.matches && hud.selected ? hud.panelRect() : null;
    const band = sheet ? Math.max(120, sheet.y0) + "px" : null;
    if (band === clearBand) return;
    clearBand = band;
    if (band) document.body.style.setProperty("--cv-clear", band);
    else document.body.style.removeProperty("--cv-clear");
  }

  function accept(doc) {
    map.update(doc);
    hud.update(doc);
    if (!fitted && map.places.size && kit) {
      fitted = true;
      map.step(sceneTime);
      fit(true);
    }
  }

  /* ------------------------------------------------------------ boot */
  function frame(t) {
    const dt = Math.min(Math.max(t - sceneTime, 0), 0.25);
    sceneTime = t;
    stepCamera(dt);
    map.step(t, kit.reducedMotion ? 0.2 : 1);
    if (!feed.doc) return;
    const highlight = (id) => (id === selectedId ? 1 : id === hoveredId ? 2 : 0);
    window.ConstellationFrame.write(wire, map, feed.doc, highlight, feed.pulse).send(mod);
  }

  function screenTargets() {
    const r = canvas.getBoundingClientRect();
    return map.visibleStars().concat(map.visiblePlanets()).map((thing) => {
      const s = kit.project(thing.x, thing.y, thing.z);
      return s && {id: thing.id, x: s.x + r.left, y: s.y + r.top};
    }).filter(Boolean);
  }

  function createKit() {
    return StrataKit.create({
      module: mod, canvas,
      camera: {yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, dist: 80, tx: 0, ty: 0, tz: 0},
      limits: {minDist: 3, maxDist: 400, minPitch: -1.3, maxPitch: 1.5},
      frame,
      after: () => { fitClearBand(); if (feed && feed.doc) placeLabels(); },
      pick,
      idOf: (thing) => thing.id,
      onTap: (thing) => hud.select(targetOf(thing), "tap"),
      onHover(thing) { hoveredId = thing ? thing.id : null; canvas.style.cursor = thing ? "pointer" : ""; },
      onSlow: () => StrataLoader.slow(),
      onFatal: (code, msg) => StrataLoader.fallback(code, msg),
      targets: screenTargets,
    });
  }

  function expose() {
    window.__constellation = map;
    window.__page = {kit, map, hud, fit, fitView,
      select: (id, focus) => hud.select(targetOf(map.find(id)), focus ? "list" : "api"),
      look: (cam) => { flight = null; Object.assign(kit.cam, cam); },
      get doc() { return feed.doc; }, get polls() { return feed.polls; }, get sceneTime() { return sceneTime; },
      feedClient: feed, stopPolling: () => feed.stop(), pollOnce: () => feed.pollOnce(), feed: (d) => feed.push(d)};
  }

  async function boot() {
    try {
      mod = await StrataLoader.load({script: "constellation-engine.js", factory: "createConstellation",
        wasm: "constellation-engine.wasm", title: "the constellation"});
    } catch (error) {
      console.error("constellation: the engine did not load", error);
      return;  // StrataLoader has already shown its fallback
    }
    try {
      kit = createKit();
    } catch (error) {
      StrataLoader.fallback(error.code === "no-webgl2" ? "no-webgl2" : "engine");
      return;
    }
    // Under ?drive=1 tool-call pulses follow scene time, so captures repeat.
    const now = () => (kit.driven ? sceneTime : Date.now() / 1000);
    feed = AgentvizFeed.create({onUpdate: accept, onStatus: hud.setStatus, now});
    expose();
    feed.start();
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
  }

  boot();
})();
