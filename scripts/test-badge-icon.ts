// OWNER: qa-test-engineer (IDEA-052b)
//
// Is the notification badge actually a SILHOUETTE?
//
// `Notification.badge` is the small mark Android puts in the status bar beside
// the clock, and it is not a small app icon: Android uses ONLY THE ALPHA
// CHANNEL and paints the result white. So a normal, edge-to-edge opaque icon
// renders as a SOLID WHITE RECTANGLE — which is what shipped in the first cut
// of push here, and what it looked like on a real phone.
//
// Nothing about that is visible in code review, in a file listing, or in an
// image viewer with a white background. It needs the alpha channel read.
//
// Decoding is done by the BROWSER rather than by hand: a first attempt at
// parsing the PNG in Node forgot to undo the per-row filters and reported 0%
// opaque on a perfectly good file. drawImage + getImageData cannot get that
// wrong.

import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BADGE = join(ROOT, "public/icons/badge-96.png");

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

if (!existsSync(BADGE)) {
  console.log(`  FAIL public/icons/badge-96.png is missing — run: npm run make:badge`);
  process.exit(1);
}

const dataUri = `data:image/png;base64,${readFileSync(BADGE).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const stats = await page.evaluate(async (uri) => {
  const img = new Image();
  img.src = uri;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let clear = 0;
  let solid = 0;
  let edge = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a === 0) clear++;
    else if (a === 255) solid++;
    else edge++;
  }
  return { w: img.width, h: img.height, total: c.width * c.height, clear, solid, edge };
}, dataUri);
await browser.close();

console.log(`\nBadge: ${stats.w}x${stats.h}`);

ok("it is square", stats.w === stats.h, `${stats.w}x${stats.h}`);
// Android renders the badge around 18-24dp; below 48px it is mush on a dense
// screen, and above ~192 is pointless weight.
ok("…and a sensible size", stats.w >= 48 && stats.w <= 192, `${stats.w}px`);

const clearPct = (stats.clear / stats.total) * 100;
const solidPct = (stats.solid / stats.total) * 100;
console.log(`  clear ${clearPct.toFixed(0)}% · solid ${solidPct.toFixed(0)}% · edge ${stats.edge}px`);

// THE CHECK THIS FILE EXISTS FOR. A mostly-opaque badge is the white rectangle.
ok(
  "most of it is TRANSPARENT — not a white rectangle",
  clearPct > 40,
  `${clearPct.toFixed(0)}% clear`,
);

// …and the other direction: an entirely transparent image would "pass" the
// check above while showing nothing at all in the status bar.
ok("…but there is a real shape in it", solidPct > 5, `${solidPct.toFixed(0)}% solid`);

// Anti-aliased edges mean a drawn shape rather than a hard-edged rectangle.
ok("…with soft edges, so it is a glyph and not a box", stats.edge > 20, `${stats.edge}px`);

console.log(`\n${"-".repeat(60)}`);
console.log(`BADGE ICON: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
