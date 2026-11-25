# CLAUDE.md

agentviz-constellation: Claude Code sessions as a star map, drawn with the
Strata 0.10.0 web kit. One of the agentviz family
(https://github.com/dmccoystephenson/agentviz). PRIVATE repo.

- Data comes ONLY from `/api/agents` (schema: the agentviz repo's docs/FEED.md),
  served by the vendored `vendor/agentfeed/`. Never edit the vendored copy:
  re-vendor with agentviz's `tools/vendor-feed.sh`.
- `web/constellation.js` owns layout, easing and picking and writes float rows
  every frame; `scene/main.cpp` only draws them. Row layouts (PLACE/STAR/PLANET
  strides) must match in both files.
- Build: `scene/build.sh` (emsdk 6.0.11; outputs committed in `web/`).
- Run: `python3 -m vendor.agentfeed serve --web web --port 8847 [--fixture]`.
- Tests: `python3 -m unittest discover -s tests`; browser smoke
  `node tests/smoke.cjs`; README images `node tests/screenshots.cjs`
  (NODE_PATH to a node_modules with Playwright). Test port 8947.
- Screenshots come from the FIXTURE feed only, never a live feed.
- Hosted Actions are refused on this private repo: run localci on PRs.
