// IDEA-076: measure the game-screen HUD stack, row by row, and what is left
// for the power-up tray.
//
// Nuno, after playing with IDEA-073's fourth chrome button in: "the interface
// now have another button and when the player have 4 power ups the tags of the
// power ups are above the maze and make hard to play." Two claims, both
// geometry, so both get measured rather than reasoned about — this row is on a
// documented 4px budget and every failure in it has been found by measuring
// (CLAUDE.md, IDEA-048 / IDEA-069 / IDEA-073).
//
// TWO PHASES, because the two facts live in two pages. `--bc-board-top` is
// published by the real rig, so it is read from /preview-board/ exactly as
// _scratch-tray-band.ts does; the HUD and tray are static markup in
// index.html, so the stylesheet measured there is the shipped one and the auth
// gate never has to be dismissed. The board top from phase 1 is then INJECTED
// into phase 2, so the band arithmetic is the real one rather than the CSS
// fallback.
//
// THREE RULES BORROWED FROM ITS SIBLINGS, all learned the hard way:
//   - no inner NAMED functions in a `page.evaluate` body — esbuild's keepNames
//     wraps them in a `__name` helper the page does not have, and valid
//     TypeScript throws ReferenceError (IDEA-074);
//   - AWAIT `document.fonts.ready` before measuring anything holding an icon:
//     an unresolved ligature renders as the WORD, and five hearts reading
//     "favorite" measure 279px against a real ~110 — which is exactly the
//     inflation _scratch-hud-band.ts recorded and could not explain;
//   - touch as little as possible before measuring, or the probe becomes the
//     thing that is wrong.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const CHIPS = Number(process.env.CHIPS ?? 5);

const FRAMINGS: Array<{ label: string; w: number; h: number }> = [
  { label: "phone 390x844", w: 390, h: 844 },
  { label: "narrow 360x780", w: 360, h: 780 },
  { label: "tall 414x896", w: 414, h: 896 },
  { label: "square 820x900", w: 820, h: 900 },
  { label: "landscape 844x390", w: 844, h: 390 },
  { label: "desktop 1280x800", w: 1280, h: 800 },
];

// Measured once with phase 1 below, and kept so the HUD can be re-measured
// without paying for a cold /preview-board/ boot each time (a hard load
// refetches the whole module graph across a Windows bind mount). These are a
// RENDER-layer fact — scene.ts's camera dolly — so no HUD or stylesheet change
// can move them. Re-measure with BOARD=1 after touching scene.ts.
const BOARD_TOP_CACHE: Record<string, number> = {
  "phone 390x844": 264,
  "narrow 360x780": 244,
  "tall 414x896": 280,
  "square 820x900": 181,
  "landscape 844x390": 68,
  "desktop 1280x800": 140,
};

const b = await chromium.launch();

// ---- phase 1: where does the board start, on the real rig? ----------------
const boardTop = new Map<string, number>();
for (const f of FRAMINGS) {
  if (process.env.BOARD !== "1" && BOARD_TOP_CACHE[f.label] !== undefined) {
    boardTop.set(f.label, BOARD_TOP_CACHE[f.label]);
    continue;
  }
  const p = await b.newPage({ viewport: { width: f.w, height: f.h }, reducedMotion: "reduce" });
  await p.goto(`${base}/preview-board/?theme=garden&maze=0&view=game&hud=0`, {
    waitUntil: "load",
    timeout: 60000,
  });
  await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 30000 });
  const v = await p.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bc-board-top").trim(),
  );
  boardTop.set(f.label, parseFloat(v));
  await p.close();
}

