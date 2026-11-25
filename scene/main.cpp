// agentviz-constellation: Claude Code sessions as a star map.
//
// The page (web/constellation-*.js) owns the data and the layout: it reads
// the agent feed, places nebulae, stars and planets, eases them between
// snapshots and turns the orbits. Every frame it packs the scene in the
// agentviz wire format (vendor/agentviz-kit, docs/KIT.md in the agentviz
// repo) and calls agentviz_frame(); this file only draws what the frame says:
//   zones   one nebula per place (sky.h)
//   agents  a star per session (star.h), a planet per subagent (planet.h)
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include "planet.h"
#include "sky.h"

namespace {

agentviz::Frame frame;

}  // namespace

AGENTVIZ_FRAME_EXPORT(frame)

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
    h.sunIntensity = 0.0f;
    h.ambientTint = {0.25f, 0.27f, 0.35f};
    h.ambientLift = {0.1f, 0.1f, 0.13f};
}

void strata_kit_build(strata_kit::Host& h, double seconds) {
    cv::drawSky(h);
    if (!frame.ok) return;
    const float t = static_cast<float>(seconds);
    const float motion = h.reducedMotion ? 0.25f : 1.0f;
    cv::drawNebulae(h, frame.zones);
    for (const auto& agent : frame.agents) {
        if (agent.lead()) cv::drawStar(h, cv::starOf(agent), t, motion);
        else cv::drawPlanet(h, cv::planetOf(agent), t, motion);
    }
}
