// Headless smoke test on the demo feed (vendor/agentviz-kit/tests/harness.cjs):
// every fixture session is a star and every subagent a planet; the "needs you"
// chip cycles the waiting sessions; a tap on a waiting star opens its panel,
// which says why it waits; a stalled subagent's planet is labelled stalled; a
// subagent's own branch shows in its panel; a new tool call pulses; feed
// strings never become HTML; the empty state and the unreachable banner show;
// the frame is not flat; no console errors. Expected counts come from the feed.
//   npm ci && npx playwright install chromium && npm run smoke
const path = require("path");
const h = require("../vendor/agentviz-kit/tests/harness.cjs");

const REPO = path.resolve(__dirname, "..");
const PORT = Number(process.env.CONSTELLATION_TEST_PORT || 9120);
const READY = "window.__page && window.__page.polls > 0 && window.__constellation.stars.size > 0";

function check(cond, message) { if (!cond) throw new Error(message); }

const panelTitle = (page) => page.evaluate(() => {
  const panel = document.querySelector(".av-panel");
  return panel.hidden ? null : panel.querySelector("h2").textContent.trim();
});

async function checkScene(page) {
  const info = await page.evaluate(() => {
    const map = window.__constellation, doc = window.__page.doc;
    return {stars: map.stars.size, planets: map.planets.size, places: map.places.size,
      want: {stars: doc.sessions.length, planets: doc.sessions.reduce((n, s) => n + s.followers.length, 0),
        places: new Set(doc.sessions.map((s) => s.place)).size},
      waiting: doc.sessions.filter((s) => s.state === "waiting").map((s) => ({id: s.id, name: s.name, reason: s.waitingReason}))};
  });
  console.log("scene:", JSON.stringify(info));
  check(info.stars === info.want.stars && info.planets === info.want.planets && info.places === info.want.places,
    "the map does not hold every fixture session, subagent and place");
  check(info.waiting.length >= 2, "the fixture should have at least two sessions waiting");
  return info;
}

async function checkWaitingChip(page, waiting) {
  const chip = page.locator(".av-wait");
  check(await chip.isVisible(), "the needs-you chip is hidden");
  check((await chip.locator("b").textContent()) === String(waiting.length), "the needs-you chip miscounts");
  const seen = [];
  for (let i = 0; i < waiting.length; i++) { await chip.click(); seen.push(await panelTitle(page)); }
  console.log("needs-you chip cycles:", seen.join(" -> "));
  check(seen.slice().sort().join() === waiting.map((w) => w.name).sort().join(), "the chip did not cycle every waiting session");
  check(await page.locator(".av-panel .av-needs").isVisible(), "the panel does not say why it waits");
}

const REASON = {question: "has a question", permission: "needs permission"};

async function checkTapOnWaitingStar(page, target) {
  await page.evaluate(() => { window.__page.select(null); window.__page.fit(true); });
  await page.waitForTimeout(600);
  const hit = (await page.evaluate(() => window.__strataKit.targets())).find((t) => t.id === target.id);
  check(hit, "no tap target for the waiting star " + target.name);
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(400);
  const title = await panelTitle(page);
  const reason = await page.evaluate(() => document.querySelector(".av-panel .av-needs").textContent);
  console.log("tap on the waiting star:", title, "/", reason);
  check(title === target.name && reason === REASON[target.reason], "the tap did not open the waiting star's panel with its reason");
  const label = await page.evaluate((id) => [...document.querySelectorAll(".av-label.star.waiting")].map((l) => l.textContent), target.id);
  check(label.some((text) => text === target.name + " " + REASON[target.reason]), "the waiting star's label does not say why");
}

