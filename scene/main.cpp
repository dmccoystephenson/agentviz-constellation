// agentviz-constellation: Claude Code sessions as a star map.
//
// Each place (repo) is a faint nebula; each session is a star whose colour is
// its state; its subagents are planets on visible orbit rings. What a star is
// doing now (its action) is drawn on it: flares, a pulsing corona, a sweeping
// beam, jets, bright orbits, a steady glow or a shimmer. A session waiting on
// the owner pulses with cyan beacon rings that expand outward.
//
// The page (web/constellation.js) owns the layout and the easing: it hands
// this file rows of floats every frame (places, stars, planets), already in
// world space. This file only draws them.
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace {

using strata_kit::Host;
using strata_kit::Rgb;

// Row layouts. Keep in step with web/constellation.js.
constexpr int kPlaceStride = 8;  // x y z radius seed alpha waiting busyFrac
constexpr int kStarStride = 20;  // x y z state action stalled seed sel radius alpha Ux Uy Uz Vx Vy Vz hue sysR 0 0
constexpr int kPlanetStride = 12;  // x y z star orbitR size active action seed sel alpha angle

enum State { kOffline = 0, kDim = 1, kIdle = 2, kBusy = 3, kWaiting = 4 };
enum Action { kNone = 0, kEdit = 1, kRun = 2, kRead = 3, kWeb = 4, kDelegate = 5, kThink = 6, kOther = 7 };

constexpr float kTau = 6.2831853f;

std::vector<float> places, stars, planets;
bool reduced = false;

struct V3 {
    float x, y, z;
};
V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
V3 norm(V3 a) {
    const float l = std::sqrt(dot(a, a));
    return l > 1e-6f ? a * (1.0f / l) : V3{0, 1, 0};
}
Rgb mix(Rgb a, Rgb b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }
Rgb scale(Rgb a, float k) { return {a.r * k, a.g * k, a.b * k}; }

float hash(float n) {
    const float s = std::sin(n * 12.9898f + 78.233f) * 43758.5453f;
    return s - std::floor(s);
}
float fract(float v) { return v - std::floor(v); }

// Action colours, shared with the page's legend.
Rgb actionColour(int a) {
    switch (a) {
        case kEdit: return {1.0f, 0.45f, 0.15f};
        case kRun: return {0.45f, 1.0f, 0.5f};
        case kRead: return {0.5f, 0.72f, 1.0f};
        case kWeb: return {0.78f, 0.5f, 1.0f};
        case kDelegate: return {1.0f, 0.85f, 0.4f};
        case kThink: return {0.86f, 0.82f, 1.0f};
        case kOther: return {1.0f, 0.6f, 0.82f};
        default: return {0.6f, 0.6f, 0.6f};
    }
}

const Rgb kWaitColour{0.35f, 0.95f, 1.0f};

Rgb starCore(int state) {
    switch (state) {
        case kBusy: return {1.0f, 0.94f, 0.7f};
        case kWaiting: return {0.6f, 0.97f, 1.0f};
        case kIdle: return {1.0f, 0.62f, 0.28f};
        case kDim: return {0.6f, 0.64f, 0.72f};
        default: return {0.5f, 0.16f, 0.1f};
    }
}
Rgb starHalo(int state) {
    switch (state) {
        case kBusy: return {1.0f, 0.78f, 0.32f};
        case kWaiting: return kWaitColour;
        case kIdle: return {0.85f, 0.35f, 0.1f};
        case kDim: return {0.4f, 0.45f, 0.55f};
        default: return {0.35f, 0.28f, 0.27f};
    }
}

Rgb nebulaColour(float seed) {
    static const Rgb hues[6] = {{0.55f, 0.3f, 0.85f}, {0.2f, 0.55f, 0.8f}, {0.85f, 0.3f, 0.5f},
                                {0.25f, 0.7f, 0.6f},  {0.8f, 0.5f, 0.25f}, {0.45f, 0.4f, 0.95f}};
    return hues[static_cast<int>(seed * 6.0f) % 6];
}

Rgb planetColour(float seed) {
    static const Rgb hues[7] = {{0.75f, 0.55f, 0.4f}, {0.4f, 0.6f, 0.85f}, {0.6f, 0.75f, 0.5f}, {0.85f, 0.75f, 0.55f},
                                {0.7f, 0.45f, 0.6f},  {0.5f, 0.8f, 0.8f},  {0.8f, 0.6f, 0.35f}};
    return hues[static_cast<int>(seed * 7.0f) % 7];
}

// A circle of line segments around c in the plane of a, b.
void circle(Host& h, V3 c, V3 a, V3 b, float r, Rgb col, float alpha, int segs = 64) {
    for (int k = 0; k < segs; ++k) {
        const float t0 = k * kTau / segs, t1 = (k + 1) * kTau / segs;
        const V3 p0 = c + a * (r * std::cos(t0)) + b * (r * std::sin(t0));
        const V3 p1 = c + a * (r * std::cos(t1)) + b * (r * std::sin(t1));
        h.line(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, col, alpha);
    }
}

void glow(Host& h, V3 p, float diameter, Rgb c, float a, float minPx = 2.0f, uint32_t flags = STRATA_POINT_SOFT) {
    h.point(p.x, p.y, p.z, minPx, diameter, c, a, flags);
}

// A camera-facing basis at p.
void facing(const Host& h, V3 p, V3& a, V3& b) {
    const V3 view = norm(V3{h.eye[0], h.eye[1], h.eye[2]} - p);
    a = norm(cross(view, V3{0, 1, 0}));
    if (std::fabs(dot(view, V3{0, 1, 0})) > 0.98f) a = V3{1, 0, 0};
    b = norm(cross(a, view));
}

// What an agent is doing, drawn round a body at c of radius r. U, V span its
// orbit plane, N is that plane's normal; reach is how far the effect goes.
void drawAction(Host& h, int action, V3 c, float r, V3 U, V3 V, float reach, double tt, float seed, float k) {
    if (action == kNone || k <= 0.01f) return;
    const float t = static_cast<float>(tt) * (reduced ? 0.25f : 1.0f);
    const Rgb col = actionColour(action);
    const V3 N = norm(cross(U, V));
    V3 fa, fb;
    facing(h, c, fa, fb);
    switch (action) {
        case kEdit: {  // flares: arcs that leap off the surface and fall back
            for (int f = 0; f < 3; ++f) {
                const float period = 2.4f + f * 0.5f;
                const float life = fract(t / period + f * 0.37f + seed);
                const float cycle = std::floor(t / period + f * 0.37f + seed);
                const float base = hash(cycle * 7.1f + f + seed * 31.0f) * kTau;
                const float tilt = (hash(cycle * 3.3f + f) - 0.5f) * 1.2f;
                const float height = r * 1.4f * std::sin(life * 3.14159f);
                for (int s = 0; s <= 10; ++s) {
                    const float u = s / 10.0f;
                    const float ang = base + u * 0.9f;
                    const V3 dir = norm(U * std::cos(ang) + V * std::sin(ang) + N * tilt);
                    const V3 p = c + dir * (r + height * std::sin(u * 3.14159f));
                    glow(h, p, r * 0.45f, mix(col, {1.0f, 0.9f, 0.5f}, u * 0.3f), 0.85f * k * (1.0f - life * 0.6f));
                }
            }
            break;
        }
        case kRun: {  // a corona that pulses in and out, like an engine running
            const float pulse = 0.5f + 0.5f * std::sin(t * 5.0f + seed * 10.0f);
            const float rr = r * (1.35f + 0.35f * pulse);
            for (int i = 0; i < 28; ++i) {
                const float a = i * kTau / 28 + t * 0.4f;
                const V3 p = c + fa * (rr * std::cos(a)) + fb * (rr * std::sin(a));
                glow(h, p, r * (0.5f + 0.3f * pulse), col, (0.35f + 0.45f * pulse) * k);
            }
            glow(h, c, r * (3.2f + 1.2f * pulse), col, 0.18f * k);
            break;
        }
        case kRead: {  // a slow beam that sweeps round, like a lighthouse
            const float a = t * 0.7f + seed * kTau;
            const V3 dir = norm(U * std::cos(a) + V * std::sin(a));
            const float len = reach;
            for (int s = 1; s <= 16; ++s) {
                const float u = s / 16.0f;
                const V3 p = c + dir * (r + u * len);
                glow(h, p, r * (0.3f + 1.4f * u), col, 0.6f * (1.0f - u) * k);
            }
            const V3 e = c + dir * (r + len);
            h.line(c.x, c.y, c.z, e.x, e.y, e.z, col, 0.55f * k);
            break;
        }
        case kWeb: {  // jets out of both poles, out to the edge of the system
            const float len = reach * 1.6f;
            for (int side = -1; side <= 1; side += 2) {
                const V3 d = N * static_cast<float>(side);
                for (int i = 0; i < 14; ++i) {
                    const float u = fract(t * 0.6f + i / 14.0f);
                    const V3 p = c + d * (r + u * len);
                    glow(h, p, r * (0.35f + 0.5f * u), col, 0.8f * (1.0f - u) * k);
                }
                const V3 e = c + d * (r + len);
                h.line(c.x, c.y, c.z, e.x, e.y, e.z, col, 0.35f * k);
            }
            break;
        }
        case kDelegate:  // the orbits brighten (drawn with the rings); a gold halo here
            glow(h, c, r * 3.0f, col, 0.22f * k);
            break;
        case kThink: {  // a steady, slowly breathing glow
            const float b = 0.85f + 0.15f * std::sin(t * 1.0f + seed * 6.0f);
            glow(h, c, r * 4.2f * b, col, 0.28f * k);
            glow(h, c, r * 2.4f * b, col, 0.3f * k);
            break;
        }
        case kOther: {  // a shimmer of sparkles round the surface
            for (int i = 0; i < 14; ++i) {
                const float cyc = std::floor(t * 3.0f + i * 0.31f);
                const float life = fract(t * 3.0f + i * 0.31f);
                const float a = hash(cyc * 1.7f + i * 9.1f + seed) * kTau;
                const float e = (hash(cyc * 5.3f + i) - 0.5f) * 2.4f;
                const V3 dir = norm(fa * std::cos(a) + fb * std::sin(a) + N * (e * 0.3f));
                const V3 p = c + dir * (r * (1.2f + 0.6f * hash(cyc + i * 2.0f)));
                glow(h, p, r * 0.35f, col, std::sin(life * 3.14159f) * 0.9f * k);
            }
            break;
        }
        default: break;
    }
}

// Background: a fixed field of faint stars far away, seeded so it repeats.
void drawSky(Host& h) {
    for (int i = 0; i < 700; ++i) {
        const float u = hash(i * 1.37f) * 2.0f - 1.0f, a = hash(i * 7.91f + 3.0f) * kTau;
        const float s = std::sqrt(1.0f - u * u);
        const float d = 520.0f;
        const float b = 0.25f + 0.75f * hash(i * 3.17f + 1.0f) * hash(i * 0.73f);
        const float tint = hash(i * 11.3f);
        const Rgb c = tint < 0.2f ? Rgb{0.7f, 0.8f, 1.0f} : (tint > 0.85f ? Rgb{1.0f, 0.85f, 0.7f} : Rgb{1, 1, 1});
        h.point(s * std::cos(a) * d, u * d, s * std::sin(a) * d, 1.0f + 1.6f * b, 0.0f, c, 0.25f + 0.6f * b, 0);
    }
}

void drawPlace(Host& h, const float* p) {
    const V3 c{p[0], p[1], p[2]};
    const float R = p[3], seed = p[4], alpha = p[5];
    const Rgb col = nebulaColour(seed);
    for (int i = 0; i < 34; ++i) {
        const float a = hash(seed * 91.0f + i * 1.3f) * kTau;
        const float rr = std::sqrt(hash(seed * 17.0f + i * 2.7f)) * R * 0.8f;
        const float y = (hash(seed * 5.0f + i * 0.9f) - 0.5f) * R * 0.3f;
        const V3 q = c + V3{std::cos(a) * rr, y, std::sin(a) * rr};
        const float d = R * (0.45f + 0.5f * hash(seed * 3.0f + i * 4.1f));
        const Rgb cc = mix(col, nebulaColour(fract(seed + 0.34f)), hash(i * 1.9f + seed) * 0.5f);
        glow(h, q, d, cc, 0.07f * alpha, 2.0f);
    }
    // A few bright dust knots so the region reads as a place, not a smear.
    for (int i = 0; i < 10; ++i) {
        const float a = hash(seed * 41.0f + i * 3.1f) * kTau;
        const float rr = (0.3f + 0.7f * hash(seed * 13.0f + i)) * R;
        const V3 q = c + V3{std::cos(a) * rr, (hash(i + seed) - 0.5f) * R * 0.2f, std::sin(a) * rr};
        glow(h, q, 0.1f, mix(col, {1, 1, 1}, 0.6f), 0.45f * alpha, 1.5f, 0);
    }
}

void drawStar(Host& h, const float* s, int index, double t) {
    const V3 c{s[0], s[1], s[2]};
    const int state = static_cast<int>(s[3] + 0.5f), action = static_cast<int>(s[4] + 0.5f);
    const bool stalled = s[5] > 0.5f;
    const float seed = s[6], sel = s[7], r = s[8], alpha = s[9];
    const V3 U{s[10], s[11], s[12]}, V{s[13], s[14], s[15]};
    const float sysR = s[17];
    const float tf = static_cast<float>(t);

    float bright = 1.0f;
    if (stalled) {  // a stalled star flickers like a failing bulb
        const float f = hash(std::floor(tf * 11.0f) + seed * 100.0f);
        bright = f > 0.35f ? 1.0f : 0.25f + f;
    }
    float pulse = 0.0f;
    if (state == kWaiting) pulse = 0.5f + 0.5f * std::sin(tf * 6.0f);
    const float a = alpha;

    Rgb core = starCore(state), halo = starHalo(state);
    if (state == kWaiting) core = mix(core, {1, 1, 1}, pulse);
    const float coreA = (state == kOffline ? 0.55f : 1.0f) * a;
    // Body: a solid disc the size of the star, then soft halos.
    glow(h, c, r * 2.0f * (1.0f + 0.15f * pulse), scale(core, bright), coreA, 3.0f, 0);
    glow(h, c, r * 3.6f * (1.0f + 0.4f * pulse), halo, (state == kOffline ? 0.25f : 0.6f) * bright * a, 4.0f);
    glow(h, c, r * 8.0f * (1.0f + 0.6f * pulse), halo,
         (state == kBusy || state == kWaiting ? 0.25f : 0.1f) * bright * a, 6.0f);

    // Light for its planets: the brighter states win the light budget.
    const float intensity = (state == kBusy ? 4.0f : state == kWaiting ? 3.5f + 1.5f * pulse
                             : state == kIdle ? 2.0f : 0.8f) * bright * a;
    const int prio = state == kWaiting ? 4 : state == kBusy ? 3 : state == kIdle ? 2 : 1;
    if (intensity > 0.01f) h.light(c.x, c.y, c.z, sysR * 1.6f + 6.0f, mix(halo, {1, 1, 1}, 0.5f), intensity, prio);

    drawAction(h, action, c, r, U, V, sysR + 2.0f, t, seed, a * bright);

    if (state == kWaiting) {
        // Beacon rings expanding outward, in the orbit plane and facing the
        // camera, plus a marker that shows through everything.
        V3 fa, fb;
        facing(h, c, fa, fb);
        for (int k = 0; k < 3; ++k) {
            const float u = fract(tf * 0.6f + k / 3.0f);
            const float rr = r * 1.5f + u * (sysR + 8.0f);
            circle(h, c, U, V, rr, kWaitColour, (1.0f - u) * 0.95f * a, 72);
            circle(h, c, fa, fb, r * 1.6f + u * r * 4.0f, kWaitColour, (1.0f - u) * 0.8f * a, 40);
        }
        glow(h, c, r * 10.0f * (0.6f + 0.4f * pulse), kWaitColour, 0.35f * a, 8.0f);
        glow(h, c, r * 4.5f * (0.8f + 0.3f * pulse), kWaitColour, 0.55f * a, 6.0f);
        glow(h, c + V3{0, r * 2.6f + 0.6f, 0}, 0.0f, kWaitColour, (0.6f + 0.4f * pulse) * a, 14.0f + 6.0f * pulse,
             STRATA_POINT_SOFT | STRATA_POINT_ON_TOP);
        for (int i = 1; i <= 8; ++i) {  // a light column rising from the star
            const float u = i / 8.0f;
            glow(h, c + V3{0, r + u * 7.0f, 0}, 0.6f * (1.0f - u * 0.5f), kWaitColour, (1.0f - u) * 0.5f * a, 2.0f);
        }
    }

    if (sel > 0.5f) {
        V3 fa, fb;
        facing(h, c, fa, fb);
        circle(h, c, fa, fb, r * 2.4f, {1, 1, 1}, 0.9f, 48);
        circle(h, c, fa, fb, r * 2.6f, {1, 1, 1}, 0.4f, 48);
    }
    (void)index;
}

void drawPlanet(Host& h, const float* p, double t) {
    const int si = static_cast<int>(p[3] + 0.5f);
    if (si < 0 || static_cast<size_t>(si + 1) * kStarStride > stars.size()) return;
    const float* s = &stars[static_cast<size_t>(si) * kStarStride];
    const V3 c{s[0], s[1], s[2]};
    const V3 U{s[10], s[11], s[12]}, V{s[13], s[14], s[15]};
    const int starAction = static_cast<int>(s[4] + 0.5f);
    const float starAlpha = s[9];
    const V3 q{p[0], p[1], p[2]};
    const float orbitR = p[4], size = p[5], active = p[6];
    const int action = static_cast<int>(p[7] + 0.5f);
    const float seed = p[8], sel = p[9], alpha = p[10] * starAlpha;

    // Its orbit ring: faint when resting, brighter when working, gold and
    // bright when the star is delegating.
    Rgb ringC = mix({0.45f, 0.5f, 0.65f}, {0.75f, 0.8f, 0.95f}, active);
    float ringA = (0.16f + 0.22f * active) * alpha;
    if (starAction == kDelegate) {
        ringC = actionColour(kDelegate);
        ringA = (0.55f + 0.25f * std::sin(static_cast<float>(t) * 3.0f + orbitR)) * alpha;
    }
    circle(h, c, U, V, orbitR, ringC, ringA, 72);

    const Rgb body = mix(scale(planetColour(seed), 0.55f), planetColour(seed), active);
    h.add(STRATA_PRIMITIVE_SPHERE, q.x, q.y, q.z, size * 2.0f, size * 2.0f, size * 2.0f, body, 1.0f);
    // A thin atmosphere in its action's colour when it is working.
    if (active > 0.05f && action != kNone) glow(h, q, size * 3.2f, actionColour(action), 0.4f * active * alpha, 3.0f);
    drawAction(h, action, q, size, U, V, size * 4.0f, t, seed, active * alpha * 0.8f);
    if (sel > 0.5f) {
        V3 fa, fb;
        facing(h, q, fa, fb);
        circle(h, q, fa, fb, size * 2.2f + 0.2f, {1, 1, 1}, 0.9f, 36);
    }
}

}  // namespace

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "constellation";
    o.fog = false;
    o.farPlane = 900.0f;
    o.nearPlane = 0.2f;
    // Space: no sun, so no shadow cascades at any tier.
    for (auto& tier : o.tiers) tier.cascades = 0;
    o.tiers[0].thinPoints = true;
}

