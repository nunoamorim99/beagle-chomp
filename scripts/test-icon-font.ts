// OWNER: qa-test-engineer (IDEA-052)
//
// Does the shipped icon subset actually CONTAIN every glyph ICON names?
//
// This replaces a heuristic that has stopped working. tokens.css told you to
// verify a re-cut by FILE SIZE — "a real glyph adds a couple of hundred bytes,
// a name that does not exist adds about two dozen" — because Google's CSS
// endpoint answers 200 for a nonexistent icon_name either way. Measured
// 2026-09-09, that is no longer true: a bogus name now adds EXACTLY ZERO bytes,
// so the tell it depended on is gone. Worse, two real glyphs added only 68
// bytes between them, which under the old rule reads as "suspect".
//
// So this checks the thing itself instead of a proxy for it. The failure mode
// is what makes it worth a browser: an icon element carries its ligature name
// as its TEXT, so a missing glyph does not draw a blank — it prints the word.
// A button reads "arrow_back Menu". That is exactly what shipped once when a
// Google Fonts request was blocked, and it took the whole visual language with
// it.
//
// The measurement is unambiguous. At a 24px font a present glyph is one square
// icon, about 24px wide; a missing one renders its own name and runs to 300px.
// There is no grey area to tune a threshold against.
//
// NOT in `npm test` — it needs a browser, like every other Playwright suite
// here. Run it after re-cutting the subset:  npm run test:icon-font

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT = join(ROOT, "src/ui/fonts/material-symbols-rounded-subset.woff2");
const ICONS = join(ROOT, "src/ui/icons.ts");

/** Every value in ICON — which is also the complete list of glyphs the game can
 *  ask for, because nothing addresses this font any other way. Parsed from the
 *  source rather than imported: icons.ts is a DOM module, and this needs the
 *  names before a browser exists. */
function iconNames(): string[] {
  const src = readFileSync(ICONS, "utf-8");
  const start = src.indexOf("export const ICON");
  if (start === -1) throw new Error("could not find ICON in icons.ts");
  const block = src.slice(start, src.indexOf("} as const", start));
  const names = [...block.matchAll(/:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("no icon names parsed — did ICON's shape change?");
  return [...new Set(names)].sort();
}

const names = iconNames();
const b64 = readFileSync(FONT).toString("base64");

// The real .bc-i rule from tokens.css. The font-feature-settings line is the
// ligature machinery — without it every glyph renders as its own word.
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'MS';font-style:normal;font-weight:400 700;font-display:block;
  src:url(data:font/woff2;base64,${b64}) format("woff2");}
.bc-i{font-family:'MS';font-weight:normal;font-style:normal;line-height:1;
  letter-spacing:normal;text-transform:none;white-space:nowrap;word-wrap:normal;
  direction:ltr;display:inline-block;font-feature-settings:'liga';
  -webkit-font-feature-settings:'liga';font-size:24px;}
</style><body>${names
  .map((n, i) => `<i class="bc-i" data-i="${i}">${n}</i><br>`)
  .join("")}</body>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const widths: number[] = await page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>(".bc-i")].map((el) => el.offsetWidth),
);
await browser.close();

let failed = 0;
console.log(`Checking ${names.length} icon names against the shipped subset\n`);
for (let i = 0; i < names.length; i++) {
  const w = widths[i];
  const ok = w > 0 && w <= 40;
  if (!ok) failed++;
  if (!ok) {
    console.log(`  FAIL ${names[i].padEnd(30)} ${w}px — rendered as TEXT, not in the font`);
  }
}

// A CONTROL, so a pass cannot be vacuous. If the font failed to load at all,
// every name would render as text and the loop above would catch it — but if
// the measurement itself were broken (say offsetWidth always 0), everything
// would "pass". A name the family certainly does not have must FAIL.
const control = await (async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(
    html.replace("</body>", `<i class="bc-i" id="ctl">definitely_not_a_real_icon</i></body>`),
  );
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  const w = await p.locator("#ctl").evaluate((el) => (el as HTMLElement).offsetWidth);
  await b.close();
  return w;
})();

console.log(`\n  control  a name the family lacks: ${control}px (must be wide)`);
if (control <= 40) {
  console.log("  FAIL the control passed — this test cannot detect a missing glyph");
  failed++;
}

console.log(`\n${"-".repeat(60)}`);
console.log(
  failed === 0
    ? `ICON FONT: all ${names.length} glyphs present`
    : `ICON FONT: ${failed} problem(s) — re-cut the subset (recipe in src/ui/tokens.css)`,
);
process.exit(failed === 0 ? 0 : 1);
