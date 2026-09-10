import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = ".img2threejs/nigiri/renders/eyes";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
const shots: [string, string][] = [
  ["wide-normal", "model=nigiri&az=0&el=20&dist=1.9&fov=20"],
  ["wide-frightened", "model=nigiri&az=0&el=20&dist=1.9&fov=20&state=frightened"],
  ["play-normal", "model=nigiri&az=18&el=59&dist=1.9&fov=20"],
  ["play-frightened", "model=nigiri&az=18&el=59&dist=1.9&fov=20&state=frightened"],
];
for (const [name, qs] of shots) {
  await page.goto(`http://localhost:5173/preview-rework/?${qs}&grid=0&hud=0`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close();
console.log("wrote", out);
