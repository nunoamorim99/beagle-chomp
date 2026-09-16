// IDEA-073: does the ambience button actually wire up against the REAL
// index.html, and does each toggle move only its own layer?
//
// attachBedButton THROWS when it finds no `.bed-btn` — which is the right
// behaviour and a nasty symptom, because it throws inside Game's constructor
// and the player sees a black screen at boot rather than a missing button.
// test-ambience.ts asserts the markup exists; this asserts the SELECTOR finds
// it, which is a different claim (a class renamed in one place and not the
// other passes the first and fails the second).
//
// It runs without a session: sound.ts and the markup are both static, and what
// is under test is the wiring, not the game.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(800);

const r = await p.evaluate(async () => {
  const path = "/src/ui/sound.ts";
  const mod = await import(path);
  // A fresh, unmuted baseline — a previous run of this script leaves both
  // preferences in localStorage and would otherwise decide the result.
  localStorage.removeItem("bc_muted");
  localStorage.removeItem("bc_bed_muted");

  const sound = mod.createSound();
  const found: Record<string, unknown> = {};
  try {
    const d1 = mod.attachMuteButton(document.body, sound);
    const d2 = mod.attachBedButton(document.body, sound);
    const d3 = mod.attachSoundButton(document.body, sound);
    found.attached = true;
    found.bedButtons = document.querySelectorAll(".bed-btn").length;
    found.muteButtons = document.querySelectorAll(".mute-btn").length;
    found.soundButtons = document.querySelectorAll(".sound-btn").length;

    const bed = document.querySelector("#bedBtn") as HTMLButtonElement;
    // The two must be INDEPENDENT: pressing one may not move the other.
    const before = { sfx: sound.isMuted(), bed: sound.isBedMuted() };
    bed.click();
    const afterBed = { sfx: sound.isMuted(), bed: sound.isBedMuted() };
    (document.querySelector("#muteBtn") as HTMLButtonElement).click();
    const afterBoth = { sfx: sound.isMuted(), bed: sound.isBedMuted() };

    // The glyph must be a real ligature, never the raw word: the button holds
    // its name as TEXT, so this is also the check that the font subset covers
    // the new icon in situ rather than only in test-icon-font's own page.
    //
    // MEASURED VISIBLE, and that is not a detail. The first version measured
    // it as it found it — inside a `.hud-buttons` that the auth gate hides —
    // and got 0px, which sailed through a "narrower than 40px" test for
    // exactly the wrong reason. A hidden element passes every width check
    // there is. Un-hide the row, and wait for the font, before believing a
    // number.
    await document.fonts.ready;
    for (const c of [...document.body.classList]) {
      if (c.endsWith("-open")) document.body.classList.remove(c);
    }
    (document.querySelector(".hud") as HTMLElement).style.display = "";
    (document.querySelector(".hud-buttons") as HTMLElement).style.display = "";
    // Back to the UNMUTED state, because the glyph under test is the new one
    // (graphic_eq). The off state reuses the speaker the effects button
    // already had, so measuring that would not test the re-cut subset at all.
    bed.click();
    const glyph = (bed.querySelector("i") as HTMLElement).textContent;
    const w = (bed.querySelector("i") as HTMLElement).getBoundingClientRect().width;

    // And the volumes must persist through a set.
    sound.setBedVolume(0.35);
    const stored = localStorage.getItem("bc_vol_bed");

    found.before = before;
    found.afterBed = afterBed;
    found.afterBoth = afterBoth;
    found.glyph = glyph;
    found.glyphWidth = Math.round(w);
    found.storedBedVolume = stored;
    found.readBack = sound.getBedVolume();
    // The MENU's single master toggle: one press silences everything, the
    // next restores it. And pressing it while only ONE layer is muted must
    // silence the rest rather than un-mute half.
    const menu = document.querySelector("#menuMuteBtn") as HTMLButtonElement;
    sound.setMuted(false);
    sound.setBedMuted(false);
    menu.click();
    const masterOff = { sfx: sound.isMuted(), bed: sound.isBedMuted() };
    menu.click();
    const masterOn = { sfx: sound.isMuted(), bed: sound.isBedMuted() };
    sound.setMuted(true);
    sound.setBedMuted(false);
    menu.click();
    const fromHalf = { sfx: sound.isMuted(), bed: sound.isBedMuted() };
    // And the menu's icon must FOLLOW a change made elsewhere -- two toggles
    // over overlapping state is exactly what onStateChange exists to keep in
    // step.
    sound.setMuted(false);
    sound.setBedMuted(false);
    const menuGlyphUnmuted = (menu.querySelector("i") as HTMLElement).textContent;
    (document.querySelector("#muteBtn") as HTMLButtonElement).click();
    (document.querySelector("#bedBtn") as HTMLButtonElement).click();
    const menuGlyphAfterHud = (menu.querySelector("i") as HTMLElement).textContent;

    found.masterOff = masterOff;
    found.masterOn = masterOn;
    found.fromHalf = fromHalf;
    found.menuGlyphUnmuted = menuGlyphUnmuted;
    found.menuGlyphAfterHud = menuGlyphAfterHud;
    d1();
    d2();
    d3();
  } catch (e) {
    found.attached = false;
    found.error = String(e);
  }
  return found;
});

