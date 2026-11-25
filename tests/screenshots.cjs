// Regenerates every README image in docs/media/ from the DEMO feed (never live):
//   npm run screenshots [-- name ...]
// Stills are drawn with ?drive=1 (the kit draws one frame on demand), so they
// repeat. The GIF steps scene time frame by frame on Otto's system, feeding
// it new tool calls so the per-call rings show, and is encoded with Pillow
// (tests/make_gif.py).
const {execFileSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const h = require("../vendor/agentviz-kit/tests/harness.cjs");
const screens = require("../vendor/agentviz-kit/tests/screens.cjs");

const REPO = path.resolve(__dirname, "..");
const MEDIA = path.join(REPO, "docs/media");
const PORT = Number(process.env.CONSTELLATION_TEST_PORT || 9120);
const READY = "window.__page && window.__page.polls > 0 && window.__constellation.stars.size > 0";
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const DESKTOP = {viewport: {width: 1600, height: 900}};
const PHONE = {viewport: {width: 390, height: 844}, dpr: 3, mobile: true};

// Camera helpers run in the page: frame the whole map, a star or a place.
const HELPERS = `
window.__shots = {
  settle(seconds) { const m = window.__constellation; for (let i = 0; i < seconds * 10; i++) m.step((m.lastT || 0) + 0.1); },
  fit(c) { window.__page.fit(true); Object.assign(window.__page.kit.cam, c || {}); },
  cam(c) { window.__page.look(c); },
  at(thing, c) { this.cam(Object.assign({tx: thing.x, ty: thing.y, tz: thing.z}, c)); },
  star(id, c) { this.at(window.__constellation.find(id), c); },
  place(id, c) { this.at(window.__constellation.places.get(id), c); },
  draw() { window.__page.kit.drive(window.__constellation.lastT || 0); },
};`;

async function openPage(browser, server, options) {
  const opened = await h.open(browser, `${server.base}/?fixture=1&drive=1`, Object.assign({ready: READY}, options));
  await h.stillAnimations(opened.page);
  await opened.page.evaluate(() => window.__page.stopPolling());
  await opened.page.evaluate(HELPERS);
  await opened.page.evaluate(() => window.__shots.settle(8));
  return opened;
}

async function shoot(page, name, setup) {
  if (!want(name)) return;
  await page.evaluate(setup);
  await screens.still(page, path.join(MEDIA, name + ".png"), () => window.__shots.draw());
}

const DESKTOP_SHOTS = [
  ["hero", "window.__page.select(null); window.__shots.fit()"],
  ["angle-top", "window.__shots.fit(); window.__shots.cam({pitch: 1.45, dist: window.__page.kit.cam.dist * 1.35})"],
  ["angle-low", "window.__shots.fit(); window.__shots.cam({yaw: 2.4, pitch: 0.16, dist: window.__page.kit.cam.dist * 1.1})"],
  ["closeup-lead", "window.__shots.star('demo-lead-b', {yaw: 0.9, pitch: 0.5, dist: 21})"],
  ["closeup-delegate-resting", "window.__shots.star('demo-lead-a', {yaw: 1.9, pitch: 0.55, dist: 18})"],
  ["closeup-waiting", "window.__shots.star('demo-waiting', {yaw: 0.5, pitch: 0.45, dist: 24})"],
  ["closeup-question", "window.__shots.star('demo-asker', {ty: window.__constellation.find('demo-asker').y + 2.5, yaw: 0.3, pitch: 0.25, dist: 15})"],
  ["closeup-stalled", "window.__shots.star('demo-stalled', {yaw: 0.8, pitch: 0.4, dist: 12})"],
  ["closeup-idle-offline", "window.__shots.place('~', {yaw: 0.8, pitch: 0.5, dist: 22})"],
  ["closeup-engine", "window.__shots.place('engine', {yaw: 0.8, pitch: 0.45, dist: 20})"],
  ["closeup-read-web", "window.__shots.place('docs', {yaw: 0.6, pitch: 0.35, dist: 26})"],
  ["panel-desktop", "window.__page.select('demo-lead-b', false); window.__shots.star('demo-lead-b', {yaw: 0.9, pitch: 0.55, dist: 30})"],
  ["panel-subagent", "window.__page.select('demo-lead-b/demo-b6', false); window.__shots.star('demo-lead-b', {yaw: 0.9, pitch: 0.55, dist: 26})"],
];

async function desktopStills(browser, server) {
  const {ctx, page, errors} = await openPage(browser, server, DESKTOP);
  for (const [name, setup] of DESKTOP_SHOTS) await shoot(page, name, setup);
  h.assertNoErrors(errors);
  await ctx.close();
}

async function phoneStills(browser, server) {
  if (!want("phone-sheet") && !want("phone-map")) return;
  const {ctx, page, errors} = await openPage(browser, server, PHONE);
  await shoot(page, "phone-sheet", "window.__page.select('demo-lead-b', false); window.__shots.star('demo-lead-b', {yaw: 0.9, pitch: 0.75, dist: 30})");
  await shoot(page, "phone-map", "window.__page.select(null); window.__shots.fit()");
  h.assertNoErrors(errors);
  await ctx.close();
}

// The GIF: Otto's system for five seconds at 12 fps, a new tool call every
// 20 frames (Otto, then two of its subagents), so the per-call rings show.
async function motionGif(browser, server) {
  if (!want("motion")) return;
  const {ctx, page, errors} = await openPage(browser, server, {viewport: {width: 720, height: 432}});
  await page.evaluate(() => {
    window.__toolCall = (k) => {
      const doc = JSON.parse(JSON.stringify(window.__page.doc));
      const otto = doc.sessions.find((s) => s.id === "demo-lead-b");
      if (k % 3 === 0) otto.lastToolAt += 1;
      else otto.followers[k % 3 === 1 ? 0 : 2].toolCount += 1;
      window.__page.feed(doc);
    };
    window.__shots.star("demo-lead-b", {yaw: 0.9, pitch: 0.55, dist: 18});
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "constellation-gif-"));
  const FPS = 12;
  await screens.frames(page, tmp, FPS * 5, (i) => {
    const m = window.__constellation;
    m.step((m.lastT || 0) + 1 / 12);
    if (i % 20 === 4) window.__toolCall(Math.floor(i / 20));
    window.__shots.draw();
  });
  // Per-frame palettes: the kit's shared one greys out the effects (tests/make_gif.py).
  execFileSync("python3", [path.join(__dirname, "make_gif.py"), tmp, path.join(MEDIA, "motion.gif"), String(FPS)], {stdio: "inherit"});
  fs.rmSync(tmp, {recursive: true, force: true});
  h.assertNoErrors(errors);
  await ctx.close();
}

h.run("screenshots", {repo: REPO, port: PORT}, async ({server, browser}) => {
  fs.mkdirSync(MEDIA, {recursive: true});
  await desktopStills(browser, server);
  await phoneStills(browser, server);
  await motionGif(browser, server);
});
