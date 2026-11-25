// draw_util.h: vectors, colours and the few shapes the star map is built from.
#pragma once

#include <cmath>
#include <cstdint>

#include "strata_kit.h"
#include "../vendor/agentviz-kit/scene/agentviz.h"

namespace cv {

using agentviz::Action;
using agentviz::State;
using strata_kit::Host;
using strata_kit::Rgb;

constexpr float kTau = 6.2831853f;
constexpr float kPi = 3.14159265f;

struct V3 {
    float x, y, z;
};
inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline V3 norm(V3 a) {
    const float l = std::sqrt(dot(a, a));
    return l > 1e-6f ? a * (1.0f / l) : V3{0, 1, 0};
}

inline Rgb mix(Rgb a, Rgb b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }
inline Rgb scale(Rgb a, float k) { return {a.r * k, a.g * k, a.b * k}; }

// A repeatable 0..1 noise value for n.
inline float hash(float n) {
    const float s = std::sin(n * 12.9898f + 78.233f) * 43758.5453f;
    return s - std::floor(s);
}
inline float fract(float v) { return v - std::floor(v); }

const Rgb kWhite{1.0f, 1.0f, 1.0f};
const Rgb kWaitColour{0.35f, 0.95f, 1.0f};
const Rgb kStallColour{1.0f, 0.3f, 0.2f};

// Action colours; the page's legend and HUD theme use the same ones.
inline Rgb actionColour(Action a) {
    switch (a) {
        case Action::Edit: return {1.0f, 0.45f, 0.15f};
        case Action::Run: return {0.45f, 1.0f, 0.5f};
        case Action::Read: return {0.5f, 0.72f, 1.0f};
        case Action::Web: return {0.78f, 0.5f, 1.0f};
        case Action::Delegate: return {1.0f, 0.85f, 0.4f};
        case Action::Think: return {0.86f, 0.82f, 1.0f};
        case Action::Other: return {1.0f, 0.6f, 0.82f};
        default: return {0.6f, 0.6f, 0.6f};
    }
}

inline Rgb starCore(State s) {
    switch (s) {
        case State::Busy: return {1.0f, 0.94f, 0.7f};
        case State::Waiting: return {0.6f, 0.97f, 1.0f};
        case State::Idle: return {1.0f, 0.62f, 0.28f};
        case State::Dim: return {0.6f, 0.64f, 0.72f};
        default: return {0.5f, 0.16f, 0.1f};
    }
}

inline Rgb starHalo(State s) {
    switch (s) {
        case State::Busy: return {1.0f, 0.78f, 0.32f};
        case State::Waiting: return kWaitColour;
        case State::Idle: return {0.85f, 0.35f, 0.1f};
        case State::Dim: return {0.4f, 0.45f, 0.55f};
        default: return {0.35f, 0.28f, 0.27f};
    }
}

inline Rgb nebulaColour(float seed) {
    static const Rgb hues[6] = {{0.55f, 0.3f, 0.85f}, {0.2f, 0.55f, 0.8f}, {0.85f, 0.3f, 0.5f},
                                {0.25f, 0.7f, 0.6f},  {0.8f, 0.5f, 0.25f}, {0.45f, 0.4f, 0.95f}};
    return hues[static_cast<int>(seed * 6.0f) % 6];
}

inline Rgb planetColour(float seed) {
    static const Rgb hues[7] = {{0.75f, 0.55f, 0.4f}, {0.4f, 0.6f, 0.85f}, {0.6f, 0.75f, 0.5f}, {0.85f, 0.75f, 0.55f},
                                {0.7f, 0.45f, 0.6f},  {0.5f, 0.8f, 0.8f},  {0.8f, 0.6f, 0.35f}};
    return hues[static_cast<int>(seed * 7.0f) % 7];
}

// A failing bulb: 1 most of the time, dipping at random a few times a second.
inline float flicker(float t, float seed) {
    const float f = hash(std::floor(t * 11.0f) + seed * 100.0f);
    return f > 0.35f ? 1.0f : 0.25f + f;
}

// A circle of line segments round c in the plane of a, b.
inline void circle(Host& h, V3 c, V3 a, V3 b, float r, Rgb col, float alpha, int segs = 64) {
    for (int k = 0; k < segs; ++k) {
        const float t0 = k * kTau / segs, t1 = (k + 1) * kTau / segs;
        const V3 p0 = c + a * (r * std::cos(t0)) + b * (r * std::sin(t0));
        const V3 p1 = c + a * (r * std::cos(t1)) + b * (r * std::sin(t1));
        h.line(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, col, alpha);
    }
}

inline void glow(Host& h, V3 p, float diameter, Rgb c, float a, float minPx = 2.0f, uint32_t flags = STRATA_POINT_SOFT) {
    h.point(p.x, p.y, p.z, minPx, diameter, c, a, flags);
}

// Screen-aligned axes at p: `right` points to the viewer's right, `up` to
// screen-up, so world-space glyphs read the right way round from any orbit.
struct Facing {
    V3 right, up;
};
inline Facing facing(const Host& h, V3 p) {
    const V3 view = norm(V3{h.eye[0], h.eye[1], h.eye[2]} - p);
    V3 right = norm(cross(V3{0, 1, 0}, view));
    if (std::fabs(dot(view, V3{0, 1, 0})) > 0.98f) right = V3{1, 0, 0};
    return {right, norm(cross(view, right))};
}

}  // namespace cv
