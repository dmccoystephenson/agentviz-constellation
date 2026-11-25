// sky.h: the fixed background star field and one nebula per place (a zone).
#pragma once

#include <vector>

#include "draw_util.h"

namespace cv {

// A place's nebula, from its zone record (constellation-frame.js).
struct Nebula {
    V3 c;
    float R, seed, appear, density;
};

inline Nebula nebulaOf(const agentviz::Zone& z) {
    return {{(z.x0 + z.x1) * 0.5f, z.extra[0], (z.z0 + z.z1) * 0.5f}, z.extra[1], z.seed, z.appear, z.extra[2]};
}

// Background: a fixed field of faint stars far away, seeded so it repeats.
inline void drawSky(Host& h) {
    constexpr float kDistance = 520.0f;
    for (int i = 0; i < 700; ++i) {
        const float u = hash(i * 1.37f) * 2.0f - 1.0f, a = hash(i * 7.91f + 3.0f) * kTau;
        const float s = std::sqrt(1.0f - u * u);
        const float bright = 0.25f + 0.75f * hash(i * 3.17f + 1.0f) * hash(i * 0.73f);
        const float tint = hash(i * 11.3f);
        const Rgb c = tint < 0.2f ? Rgb{0.7f, 0.8f, 1.0f} : (tint > 0.85f ? Rgb{1.0f, 0.85f, 0.7f} : kWhite);
        h.point(s * std::cos(a) * kDistance, u * kDistance, s * std::sin(a) * kDistance, 1.0f + 1.6f * bright, 0.0f, c,
                0.25f + 0.6f * bright, 0);
    }
}

// Soft clouds, more and brighter the more tool calls the place has seen.
inline void drawClouds(Host& h, const Nebula& n, Rgb col) {
    const int clouds = 22 + static_cast<int>(n.density * 22.0f);
    const float alpha = (0.05f + 0.04f * n.density) * n.appear;
    for (int i = 0; i < clouds; ++i) {
        const float a = hash(n.seed * 91.0f + i * 1.3f) * kTau;
        const float rr = std::sqrt(hash(n.seed * 17.0f + i * 2.7f)) * n.R * 0.8f;
        const float y = (hash(n.seed * 5.0f + i * 0.9f) - 0.5f) * n.R * 0.3f;
        const V3 q = n.c + V3{std::cos(a) * rr, y, std::sin(a) * rr};
        const float d = n.R * (0.45f + 0.5f * hash(n.seed * 3.0f + i * 4.1f));
        const Rgb cc = mix(col, nebulaColour(fract(n.seed + 0.34f)), hash(i * 1.9f + n.seed) * 0.5f);
        glow(h, q, d, cc, alpha, 2.0f);
    }
}

// Bright dust knots so the region reads as a place, not a smear.
inline void drawKnots(Host& h, const Nebula& n, Rgb col) {
    const int knots = 6 + static_cast<int>(n.density * 12.0f);
    for (int i = 0; i < knots; ++i) {
        const float a = hash(n.seed * 41.0f + i * 3.1f) * kTau;
        const float rr = (0.3f + 0.7f * hash(n.seed * 13.0f + i)) * n.R;
        const V3 q = n.c + V3{std::cos(a) * rr, (hash(i + n.seed) - 0.5f) * n.R * 0.2f, std::sin(a) * rr};
        glow(h, q, 0.1f, mix(col, kWhite, 0.6f), 0.45f * n.appear, 1.5f, 0);
    }
}

inline void drawNebulae(Host& h, const std::vector<agentviz::Zone>& zones) {
    for (const auto& z : zones) {
        const Nebula n = nebulaOf(z);
        const Rgb col = nebulaColour(n.seed);
        drawClouds(h, n, col);
        drawKnots(h, n, col);
    }
}

}  // namespace cv
