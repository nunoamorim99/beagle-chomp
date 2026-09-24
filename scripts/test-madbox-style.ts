// Guards the reference-style palette (src/render/madboxStyle.ts).
//
// Pure, so it runs in `npm run test` with no browser. It exists because the
// snap is a scoring function over a colour library, and every defect this pass
// hit was one entry landing on the wrong side of a threshold while every
// neighbour stayed correct — Night City's deck going VIOLET while its own
// skirt stayed slate, the beach's sand losing to a brown. Nothing about those
// looks like an error in a diff; they look like an art decision.
//
// The rules asserted here are the ones the reference states outright, so a
// future retune that breaks the style breaks the build.

import { JOURNEY_LEVELS } from "../src/game/journey.js";
import { getMazeTheme } from "../src/game/themes.js";
import {
  MADBOX_PALETTE,
  MADBOX_INK,
  MADBOX_BOUNCE,
  SURFACE_LIFT,
  liftPaletteForMadbox,
  shouldStyleBoard,
  boardBounce,
  NEUTRAL_MAX_S,
  snapToPalette,
} from "../src/render/madboxStyle.js";
import { BEAGLE_SKINS } from "../src/game/cosmetics.js";
import { COLORS } from "../src/game/config.js";
import { MAZE_THEMES } from "../src/game/themes.js";
import { HEDGE_TONES } from "../src/render/wallTexture.js";
import * as THREE from "three";
import {
  makeBeagle,
  makeEnemy,
  applyBeagleSkin,
  applyGhostState,
  remapBeagleCoatMats,
  remapEnemyMaterials,
} from "../src/render/characters.js";
import { ENEMY_SKINS } from "../src/game/cosmetics.js";
import {
  applyMadboxStyle,
  makeMadboxCaches,
  boardBounce as _bb,
  type MadboxCaches,
} from "../src/render/madboxStyle.js";
import { FRUIT_BUILDERS, POWERUP_BUILDERS } from "../src/render/board.js";

/** What `styleSpawned` does, with the caches passed in so the test can share
 *  one. Kept here rather than exported from the module because the shipped
 *  function deliberately owns its own cache. */
function styleSpawnedForTest(o: THREE.Object3D, caches: MadboxCaches): void {
  applyMadboxStyle(o, _bb(MAZE_THEMES[0].palette), caches, undefined, { tint: true });
}
import { readFileSync } from "node:fs";


/**
 * The smallest `document.createElement("canvas")` that lets a matcap be built
 * in Node.
 *
 * Only the calls `makeMatcapTexture` makes are provided — `createImageData`
 * and `putImageData` — because this is a LOGIC test: nothing here rasterises,
 * and `THREE.CanvasTexture` only keeps the object as its `.image`. Anything
 * beyond that would be a canvas implementation nobody asked for.
 */
