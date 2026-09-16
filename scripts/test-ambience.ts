// IDEA-073: guards the themed AMBIENCE BEDS — the one continuous sound each
// theme plays under a run and under the menu.
//
// Headless by necessity AND by design. ambience.ts builds a Web Audio graph,
// which Node has no implementation of, so nothing here can start a bed or
// listen to one. What it CAN do is guard every rule that is decided before a
// single sample is produced — and those are the rules that fail silently: an
// audio defect announces itself the moment you press Play, whereas a theme
// with no bed, a bed two themes share, or an icon that is not in the font
// subset all look completely fine until someone puts headphones on.
//
// FIVE THINGS IT EXISTS FOR.
//
//  1. EVERY THEME DECLARES A BED, AND THE COMPILER ONLY HALF-ENFORCES IT.
//     `MazeTheme.ambience` is required, so a theme with the field MISSING will
//     not build — but a theme with `ambience: "none"` builds perfectly and is
//     silent, which is the actual failure mode. Only Arcade Night may be
//     silent, and it is silent on purpose (Nuno's call: it is the neon tribute
//     board whose `surround` is already "none").
//
//  2. TWO THEMES SHARING A BED IS A COPY-PASTE, NOT A DECISION. The five
//     sounded themes claim five different kinds. If a sixth theme is added by
//     duplicating an entry — which is how every theme in that file was
//     written — the bed is the field most likely to be left pointing at its
//     donor, and standing in Deep Forest listening to the beach is not
//     something any other check would notice.
//
//  3. AN ICON THAT IS NOT IN `ICON` IS NOT IN THE FONT. The subset is cut from
//     ICON's values and nothing else, so a glyph addressed any other way
//     renders as its own ligature NAME in plain text — which is exactly how
//     the shop's Beetle, Bee and Ladybug cards printed "PEST_CONTROL", "HIVE"
//     and "BUG_REPORT" across the rail for three releases. The bed button is a
//     new glyph, so it is a new chance to do it again.
//
//  4. THE MARKUP AND THE WIRING MUST AGREE ON A CLASS NAME. attachBedButton
//     THROWS when it finds no `.bed-btn`, which is loud and fine — but it
//     throws inside Game's constructor, so the symptom is a black screen at
//     boot rather than a missing button.
//
//  5. THE BED SURVIVES A THEME SAVE. `boardCodegen` writes MazeTheme's fields
//     BY HAND; test-board-surfaces derives its list from the interface and so
//     covers `ambience` for free, but the value it writes must also be a
//     STRING LITERAL. `secret: true` was dropped this way once already.

import { readFileSync } from "node:fs";
import { MAZE_THEMES, TRIBUTE_MAZE_THEME_ID } from "../src/game/themes";
import { AMBIENCE_KINDS, type AmbienceKind } from "../src/ui/ambience";
import { ICON } from "../src/ui/icons";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const indexSrc = read("index.html");
const soundSrc = read("src/ui/sound.ts");
const ambienceSrc = read("src/ui/ambience.ts");
const codegenSrc = read("src/editor/boardCodegen.ts");
const gameSrc = read("src/game/game.ts");

// ---------------------------------------------------------------------------
section("Every theme says what it sounds like");

for (const theme of MAZE_THEMES) {
  ok(
    `${theme.id} declares a bed`,
    typeof theme.ambience === "string" && theme.ambience.length > 0,
    `got ${JSON.stringify(theme.ambience)}`,
  );
  ok(
    `${theme.id}'s bed is a kind ambience.ts knows`,
    AMBIENCE_KINDS.includes(theme.ambience),
    `"${theme.ambience}" is not one of ${AMBIENCE_KINDS.join(", ")}`,
  );
}

const silent = MAZE_THEMES.filter((t) => t.ambience === "none");
ok(
  "exactly one theme is silent",
  silent.length === 1,
  `silent: ${silent.map((t) => t.id).join(", ") || "(none)"}`,
);
ok("...and it is Arcade Night", silent[0]?.id === TRIBUTE_MAZE_THEME_ID, `got ${silent[0]?.id}`);

// Rule 2: five sounded themes, five different beds.
const sounded = MAZE_THEMES.filter((t) => t.ambience !== "none");
const kinds = new Set<AmbienceKind>(sounded.map((t) => t.ambience));
ok(
  "no two themes share a bed",
  kinds.size === sounded.length,
  `${sounded.length} sounded themes, ${kinds.size} distinct beds — ` +
    sounded.map((t) => `${t.id}=${t.ambience}`).join(" "),
);

// A kind that is in the union and named by a theme but has no case in
// `build()` falls straight through to silence — which is rule 1 again, one
// layer down, and this is the only place it can be seen without listening.
for (const kind of kinds) {
  ok(
    `ambience.ts builds "${kind}"`,
    new RegExp(`case "${kind}":`).test(ambienceSrc),
    "add a case to build(), or the theme is silent",
  );
}