// ---- phase 2: the HUD stack and the tray ---------------------------------
for (const f of FRAMINGS) {
  const p = await b.newPage({ viewport: { width: f.w, height: f.h }, reducedMotion: "reduce" });
  // `load`, not `domcontentloaded`: index.html's stale-shell recovery script
  // reloads the page if any script or stylesheet 404s, which a cold Vite dev
  // server occasionally does — and a reload mid-evaluate surfaces as
  // "Execution context was destroyed", which looks nothing like its cause.
  await p.goto(`${base}/`, { waitUntil: "load", timeout: 120000 });
  await p.waitForSelector(".hud", { state: "attached", timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);

  // SETUP AND MEASUREMENT ARE TWO CALLS, ACROSS A FRAME, AND THAT IS NOT
  // TIDINESS. Publishing `--bc-hud-bottom` and reading `getComputedStyle(tray)
  // .top` in the SAME task returns the value calc() had BEFORE the custom
  // property moved — measured here: the variable read back as 500px on the
  // tray itself while `top` still read 104px, i.e. 96px fallback + 8. Two
  // rAFs later it reads 508. So the first version of this instrument reported
  // the tray sitting under a 96px HUD that is actually 180 tall, which is a
  // confident wrong answer about the one number the feature turns on.
  await p.evaluate(
    (arg: { n: number; boardTop: number }) => {
      // The HUD is behind the auth gate at boot. Show just this subtree —
      // nothing under test depends on a session.
      for (const c of [...document.body.classList]) {
        if (c.endsWith("-open")) document.body.classList.remove(c);
      }
      const hud = document.querySelector(".hud") as HTMLElement;
      hud.style.display = "";
      const row = document.querySelector(".hud-buttons") as HTMLElement;
      row.style.display = "";
      if (Number.isFinite(arg.boardTop)) {
        document.documentElement.style.setProperty("--bc-board-top", `${arg.boardTop}px`);
      }

      // THE WORST CASE, not the boot state: five hearts (hud.ts always draws
      // LIVES.max, dimming the unearned ones) and the widest map label, which
      // is "Bonus" — wider than any number, so a numbered map can never be
      // what wraps the row.
      const lives = document.querySelector("#lives") as HTMLElement;
      lives.innerHTML = '<i class="bc-i">favorite</i>'.repeat(5);
      (document.querySelector("#score") as HTMLElement).textContent = "128 450";
      (document.querySelector("#coins") as HTMLElement).textContent = "1284";
      (document.querySelector("#levelLabel") as HTMLElement).textContent = "";
      (document.querySelector("#level") as HTMLElement).textContent = "Bonus";

      // The five real chips, in hud.ts's own markup, at the widest names.
      const names = ["x2 Biscuits", "x2 Enemies", "Slow", "Star", "Shield"];
      const glyphs = ["cookie", "pest_control", "anchor", "star", "shield"];
      const cols = ["#F0CF8E", "#9B6BD6", "#6FB84A", "#E8A23D", "#53C7C0"];
      const inks = ["#6B4A2F", "#FFF7E8", "#17300C", "#4A2E08", "#0E3B39"];
      // hud.ts publishes this through a ResizeObserver as soon as createHud
      // runs; nothing has run here, so the tray would otherwise sit at the CSS
      // fallback and every tray number below would be fiction. Republish it
      // exactly as publishHudBottom does.
      document.documentElement.style.setProperty(
        "--bc-hud-bottom",
        `${Math.round(hud.getBoundingClientRect().bottom)}px`,
      );
      const tray = document.querySelector("#powerups") as HTMLElement;
      tray.innerHTML = "";
      for (let i = 0; i < arg.n; i++) {
        const el = document.createElement("div");
        el.className = "powerup";
        el.style.setProperty("--pu", cols[i % 5]);
        el.style.setProperty("--pu-ink", inks[i % 5]);
        el.innerHTML =
          `<span class="bc-plate bc-plate--power bc-plate--hud"><i class="bc-i">${glyphs[i % 5]}</i></span>` +
          `<span class="name">${names[i % 5]}<span class="time">12s</span></span>` +
          `<div class="bar" style="width:60%"></div>`;
        tray.appendChild(el);
      }

      return true;
    },
    { n: CHIPS, boardTop: boardTop.get(f.label) ?? NaN },
  );
  await p.evaluate(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));

  const r = await p.evaluate(() => {
      const row = document.querySelector(".hud-buttons") as HTMLElement;
      const tray = document.querySelector("#powerups") as HTMLElement;
      const want: Array<[string, string]> = [
        ["scoreChip", ".hud-line .stat"],
        ["coins", ".coin-stat"],
        ["level", "#levelChip"],
        ["lives", "#lives"],
        ["hud", ".hud"],
        ["row", ".hud-buttons"],
      ];
      const boxes: Record<string, { t: number; l: number; w: number; h: number } | null> = {};
      for (const [key, sel] of want) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) {
          boxes[key] = null;
          continue;
        }
        const q = el.getBoundingClientRect();
        boxes[key] = {
          t: Math.round(q.top),
          l: Math.round(q.left),
          w: Math.round(q.width),
          h: Math.round(q.height),
        };
      }
      const btns: Array<{ id: string; t: number; l: number; w: number }> = [];
      for (const el of row.querySelectorAll("button")) {
        const q = el.getBoundingClientRect();
        btns.push({ id: el.id, t: Math.round(q.top), l: Math.round(q.left), w: Math.round(q.width) });
      }
      const chipBoxes: Array<{ t: number; l: number; w: number; h: number }> = [];
      for (const el of tray.querySelectorAll(".powerup")) {
        const q = el.getBoundingClientRect();
        chipBoxes.push({
          t: Math.round(q.top),
          l: Math.round(q.left),
          w: Math.round(q.width),
          h: Math.round(q.height),
        });
      }
      return {
        // Named rather than spread: `boxes` is a Record, and spreading one
        // gives TypeScript an index signature with no keys on it.
        scoreChip: boxes.scoreChip,
        coins: boxes.coins,
        level: boxes.level,
        lives: boxes.lives,
        hud: boxes.hud,
        row: boxes.row,
        btns,
        chipBoxes,
        hudBottomVar: getComputedStyle(document.documentElement).getPropertyValue("--bc-hud-bottom").trim(),
        trayTopCss: getComputedStyle(tray).top,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
  });

  const tops = (xs: Array<{ t: number } | null | undefined>): number =>
    new Set(xs.filter(Boolean).map((x) => (x as { t: number }).t)).size;
  // "One line" is VERTICAL OVERLAP, not an equal `top`. The two chips on a
  // line are different heights and `align-items:center` offsets the shorter
  // one, so comparing tops reported a correct line as two rows — the first
  // version of this instrument did exactly that and called the finished
  // layout broken.
  const sameLine = (
    a: { t: number; h: number } | null | undefined,
    c: { t: number; h: number } | null | undefined,
  ): boolean => (!a || !c ? false : a.t < c.t + c.h && c.t < a.t + a.h);

  const bt = boardTop.get(f.label) ?? NaN;
  const hudBottom = (r.hud?.t ?? 0) + (r.hud?.h ?? 0);
  const trayTop = r.chipBoxes.length ? Math.min(...r.chipBoxes.map((c) => c.t)) : 0;
  const trayBottom = r.chipBoxes.length ? Math.max(...r.chipBoxes.map((c) => c.t + c.h)) : 0;

  console.log(`\n${f.label}`);
  console.log(`  score ${JSON.stringify(r.scoreChip)}  coins ${JSON.stringify(r.coins)}`);
  console.log(`  map   ${JSON.stringify(r.level)}  lives ${JSON.stringify(r.lives)}`);
  console.log(
    `  score+map one line: ${sameLine(r.scoreChip, r.level)}` +
      `   coins+lives one line: ${sameLine(r.coins, r.lives)}` +
      `   chips above buttons: ${(r.lives?.t ?? 0) + (r.lives?.h ?? 0) <= (r.btns[0]?.t ?? 0) || (r.btns[0]?.t ?? 0) === (r.lives?.t ?? -1)}`,
  );
  console.log(
    `  buttons lines=${tops(r.btns)} rowW=${r.row?.w}  ` +
      r.btns.map((x) => `${x.id}@${x.l},${x.t}`).join(" "),
  );
  console.log(
    `  hud h=${r.hud?.h} bottom=${hudBottom}  boardTop=${Math.round(bt)}  band=${Math.round(bt - hudBottom)}px`,
  );
  // The board verdict only means anything where the tray uses the PORTRAIT
  // anchor. In a landscape phone it falls back to the bottom-left corner and
  // in a landscape window it becomes a side rail — in both it sits over the
  // board deliberately, so measuring it against the board's top edge there is
  // measuring the wrong rule.
  const portraitAnchor = f.h > 480 && !(f.w >= 600 && f.w >= f.h);
  console.log(
    `  tray(${CHIPS}) lines=${tops(r.chipBoxes)} chipH=${r.chipBoxes[0]?.h} top=${trayTop} bottom=${trayBottom}` +
      (!portraitAnchor
        ? "   (own anchor: corner rail / side rail)"
        : trayBottom > bt
          ? `   OVER THE BOARD by ${Math.round(trayBottom - bt)}px`
          : `   clears the board by ${Math.round(bt - trayBottom)}px`),
  );
  console.log(`  --bc-hud-bottom=${r.hudBottomVar} tray css top=${r.trayTopCss}`);
  console.log(`  chip widths ${r.chipBoxes.map((c) => c.w).join(" ")}  (sum ${r.chipBoxes.reduce((a, c) => a + c.w, 0)})`);
  await p.close();
}

await b.close();