async function checkFollowers(page) {
  const found = await page.evaluate(() => {
    const doc = window.__page.doc, entries = doc.sessions.flatMap((s) => s.followers.map((f) => ({s, f})));
    const stalled = entries.find((e) => e.f.stalled), branched = entries.find((e) => e.f.branch && e.f.branch !== e.s.branch);
    return {stalled: stalled && stalled.f.label, branched: branched && {id: branched.s.id + "/" + branched.f.id, branch: branched.f.branch}};
  });
  check(found.stalled && found.branched, "the fixture should have a stalled subagent and one on its own branch");
  const stalledLabel = await page.waitForFunction((label) => [...document.querySelectorAll(".av-label.planet.stalled")]
    .some((l) => l.textContent === label), found.stalled, {timeout: 120000}).then(() => true, () => false);
  console.log("stalled planet label:", found.stalled, stalledLabel);
  check(stalledLabel, "the stalled subagent's planet is not labelled stalled");
  await page.evaluate((id) => window.__page.select(id, false), found.branched.id);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".av-panel dd")].map((d) => d.textContent));
  check(rows.includes(found.branched.branch), "the subagent panel does not show its own branch");
}

async function checkToolCallPulse(page) {
  const pulse = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    const busy = doc.sessions.find((s) => s.state === "busy" && s.lastToolAt != null);
    busy.lastToolAt += 1;
    window.__page.feed(doc);
    return window.__page.feedClient.pulse(busy.id);
  });
  check(pulse > 0, "a new tool call did not pulse");
}

async function checkTextOnly(page) {
  const result = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    const lead = doc.sessions.find((s) => s.followers.length);
    lead.followers[0].label = "<img src=x id=pwned>";
    window.__page.feed(doc);
    window.__page.select(lead.id, false);
    return {img: !!document.getElementById("pwned"),
      text: [...document.querySelectorAll(".av-panel .av-lanes button")].some((b) => b.textContent === "<img src=x id=pwned>")};
  });
  // World labels are placed after the next frame, which can be slow under SwiftShader.
  const labelText = await page.waitForFunction(() => [...document.querySelectorAll(".av-label.planet")]
    .some((l) => l.textContent === "<img src=x id=pwned>"), null, {timeout: 120000}).then(() => true, () => false);
  check(!result.img && result.text && labelText && !(await page.evaluate(() => !!document.getElementById("pwned"))),
    "a feed label was parsed as HTML");
}

async function checkEmptyState(page) {
  const shown = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    const sessions = doc.sessions;
    window.__page.feed(Object.assign(doc, {sessions: []}));
    const visible = !document.querySelector(".av-empty").hidden;
    window.__page.feed(Object.assign(doc, {sessions}));
    return visible && document.querySelector(".av-empty").hidden;
  });
  check(shown, "no empty-state hint with zero sessions");
}

async function checkUnreachable(page) {
  await page.route("**/api/agents*", (route) => route.fulfill({status: 503, body: "down"}));
  await page.evaluate(async () => { await window.__page.pollOnce(); await window.__page.pollOnce(); });
  const banner = await page.evaluate(() => !document.querySelector(".av-banner").hidden && document.querySelector(".av-banner").textContent);
  console.log("banner:", banner);
  check(banner && banner.includes("HTTP 503"), "no unreachable banner after failed polls");
}

h.run("smoke", {repo: REPO, port: PORT}, async ({server, browser}) => {
  const {page, errors} = await h.open(browser, server.base + "/?fixture=1", {ready: READY});
  await h.stillAnimations(page);
  await page.waitForFunction(() => window.__page.kit.stats().frames > 3, null, {timeout: 400000});
  await page.evaluate(() => window.__page.stopPolling());
  const info = await checkScene(page);
  await checkWaitingChip(page, info.waiting);
  await checkTapOnWaitingStar(page, info.waiting[0]);
  await checkFollowers(page);
  await checkToolCallPulse(page);
  await checkTextOnly(page);
  await checkEmptyState(page);
  await page.evaluate(() => { window.__page.select(null); window.__page.fit(true); });
  await page.mouse.move(2, 400);  // no hover ring in the saved frame
  await page.waitForTimeout(600);
  const png = await h.shot(page, path.join(REPO, "docs/media/screenshot.png"));
  console.log("distinct colours:", await h.assertNotFlat(page, png));
  h.assertNoErrors(errors);
  await checkUnreachable(page);  // last: the failed fetches log console errors of their own
});
