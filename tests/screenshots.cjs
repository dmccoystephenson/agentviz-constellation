// Regenerates every README image in docs/media/ from the FIXTURE feed:
//   NODE_PATH=/root/arcade-watch/node_modules node tests/screenshots.cjs
// The GIF is assembled with Pillow (python3 -m pip install pillow) from frames
// drawn at fixed scene times (?drive=1), so it repeats run to run.
const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");
const {ROOT, startServer, open, launch} = require("./harness.cjs");

const MEDIA = path.join(ROOT, "docs/media");
const shot = (page, name) => page.screenshot({path: path.join(MEDIA, name), timeout: 120000});

async function look(page, cam, settleMs = 2200) {
  await page.evaluate((c) => window.__constellation.look(c), cam);
  await page.waitForTimeout(settleMs);
}
async function starCam(page, id, extra) {
  const s = (await page.evaluate(() => window.__constellation.stars())).find((x) => x.id === id);
  return Object.assign({tx: s.x, ty: s.y, tz: s.z}, extra);
}
async function placeCam(page, id, extra) {
  const p = (await page.evaluate(() => window.__constellation.places())).find((x) => x.id === id);
  return Object.assign({tx: p.x, ty: p.y, tz: p.z}, extra);
}

(async () => {
  fs.mkdirSync(MEDIA, {recursive: true});
  const server = await startServer();
  const browser = await launch();
  try {
    // Desktop shots, 1600 x 900.
    {
      const {page, ctx} = await open(browser, {viewport: {width: 1600, height: 900}});
      await page.waitForTimeout(3000);
      const e = await page.evaluate(() => window.__constellation.extent());
      const whole = {tx: e.c[0], ty: 0, tz: e.c[2]};
      await look(page, Object.assign({yaw: 0.6, pitch: 0.62, dist: e.r * 1.5}, whole));
      await shot(page, "hero.png");
      await look(page, Object.assign({yaw: 0.6, pitch: 1.45, dist: e.r * 2.1}, whole));
      await shot(page, "angle-top.png");
      await look(page, Object.assign({yaw: 2.4, pitch: 0.16, dist: e.r * 1.7}, whole));
      await shot(page, "angle-low.png");
      await look(page, await starCam(page, "demo-lead-b", {yaw: 0.9, pitch: 0.5, dist: 19}));
      await shot(page, "closeup-lead.png");
      await look(page, await starCam(page, "demo-lead-a", {yaw: 1.9, pitch: 0.55, dist: 17}));
      await shot(page, "closeup-delegate-resting.png");
      await look(page, await starCam(page, "demo-waiting", {yaw: 0.5, pitch: 0.45, dist: 24}));
      await shot(page, "closeup-waiting.png");
      await look(page, await placeCam(page, "~", {yaw: 0.8, pitch: 0.5, dist: 20}));
      await shot(page, "closeup-idle-offline.png");
      await look(page, await placeCam(page, "engine", {yaw: 0.8, pitch: 0.4, dist: 16}));
      await shot(page, "closeup-edit-stalled.png");
      // The panel, with a lead selected (the camera flies to it).
      await page.evaluate(() => window.__constellation.select("demo-lead-a"));
      await page.waitForTimeout(3500);
      await shot(page, "panel-desktop.png");
      await ctx.close();
    }
    // Phone portrait, 390 x 844 at DPR 3, bottom sheet open.
    {
      const {page, ctx} = await open(browser, {viewport: {width: 390, height: 844}, dpr: 3, mobile: true});
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.__constellation.select("demo-lead-b"));
      await page.waitForTimeout(3500);
      await shot(page, "phone-sheet.png");
      await page.evaluate(() => window.__constellation.select(null));
      const e = await page.evaluate(() => window.__constellation.extent());
      await look(page, {yaw: 0.6, pitch: 0.9, dist: e.r * 3.2, tx: e.c[0], ty: 0, tz: e.c[2]});
      await shot(page, "phone-map.png");
      await ctx.close();
    }
    // The GIF: fixed scene times, 12 fps for 5 s, on Otto's busy system and
    // the waiting star beside it.
    {
      const {page, ctx} = await open(browser, {viewport: {width: 720, height: 432}, query: "&drive=1"});
      for (let i = 0; i <= 60; i++) await page.evaluate((t) => window.__strataKit.drive(t), i * 0.1);
      const st = (await page.evaluate(() => window.__constellation.stars()));
      const otto = st.find((x) => x.id === "demo-lead-b");
      await page.evaluate((c) => window.__constellation.look(c), {tx: otto.x, ty: otto.y, tz: otto.z, yaw: 0.9, pitch: 0.55, dist: 18});
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "constellation-gif-"));
      const frames = [];
      for (let i = 0; i < 60; i++) {
        await page.evaluate((t) => window.__strataKit.drive(t), 6 + i / 12);
        const f = path.join(dir, `f${String(i).padStart(3, "0")}.png`);
        await page.screenshot({path: f, timeout: 120000});
        frames.push(f);
      }
      execFileSync("python3", ["-I", "-c", `
import sys
from PIL import Image
frames = [Image.open(p).convert("RGB").quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE) for p in sys.argv[2:]]
frames[0].save(sys.argv[1], save_all=True, append_images=frames[1:], duration=83, loop=0, optimize=True)
`, path.join(MEDIA, "motion.gif"), ...frames]);
      fs.rmSync(dir, {recursive: true, force: true});
      await ctx.close();
    }
    console.log("screenshots: wrote", fs.readdirSync(MEDIA).join(", "));
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
