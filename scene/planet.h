// planet.h: a subagent as a planet on its orbit ring round its session's
// star. The ring is faint when resting, brighter when working and gold when
// the star delegates; an atmosphere in its action's colour when working; a
// flicker and a red haze when stalled; a thin ring round it once finished; a
// flash at each new tool call.
#pragma once

#include "star.h"

namespace cv {

// A planet, from its agent record (constellation-frame.js).
struct Planet {
    const agentviz::Agent* a;
    V3 c, star, u, v;
    float orbitR, size, active, delegating, alpha;
};

inline Planet planetOf(const agentviz::Agent& a) {
    const float* e = a.extra;
    return {&a, {a.x, a.y, a.z}, {e[3], e[4], e[5]}, {e[6], e[7], e[8]}, {e[9], e[10], e[11]},
            e[0], e[1], e[2], e[12], a.appear * e[13]};
}

inline void drawOrbit(Host& h, const Planet& p, float t) {
    Rgb col = mix({0.45f, 0.5f, 0.65f}, {0.75f, 0.8f, 0.95f}, p.active);
    float alpha = (0.16f + 0.22f * p.active) * p.alpha;
    if (p.delegating > 0.5f) {
        col = actionColour(Action::Delegate);
        alpha = (0.55f + 0.25f * std::sin(t * 3.0f + p.orbitR)) * p.alpha;
    }
    circle(h, p.star, p.u, p.v, p.orbitR, col, alpha, 72);
}

inline void drawGlobe(Host& h, const Planet& p, float bright) {
    const agentviz::Agent& a = *p.a;
    Rgb body = mix(scale(planetColour(a.seed), 0.55f), planetColour(a.seed), p.active);
    if (a.stalled) body = mix(body, kStallColour, 0.45f);
    body = scale(body, bright);
    const float d = p.size * 2.0f * (1.0f + 0.25f * a.pulse);
    h.add(STRATA_PRIMITIVE_SPHERE, p.c.x, p.c.y, p.c.z, d, d, d, body, 1.0f);
    if (p.active > 0.05f && a.action != Action::None)
        glow(h, p.c, p.size * 3.2f, actionColour(a.action), 0.4f * p.active * p.alpha, 3.0f);
    if (a.stalled) glow(h, p.c, p.size * 4.0f, kStallColour, 0.45f * bright * p.alpha, 3.0f);
    if (a.pulse > 0.01f) glow(h, p.c, p.size * 5.0f, mix(actionColour(a.action), kWhite, 0.6f), 0.5f * a.pulse * p.alpha, 3.0f);
}

// Finished: a thin ring round the planet, tipped a little out of its orbit plane.
inline void drawFinishedRing(Host& h, const Planet& p) {
    const V3 tipped = norm(p.v + norm(cross(p.u, p.v)) * 0.35f);
    circle(h, p.c, p.u, tipped, p.size * 1.8f, {0.9f, 0.88f, 0.75f}, 0.7f * p.alpha, 32);
}

inline void drawPlanet(Host& h, const Planet& p, float t, float motion) {
    const agentviz::Agent& a = *p.a;
    const float bright = a.stalled ? flicker(t, a.seed) : 1.0f;
    drawOrbit(h, p, t);
    drawGlobe(h, p, bright);
    if (a.finished) drawFinishedRing(h, p);
    const V3 n = norm(cross(p.u, p.v));
    drawAction(h, a.action, Body{p.c, p.size, p.u, p.v, n, p.size * 4.0f, a.seed, p.active * p.alpha * 0.8f}, t * motion);
    drawHighlight(h, p.c, p.size * 2.2f + 0.2f, a.highlight);
}

}  // namespace cv
