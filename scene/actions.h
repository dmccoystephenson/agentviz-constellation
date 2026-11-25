// actions.h: what an agent is doing, drawn round its body: flares (edit), a
// pulsing corona (run), a sweeping beam (read), polar jets (web), a gold halo
// (delegate; the gold orbits are in planet.h), a breathing glow (think) and a
// shimmer of sparkles (other). Stars draw them full size, planets in miniature.
#pragma once

#include "draw_util.h"

namespace cv {

// Where and how big: a body at c of radius r whose orbit plane is spanned by
// u, v (normal n); `reach` is how far a beam or jet goes; k fades it all.
struct Body {
    V3 c;
    float r;
    V3 u, v, n;
    float reach, seed, k;
};

inline void drawFlares(Host& h, const Body& b, float t, Rgb col) {
    for (int f = 0; f < 3; ++f) {
        const float period = 2.4f + f * 0.5f;
        const float phase = t / period + f * 0.37f + b.seed;
        const float life = fract(phase), cycle = std::floor(phase);
        const float base = hash(cycle * 7.1f + f + b.seed * 31.0f) * kTau;
        const float tilt = (hash(cycle * 3.3f + f) - 0.5f) * 1.2f;
        const float height = b.r * 1.4f * std::sin(life * kPi);
        for (int s = 0; s <= 10; ++s) {
            const float along = s / 10.0f, angle = base + along * 0.9f;
            const V3 dir = norm(b.u * std::cos(angle) + b.v * std::sin(angle) + b.n * tilt);
            const V3 p = b.c + dir * (b.r + height * std::sin(along * kPi));
            glow(h, p, b.r * 0.45f, mix(col, {1.0f, 0.9f, 0.5f}, along * 0.3f), 0.85f * b.k * (1.0f - life * 0.6f));
        }
    }
}

inline void drawCorona(Host& h, const Body& b, float t, Rgb col) {
    const Facing f = facing(h, b.c);
    const float beat = 0.5f + 0.5f * std::sin(t * 5.0f + b.seed * 10.0f);
    const float ring = b.r * (1.35f + 0.35f * beat);
    for (int i = 0; i < 28; ++i) {
        const float a = i * kTau / 28 + t * 0.4f;
        const V3 p = b.c + f.right * (ring * std::cos(a)) + f.up * (ring * std::sin(a));
        glow(h, p, b.r * (0.5f + 0.3f * beat), col, (0.35f + 0.45f * beat) * b.k);
    }
    glow(h, b.c, b.r * (3.2f + 1.2f * beat), col, 0.18f * b.k);
}

inline void drawBeam(Host& h, const Body& b, float t, Rgb col) {
    const float a = t * 0.7f + b.seed * kTau;
    const V3 dir = norm(b.u * std::cos(a) + b.v * std::sin(a));
    for (int s = 1; s <= 16; ++s) {
        const float along = s / 16.0f;
        glow(h, b.c + dir * (b.r + along * b.reach), b.r * (0.3f + 1.4f * along), col, 0.6f * (1.0f - along) * b.k);
    }
    const V3 end = b.c + dir * (b.r + b.reach);
    h.line(b.c.x, b.c.y, b.c.z, end.x, end.y, end.z, col, 0.55f * b.k);
}

inline void drawJets(Host& h, const Body& b, float t, Rgb col) {
    const float length = b.reach * 1.6f;
    for (int side = -1; side <= 1; side += 2) {
        const V3 d = b.n * static_cast<float>(side);
        for (int i = 0; i < 14; ++i) {
            const float along = fract(t * 0.6f + i / 14.0f);
            glow(h, b.c + d * (b.r + along * length), b.r * (0.35f + 0.5f * along), col, 0.8f * (1.0f - along) * b.k);
        }
        const V3 end = b.c + d * (b.r + length);
        h.line(b.c.x, b.c.y, b.c.z, end.x, end.y, end.z, col, 0.35f * b.k);
    }
}

inline void drawThinking(Host& h, const Body& b, float t, Rgb col) {
    const float breath = 0.85f + 0.15f * std::sin(t + b.seed * 6.0f);
    glow(h, b.c, b.r * 4.2f * breath, col, 0.4f * b.k);
    glow(h, b.c, b.r * 2.4f * breath, col, 0.45f * b.k);
}

inline void drawShimmer(Host& h, const Body& b, float t, Rgb col) {
    const Facing f = facing(h, b.c);
    for (int i = 0; i < 14; ++i) {
        const float cycle = std::floor(t * 3.0f + i * 0.31f), life = fract(t * 3.0f + i * 0.31f);
        const float a = hash(cycle * 1.7f + i * 9.1f + b.seed) * kTau;
        const float lift = (hash(cycle * 5.3f + i) - 0.5f) * 0.72f;
        const V3 dir = norm(f.right * std::cos(a) + f.up * std::sin(a) + b.n * lift);
        const V3 p = b.c + dir * (b.r * (1.2f + 0.6f * hash(cycle + i * 2.0f)));
        glow(h, p, b.r * 0.35f, col, std::sin(life * kPi) * 0.9f * b.k);
    }
}

// t is already slowed for reduced motion by the caller.
inline void drawAction(Host& h, Action action, const Body& b, float t) {
    if (action == Action::None || b.k <= 0.01f) return;
    const Rgb col = actionColour(action);
    switch (action) {
        case Action::Edit: drawFlares(h, b, t, col); break;
        case Action::Run: drawCorona(h, b, t, col); break;
        case Action::Read: drawBeam(h, b, t, col); break;
        case Action::Web: drawJets(h, b, t, col); break;
        case Action::Delegate: glow(h, b.c, b.r * 3.0f, col, 0.22f * b.k); break;
        case Action::Think: drawThinking(h, b, t, col); break;
        case Action::Other: drawShimmer(h, b, t, col); break;
        default: break;
    }
}

}  // namespace cv
