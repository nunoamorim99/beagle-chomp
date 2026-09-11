// IDEA-064: measure the shop's perk line on a 390px phone.
//
//   npx tsx scripts/_scratch-perk-line-390.ts [baseUrl]
//
// The design system's rule is to MEASURE rather than look, and the Pac-Beagle's
// perk is the longest string in the panel ("Unlocks the Ghost enemy and the
// Arcade Night board") — it runs to three lines at 390 where the other four run
// to two. What matters is that it neither overflows the document nor collides
// with the action button beside it, and that the info block's height does not
// move between coats (a panel that changes height as you scroll the rail reads
// as a layout bug). Prints those four numbers per coat and leaves a screenshot.
//
// Needs the real stack — it signs up a throwaway account to reach the shop.
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:5173";
const name = `mp${Date.now().toString(36)}`.slice(0, 20);

async function main(): Promise<void> {

const b = await chromium.launch();
const page = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }).then(c => c.newPage());
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

for (const id of ["bagel", "cookie", "muffin", "pepper", "pacbeagle"]) {
  await page.click(`.shop-rail-card[data-card-id="${id}"]`);
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const perk = document.querySelector<HTMLElement>(".shop-hero-perk");
    const info = document.querySelector<HTMLElement>(".shop-hero-info");
    const action = document.querySelector<HTMLElement>(".shop-hero-action");
    const p = perk?.getBoundingClientRect();
    const i = info?.getBoundingClientRect();
    const a = action?.getBoundingClientRect();
    return {
      text: perk?.textContent?.trim().replace(/^bolt/, "") ?? "",
      perkRight: p ? Math.round(p.right) : -1,
      perkLines: p && perk ? Math.round(p.height / parseFloat(getComputedStyle(perk).lineHeight || "16")) : -1,
      infoBottom: i ? Math.round(i.bottom) : -1,
      actionLeft: a ? Math.round(a.left) : -1,
      perkOverlapsAction: !!(p && a && p.right > a.left && p.bottom > a.top && p.top < a.bottom),
      docScrollW: document.documentElement.scrollWidth,
    };
  });
  console.log(id.padEnd(10), JSON.stringify(m));
}
// Written where scratch output belongs rather than into the repo root — set
// BC_SHOT to put it somewhere you can actually open.
if (process.env.BC_SHOT) await page.screenshot({ path: process.env.BC_SHOT });
await b.close();

}
void main();