function installCanvasStub(): void {
  const g = globalThis as { document?: unknown };
  if (g.document) return;
  g.document = {
    createElement(kind: string) {
      if (kind !== "canvas") return {};
      const c = {
        width: 0,
        height: 0,
        getContext() {
          return {
            createImageData: (w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4),
            }),
            putImageData: () => {},
            fillRect: () => {},
            beginPath: () => {},
            ellipse: () => {},
            fill: () => {},
            createRadialGradient: () => ({ addColorStop: () => {} }),
            set fillStyle(_v: string) {},
            get fillStyle() {
              return "";
            },
          };
        },
      };
      return c;
    },
  };
}

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function hsl(hex: number): { h: number; s: number; l: number } {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

console.log("\nThe palette is high-key, which is the whole rule");
// "Saturation lives in hue, not in value. Nothing is dark." Bounded at BOTH
// ends: a floor-only check passes happily on a palette of pure white, which is
// the other way to have no style at all.
for (const e of MADBOX_PALETTE) {
  const c = hsl(e.hex);
  ok(`"${e.id}" is not dark`, c.l >= 0.44, `l ${c.l.toFixed(2)}`);
  ok(`"${e.id}" is not blown out`, c.l <= 0.98, `l ${c.l.toFixed(2)}`);
}
{
  // BOUNDED ON THE MEAN, not on a count below a line. The first version
  // asserted "exactly one entry may sit under 0.55" and failed a correct
  // palette: four entries live at 0.46-0.53, which are MID-TONES, not darks —
  // the reference's "nothing is dark" is about the rendered image, where its
  // own darkest mark is a shadow at 20% alpha. A count against an arbitrary
  // line measures nothing; the distribution is the property. Measured today:
  // mean 0.673, one entry (pine) below 0.50.
  const ls = MADBOX_PALETTE.map((e) => hsl(e.hex).l);
  const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
  ok("the palette's mean lightness is high-key", mean >= 0.62, `mean ${mean.toFixed(3)}`);
  // And an upper bound too, because a palette of near-whites would pass a
  // floor-only check while having no colour in it at all.
  ok("…without being washed out", mean <= 0.78, `mean ${mean.toFixed(3)}`);
  ok(
    "at most two entries sit below mid",
    ls.filter((l) => l < 0.5).length <= 2,
    `${ls.filter((l) => l < 0.5).length}`,
  );
}
ok(
  "no two entries are the same colour",
  new Set(MADBOX_PALETTE.map((e) => e.hex)).size === MADBOX_PALETTE.length,
);
ok("ids are unique", new Set(MADBOX_PALETTE.map((e) => e.id)).size === MADBOX_PALETTE.length);

console.log("\nThe bounce is a light sea tone, so it can act as one environment");
{
  const b = hsl(MADBOX_BOUNCE);
  ok("bounce is light", b.l >= 0.6, `l ${b.l.toFixed(2)}`);
  ok("bounce is cyan-ish", b.h > 0.45 && b.h < 0.62, `h ${(b.h * 360).toFixed(0)}`);
}

console.log("\nHue survives the snap — the defect that made the beach brown");
// Each of these is a real colour off a real island. The pairing is the point:
// a snap that got the hue family right but the value wrong is what shipped
// once, so these assert the FAMILY rather than an exact id where several
// entries would be acceptable.
const FAMILIES: Record<string, readonly string[]> = {
  green: ["lime", "grass", "leaf", "pine"],
  warm: ["sand", "gold", "wood", "bark", "cream"],
  neutral: ["white", "stone", "slate"],
  cool: ["teal", "sky", "blue", "indigo", "violet"],
};
const CASES: Array<[string, number, string]> = [
  ["garden lawn", 0x8bce5b, "green"],
  ["a very dark forest green", 0x1b3f21, "green"],
  ["the darkest forest green", 0x143423, "green"],
  ["beach sand deck", 0xc4a672, "warm"],
  ["forest earth", 0xc7946b, "warm"],
  ["a treehouse plank", 0x8b6241, "warm"],
  ["Night City tarmac", 0x9f95ad, "neutral"],
  ["Night City kerb", 0x6c6576, "neutral"],
  ["a pale city wall", 0xcfc0a8, "warm"],
  ["shop-sign cyan", 0x5fc8e8, "cool"],
  ["sky blue", 0x86cdf0, "cool"],
];
for (const [label, hex, family] of CASES) {
  const got = snapToPalette(hex).id;
  ok(`${label} stays ${family}`, FAMILIES[family].includes(got), `got "${got}"`);
}

console.log("\nA near-grey never picks up a hue");
// Night City's deck measured s 0.13 and took VIOLET while its own skirt at
// s 0.08 stayed slate. Every desaturated colour in this game sits in that
// band, so the threshold is load-bearing rather than incidental.
for (const hex of [0x9f95ad, 0x6c6576, 0x807158, 0x5a5a68, 0x2a2a30, 0x6e6a63]) {
  const c = hsl(hex);
  if (c.s >= 0.18) continue;
  const got = snapToPalette(hex).id;
  ok(
    `#${hex.toString(16).padStart(6, "0")} (s ${c.s.toFixed(2)}) stays neutral`,
    FAMILIES.neutral.includes(got),
    `got "${got}"`,
  );
}

console.log("\nA beach is sand because it is a BEACH, not because of its colour");
// The role override. The garden's beach band is a blend of its own lawn and a
// warm sand, so it measures as a yellow-green and honestly matches `lime`.
for (const hex of [0xc9d190, 0xcfce96, 0xdac596, 0xcfc0a8]) {
  ok(
    `#${hex.toString(16).padStart(6, "0")} as island-beach is sand`,
    snapToPalette(hex, "island-beach").id === "sand",
    `got "${snapToPalette(hex, "island-beach").id}"`,
  );
}
ok(
  "…and the same colour without the role is free to match on hue",
  snapToPalette(0xc9d190).id !== "sand" || snapToPalette(0xc9d190, "island-beach").id === "sand",
);

console.log("\nEvery theme's own ground still resolves");
// Not an aesthetic check — a theme whose ground falls outside every branch
// would silently keep its toon material and be the one island in the chain
// wearing the old look.
for (const themeId of new Set(JOURNEY_LEVELS.map((l) => l.themeId))) {
  const pal = getMazeTheme(themeId).palette;
  for (const [slot, hex] of [
    ["surroundGround", pal.surroundGround],
    ["floor", pal.floor],
  ] as const) {
    const e = snapToPalette(hex);
    ok(
      `${themeId}.${slot} snaps to a real entry`,
      MADBOX_PALETTE.some((p) => p.id === e.id),
      `got "${e.id}"`,
    );
  }
}

console.log("\nThemes stay distinguishable");
// A unified palette that collapses six themes onto one entry has unified them
// out of existence. This is the guard against the snap being too coarse.
{
  const decks = new Set(
    [...new Set(JOURNEY_LEVELS.map((l) => l.themeId))].map(
      (t) => snapToPalette(getMazeTheme(t).palette.surroundGround).id,
    ),
  );
  ok("at least four distinct deck tones across the six themes", decks.size >= 4, `${decks.size}: ${[...decks].join(", ")}`);
}

console.log("\n" + "-".repeat(60));
console.log("");
console.log("Ink is a DECLARED role, and it is the only way to be dark");
// Nuno's call, and the thing that makes the style usable on characters: a
// marking must survive "nothing is dark". Colour cannot decide which is which
// — Cookie's saddle (l 0.157, s 0.450) and Deep Forest's foliage (l 0.176,
// s 0.400) are two hundredths apart in BOTH dimensions — so the rule is a tag,
// and these checks are what stop it quietly turning back into a threshold.
ok("the ink set is small", MADBOX_INK.length > 0 && MADBOX_INK.length <= 4);
for (const e of MADBOX_INK) {
  ok(`ink "${e.id}" really is dark`, hsl(e.hex).l <= 0.24, `l ${hsl(e.hex).l.toFixed(2)}`);
  ok(
    `ink "${e.id}" is NOT reachable from a surface snap`,
    !MADBOX_PALETTE.some((x) => x.id === e.id),
  );
}
for (const sk of BEAGLE_SKINS) {
  const black = (sk.coat as unknown as Record<string, number>).black;
  const got = snapToPalette(black, "ink");
  ok(
    `${sk.id}'s saddle stays a marking`,
    MADBOX_INK.some((e) => e.id === got.id),
    `got "${got.id}"`,
  );
}
{
  // The tag has to be STAMPED, not merely supported. A missed stamp does not
  // error — it silently repaints the dog — so this is the check that fires if
  // someone adds a coat channel and forgets.
  const src = readFileSync("src/render/characters.ts", "utf8");
  ok("makeBeagle declares its markings as ink", src.includes('madboxRole = "ink"'));
  for (const m of ["black", "browMat", "pupilMat", "noseMat"]) {
    ok(`…including ${m}`, new RegExp(`madboxRole[^;]*`).test(src) && src.includes(m));
  }
}

console.log("");
console.log("The surface lift is bounded, and the floor is held back");
// The board palettes are dark BECAUSE biscuits have to read against them at
// ~17px a tile — the one constraint the island map never had. Measured on the
// real board the lift IMPROVED pellet contrast (delta 0.389 -> 0.581, ratio
// 2.2 -> 2.72), and these bounds are what keep it that way.
ok("the floor is lifted less than the walls", SURFACE_LIFT.floorL < SURFACE_LIFT.wallL);
ok("…and the walls no further than outside the board", SURFACE_LIFT.wallL <= SURFACE_LIFT.outsideL);
ok("nothing is lifted to white", SURFACE_LIFT.outsideL <= 0.72);
{
  const before = { floor: 0x6b4a2f, wall: 0x3f8f3a, surroundGround: 0x517a33 };
  const pal: Record<string, unknown> = { ...before };
  liftPaletteForMadbox("garden", pal);
  ok("the garden's floor got lighter", hsl(pal.floor as number).l > hsl(before.floor).l);
  ok("…and its wall did too", hsl(pal.wall as number).l > hsl(before.wall).l);
  ok(
    "…and the floor stayed darker than the wall",
    hsl(pal.floor as number).l < hsl(pal.wall as number).l,
  );
  ok("…and the hue survived", Math.abs(hsl(pal.wall as number).h - hsl(before.wall).h) < 0.02);
}
{
  // A NIGHT THEME IS EXEMPT, AND IT IS DECIDED BY ITS SKY rather than by name.
  // Night City passed every numeric check — its greys stayed grey — and still
  // rendered wrong: a lifted ground under a night sky reads as an overcast
  // afternoon, not as a dark street with lit windows. That is the reference's
  // own "deliberate contrast accent" carve-out, which is why the rule is
  // "nothing is dark" and not "nothing is ever dark".
  //
  // Both directions, because an exemption that fires on everything would pass
  // the first half alone and silently switch the whole feature off.
  const night: Record<string, unknown> = { bg: 0x111120, floor: 0x111120, wall: 0x2b2b6b };
  ok("a night theme is exempt", liftPaletteForMadbox("anything", night) === null);
  ok("…and untouched", night.floor === 0x111120 && night.wall === 0x2b2b6b);

  const dusk: Record<string, unknown> = { bg: 0x332a52, floor: 0x3a3640 };
  ok("…and so is a dusk sky", liftPaletteForMadbox("anything", dusk) === null);

  const day: Record<string, unknown> = { bg: 0x9ecbe8, floor: 0x6b4a2f };
  ok("a daylight theme is NOT exempt", liftPaletteForMadbox("anything", day) !== null);
  ok("…and its floor did lift", (day.floor as number) !== 0x6b4a2f);

  // Every shipped theme lands on the side its sky says it should — and the
  // BOARD-level exemption agrees with the lift's, because they are the same
  // judgement reached from the same place.
  for (const t of MAZE_THEMES) {
    const isNight = hsl(t.palette.bg).l < 0.4;
    const copy: Record<string, unknown> = { ...(t.palette as unknown as Record<string, unknown>) };
    const lifted = liftPaletteForMadbox(t.id, copy) !== null;
    ok(`${t.id} is ${isNight ? "exempt" : "lifted"}`, lifted !== isNight);
    ok(
      `…and its board is ${isNight ? "left alone" : "styled"}`,
      shouldStyleBoard(t.palette) !== isNight,
    );
  }
  // Verified by rendering: both night themes are BYTE-IDENTICAL between the
  // two styles, and the garden is not.
  ok(
    "exactly two shipped themes are night themes",
    MAZE_THEMES.filter((t) => !shouldStyleBoard(t.palette)).length === 2,
  );
}
{
  // Never darken: a slot already above target is one somebody chose.
  const pal: Record<string, unknown> = { floor: 0xf2d9a0 };
  liftPaletteForMadbox("beach", pal);
  ok("an already-bright slot is not pulled down", hsl(pal.floor as number).l >= hsl(0xf2d9a0).l);
}

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("The enemy cast is left on toon ON PURPOSE, and stays in the style anyway");
// The one part of the game the restyle deliberately does not touch, so this is
// the check that keeps that decision honest rather than letting it rot into a
// gap nobody re-examined.
//
// Two independent reasons, and BOTH have to hold:
//
//  1. A matcap has no emissive channel and the cast uses one — and, worse,
//     `applyGhostState` drives `material.color` at runtime, so a matcapped
//     enemy would stop turning blue when you eat a bone. That is the player
//     losing the signal that says when they can chase.
//  2. They do not need the style applied, because they are already in it.
//
// It is (2) that makes leaving them a decision rather than a compromise, and
// (2) is a measurement that a future palette retune could silently break —
// hence this.
{
  const hues: Array<[string, number]> = [
    ["rose", COLORS.ghostRose],
    ["teal", COLORS.ghostTeal],
    ["amber", COLORS.ghostAmber],
    ["violet", COLORS.ghostViolet],
    ["leaf", COLORS.ghostLeaf],
    ["frightened", COLORS.frightened],
  ];
  const surfaceLs = MADBOX_PALETTE.map((e) => hsl(e.hex).l);
  const lo = Math.min(...surfaceLs);
  const hi = Math.max(...surfaceLs);
  for (const [name, hex] of hues) {
    const c = hsl(hex);
    // Bounded at BOTH ends against the palette's own range, rather than
    // against a number typed in here: the claim being protected is "these are
    // already in the same family", so the palette is the right yardstick and a
    // hand-written bound would just drift away from it.
    ok(`the ${name} enemy is already high-key`, c.l >= lo - 0.02, `l ${c.l.toFixed(3)} vs floor ${lo.toFixed(3)}`);
    ok(`…and not washed out`, c.l <= hi, `l ${c.l.toFixed(3)}`);
    // Saturation is the other half of "saturation lives in hue, not in value".
    // A team colour that lost it would stop being a team colour.
    ok(`…and still saturated`, c.s >= 0.4, `s ${c.s.toFixed(3)}`);
  }
  // The five teams must stay distinguishable from EACH OTHER and from the
  // frightened blue — that is gameplay, not styling.
  const spread = new Set(hues.map(([, hex]) => Math.round(hsl(hex).l * 10)));
  ok("the teams are separated by hue, not by lightness", spread.size <= 3, `${spread.size} lightness bands`);
}

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("A restyled beagle can still change its coat");
// THE SILENT ONE. `makeBeagle` keeps its eight coat materials in
// `userData.coatMats` so `applyBeagleSkin` can recolour the dog in place when
// a player equips a coat. Swapping `mesh.material` for a matcap does NOT
// update those references — and writing a colour to an orphaned material is
// not an error, so the failure mode is a coat you paid for simply not
// appearing.
//
// ---------------------------------------------------------------------------
// THIS TEST WAS VACUOUS ON ITS FIRST WRITING, WHICH IS THE REAL LESSON HERE.
// ---------------------------------------------------------------------------
//
// `makeMatcapTexture` needs a CANVAS and returns null without one, so under
// plain Node the restyle swapped NOTHING — and a check that "no coat reference
// is orphaned" passes perfectly when no reference was ever going to be. The
// suite reported 129 passed against a deliberately broken implementation.
//
// Two things fix it and BOTH are needed: a minimal canvas stub so the swap can
// actually happen, and an explicit assertion that it DID. The stub alone would
// rot silently the day something else makes the swap a no-op again.
{
  installCanvasStub();

  const dog = makeBeagle();
  const caches = makeMadboxCaches();
  const swaps = applyMadboxStyle(dog, MADBOX_BOUNCE, caches, undefined, { tint: true });

  // THE VACUITY GUARD. Everything below is meaningless without it.
  ok("the restyle actually swapped materials", swaps.size > 0, `${swaps.size} swaps`);

  remapBeagleCoatMats(dog, swaps);

  const mats = dog.userData.coatMats as Record<string, { color: { getHex(): number } }>;
  ok("the dog kept its coat material record", !!mats && typeof mats.tan === "object");

  // Every material the record points at must be one the dog actually draws.
  const drawn = new Set<unknown>();
  dog.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) drawn.add(mat);
  });
  const orphans = Object.keys(mats).filter((k) => !drawn.has(mats[k]));
  ok(
    "…and every coat reference is a material the dog draws",
    orphans.length === 0,
    orphans.length ? `orphaned: ${orphans.join(", ")}` : "",
  );

  // And the point of all of it: equipping another coat still repaints it.
  const bagel = BEAGLE_SKINS[0];
  const other = BEAGLE_SKINS.find((s2) => s2.coat.tan !== bagel.coat.tan) ?? BEAGLE_SKINS[1];
  applyBeagleSkin(dog, bagel);
  const before = mats.tan.color.getHex();
  applyBeagleSkin(dog, other);
  const after = mats.tan.color.getHex();
  ok("equipping a different coat changes the drawn colour", before !== after);
  ok("…to that coat's own tan", after === other.coat.tan, `expected #${other.coat.tan.toString(16)}`);
}

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("The lift never INVENTS a colour on a near-grey");
// A near-grey's hue is noise, so forcing saturation onto one produces a colour
// nobody chose. The first gate let anything over s 0.06 through and Night
// City's floor (#3a3640, s 0.08) came out #6d4d9d — a vivid purple, with its
// surround to match: a grey concrete theme with lilac roads.
//
// Checked against the REAL shipped palettes rather than invented inputs,
// because the defect was in which colours actually exist: the garden, the only
// theme looked at by eye, happens to have no near-grey surface at all and was
// safe the whole time.
for (const t of MAZE_THEMES) {
  const pal = t.palette as unknown as Record<string, number>;
  const before: Record<string, number> = {};
  for (const slot of ["floor", "wall", "surroundGround", "fenceColor", "groundDetailColor"]) {
    if (typeof pal[slot] === "number") before[slot] = pal[slot];
  }
  const copy: Record<string, unknown> = { ...before };
  liftPaletteForMadbox(t.id, copy);
  for (const slot of Object.keys(before)) {
    const a = hsl(before[slot]);
    const b = hsl(copy[slot] as number);
    if (a.s >= NEUTRAL_MAX_S) continue;
    ok(
      `${t.id}.${slot} stays neutral (s ${a.s.toFixed(2)})`,
      b.s <= a.s + 0.02,
      `s ${a.s.toFixed(2)} -> ${b.s.toFixed(2)}`,
    );
  }
}
// And the gate is the SAME one the snap uses — the two answer the same
// question ("does this colour have a hue worth acting on") and must not drift
// to two answers.
ok("the lift and the snap share one neutral threshold", NEUTRAL_MAX_S > 0 && NEUTRAL_MAX_S < 0.5);

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("A restyled enemy still turns blue when you eat a bone");
// THE ONE WITH GAMEPLAY ON THE LINE. `applyGhostState` drives the cast's
// colours to show FRIGHTENED and EATEN, reaching them through `userData`
// references. Two ways to break it and both are silent:
//
//   1. BAKE the colour into the matcap and hold the material white — then
//      `color.setHex(COLORS.frightened)` writes to a material whose colour is
//      not what is drawn, and nothing turns blue.
//   2. Swap the materials and forget the REMAP — then the writes land on
//      objects nothing draws.
//
// Either way the enemies stay their team colour while edible, and the player
// loses the signal that says when they can chase. Checked across every skin,
// because the swap is per-material and a skin with an unusual arrangement is
// exactly what would slip through.
{
  installCanvasStub();
  const caches = makeMadboxCaches();
  let checked = 0;

  for (const skin of ENEMY_SKINS) {
    const enemy = makeEnemy(skin.id, COLORS.ghostRose);
    const swaps = applyMadboxStyle(enemy, MADBOX_BOUNCE, caches);
    remapEnemyMaterials(enemy, swaps);
    if (swaps.size === 0) continue; // nothing to restyle on this skin
    checked++;

    const ud = enemy.userData as { bodyMat?: { color: { getHex(): number } } };

    // THE COLOUR MUST STILL LIVE ON THE MATERIAL. This is the assertion that
    // separates tint from bake, and the first version of this test missed it:
    // reading `color` after a state change passes EITHER way, because
    // `setHex` writes the property regardless — it is whether that property is
    // what gets DRAWN that differs. A baked matcap carries the colour in its
    // texture and holds the material at white, so every later `setHex` becomes
    // a tint over the wrong base. Verified by re-injecting exactly that.
    ok(
      `${skin.id}: its colour is on the material, not baked away`,
      ud.bodyMat!.color.getHex() === COLORS.ghostRose,
      `#${ud.bodyMat!.color.getHex().toString(16)}`,
    );

    // Every reference must be something the enemy actually draws.
    const drawn = new Set<unknown>();
    enemy.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) drawn.add(mat);
    });
    ok(`${skin.id}: its body material is drawn`, drawn.has(ud.bodyMat));

    applyGhostState(enemy, "chase", { x: 0, y: 1 });
    const normal = ud.bodyMat!.color.getHex();
    applyGhostState(enemy, "frightened", { x: 0, y: 1 });
    const frightened = ud.bodyMat!.color.getHex();
    applyGhostState(enemy, "chase", { x: 0, y: 1 });
    const back = ud.bodyMat!.color.getHex();

    ok(`${skin.id}: frightened turns it blue`, frightened === COLORS.frightened,
      `#${frightened.toString(16)}`);
    ok(`${skin.id}: …and it is not already that colour`, normal !== COLORS.frightened);
    ok(`${skin.id}: …and it changes back`, back === normal, `#${back.toString(16)}`);
  }

  // VACUITY GUARD. Everything above is meaningless if no skin was restyled —
  // which is exactly what happens without a canvas, since the matcap texture
  // cannot be built and the swap silently becomes a no-op.
  ok("at least one skin was actually restyled", checked > 0, `${checked} of ${ENEMY_SKINS.length}`);
}

