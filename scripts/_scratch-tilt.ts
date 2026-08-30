// Scratch diagnostic (delete before commit): tilted anchor across one full
// spinDecor revolution, to show whether a baked lean reads as a lean.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 500 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://localhost:5173/preview/_scratch-anchor.html", { waitUntil: "networkidle" });
try {
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 15_000 });
} catch {
  console.log("page never signalled ready");
}
const target = page.locator("#wrap2");
if (await target.count()) {
  await target.screenshot({ path: ".tmp-screens/anchor-tilt-demo.png" });
  console.log("→ .tmp-screens/anchor-tilt-demo.png");
} else {
  console.log("no #wrap2 on the page");
}
await browser.close();
for (const e of errors) console.log(`  ${e}`);