void strata_kit_engine_ready(strata_kit::Host& h) {
    h.clearFlags = STRATA_CLEAR_COLOR | STRATA_CLEAR_DEPTH;
    h.clearColor[0] = 0.008f;
    h.clearColor[1] = 0.01f;
    h.clearColor[2] = 0.025f;
    h.clearColor[3] = 1.0f;
#if STRATA_ABI_MINOR >= 16
    h.sunIntensity = 0.0f;
    h.ambientTint = {0.25f, 0.27f, 0.35f};
    h.ambientLift = {0.1f, 0.1f, 0.13f};
#endif
}

void strata_kit_build(strata_kit::Host& h, double t) {
    reduced = h.reducedMotion;
    drawSky(h);
    for (size_t i = 0; i + kPlaceStride <= places.size(); i += kPlaceStride) drawPlace(h, &places[i]);
    for (size_t i = 0; i + kStarStride <= stars.size(); i += kStarStride)
        drawStar(h, &stars[i], static_cast<int>(i / kStarStride), t);
    for (size_t i = 0; i + kPlanetStride <= planets.size(); i += kPlanetStride) drawPlanet(h, &planets[i], t);
}

STRATA_KIT_EXPORT void cv_set_places(const float* rows, int count) {
    places.assign(rows, rows + static_cast<size_t>(std::max(count, 0)) * kPlaceStride);
}
STRATA_KIT_EXPORT void cv_set_stars(const float* rows, int count) {
    stars.assign(rows, rows + static_cast<size_t>(std::max(count, 0)) * kStarStride);
}
STRATA_KIT_EXPORT void cv_set_planets(const float* rows, int count) {
    planets.assign(rows, rows + static_cast<size_t>(std::max(count, 0)) * kPlanetStride);
}