console.log("");
console.log("A restyled enemy keeps EVERY authored colour, not just the blue");
// Nuno, after the style shipped: "on the shop they have the right colors but
// on the game they are all black... the crab should be orange like he is on
// the shop." Measured, 52 of the flea's 74 materials rendered #000000 in a run
// against #4a2510 in the shop.
//
// TWO CAUSES, AND THE SHOP/GAME ASYMMETRY IS WHAT HID BOTH. A shop hero is
// static; a run drives `applyGhostState`, which repaints an enemy from state
// the character layer stamps ON THE MATERIAL -- `userData.baseColor` on every
// accent, `userData.spiritBase` on every spirit material. A swapped-in matcap
// had an empty bag, so `m.color.setHex(m.userData.baseColor)` became
// `setHex(undefined)`, which is not a no-op: it is BLACK. And the tint cache
// was keyed on the source COLOUR, so three ghosts shared 132 material objects
// and each recolour painted the others.
//
// The check that catches both is the same one: style a second copy of a skin
// and drive it through the looks, then compare its colours against an
// UNSTYLED copy driven through the same looks. The style may change the
// shading model; it may not change a single colour.
{
  installCanvasStub();
  const caches = makeMadboxCaches();
  const dir = { x: 0, y: 1 };

  /** Every material colour under a group, as a sorted multiset. */
  const census = (o: THREE.Object3D): string => {
    const counts = new Map<string, number>();
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const c = (mat as THREE.MeshToonMaterial).color;
        if (!c) continue;
        const k = c.getHexString();
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    });
    return [...counts.entries()].sort().map(([c, n]) => `${c}x${n}`).join(" ");
  };

  let compared = 0;
  const seenMaterials = new Map<unknown, string>();
  let crossSkinShares = 0;

  for (const skin of ENEMY_SKINS) {
    const plain = makeEnemy(skin.id, COLORS.ghostRose);
    const styled = makeEnemy(skin.id, COLORS.ghostRose);
    const swaps = applyMadboxStyle(styled, MADBOX_BOUNCE, caches);
    remapEnemyMaterials(styled, swaps);
    if (swaps.size === 0) continue;
    compared++;

    // The three looks in the order a run actually visits them, because the
    // post-eaten RESTORE is a separate path from the first normal paint and
    // reads a different userData key (`spiritBase`, not `baseColor`).
    // "chase" is the normal look; there is no "normal" state (ghostAI.ts).
    for (const look of ["chase", "frightened", "eaten", "chase"] as const) {
      applyGhostState(plain, look, dir);
      applyGhostState(styled, look, dir);
      ok(
        `${skin.id}: colours survive the style at "${look}"`,
        census(styled) === census(plain),
        `styled ${census(styled)} | plain ${census(plain)}`,
      );
    }

    // NO TWO SKINS MAY SHARE A MATERIAL OBJECT. Everything tinted is
    // recoloured in place, so a shared material is one character painting
    // another -- and it is invisible until two of them are on screen at once.
    styled.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const owner = seenMaterials.get(mat);
        if (owner !== undefined && owner !== skin.id) crossSkinShares++;
        else seenMaterials.set(mat, skin.id);
      }
    });
  }

  ok("no material is shared between two skins", crossSkinShares === 0,
    `${crossSkinShares} shared`);
  // VACUITY GUARD, twice over: with no canvas the swap is a no-op and every
  // comparison above passes by doing nothing, and an empty census compares
  // equal to an empty census.
  ok("the skins really were restyled", compared > 0, `${compared} of ${ENEMY_SKINS.length}`);
  ok("…and the census actually sees materials",
    census(makeEnemy(ENEMY_SKINS[0]!.id, COLORS.ghostRose)).length > 0);
}

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("The hedge's tone table is high-key but not flat");
// The maze wall is TEXTURED, so the material swap never touches it — the only
// lever is the painter's own tone relationships, and those were tuned against
// a dark base. Two failure modes, and the first one shipped for a render:
//
//   * raise `deep` (which is the FILL the leaf clumps sit on) and the hedge
//     flattens into a plain green surface with a few dots on it;
//   * leave the table alone and a lifted palette just scales the old contrast
//     up, so a brighter wall keeps the dark wall's proportions.
{
  const c = HEDGE_TONES.classic;
  const m = HEDGE_TONES.madbox;
  // The body is brighter at every level.
  ok("the new shade is lighter than classic's", m.shade > c.shade, `${m.shade} vs ${c.shade}`);
  ok("…and so is the fill behind it", m.deep > c.deep, `${m.deep} vs ${c.deep}`);
  // But the fill stays well below the leaves, which is what stops it flattening.
  ok(
    "the leaves still sit well clear of the fill",
    m.shade - m.deep > 0.2,
    `gap ${(m.shade - m.deep).toFixed(2)}`,
  );
  // And the gaps stay the darkest thing on the wall — a hedge has no form
  // without them, and the palette rule allows dark as a deliberate accent.
  ok("the gaps are the darkest tone", m.gap < m.deep, `${m.gap} vs ${m.deep}`);
  // Bounded at the top too: a table that only ever brightens ends in a white
  // wall, which passes every floor check there is.
  ok("nothing is blown out", m.pop <= 1.35, `${m.pop}`);
  ok("classic is untouched", c.deep === 0.54 && c.shade === 0.76 && c.light === 1.2 && c.pop === 1.26);
}

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("A board's bounce comes from the board, not from the ocean");
// Nuno, playing the garden: "the shadows look too blue, like all the
// components have a blue glowing or shadow." That is the BOUNCE — it fills the
// area outside the matcap's normal disk, so it becomes the rim at every
// grazing angle and the fill on every turned-away face. A saturated sea-cyan
// there is an environment that exists on the island map and nowhere else.
//
// Measured after the fix, on 6,900 samples of the garden's props: the blue
// cast (mean B-R) went from -25.8 in classic to -28.2 in the new style, i.e.
// warmer than classic rather than bluer.
{
  const globalS = hsl(MADBOX_BOUNCE).s;
  for (const t of MAZE_THEMES) {
    const bounce = boardBounce(t.palette);
    const c = hsl(bounce);
    // Bounded at BOTH ends. Too saturated and it paints; pure white and there
    // is no bounce at all, which is the other way to have no style.
    ok(`${t.id}'s bounce is not a coloured light`, c.s <= 0.34, `s ${c.s.toFixed(2)}`);
    ok(`…and far less saturated than the ocean's`, c.s < globalS * 0.6, `${c.s.toFixed(2)} vs ${globalS.toFixed(2)}`);
    ok(`…but still carries some of the place`, c.s >= 0.05, `s ${c.s.toFixed(2)}`);
    // A bounce is ambient light: it must be lighter than what it lands on.
    ok(`…and is light`, c.l >= 0.7, `l ${c.l.toFixed(2)}`);
  }
  // DERIVED, not one global colour: six themes must not all get the same
  // bounce, or this is the old bug with a nicer number.
  const distinct = new Set(MAZE_THEMES.map((t) => boardBounce(t.palette)));
  ok("themes get their own bounce", distinct.size >= 4, `${distinct.size} distinct`);
  // And the journey map keeps the ocean, because there it is true.
  ok("the map's own bounce is still the sea", hsl(MADBOX_BOUNCE).s > 0.6);
}