await b.close();

let bad = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  if (!cond) bad++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log("");
check("both toggles attach to the real DOM", r.attached === true, String(r.error ?? ""));
// IDEA-073 v2: TWO buttons in the HUD, ONE on the menu.
check("the HUD carries one bed button", r.bedButtons === 1, `found ${r.bedButtons}`);
check("the HUD carries one effects button", r.muteButtons === 1, `found ${r.muteButtons}`);
check("the menu carries one master button", r.soundButtons === 1, `found ${r.soundButtons}`);

const before = r.before as { sfx: boolean; bed: boolean } | undefined;
const afterBed = r.afterBed as { sfx: boolean; bed: boolean } | undefined;
const afterBoth = r.afterBoth as { sfx: boolean; bed: boolean } | undefined;
check("both start unmuted", before?.sfx === false && before?.bed === false);
check(
  "pressing the bed button mutes ONLY the bed",
  afterBed?.bed === true && afterBed?.sfx === false,
  JSON.stringify(afterBed),
);
check(
  "pressing the mute button then mutes the effects, bed untouched",
  afterBoth?.sfx === true && afterBoth?.bed === true,
  JSON.stringify(afterBoth),
);

// A missing glyph prints its own ligature name — "graphic_eq" at 20px is well
// over 100px wide — while a present one is a ~20px square. The LOWER bound is
// what stops this passing on a hidden element, which is how it passed the
// first time.
check(
  "the button draws a real glyph, not its own name",
  (r.glyphWidth as number) > 8 && (r.glyphWidth as number) < 40,
  `${r.glyphWidth}px wide, text "${r.glyph}"`,
);
check("...and it is the ambience glyph, not the speaker", r.glyph === "graphic_eq", String(r.glyph));
const masterOff = r.masterOff as { sfx: boolean; bed: boolean } | undefined;
const masterOn = r.masterOn as { sfx: boolean; bed: boolean } | undefined;
const fromHalf = r.fromHalf as { sfx: boolean; bed: boolean } | undefined;
check(
  "the menu button silences BOTH layers",
  masterOff?.sfx === true && masterOff?.bed === true,
  JSON.stringify(masterOff),
);
check(
  "...and restores both",
  masterOn?.sfx === false && masterOn?.bed === false,
  JSON.stringify(masterOn),
);
check(
  "pressing it half-muted silences the rest, never un-mutes half",
  fromHalf?.sfx === true && fromHalf?.bed === true,
  JSON.stringify(fromHalf),
);
check(
  "the menu icon follows a change made in the HUD",
  r.menuGlyphUnmuted === "volume_up" && r.menuGlyphAfterHud === "volume_off",
  `${r.menuGlyphUnmuted} -> ${r.menuGlyphAfterHud}`,
);
check("the bed volume persists", r.storedBedVolume === "0.35" && r.readBack === 0.35, `stored ${r.storedBedVolume}, read ${r.readBack}`);

console.log(
  bad === 0
    ? "\nall three controls are wired: two independent ones in the HUD, one master on the menu"
    : `\n${bad} problem(s)`,
);
if (bad > 0) process.exit(1);
