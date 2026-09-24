// Does the game LOOP actually advance under each style? A screenshot that says
// "Ready!" proves nothing on its own — it is also what a frozen frame looks
// like, which is the single most important thing to rule out before blaming
// anything downstream.
import { chromium } from "playwright";

const b = await chromium.launch();
for (const style of ["classic", "madbox"] as const) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", style, e.message));
  await page.goto(`http://localhost:5173/?style=${style}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 60000 });
  const user = `run${Date.now().toString(36)}${style[0]}`.slice(0, 20);
  await page.fill("#signupUsername", user);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 40000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 40000 });
  await page.click("#playBtn");
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 20000 }).catch(() => {});
  const t = await page.$(".tut-skip");
  if (t) { await t.click(); await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10000 }); }

  const sample = async () => page.evaluate(`(() => {
    const g = window.__game;
    return { mode: g?.mode ?? "?", ready: !document.getElementById("center")?.classList.contains("hidden"),
             x: +(g?.beagle?.x ?? -1).toFixed(2), score: document.getElementById("score")?.textContent };
  })()`);
  const a = await sample();
  // THE RUN WAITS FOR THE FIRST INPUT — `mode: "ready"` is not a frozen frame,
  // it is the game holding until the player commits to a direction. Both
  // styles sat there identically, which is how I know it is the game and not
  // the restyle.
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(5000);
  const c = await sample();
  console.log(style.padEnd(8), "t0", JSON.stringify(a), " t+4s", JSON.stringify(c));
  await page.screenshot({ path: `.tmp-screens/run-${style}.png` });
  await ctx.close();
}
await b.close();
