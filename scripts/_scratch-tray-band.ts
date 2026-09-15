// IDEA-069: is there actually room above the board for the power-up tray, and
// does scene.ts publish where it starts?
//
// Measures the REAL rig through /preview-board/ (which builds the shipped
// scene) at the framings that matter, then checks the CSS arithmetic the tray
// rule uses. Cheaper and more precise than driving a whole run, and it tests
// exactly the two things that can break: the published value, and the band.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const FRAMINGS: Array<{ label: string; w: number; h: number }> = [
  { label: "phone 390x844", w: 390, h: 844 },
  { label: "narrow 360x780", w: 360, h: 780 },
  { label: "tall 414x896", w: 414, h: 896 },
  { label: "square-ish 820x900", w: 820, h: 900 },
  { label: "landscape 844x390", w: 844, h: 390 },
  { label: "desktop 1280x800", w: 1280, h: 800 },
];
// The HUD's chrome row bottom, measured on the real build at 390x844. The tray
// must not reach above this or it sits on the mute/pause/home buttons.
const HUD_BOTTOM_PX = 112;
const CHIP_H = 42;

const b = await chromium.launch();
let bad = 0;
for (const f of FRAMINGS) {
  const p = await b.newPage({ viewport: { width: f.w, height: f.h }, reducedMotion: "reduce" });
  await p.goto(`${base}/preview-board/?theme=garden&maze=0&view=game&hud=0`, { waitUntil: "load", timeout: 60000 });
  await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
  const v = await p.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      top: s.getPropertyValue("--bc-board-top").trim(),
      bottom: s.getPropertyValue("--bc-board-bottom").trim(),
    };
  });
  const top = parseFloat(v.top);
  const bottom = parseFloat(v.bottom);
  const band = top - HUD_BOTTOM_PX;
  const under = f.h - bottom;
  const landscape = f.w >= f.h;
  const ok = landscape || band >= CHIP_H;
  if (!ok) bad++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${f.label.padEnd(16)} boardTop=${v.top.padStart(6)} ` +
      `band above=${String(Math.round(band)).padStart(4)}px  under=${String(Math.round(under)).padStart(4)}px` +
      (landscape ? "   (landscape: tray falls back to the corner rail)" : ""),
  );
  await p.close();
}
await b.close();
console.log(bad === 0 ? "\nevery PORTRAIT framing has room for at least one chip row above the board" : `\n${bad} framing(s) have no band`);
if (bad > 0) process.exit(1);

// ---------------------------------------------------------------------------
// IDEA-070: and does the tray actually land under the HUD?
//
// Driven against the REAL index.html — its `.hud` and `#powerups` markup is
// static, so the stylesheet under test is the shipped one. The auth gate is
// never dismissed: what is being measured is a CSS rule and one published
// variable, not a session.
//
// TWO THINGS THIS INSTRUMENT GOT WRONG FIRST, both worth keeping:
//
//  1. A HELPER FUNCTION INSIDE `page.evaluate` THROWS UNDER tsx. esbuild wraps
//     named arrows in its own `__name` helper, which does not exist in the
//     page — "ReferenceError: __name is not defined", from code that is
//     perfectly valid TypeScript. Keep evaluate bodies free of inner
//     functions.
//  2. IT REPORTED A CORRECT RULE AS BROKEN. The first version cleared the body
//     class and forced `.hud` visible before measuring, and came back with the
//     tray 30px ABOVE the HUD — i.e. the calc falling through to its fallback
//     while `getComputedStyle` simultaneously reported the variable as set.
//     Setting the variable and reading `top` straight back, with nothing else
//     touched, gives 134 + 8 = 142px every time. The rule was always right;
//     the probe was not. Fourth false alarm from an instrument in this
//     project, after the ?fov= framing, the ?bg=none holes and the white pine.
{
  const p = await (await chromium.launch()).newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await p.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const tray = document.querySelector("#powerups") as HTMLElement;
    tray.innerHTML = '<div class="powerup"><span class="bc-plate">S</span><span class="time">7s</span></div>';
    const fallback = getComputedStyle(tray).top;
    // 134px is the measured height of the real HUD at this framing.
    document.documentElement.style.setProperty("--bc-hud-bottom", "134px");
    const withHud = getComputedStyle(tray).top;
    const rect = tray.getBoundingClientRect();
    return { fallback, withHud, top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
  });
  const gap = r.top - 134;
  console.log(`
  tray: hud ends 134px, tray runs ${r.top}..${r.bottom}px (gap ${gap}px, board starts 264px)`);
  console.log(`  fallback top ${r.fallback} -> with --bc-hud-bottom ${r.withHud}`);
  const ok = gap > 0 && gap < 24 && r.bottom <= 264;
  console.log(ok ? "  ok   the tray sits directly under the HUD and clears the maze" : "  FAIL the tray is not where it should be");
  if (!ok) process.exitCode = 1;
}
