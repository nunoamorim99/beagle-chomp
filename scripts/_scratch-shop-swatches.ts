// IDEA-064 v2: photograph the shop rail's swatches on all three tabs.
//
//   BC_SHOT=<path.png> npx tsx scripts/_scratch-shop-swatches.ts [baseUrl]
//
// The swatch is the only thing on a card that is not text, and it is ~48px
// tall. The project's rule for anything that small is to look at it at its real
// size rather than reason about the geometry — the paw's toes are single-digit
// pixels across at the phone layout.
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:5173";
const SHOT = process.env.BC_SHOT ?? "";
const name = `sw${Date.now().toString(36)}`.slice(0, 20);

async function main(): Promise<void> {
  const b = await chromium.launch();
  // BC_W/BC_H so the same script can shoot the desktop side panel and the
  // 390px phone rail — the swatch is 56px on one and 48 on the other, and the
  // project's rule is to look at a small thing at its real size.
  const page = await b
    .newContext({
      viewport: {
        width: Number(process.env.BC_W ?? 1280),
        height: Number(process.env.BC_H ?? 900),
      },
      reducedMotion: "reduce",
    })
    .then((c) => c.newPage());
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#signupForm");
  await page.fill("#signupUsername", name);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20000 });
  await page.click("#menuShopBtn");
  await page.waitForSelector("#shop:not(.hidden)");

  for (const tab of ["beagle", "enemy", "theme"] as const) {
    await page.click(`.shop-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(250);
    const rail = await page.$("#shopRail");
    if (rail && SHOT) {
      await rail.screenshot({ path: SHOT.replace(".png", `-${tab}.png`) });
      // The rail scrolls, and element.screenshot only captures the visible box
      // — the enemies tab has eleven cards and shows six. The second shot is
      // the rest of them, which is where the food and the secret one live.
      await page.$eval("#shopRail", (el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(250);
      await rail.screenshot({ path: SHOT.replace(".png", `-${tab}-end.png`) });
      await page.$eval("#shopRail", (el) => el.scrollTo(0, 0));
    }
    const names = await page.$$eval(".shop-rail-card-name", (e) => e.map((x) => x.textContent));
    console.log(tab.padEnd(7), names.join(" | "));
  }
  await b.close();
}
void main();
