/* constellation-frame.js: packs the star map for the scene, once a frame, in
   the agentviz wire format (vendor/agentviz-kit, docs/KIT.md in agentviz).
   scene/sky.h, star.h and planet.h read what is written here.

     zones   one nebula per place (kind 0); x0..z1 = centre -/+ radius
             extras: centre y, radius, density (0..1, from the place's toolCount)
     agents  a star per session; extras: radius, orbit plane u (3), v (3), system radius
             a planet per subagent; extras: orbit radius, size, active (eased), star centre (3),
             orbit plane u (3), v (3), star delegating, star appear
     links   none

   Classic script: window.ConstellationFrame. */
(function () {
  "use strict";
  const ZONE = {nebula: 0};

  function nebula(wire, place) {
    const r = place.R * place.appear;
    wire.zone({id: "place:" + place.id, kind: ZONE.nebula, seed: place.seed, appear: place.appear,
      x0: place.x - r, z0: place.z - r, x1: place.x + r, z1: place.z + r,
      extra: [place.y, place.R, place.density]});
  }

  function star(wire, s, highlight, pulse) {
    wire.agent({session: s.session, x: s.x, y: s.y, z: s.z, appear: s.appear, highlight, pulse,
      extra: [s.r, ...s.u, ...s.v, s.systemR]});
  }

  function planet(wire, p, highlight, pulse) {
    const s = p.star;
    wire.agent({session: s.session, follower: p.follower, x: p.x, y: p.y, z: p.z, appear: p.appear, highlight, pulse,
      extra: [p.orbitR, p.size, p.active, s.x, s.y, s.z, ...s.u, ...s.v,
        s.session.action === "delegate" ? 1 : 0, s.appear]});
  }

  // highlightOf(id) -> 0 none, 1 selected, 2 hovered; pulseOf(id) -> 0..1.
  function write(wire, map, doc, highlightOf, pulseOf) {
    wire.begin({doc});
    for (const place of map.places.values()) nebula(wire, place);
    for (const s of map.stars.values()) star(wire, s, highlightOf(s.id), pulseOf(s.id));
    for (const p of map.planets.values()) planet(wire, p, highlightOf(p.id), pulseOf(p.id));
    return wire;
  }

  window.ConstellationFrame = {write, ZONE};
})();