// ---------------------------------------------------------------------------
section("The bed follows what the board WEARS");

// IDEA-063 forces a theme per challenge level, owned or not. Keying the bed
// off the EQUIPPED theme would leave the ears in the wrong place — the same
// defect restoreEquippedTheme exists to stop for the eyes.
ok(
  "syncAmbience reads sceneThemeId",
  /syncAmbience\(\): void \{[\s\S]{0,200}?getMazeTheme\(this\.sceneThemeId\)\.ambience/.test(gameSrc),
  "the bed must follow the scene theme, not the equipped one",
);
ok(
  "the old menu-only bed is gone",
  !/menuBed/.test(gameSrc) && !/menuBed/.test(soundSrc),
  "two bed implementations is one that drifts",
);
ok(
  "stopping the Game stops the bed",
  /ambience\("none"\)/.test(gameSrc),
  "a looping AudioBufferSourceNode outlives the Game and nothing else holds a handle on it",
);

// ---------------------------------------------------------------------------
section("The two mutes are independent, and neither is the old one renamed");

ok("the effects mute keeps its storage key", /"bc_muted"/.test(soundSrc));
ok("the bed mute has its own", /"bc_bed_muted"/.test(soundSrc));
ok("both volumes persist", /"bc_vol_sfx"/.test(soundSrc) && /"bc_vol_bed"/.test(soundSrc));
// The whole point of the split: cues and beds land on different buses, so
// neither button can silence the other's layer.
ok("cues route through sfxBus", /destination \?\? sfxBus/.test(soundSrc));
ok("the interface layer is an EFFECT", /uiBus\.connect\(sfxBus\)/.test(soundSrc));
ok("the bed has a bus of its own", /createAmbience\(ctx, bedBus\)/.test(soundSrc));

// ---------------------------------------------------------------------------
section("The button exists, is addressable, and has a real glyph");

ok("ICON names the bed's glyph", typeof ICON.ambienceOn === "string" && ICON.ambienceOn.length > 0);
ok(
  "the HUD carries a .bed-btn",
  /class="bed-btn" id="bedBtn"/.test(indexSrc),
  "attachBedButton throws inside Game's constructor when it finds none",
);
// IDEA-073 v2 (Nuno): the MENU carries ONE button, not two -- a run has both
// layers competing and a menu does not, so splitting it there would be two
// controls for one decision. It is a MASTER toggle rather than a second copy
// of either, which is why it has its own class: attachMuteButton wires EVERY
// `.mute-btn` on the page to the effects flag, so leaving that class on the
// menu button would have silently made it an effects-only control again.
ok(
  "the menu carries exactly one sound button",
  /class="sound-btn" id="menuMuteBtn"/.test(indexSrc) && !/menuBedBtn/.test(indexSrc),
  "the menu takes a single master toggle",
);
ok(
  "...and it is NOT wired as an effects-only button",
  !/class="[^"]*mute-btn[^"]*" id="menuMuteBtn"/.test(indexSrc),
  "`.mute-btn` would make attachMuteButton claim it",
);
ok(
  "the master toggle moves BOTH flags",
  /selector: "\.sound-btn"[\s\S]{0,400}?setMuted\(!silenced\)[\s\S]{0,120}?setBedMuted\(!silenced\)/.test(
    soundSrc,
  ),
  "one button, one decision: make it quiet",
);
// Two independent toggles over overlapping state can disagree about what they
// are showing -- muting effects in the HUD changes what the menu's master
// button ought to draw. Before the split that was free (one handler drove
// every `.mute-btn`), so this subscription is what replaces it.
ok(
  "every button re-renders when another moves the state",
  /sound\.onStateChange\(render\)/.test(soundSrc),
  "otherwise the menu's icon lies about the state it is in",
);
// Rule 3: the markup's literal must be the glyph ICON names, or the font
// subset (cut from ICON) will not contain it and the button prints the word.
ok(
  "the markup's glyph is the one ICON names",
  new RegExp(
    `class="bed-btn"[^>]*><i class="bc-i" aria-hidden="true">${ICON.ambienceOn}<`,
  ).test(indexSrc),
  `index.html must use "${ICON.ambienceOn}" — anything else is not in the font`,
);

// ---------------------------------------------------------------------------
section("A theme saved from the editor keeps its bed");

ok("boardCodegen carries ambience on WorkingTheme", /ambience: AmbienceKind;/.test(codegenSrc));
ok(
  "...and writes it as a QUOTED literal",
  /ambience: \$\{str\(theme\.ambience\)\}/.test(codegenSrc),
  "unquoted emits `ambience: birds,` — a themes.ts that does not compile",
);

// ---------------------------------------------------------------------------
console.log(`\n${"-".repeat(60)}`);
console.log(`AMBIENCE: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
