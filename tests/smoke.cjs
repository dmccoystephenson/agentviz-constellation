// Headless smoke test: serve the fixture, load /?fixture=1, wait for the kit
// to draw, check the frame is not flat, a tap on a star selects it and opens
// the panel, and nothing errs; save docs/media/screenshot.png.
//   NODE_PATH=/root/arcade-watch/node_modules node tests/smoke.cjs
const path = require("path");
const {ROOT, startServer, open, launch} = require("./harness.cjs");

(async () => {
  const server = await startServer();
  const browser = await launch();
  let failed = false;
  const fail = (m) => { console.error("FAIL:", m); failed = true; };
  try {
    const {page, errors} = await open(browser);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => window.__strataKit.stats());
    if (st.points < 100) fail(`too few points drawn: ${st.points}`);
    if (st.primitives < 5) fail(`too few planets drawn: ${st.primitives}`);
    const stars = await page.evaluate(() => window.__constellation.stars());
    if (stars.length !== 8) fail(`expected 8 stars, got ${stars.length}`);
    // Not one flat colour.
    const shot = await page.screenshot({path: path.join(ROOT, "docs/media/screenshot.png"), timeout: 120000});
    const flat = await page.evaluate(() => {
      const c = document.getElementById("view"), g = c.getContext("webgl2");
      const w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 120) lit++;
      return lit;
    });
    if (flat < 200) fail(`frame looks empty (${flat} lit pixels)`);
    // The waiting beacon chip is up.
    const beacon = await page.textContent("#beacons");
    if (!/Thistle needs you/.test(beacon || "")) fail(`no waiting beacon: ${beacon}`);
    // Tap the waiting star: it selects, and the panel shows its name.
    const targets = await page.evaluate(() => window.__strataKit.targets());
    const t = targets.find((x) => x.id === "demo-waiting");
    if (!t) fail("no tap target for the waiting star");
    else {
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(400);
      const panel = await page.textContent("#panel");
      if (!/Thistle/.test(panel || "") || !/Needs you/.test(panel || "")) fail(`panel after tap: ${panel}`);
    }
    if (errors.length) fail("console errors: " + errors.join(" | "));
    console.log(failed ? "smoke: FAIL" : `smoke: OK (${st.points} points, ${st.primitives} primitives, ${st.lines} lines, ${shot.length} B png)`);
  } catch (e) {
    fail(e.stack || String(e));
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
