/* constellation-model.js: the star map's layout and motion.

   Keys everything by id (stars by session id, planets by
   "<session id>/<follower id>", nebulae by place id) and eases between feed
   snapshots, never rebuilding the map. Places sit on a golden-angle spiral
   (slot = order first seen, kept for the page's life); each session is a star
   on a small spiral inside its place; each subagent is a planet on its own
   orbit ring, in a plane tilted by the star's seed.

     const map = new Constellation();
     map.update(doc);          // after every feed snapshot
     map.step(t, motion);      // every frame: t in seconds, motion 1 (or less for reduced motion)

   Classic script: window.Constellation. Needs AgentvizFeed. MIT. */
(function () {
  "use strict";
  const {ease, seedOf, followerKey} = window.AgentvizFeed;

  const STAR_RADIUS = {offline: 0.45, dim: 0.5, idle: 0.65, busy: 0.9, waiting: 1.0};
  const GOLDEN_ANGLE = 2.39996;
  const MOVE_RATE = 2.5, FADE_RATE = 1.5;
  const GONE = 0.02;  // a fading thing below this appearance is dropped
  const ORBIT_SPEED = {active: 0.9, resting: 0.07};

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // A slightly tilted orbit plane per star, from its seed: u and v span it.
  function orbitBasis(seed) {
    const tiltX = (seed - 0.5) * 0.7, tiltZ = (((seed * 7.3) % 1) - 0.5) * 0.7;
    const normal = norm([Math.sin(tiltZ), 1, Math.sin(tiltX)]);
    const v = norm(cross(normal, norm(cross(normal, [0, 0, 1]))));
    return {u: norm(cross(v, normal)), v};
  }

  const orbitRadius = (slot, starRadius) => starRadius + 1.6 + slot * 1.15;
  const planetSize = (toolCount) => Math.min(0.75, 0.2 + 0.06 * Math.sqrt(Math.max(0, toolCount || 0)));
  const systemRadius = (planetSlots) => orbitRadius(Math.max(planetSlots, 1) - 1, 1.0) + 1.2;
  // 0..1 from a place's tool calls: how thick its nebula is.
  const nebulaDensity = (toolCount) => Math.min(1, Math.log10(1 + Math.max(0, toolCount || 0)) / 2.6);

  class Constellation {
    constructor() {
      this.places = new Map();      // place id -> nebula
      this.stars = new Map();       // session id -> star
      this.planets = new Map();     // "<session>/<follower>" -> planet
      this.placeSlots = new Map();  // place id -> spiral slot, first seen
      this.doc = null;
      this.lastT = null;
    }

    /* ------------------------------------------------------------ snapshots */

    update(doc) {
      this.doc = doc;
      const seen = new Set();
      for (const session of doc.sessions || []) {
        seen.add(session.id);
        this._ingestFollowers(this._ingestSession(session), session);
      }
      for (const star of this.stars.values()) if (!seen.has(star.id)) this._retire(star);
      this._layout();
    }

    _ingestSession(session) {
      let star = this.stars.get(session.id);
      if (!star) {
        const seed = session.seed != null ? session.seed : seedOf(session.id);
        star = Object.assign({id: session.id, seed, x: 0, y: 0, z: 0, placed: false, appear: 0,
          r: STAR_RADIUS[session.state] || 0.6, planets: new Map(), slots: []}, orbitBasis(seed));
        this.stars.set(session.id, star);
      }
      star.session = session;
      star.live = true;
      return star;
    }

    _ingestFollowers(star, session) {
      const seen = new Set();
      for (const follower of session.followers || []) {
        seen.add(follower.id);
        let planet = star.planets.get(follower.id);
        if (!planet) planet = this._newPlanet(star, follower);
        planet.follower = follower;
        planet.live = true;
      }
      for (const planet of star.planets.values()) if (!seen.has(planet.followerId)) planet.live = false;
    }

    _newPlanet(star, follower) {
      let slot = star.slots.indexOf(null);
      if (slot < 0) slot = star.slots.length;
      star.slots[slot] = follower.id;
      const seed = follower.seed != null ? follower.seed : seedOf(follower.id);
      const planet = {id: followerKey(star.session, follower), followerId: follower.id, star, slot, seed,
        angle: seed * Math.PI * 2, speed: 0, active: 0, appear: 0, size: planetSize(follower.toolCount),
        x: star.x, y: star.y, z: star.z, orbitR: orbitRadius(slot, star.r)};
      star.planets.set(follower.id, planet);
      this.planets.set(planet.id, planet);
      return planet;
    }

    _retire(star) {
      star.live = false;
      for (const planet of star.planets.values()) planet.live = false;
    }

    /* ------------------------------------------------------------ layout */

    _layout() {
      const groups = this._starsByPlace();
      const sizes = new Map();
      let widest = 6;
      for (const [placeId, list] of groups) {
        const size = this._placeSize(list);
        sizes.set(placeId, size);
        widest = Math.max(widest, size.R);
      }
      const info = new Map(((this.doc && this.doc.places) || []).map((p) => [p.id, p]));
      for (const [placeId, list] of groups) {
        const place = this._placePlace(placeId, info.get(placeId), sizes.get(placeId), widest * 1.9);
        this._placeStars(place, list, sizes.get(placeId).system);
      }
      for (const [placeId, place] of this.places) if (!groups.has(placeId)) place.live = false;
    }

    _starsByPlace() {
      const groups = new Map();
      for (const star of this.stars.values()) {
        if (!star.live) continue;
        const placeId = star.session.place || "~";
        if (!groups.has(placeId)) groups.set(placeId, []);
        groups.get(placeId).push(star);
      }
      for (const placeId of groups.keys()) if (!this.placeSlots.has(placeId)) this.placeSlots.set(placeId, this.placeSlots.size);
      return groups;
    }

    _placeSize(list) {
      const system = Math.max(...list.map((star) => systemRadius(star.slots.length)));
      const spread = list.length === 1 ? 0 : system * 1.25 * Math.sqrt(list.length);
      return {R: spread + system + 1.5, system};
    }

    _placePlace(placeId, info, size, spacing) {
      const slot = this.placeSlots.get(placeId);
      const angle = slot * GOLDEN_ANGLE, distance = slot === 0 ? 0 : spacing * Math.sqrt(slot + 0.3);
      const seed = info ? info.seed : seedOf(placeId);
      const tx = Math.cos(angle) * distance, tz = Math.sin(angle) * distance, ty = (seed - 0.5) * 4;
      let place = this.places.get(placeId);
      if (!place) {
        place = {id: placeId, x: tx, y: ty, z: tz, R: size.R, appear: 0};
        this.places.set(placeId, place);
      }
      return Object.assign(place, {tx, ty, tz, targetR: size.R, seed, live: true,
        label: info ? info.label : placeId, density: nebulaDensity(info && info.toolCount)});
    }

    _placeStars(place, list, system) {
      list.sort((a, b) => (a.session.startedAt || 0) - (b.session.startedAt || 0) || (a.id < b.id ? -1 : 1));
      list.forEach((star, j) => {
        const alone = list.length === 1;
        const angle = j * GOLDEN_ANGLE + place.seed * 6.28;
        const distance = j === 0 && !alone ? system * 0.6 : system * 1.25 * Math.sqrt(j + 0.4);
        star.tx = place.tx + (alone ? 0 : Math.cos(angle) * distance);
        star.tz = place.tz + (alone ? 0 : Math.sin(angle) * distance);
        star.ty = place.ty + (star.seed - 0.5) * 2.5;
        if (!star.placed) Object.assign(star, {x: star.tx, y: star.ty, z: star.tz, placed: true});
      });
    }

    /* ------------------------------------------------------------ motion */

    step(t, motion = 1) {
      const dt = this.lastT == null ? 0.016 : Math.min(Math.max(t - this.lastT, 0), 0.25);
      this.lastT = t;
      this._stepPlaces(dt);
      for (const [id, star] of this.stars) {
        this._stepStar(star, dt);
        if (!star.live && star.appear < GONE) { this._dropStar(star); continue; }
        for (const planet of star.planets.values()) this._stepPlanet(planet, dt, motion);
      }
    }

    _stepPlaces(dt) {
      for (const [id, place] of this.places) {
        place.x = ease(place.x, place.tx, dt, MOVE_RATE);
        place.y = ease(place.y, place.ty, dt, MOVE_RATE);
        place.z = ease(place.z, place.tz, dt, MOVE_RATE);
        place.R = ease(place.R, place.targetR, dt, MOVE_RATE);
        place.appear = ease(place.appear, place.live ? 1 : 0, dt, FADE_RATE);
        if (!place.live && place.appear < GONE) this.places.delete(id);
      }
    }

    _stepStar(star, dt) {
      star.x = ease(star.x, star.tx, dt, MOVE_RATE);
      star.y = ease(star.y, star.ty, dt, MOVE_RATE);
      star.z = ease(star.z, star.tz, dt, MOVE_RATE);
      star.r = ease(star.r, STAR_RADIUS[star.session.state] || 0.6, dt, MOVE_RATE);
      star.appear = ease(star.appear, star.live ? 1 : 0, dt, FADE_RATE);
      star.systemR = systemRadius(star.slots.length);
    }

    // Fast while active, slow while resting; outer orbits a little slower.
    _stepPlanet(planet, dt, motion) {
      const star = planet.star, follower = planet.follower, on = follower.state === "active" ? 1 : 0;
      planet.active = ease(planet.active, on, dt, FADE_RATE);
      planet.appear = ease(planet.appear, planet.live ? 1 : 0, dt, FADE_RATE);
      planet.size = ease(planet.size, planetSize(follower.toolCount), dt, MOVE_RATE);
      if (!planet.live && planet.appear < GONE) { this._dropPlanet(planet); return; }
      const target = (on ? ORBIT_SPEED.active : ORBIT_SPEED.resting) / Math.sqrt(1 + planet.slot * 0.35);
      planet.speed = ease(planet.speed, target, dt, MOVE_RATE);
      planet.angle += planet.speed * dt * motion;
      planet.orbitR = orbitRadius(planet.slot, star.r);
      const cos = Math.cos(planet.angle) * planet.orbitR, sin = Math.sin(planet.angle) * planet.orbitR;
      planet.x = star.x + star.u[0] * cos + star.v[0] * sin;
      planet.y = star.y + star.u[1] * cos + star.v[1] * sin;
      planet.z = star.z + star.u[2] * cos + star.v[2] * sin;
    }

    _dropStar(star) {
      for (const planet of star.planets.values()) this.planets.delete(planet.id);
      this.stars.delete(star.id);
    }

    _dropPlanet(planet) {
      planet.star.planets.delete(planet.followerId);
      planet.star.slots[planet.slot] = null;
      this.planets.delete(planet.id);
    }

    /* ------------------------------------------------------------ queries */

    // A star (by session id) or a planet (by "<session>/<follower>").
    find(id) { return this.stars.get(id) || this.planets.get(id) || null; }

    visibleStars() { return [...this.stars.values()].filter((star) => star.appear > 0.3); }
    visiblePlanets() { return [...this.planets.values()].filter((p) => p.appear * p.star.appear > 0.3); }

    // The centre and radius (on the ground plane) that hold every place.
    extent() {
      const list = [...this.places.values()].filter((place) => place.live);
      if (!list.length) return {c: [0, 0, 0], r: 20};
      const cx = list.reduce((n, p) => n + p.tx, 0) / list.length, cz = list.reduce((n, p) => n + p.tz, 0) / list.length;
      const r = list.reduce((m, p) => Math.max(m, Math.hypot(p.tx - cx, p.tz - cz) + p.targetR), 10);
      return {c: [cx, 0, cz], r};
    }
  }

  window.Constellation = Constellation;
})();
