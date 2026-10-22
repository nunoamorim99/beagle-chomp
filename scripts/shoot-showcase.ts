// Screenshots /preview-showcase/ — the menu vignette and the shop stages, per
// theme, without the auth gate the real app puts in front of them.
//
//   npm run dev
//   npx tsx scripts/shoot-showcase.ts [label] [baseUrl]
//
// Writes .img2threejs/showcase/renders/<label>/<stage>-<theme>-<framing>.png.
// Env knobs: STAGES=menu,shop,theme  THEMES=garden,forest,...  FRAMINGS=phone,desktop
//            T=<seconds of idle animation before the shot>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const baseUrl = process.argv[3] ?? "http://localhost:5173";
const OUT = `.img2threejs/showcase/renders/${label}`;
mkdirSync(OUT, { recursive: true });

const stages = (process.env.STAGES ?? "menu,shop,theme").split(",");
const themes = (process.env.THEMES ?? "garden,forest,beach,park,city,classic").split(",");
const ALL_FRAMINGS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const framings = (process.env.FRAMINGS ?? "phone,desktop").split(",") as Array<keyof typeof ALL_FRAMINGS>;
const t = process.env.T ?? "2";

const browser = await chromium.launch();
const errors: string[] = [];
for (const framing of framings) {
  const page = await browser.newPage({ viewport: ALL_FRAMINGS[framing], deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${framing}: ${e}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${framing}: ${m.text()}`);
  });
  // ONE navigation per framing; every stage x theme after it is switched
  // in-page, since a reload costs ~40s across the Windows bind mount.
  // Past Playwright's 30s default for that first load (shoot-board.ts's note).
  const extra = process.env.CLOSE === "1" ? "&close=1" : "";
  await page.goto(`${baseUrl}/preview-showcase/?stage=${stages[0]}&theme=${themes[0]}&t=${t}${extra}`, {
    waitUntil: "load",
    timeout: 180_000,
  });
  await page.waitForFunction(() => (window as unknown as { __showcase?: { ready: boolean } }).__showcase?.ready, null, {
    timeout: 180_000,
  });
  for (const stage of stages) {
    for (const theme of themes) {
      await page.evaluate(
        ([s, th]) => (window as unknown as { __showcase: { stage(a: string, b: string): void } }).__showcase.stage(s, th),
        [stage, theme] as const,
      );
      await page.waitForTimeout(500);
      const file = `${OUT}/${stage}-${theme}-${framing}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
