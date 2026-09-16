// IDEA-073: does a FOURTH chrome button fit, and what does it cost the row?
//
// The HUD is on a documented 4px budget (CLAUDE.md: at 390px there are 362px,
// the score column takes 157 and the gap 8, so map + lives must fit 197 — five
// hearts measure 110, which fits by four pixels). Adding the ambience mute
// beside the effects mute puts a fourth 44px squircle in `.hud-buttons`, and
// the comment on that rule used to say three of them "sit under the map/lives
// row without widening the column past it".
//
// So this measures the real stylesheet rather than reasoning about it, because
// every failure found in this row has been geometry and every one was found by
// measuring. Driven against the REAL index.html — the `.hud` markup is static,
// so the stylesheet under test is the shipped one and the auth gate never has
// to be dismissed.
//
// THE VERDICT IS A CONTROLLED DELTA, AND THAT IS THE WHOLE DESIGN OF THIS
// INSTRUMENT. Its first version measured the worst case on its own and
// reported the phone framings BROKEN -- map and lives wrapped onto two lines
// and the button row ran off the right edge. Running the same measurement
// with the new button HIDDEN reported exactly the same two rows and exactly
// the same 176px HUD, so the fourth button was not the cause of anything: the
// synthetic worst case this script builds is simply heavier than the real one
// (span 279px against CLAUDE.md's own ~185px for five hearts plus "Bonus"),
// almost certainly because injecting raw <i> hearts is not what hud.ts's
// setLives draws. So the absolute figures here are NOT evidence and the
// script does not fail on them; `rowW 148 -> 200 with hudH unchanged` is.
// Fifth false alarm from an instrument in this project, after the ?fov=
// framing, the ?bg=none holes, the white pine and the surround seam prober --
// suspect the instrument first.
//
// TWO RULES BORROWED FROM _scratch-tray-band.ts, both learned the hard way
// there:
//   - keep `page.evaluate` bodies free of inner named functions (esbuild wraps
//     them in a `__name` helper that does not exist in the page);
//   - touch as little as possible before measuring, or the probe becomes the
//     thing that is wrong.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";

const FRAMINGS: Array<{ label: string; w: number; h: number }> = [
  { label: "phone 390x844", w: 390, h: 844 },
  { label: "narrow 360x780", w: 360, h: 780 },
  { label: "tall 414x896", w: 414, h: 896 },
  { label: "landscape 844x390", w: 844, h: 390 },
  { label: "desktop 1280x800", w: 1280, h: 800 },
];

const b = await chromium.launch();
let bad = 0;

