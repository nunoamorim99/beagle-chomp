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
// IT NOW GUARDS TWO THINGS, and the second one is why the first was not enough.
//
// This suite builds its list by parsing ICON, on the documented assumption that
// "nothing addresses this font any other way". That assumption was FALSE and had
// been for three releases: src/ui/shop.ts's ENEMY_ICONS held raw ligature
// strings ("pest_control", "hive", "bug_report") that were never in ICON, so
// they were never in the subset Google cut, and the Beetle, Bee and Ladybug
// cards rendered the words PEST_CONTROL, HIVE and BUG_REPORT in 26px text
// across the shop rail. Every check here passed the whole time, because a name
// this suite never hears about is a name it cannot test.
//
// So the source scan below closes the hole at the source instead: outside
// icons.ts, no module that draws icons may contain a snake_case string literal
// at all. That is a blunt rule and a cheap one, and it is exactly the shape of
// the thing that went wrong — every multi-word Material Symbols ligature is
// snake_case, and this codebase is otherwise camelCase throughout.
//
// NOT in `npm test` — it needs a browser, like every other Playwright suite
// here. Run it after re-cutting the subset:  npm run test:icon-font

import { chromium } from "playwright";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

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

/**
 * Storage keys, not glyph names. The only snake_case literals the interface is
 * allowed to carry outside icons.ts, listed one by one rather than pattern-
 * matched: an allowlist that takes a prefix would quietly accept the next
 * `bc_`-looking icon name somebody invents.
 */
const ALLOWED_SNAKE_LITERALS = new Set(["bc_last_player", "bc_muted"]);

/** Blank comments to SPACES so prose about this very rule cannot trip it —
 *  the doc comment above ENEMY_ICONS names all three offending glyphs on
 *  purpose, and it must stay legal to write them down. */
function maskComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      out += " ".repeat(end - i);
      i = end;
    } else if (two === "/*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? src.length : close + 2;
      out += src.slice(i, end).replace(/[^\r\n]/g, " ");
      i = end;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every icon name reachable from source must come from ICON. Returns the
 *  offences as `file:line  "literal"` strings. */
function rawGlyphLiterals(): string[] {
  const offences: string[] = [];
  for (const file of walk(join(ROOT, "src"))) {
    if (file === ICONS) continue;
    const src = readFileSync(file, "utf-8");
    // Only modules that actually DRAW icons can be the source of this bug, and
    // scoping to them keeps the rule from policing unrelated code.
    if (!/from "\.{1,2}[./a-z]*icons"/.test(src)) continue;

    const masked = maskComments(src);
    masked.split(/\r?\n/).forEach((line, idx) => {
      for (const m of line.matchAll(/"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g)) {
        if (ALLOWED_SNAKE_LITERALS.has(m[1])) continue;
        offences.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${idx + 1}  "${m[1]}"`);
      }
    });
  }
  return offences;
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

const rawLiterals = rawGlyphLiterals();
console.log("\n  Every icon name comes from ICON (nothing addresses the font raw)");
if (rawLiterals.length === 0) {
  console.log("  ok   no raw snake_case literals in any icon-drawing module");
} else {
  for (const offence of rawLiterals) {
    console.log(`  FAIL ${offence} — use an ICON.* role, or the glyph is not in the subset`);
    failed++;
  }
}

console.log(`\n${"-".repeat(60)}`);
console.log(
  failed === 0
    ? `ICON FONT: all ${names.length} glyphs present, every name from ICON`
    : `ICON FONT: ${failed} problem(s) — re-cut the subset (recipe in src/ui/tokens.css)`,
);
process.exit(failed === 0 ? 0 : 1);
