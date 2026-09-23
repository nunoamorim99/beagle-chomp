// Drives the REAL Journey map (IDEA-079) in a browser.
//
// It replaced `levelMap.ts`, a screen that took two revisions to get its
// BEHAVIOUR right — and none of that was about how it looked. This suite
// exists to carry those rules forward, plus one bug the rewrite introduced:
//
//   * a LOCKED stone is still SELECTABLE (IDEA-063 v2). Tapping one fills the
//     card; only Play refuses, and it names the stone that unlocks it. A new
//     player has 39 padlocks and this screen's whole job is showing what the
//     game contains.
//   * the default selection is the CURRENT level.
//   * **PLAY ACTUALLY STARTS A RUN.** It did not: the camera rig listened on
//     `document.body`, so pressing Play fired its `onTap` on `pointerup`,
//     which dismissed the card and cleared the selection, and the button's
//     `click` — which runs afterwards — found nothing selected and returned.
//     The button was completely dead and nothing errored.
//
// Run: npm run test:journey-map-ui   (needs the dev server AND the API)

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}
/** A page probe returns a bag of primitives. Playwright types a string-source
 *  `evaluate` as `unknown` — correctly — so this is where that is named, once,
 *  rather than at a dozen call sites. */
type Probe = Record<string, string | number | boolean | null | undefined>;


const uniq = (): string => `jm${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`.slice(0, 20);

async function signUp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  await page.fill("#signupUsername", uniq());
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  const skip = await page.$("#tutorialSkip, #tutorialDone, .tut-skip");
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(600);
}

const browser = await chromium.launch();
// reducedMotion because the menu's Play card bobs, and Playwright will not
// click an element whose bounding box never settles.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await signUp(page);

section("The map opens on the level you are on");
await page.click("#journeyBtn");
await page.waitForSelector(".jp-item.is-visible", { timeout: 30_000 });
await page.waitForTimeout(1500);
{
  const s = (await page.evaluate(`(() => {
    const pins = [...document.querySelectorAll(".jp-item")];
    return {
      total: pins.length,
      visible: pins.filter((p) => p.classList.contains("is-visible")).length,
      current: pins.filter((p) => p.classList.contains("is-current")).length,
      currentVisible: pins.some((p) => p.classList.contains("is-current") && p.classList.contains("is-visible")),
      header: !!document.querySelector(".map-header"),
      islands: document.getElementById("levelMap").classList.contains("map--islands"),
      chrome: document.body.classList.contains("map-open"),
    };
  })()`)) as {
    total: number; visible: number; current: number; currentVisible: boolean;
    header: boolean; islands: boolean; chrome: boolean;
  };
  ok("every level has a pin", s.total === 40, `${s.total}`);
  // Bounded at BOTH ends: "some are visible" passes on all forty piled up,
  // which is the state the depth cull exists to prevent.
  ok("…and only a handful are on screen", s.visible > 1 && s.visible < 15, `${s.visible}`);
  ok("exactly one level is current", s.current === 1, `${s.current}`);
  ok("…and it is in frame when the map opens", s.currentVisible);
  ok("the header is up", s.header);
  ok("…the island variant is applied", s.islands);
  ok("…and menu chrome is hidden", s.chrome);
}

section("A locked stone is SELECTABLE; only Play refuses");
{
  const locked = page.locator(".jp-item.is-locked.is-visible .jp-pin").first();
  ok("a locked pin is on screen to tap", (await locked.count()) > 0);
  await locked.click();
  await page.waitForTimeout(600);
  const s = (await page.evaluate(`(() => {
    const btn = document.getElementById("mapPlayBtn");
    const pin = document.querySelector(".jp-item.is-locked.is-selected .jp-pin");
    return {
      open: document.getElementById("mapCard").classList.contains("is-open"),
      title: document.getElementById("mapCardTitle").textContent,
      sub: document.getElementById("mapCardSub").textContent,
      play: btn.textContent.trim(),
      disabled: btn.disabled,
      ariaDisabled: pin ? pin.getAttribute("aria-disabled") : "no selected locked pin",
      tabindex: pin ? pin.getAttribute("tabindex") : "-",
      label: pin ? pin.getAttribute("aria-label") : "-",
    };
  })()`)) as Probe;
  ok("tapping it opens the card", s.open === true);
  ok("…with the level's name", typeof s.title === "string" && s.title.length > 2, String(s.title));
  ok("…and its theme", typeof s.sub === "string" && s.sub.includes("·"), String(s.sub));
  ok("Play refuses", s.disabled === true);
  ok("…and says which stone unlocks it", /Clear stone \d+ first/.test(String(s.play)), String(s.play));
  // It is a control that DOES something, so it must not be inert.
  ok("the pin is not aria-disabled", s.ariaDisabled === null, String(s.ariaDisabled));
  ok("…and is still reachable by keyboard", s.tabindex !== "-1", String(s.tabindex));
  ok("…and announces that it is locked", /locked/i.test(String(s.label)), String(s.label));
}

