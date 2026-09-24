// The profile's art-style switch, end to end: it must RELOAD and come back in
// the other style, and the buttons must reflect what is actually on.
import { chromium } from "playwright";
import { signIn } from "./_scratch-auth.js";

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await signIn(page, "http://localhost:5173/?style=classic");

const state = async () =>
  page.evaluate(`(() => {
    const on = document.getElementById("styleNew");
    const off = document.getElementById("styleClassic");
    return {
      present: !!on && !!off,
      newActive: on ? on.classList.contains("is-active") : null,
      classicActive: off ? off.classList.contains("is-active") : null,
      note: document.querySelectorAll(".profile-setting .control-note")[1]?.textContent?.trim().slice(0, 48),
    };
  })()`);

await page.click("#menuProfileBtn");
await page.waitForSelector("#profile:not(.hidden)", { timeout: 20_000 });
await page.waitForTimeout(500);
console.log("classic session:", JSON.stringify(await state()));
await page.screenshot({ path: ".tmp-screens/profile-style.png" });

await page.click("#styleNew");
await page.waitForTimeout(1200);
await signIn(page, page.url());
await page.click("#menuProfileBtn");
await page.waitForSelector("#profile:not(.hidden)", { timeout: 20_000 });
await page.waitForTimeout(500);
console.log("after switching: ", JSON.stringify(await state()));
console.log("url:            ", page.url());
await b.close();
