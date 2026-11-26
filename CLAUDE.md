# CLAUDE.md

agentviz-constellation: Claude Code sessions drawn as a star map (Strata web kit). Part of the
agentviz family: https://github.com/dmccoystephenson/agentviz

- Data comes only from `/api/agents` (vendor/agentfeed; schema in the agentviz repo's docs/FEED.md).
- Shared pieces come from the agentviz kit (docs/KIT.md there): `vendor/agentviz-kit/` and the
  `web/agentviz-*` copies. Never edit `vendor/` or `web/agentviz-*`; re-vendor from an agentviz
  checkout with `tools/vendor-kit.sh <this repo>`. `tests/test_serve.py` checks the PINs.
- Page: `web/constellation-model.js` lays out nebulae, stars and planets and eases them;
  `web/constellation-frame.js` packs each frame in the agentviz wire format; `web/page.js` boots
  the feed client, HUD, labels and camera; `web/index.html` holds the theme and the legend.
- Scene: `scene/main.cpp` decodes the wire (`agentviz.h`) and calls `sky.h`, `star.h`,
  `planet.h` (with `actions.h`, `draw_util.h`). The extras each record carries are listed at the
  top of `web/constellation-frame.js`; keep both sides in step. Build:
  `EMSDK=/path/to/emsdk vendor/agentviz-kit/scene/build-scene.sh scene/kit.conf`
  (emsdk 6.0.11, Strata 0.10.0). The built `web/constellation-engine.*` are committed.
- Run: `python3 -m vendor.agentfeed serve --web web --port 8847 [--fixture]`.
- Tests: `python3 -m unittest discover -s tests` (port 9121, `CONSTELLATION_UNIT_PORT`); browser
  tests after `npm ci` and `npx playwright install chromium`: `npm run smoke`,
  `npm run screenshots` (Pillow from requirements-dev.txt for the GIF), port 9120
  (`CONSTELLATION_TEST_PORT`).
- Screenshots come from the FIXTURE feed only, never live sessions.
