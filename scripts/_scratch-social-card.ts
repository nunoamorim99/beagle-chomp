// Renders the README / link-preview card from an HTML composition.
//   npx tsx scripts/_scratch-social-card.ts <card.html> <outDir>
import { chromium } from "playwright";
const [html, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
for (const [w, h, name] of [[1280, 640, "social-preview.png"], [1200, 630, "og-image.png"]] as const) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto("file:///" + html);
  await p.addStyleTag({ content: `:root{--w:${w}px;--h:${h}px}` });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  await p.locator("#c").screenshot({ path: `${out}/${name}` });
  await p.close();
}
await b.close();