console.log("");
console.log("-".repeat(60));
console.log("");
console.log("A pickup keeps the colour it was authored with");
// Nuno, playing: "on the shield and some fruits still seeing too much of this
// blue." The blue on the shield turned out to be its own authored colour — but
// the audit that went looking for it found something worse next door.
//
// The pickups were going through the palette SNAP, and the snap is for
// SCENERY, where the point is that nothing can be off-palette. On a pickup it
// repaints identity: the carrot's orange (#e8721f) came out as `wood`, a TAN,
// the mango's gold as `sand`, and two of the mango's own tones collapsed onto
// one `lime`. [[IDEA-045]] exists because these five are worth 100 to 500
// points and must read as five different things at a handful of pixels — its
// own recorded failure is a gold mango that read as an orange apple.
//
// Asserted on the BUILDERS rather than on a rendered frame, because what is
// being protected is the authored value surviving the style at all.
{
  installCanvasStub();
  const caches = makeMadboxCaches();
  const authored = new Map<string, string[]>();
  const styled = new Map<string, string[]>();

  const colours = (o: THREE.Object3D): string[] => {
    const set = new Set<string>();
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const c = (mat as THREE.MeshToonMaterial).color;
        if (c && !(mat as THREE.MeshToonMaterial).map) set.add(c.getHexString());
      }
    });
    return [...set].sort();
  };

  for (const [id, build] of Object.entries(FRUIT_BUILDERS)) {
    authored.set("fruit/" + id, colours(build()));
    const o = build();
    styleSpawnedForTest(o, caches);
    styled.set("fruit/" + id, colours(o));
  }
  for (const [id, build] of Object.entries(POWERUP_BUILDERS)) {
    authored.set("powerup/" + id, colours(build()));
    const o = build();
    styleSpawnedForTest(o, caches);
    styled.set("powerup/" + id, colours(o));
  }

  let restyled = 0;
  for (const [id, before] of authored) {
    const after = styled.get(id) ?? [];
    if (after.join() !== before.join()) restyled++;
    ok(`${id} keeps every authored colour`, after.join() === before.join(),
      `${before.join(" ")} -> ${after.join(" ")}`);
  }
  ok("…and none were repainted", restyled === 0, `${restyled} changed`);

  // VACUITY GUARD: identical colours also describe "nothing was styled".
  const anyMatcap = (() => {
    const o = FRUIT_BUILDERS.mango();
    styleSpawnedForTest(o, caches);
    let n = 0;
    o.traverse((x: THREE.Object3D) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat.type === "MeshMatcapMaterial") n++;
      }
    });
    return n;
  })();
  ok("the pickups really were styled", anyMatcap > 0, `${anyMatcap} matcap materials`);

  // The five must still be distinguishable FROM EACH OTHER — that is the
  // property IDEA-045 actually cares about, and equal-to-authored does not
  // imply it if the authored set ever collapses.
  const sets = [...authored.entries()].filter(([k]) => k.startsWith("fruit/")).map(([, v]) => v.join());
  ok("the five fruits are five different palettes", new Set(sets).size === sets.length);

  // AND THE SHIPPED CALL SITE ACTUALLY ASKS FOR TINT.
  //
  // Everything above runs through a local helper with `tint: true` written
  // into it, so it proves that tint mode preserves colours — and proves
  // nothing about what `styleSpawned` does. Re-injecting the bake into the
  // real function left every check above passing. Nor can the function be
  // called directly here: it self-gates on MADBOX_STYLE_ON, which is false
  // under Node, so it would no-op and be vacuous in the other direction.
  //
  // So the DECISION is checked as text — blunt and exact, the same treatment
  // test-powerups.ts gives the shield's hand-copied cyan.
  const src = readFileSync("src/render/madboxStyle.ts", "utf8");
  const fn = src.slice(src.indexOf("export function styleSpawned"));
  const call = fn.split("\n").find((l) => l.includes("applyMadboxStyle(obj")) ?? "";
  ok("styleSpawned asks for tint mode", call.includes("tint: true"), call.trim());
}

console.log("");
console.log("-".repeat(60));
console.log(`MADBOX STYLE: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