section("Play starts the run — the bug that shipped dead");
{
  // Dismiss the locked card first: it is a bottom sheet and it covers the
  // lower part of the map, so a pin behind it cannot be tapped. Tapping the
  // water is the way out a player has, and it exercises the rig's tap/drag
  // split at the same time.
  await page.mouse.click(200, 300);
  await page.waitForTimeout(500);
  ok(
    "tapping the water dismisses the card",
    (await page.evaluate(`document.getElementById("mapCard").classList.contains("is-open")`)) === false,
  );

  await page.click(".jp-item.is-current .jp-pin");
  await page.waitForTimeout(600);
  const armed = (await page.evaluate(`(() => {
    const btn = document.getElementById("mapPlayBtn");
    return { play: btn.textContent.trim(), disabled: btn.disabled };
  })()`)) as Probe;
  ok("the current level arms Play", armed.disabled === false, String(armed.play));

  await page.click("#mapPlayBtn");
  await page.waitForTimeout(2500);
  const s = (await page.evaluate(`(() => ({
    mapHidden: document.getElementById("levelMap").classList.contains("hidden"),
    menuHidden: document.getElementById("mainMenu").classList.contains("hidden"),
    chrome: document.body.classList.contains("map-open"),
    mode: window.__game ? window.__game.mode : "?",
  }))()`)) as Probe;
  ok("the map closes", s.mapHidden === true);
  ok("…the menu goes with it", s.menuHidden === true);
  ok("…menu chrome is restored", s.chrome === false);
  // The whole point: a run is actually running.
  ok("…and a run has started", s.mode !== "start", `mode "${s.mode}"`);
}

section("Back returns to the menu");
{
  // THE HOW-TO-PLAY CAROUSEL OPENS OVER THE FIRST RUN, and `body.tutorial-open`
  // sets `.hud{display:none}` — so #homeBtn is in the DOM, enabled, and never
  // becomes visible. Dismiss it the way a player does. test-progression-ui.ts
  // and test-challenges-ui.ts both carry this same note; this is the third
  // suite it has caught.
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 15_000 }).catch(() => {});
  const tut = await page.$(".tut-skip");
  if (tut) {
    await tut.click();
    await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10_000 });
  }
  await page.waitForTimeout(1_200);
  await page.click("#homeBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  await page.click("#journeyBtn");
  await page.waitForSelector(".jp-item.is-visible", { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.click("#mapBackBtn");
  await page.waitForTimeout(800);
  const s = (await page.evaluate(`(() => ({
    mapHidden: document.getElementById("levelMap").classList.contains("hidden"),
    menuVisible: !document.getElementById("mainMenu").classList.contains("hidden"),
    chrome: document.body.classList.contains("map-open"),
  }))()`)) as Probe;
  ok("the map closes", s.mapHidden === true);
  ok("…the menu is back", s.menuVisible === true);
  ok("…and so is its chrome", s.chrome === false);
}

section("Dragging pans the map");
{
  await page.click("#journeyBtn");
  await page.waitForSelector(".jp-item.is-visible", { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const y = async () =>
    page.evaluate(`document.querySelector(".jp-item.is-visible")?.style.getPropertyValue("--y") ?? ""`);
  const before = await y();
  await page.mouse.move(200, 520);
  await page.mouse.down();
  await page.mouse.move(200, 360, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await y();
  // A frozen frame also produces "no movement", so this doubles as proof the
  // render loop is still being driven — the branch that renders this screen
  // has to reschedule its own frame and a version of it did not.
  ok("a drag moves the pins", before !== after, `${before} -> ${after}`);
}

ok("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

console.log("\n" + "-".repeat(60));
console.log(`JOURNEY MAP UI: ${passed} passed, ${failed} failed`);
await browser.close();
if (failed > 0) process.exit(1);
