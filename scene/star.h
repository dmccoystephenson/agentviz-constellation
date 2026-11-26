// star.h: a session as a star. Its colour is its state, its action is drawn
// on it (actions.h), a new tool call bursts a ring off its surface, a stalled
// star flickers, and a star waiting on the owner pulses cyan with beacon
// rings, a light column and a glyph above it: "?" for a question, a padlock
// for a permission prompt.
#pragma once

#include "actions.h"

namespace cv {

// A star, from its agent record (constellation-frame.js).
struct Star {
    const agentviz::Agent* a;
    V3 c, u, v;
    float r, systemR;
};

inline Star starOf(const agentviz::Agent& a) {
    return {&a, {a.x, a.y, a.z}, {a.extra[1], a.extra[2], a.extra[3]}, {a.extra[4], a.extra[5], a.extra[6]},
            a.extra[0], a.extra[7]};
}

// Dots along a polyline in the screen plane at c, drawn on top of everything.
inline void glyphStroke(Host& h, V3 c, const Facing& f, const float (*pts)[2], int n, float size, float alpha) {
    for (int i = 0; i + 1 < n; ++i) {
        const float dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
        const int steps = 2 + static_cast<int>(std::sqrt(dx * dx + dy * dy) * 22.0f);
        for (int s = 0; s < steps; ++s) {
            const float k = static_cast<float>(s) / steps;
            const V3 p = c + f.right * ((pts[i][0] + dx * k) * size) + f.up * ((pts[i][1] + dy * k) * size);
            glow(h, p, 0.0f, kWaitColour, alpha, 4.0f, STRATA_POINT_ON_TOP);
        }
    }
}

// "?": a hook curling into a stem, and a dot, round c.
inline void drawQuestion(Host& h, V3 c, const Facing& f, float size, float alpha) {
    float hook[12][2];
    for (int i = 0; i < 10; ++i) {  // from upper left, over the top, round to the right and in
        const float a = 2.6f - i * (3.6f / 9.0f);
        hook[i][0] = 0.24f * std::cos(a);
        hook[i][1] = 0.22f + 0.24f * std::sin(a);
    }
    hook[10][0] = 0.0f, hook[10][1] = 0.0f;
    hook[11][0] = 0.0f, hook[11][1] = -0.16f;
    glyphStroke(h, c, f, hook, 12, size, alpha);
    glow(h, c + f.up * (-0.36f * size), 0.0f, kWaitColour, alpha, 7.0f, STRATA_POINT_ON_TOP);
}

// A padlock: a shackle arch over a body of filled rows.
inline void drawPadlock(Host& h, V3 c, const Facing& f, float size, float alpha) {
    float arch[12][2];
    arch[0][0] = -0.18f, arch[0][1] = -0.05f;
    for (int i = 0; i < 10; ++i) {
        const float a = kPi - i * (kPi / 9.0f);
        arch[i + 1][0] = 0.18f * std::cos(a);
        arch[i + 1][1] = 0.05f + 0.2f * std::sin(a);
    }
    arch[11][0] = 0.18f, arch[11][1] = -0.05f;
    glyphStroke(h, c, f, arch, 12, size, alpha);
    for (int row = 0; row < 6; ++row) {
        const float y = -0.08f - row * 0.064f;
        const float body[2][2] = {{-0.28f, y}, {0.28f, y}};
        glyphStroke(h, c, f, body, 2, size, alpha);
    }
}

inline void drawBody(Host& h, const Star& s, float beat, float bright) {
    const State state = s.a->state;
    const float appear = s.a->appear;
    const Rgb halo = starHalo(state);
    const Rgb core = state == State::Waiting ? mix(starCore(state), kWhite, beat) : starCore(state);
    const bool offline = state == State::Offline, hot = state == State::Busy || state == State::Waiting;
    glow(h, s.c, s.r * 2.0f * (1.0f + 0.15f * beat), scale(core, bright), (offline ? 0.55f : 1.0f) * appear, 3.0f, 0);
    glow(h, s.c, s.r * 3.6f * (1.0f + 0.4f * beat), halo, (offline ? 0.25f : 0.6f) * bright * appear, 4.0f);
    glow(h, s.c, s.r * 8.0f * (1.0f + 0.6f * beat), halo, (hot ? 0.25f : 0.1f) * bright * appear, 6.0f);
}

// Light for its planets: the brighter states win the light budget.
inline void drawLight(Host& h, const Star& s, float beat, float bright) {
    const State state = s.a->state;
    const float base = state == State::Busy ? 4.0f : state == State::Waiting ? 3.5f + 1.5f * beat
                     : state == State::Idle ? 2.0f : 0.8f;
    const float intensity = base * bright * s.a->appear;
    const int priority = state == State::Waiting ? 4 : state == State::Busy ? 3 : state == State::Idle ? 2 : 1;
    if (intensity > 0.01f)
        h.light(s.c.x, s.c.y, s.c.z, s.systemR * 1.6f + 6.0f, mix(starHalo(state), kWhite, 0.5f), intensity, priority);
}

// Beacon rings expanding outward, in the orbit plane and facing the camera,
// a light column, and the glyph saying why it waits, on top of everything.
inline void drawBeacon(Host& h, const Star& s, float t, float beat) {
    const float a = s.a->appear, r = s.r;
    const Facing f = facing(h, s.c);
    for (int k = 0; k < 3; ++k) {
        const float u = fract(t * 0.6f + k / 3.0f);
        circle(h, s.c, s.u, s.v, r * 1.5f + u * (s.systemR + 8.0f), kWaitColour, (1.0f - u) * 0.95f * a, 72);
        circle(h, s.c, f.right, f.up, r * 1.6f + u * r * 4.0f, kWaitColour, (1.0f - u) * 0.8f * a, 40);
    }
    glow(h, s.c, r * 10.0f * (0.6f + 0.4f * beat), kWaitColour, 0.35f * a, 8.0f);
    glow(h, s.c, r * 4.5f * (0.8f + 0.3f * beat), kWaitColour, 0.55f * a, 6.0f);
    for (int i = 1; i <= 8; ++i) {
        const float u = i / 8.0f;
        glow(h, s.c + V3{0, r + u * 7.0f, 0}, 0.6f * (1.0f - u * 0.5f), kWaitColour, (1.0f - u) * 0.5f * a, 2.0f);
    }
    // page.js lifts a waiting star's label above this glyph (r * 2.6 + 4.8): keep in step.
    const V3 above = s.c + V3{0, r * 2.6f + 2.4f, 0};
    const float size = 2.2f, alpha = (0.75f + 0.25f * beat) * a;
    if (s.a->waitingReason == agentviz::WaitingReason::Question) drawQuestion(h, above, f, size, alpha);
    else drawPadlock(h, above, f, size, alpha);
}

// A ring bursting off the surface at each new tool call (pulse 1 -> 0).
inline void drawToolCall(Host& h, const Star& s) {
    const float p = s.a->pulse;
    if (p <= 0.01f) return;
    const Facing f = facing(h, s.c);
    const Rgb col = mix(actionColour(s.a->action), kWhite, 0.5f);
    circle(h, s.c, f.right, f.up, s.r * (1.3f + (1.0f - p) * 3.0f), col, p * 0.9f * s.a->appear, 48);
    glow(h, s.c, s.r * 4.0f, col, 0.3f * p * s.a->appear, 4.0f);
}

inline void drawHighlight(Host& h, V3 c, float radius, agentviz::Highlight highlight) {
    if (highlight == agentviz::Highlight::None) return;
    const Facing f = facing(h, c);
    const bool selected = highlight == agentviz::Highlight::Selected;
    circle(h, c, f.right, f.up, radius, kWhite, selected ? 0.9f : 0.45f, 48);
    if (selected) circle(h, c, f.right, f.up, radius * 1.08f, kWhite, 0.4f, 48);
}

inline void drawStar(Host& h, const Star& s, float t, float motion) {
    const agentviz::Agent& a = *s.a;
    const float bright = a.stalled ? flicker(t, a.seed) : 1.0f;
    const float beat = a.waiting() ? 0.5f + 0.5f * std::sin(t * 6.0f) : 0.0f;
    drawBody(h, s, beat, bright);
    drawLight(h, s, beat, bright);
    const V3 n = norm(cross(s.u, s.v));
    drawAction(h, a.action, Body{s.c, s.r, s.u, s.v, n, s.systemR + 2.0f, a.seed, a.appear * bright}, t * motion);
    drawToolCall(h, s);
    if (a.waiting()) drawBeacon(h, s, t, beat);
    drawHighlight(h, s.c, s.r * 2.4f, a.highlight);
}

}  // namespace cv
