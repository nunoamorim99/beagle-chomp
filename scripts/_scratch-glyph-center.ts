// Scratch: where does a Material Symbols glyph's INK actually sit relative to
// the text anchor, and what y centres it in a level-map stone?
//
//   npx tsx scripts/_scratch-glyph-center.ts
//
// SVG `dominant-baseline` is the wrong instrument for this. "middle" offsets by
// half the X-HEIGHT — a Latin-typography notion that an icon font has no
// opinion about — so a glyph drawn across the full em box ends up roughly a
// quarter of an em too high. That is the padlock sitting above the centre of
// its stone.
//
// So measure the ink directly: draw the glyph into a 2D canvas with the same
// font and font-size the SVG uses, scan the alpha channel for its real top and
// bottom, and report both relative to the ALPHABETIC baseline. The y that
// centres it is then -(top + bottom) / 2 with no dominant-baseline at all.
//
// Runs against the dev server because the font is self-hosted and subset there
// (src/ui/fonts) — loading it any other way would measure a different file.
import { chromium } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:5173";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The auth gate is enough — tokens.css and its @font-face rules are loaded by
  // then, and this measures a font, not a screen.
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);

  const out = await page.evaluate(
    (specs: { label: string; text: string; font: string }[]) => {
      const results: unknown[] = [];
      const S = 200; // draw big; the answer scales linearly with font-size
      for (const spec of specs) {
        const c = document.createElement("canvas");
        c.width = S * 2;
        c.height = S * 2;
        const ctx = c.getContext("2d");
        if (!ctx) continue;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.font = spec.font;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#000";
        const baselineY = S; // the baseline sits at canvas y = S
        ctx.fillText(spec.text, S, baselineY);

        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let top = -1;
        let bottom = -1;
        let left = -1;
        let right = -1;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] > 8) {
              if (top < 0) top = y;
              bottom = y;
              if (left < 0 || x < left) left = x;
              if (x > right) right = x;
            }
          }
        }
        // The FONT-SIZE, not the first number in the shorthand. `parseFloat`
        // on '700 200px "..."' returns 700 — the WEIGHT — which silently
        // scales every figure below by 200/700 and makes a full-em glyph
        // measure 0.27em. Nothing about that reads as wrong; it just answers
        // the wrong question with four decimal places.
        const emPx = Number(/(\d+(?:\.\d+)?)px/.exec(spec.font)?.[1] ?? NaN);
        results.push({
          label: spec.label,
          // Relative to the baseline, in EM units (negative = above baseline).
          inkTopEm: +(((top - baselineY) / emPx)).toFixed(4),
          inkBottomEm: +(((bottom - baselineY) / emPx)).toFixed(4),
          inkWidthEm: +(((right - left) / emPx)).toFixed(4),
          inkHeightEm: +(((bottom - top) / emPx)).toFixed(4),
          // The y (in em, then in px at the real size) that puts the ink centre
          // on the anchor, with textBaseline/dominant-baseline left alphabetic.
          centringYEm: +((-(top - baselineY + (bottom - baselineY)) / 2 / emPx)).toFixed(4),
        });
      }
      return results;
    },
    [
      { label: "lock glyph @20px (the stone's padlock)", text: "lock", font: '700 200px "Material Symbols Rounded"' },
      { label: "digit 7 @16px (the stone's number)", text: "7", font: '800 200px "Baloo 2"' },
      { label: "digits 40 @13.5px (widest stone)", text: "40", font: '800 200px "Baloo 2"' },
    ],
  );

  console.log(JSON.stringify(out, null, 1));
  for (const r of out as { label: string; centringYEm: number }[]) {
    console.log(`${r.label}: centring y = ${r.centringYEm} em`);
  }
  console.log(`\nlock at font-size 20px  -> y = ${((out as any)[0].centringYEm * 20).toFixed(2)}px`);
  console.log(`digit at font-size 16px -> y = ${((out as any)[1].centringYEm * 16).toFixed(2)}px`);
  console.log(`digits at font-size 13.5px -> y = ${((out as any)[2].centringYEm * 13.5).toFixed(2)}px`);

  await browser.close();
})();