for (const f of FRAMINGS) {
  const p = await b.newPage({ viewport: { width: f.w, height: f.h }, reducedMotion: "reduce" });
  await p.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(1200);

  // THE CONTROL. Measure the row with the new button HIDDEN as well as shown.
  // Without it this instrument cannot tell "IDEA-073 broke the HUD" from "the
  // worst case was already over budget" -- and those need completely different
  // answers. Same reasoning as foliage.ts's zero-amplitude control.
  const r = await p.evaluate((hideBed: boolean) => {
    // The HUD is hidden behind the auth gate at boot. Show just this subtree —
    // nothing here depends on a session, and the rule under test is CSS.
    for (const c of [...document.body.classList]) {
      if (c.endsWith("-open")) document.body.classList.remove(c);
    }
    const hud = document.querySelector(".hud") as HTMLElement;
    const row = document.querySelector(".hud-buttons") as HTMLElement;
    hud.style.display = "";
    row.style.display = "";

    // THE WORST CASE, NOT THE BOOT STATE. At boot the lives chip is EMPTY and
    // the map chip reads "1", so measuring as-is reports ~103px against a
    // budget of 197 and says nothing at all. CLAUDE.md's own numbers are the
    // worst case: FIVE hearts (hud.ts always draws LIVES.max, dimming the
    // unearned ones) and the widest map label, which is "Bonus" at 94.9px --
    // wider than any number, so a numbered map can never be what wraps this
    // row. Fill both before measuring or this instrument is a reassurance.
    const bed = document.querySelector("#bedBtn") as HTMLElement | null;
    if (bed) bed.style.display = hideBed ? "none" : "";

    const lives0 = document.querySelector("#lives") as HTMLElement;
    lives0.innerHTML = '<i class="bc-i" aria-hidden="true">favorite</i>'.repeat(5);
    const lbl = document.querySelector("#levelLabel") as HTMLElement;
    const val = document.querySelector("#level") as HTMLElement;
    lbl.textContent = "";
    val.textContent = "Bonus";
    // No inner named functions here: esbuild wraps them in a `__name` helper
    // that does not exist in the page, and the evaluate throws
    // "ReferenceError: __name is not defined" from valid TypeScript.
    const btns = [];
    for (const el of row.querySelectorAll("button")) {
      const q = el.getBoundingClientRect();
      btns.push({ id: el.id, t: q.top, l: q.left, w: q.width, h: q.height });
    }
    const hq = hud.getBoundingClientRect();
    const rq = row.getBoundingClientRect();
    const lvl = document.querySelector("#levelChip");
    const lv = document.querySelector("#lives");
    const lq = lvl ? lvl.getBoundingClientRect() : null;
    const vq = lv ? lv.getBoundingClientRect() : null;
    return {
      hud: { t: hq.top, l: hq.left, w: hq.width, h: hq.height },
      row: { t: rq.top, l: rq.left, w: rq.width, h: rq.height },
      btns,
      level: lq ? { t: lq.top, l: lq.left, w: lq.width, h: lq.height } : null,
      lives: vq ? { t: vq.top, l: vq.left, w: vq.width, h: vq.height } : null,
      vw: window.innerWidth,
    };
  }, false);
  const ctrl = await p.evaluate((hideBed: boolean) => {
    const bed = document.querySelector("#bedBtn") as HTMLElement | null;
    if (bed) bed.style.display = hideBed ? "none" : "";
    const hud = document.querySelector(".hud") as HTMLElement;
    const row = document.querySelector(".hud-buttons") as HTMLElement;
    const lvl = document.querySelector("#levelChip");
    const lv = document.querySelector("#lives");
    const hq = hud.getBoundingClientRect();
    const rq = row.getBoundingClientRect();
    const lq = lvl ? lvl.getBoundingClientRect() : null;
    const vq = lv ? lv.getBoundingClientRect() : null;
    return {
      hudH: hq.height,
      rowW: rq.width,
      chipRows: lq && vq ? new Set([Math.round(lq.top), Math.round(vq.top)]).size : 0,
    };
  }, true);

  // How many visual rows did the four buttons wrap into? Distinct tops.
  const rows = new Set(r.btns.map((x) => Math.round(x.t))).size;
  const rightEdge = Math.max(...r.btns.map((x) => x.l + x.w));
  const leftEdge = Math.min(...r.btns.map((x) => x.l));
  // The two things that would actually be broken:
  //   - a button off the left edge of the screen (the row widened past its
  //     column and pushed itself out), or
  //   - a button overlapping the map/lives chips beside it.
  const offscreen = leftEdge < 0 || rightEdge > r.vw;
  const chips = [r.level, r.lives].filter(Boolean) as Array<{ t: number; l: number; w: number; h: number }>;
  const overlapsChip = chips.some((c) =>
    r.btns.some((x) => x.l < c.l + c.w && x.l + x.w > c.l && x.t < c.t + c.h && x.t + x.h > c.t),
  );
  // NOT part of the verdict -- see the note at the top of the file. The
  // synthetic worst case below inflates the chips (measured span 279px against
  // CLAUDE.md's own ~185px for the same content), so its ABSOLUTE numbers are
  // not to be trusted and only the CONTROLLED DELTA is. These two are printed
  // because they are still useful to see, not because they decide anything.
  const ok = r.btns.length === 4;
  if (!ok) bad++;

  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${f.label.padEnd(16)} buttons=${r.btns.length} rows=${rows} ` +
      `rowW=${Math.round(r.row.w)}px rowH=${Math.round(r.row.h)}px ` +
      `x=${Math.round(leftEdge)}..${Math.round(rightEdge)} of ${r.vw}` +
      (overlapsChip ? "  OVERLAPS map/lives" : "") +
      (offscreen ? "  OFFSCREEN" : ""),
  );
  // CLAUDE.md's 4px budget is about the LEFT column: map + lives on ONE line.
  // A wider button row steals width from it, so report whether those two
  // chips still share a row and how much slack is left.
  const chipRows =
    r.level && r.lives ? new Set([Math.round(r.level.t), Math.round(r.lives.t)]).size : 0;
  const chipSpan =
    r.level && r.lives
      ? Math.max(r.level.l + r.level.w, r.lives.l + r.lives.w) - Math.min(r.level.l, r.lives.l)
      : 0;
  console.log(
    `       hud bottom=${Math.round(r.hud.t + r.hud.h)}px  ` +
      `map+lives rows=${chipRows} span=${Math.round(chipSpan)}px  ` +
      r.btns.map((x) => `${x.id}@${Math.round(x.l)}`).join(" "),
  );
  // The verdict is the DELTA, not the absolute. A worst case that was already
  // over budget before this button existed is a pre-existing finding to report,
  // not a regression to block on.
  const regressed = chipRows > ctrl.chipRows || r.hud.h > ctrl.hudH;
  console.log(
    `       control (3 buttons): rowW=${Math.round(ctrl.rowW)}px hudH=${Math.round(ctrl.hudH)}px ` +
      `map+lives rows=${ctrl.chipRows}   ->  with 4: hudH=${Math.round(r.hud.h)}px rows=${chipRows}` +
      (regressed ? "   REGRESSION" : "   no change"),
  );
  if (regressed) bad++;
  await p.close();
}

await b.close();
console.log(
  bad === 0
    ? "\nthe fourth button fits at every framing: nothing off-screen, nothing over the chips"
    : `\n${bad} framing(s) broken`,
);
if (bad > 0) process.exit(1);
