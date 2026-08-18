// OWNER: backend
//
// Generates server/src/catalog.generated.ts from the REAL game modules in
// ../src/game. Run by `npm run sync` and in the Docker build.
//
// Why generate instead of importing directly:
//   - themes.ts is ~600 lines of palettes, prop placements and wall decor. The
//     server needs exactly two things from it: which ids exist and what they
//     cost. Vendoring the whole file would drag render-shaped data into the API
//     for no reason.
//   - The frontend is compiled by Vite with moduleResolution "bundler"; the
//     server is plain NodeNext. Importing across that boundary means extension
//     rules that fight each other.
//
// Why generate rather than hand-copy: prices are money. If a skin's price
// changes in cosmetics.ts and the server keeps charging the old one, the
// mismatch is silent and only shows up as a player being over- or under-charged.
// A generated file plus the drift test in scripts/test-catalog.ts makes that a
// build failure instead.
//
// This is the same "share the game's real constants" argument that decided the
// monorepo layout — see the plan. Increment 2's plausibility validator will
// consume config.ts and mazes.json the same way.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const GAME_DIR = join(SERVER_DIR, "..", "src", "game");
const OUT_FILE = join(SERVER_DIR, "src", "catalog.generated.ts");

/** Pull `{ id: "...", ..., price: N }` pairs out of a source file.
 *
 *  A regex over TypeScript source is normally a bad idea, but here it is the
 *  pragmatic choice: the alternative is compiling the frontend's module graph
 *  (which pulls in Vite-flavoured resolution) just to read two fields. The
 *  registries are hand-written literal arrays in a stable shape, and the
 *  count assertions below turn any format surprise into a loud build failure
 *  rather than a silently short catalog. */
function extractIdPricePairs(source: string): Array<{ id: string; price: number }> {
  const out: Array<{ id: string; price: number }> = [];
  // Match an id, then the FIRST price that follows it before the next id.
  const entryRe = /\bid:\s*"([a-z0-9-]+)"([\s\S]*?)(?=\bid:\s*"|$)/g;

  for (const match of source.matchAll(entryRe)) {
    const id = match[1];
    const body = match[2] ?? "";
    const priceMatch = /\bprice:\s*(\d+)/.exec(body);
    if (priceMatch) {
      out.push({ id, price: Number(priceMatch[1]) });
    }
  }
  return out;
}

function extractDefaultId(source: string, constName: string): string {
  const re = new RegExp(`export const ${constName}\\s*=\\s*"([a-z0-9-]+)"`);
  const m = re.exec(source);
  if (!m) throw new Error(`could not find ${constName}`);
  return m[1];
}

/** Enemy skins are one-liners (`{ id: "bee", name: "Bee", price: 5 }`) inside
 *  ENEMY_SKINS, while beagle skins are large multi-line objects with nested
 *  coat colours. Slice to the named array first so the two can't bleed. */
function sliceArray(source: string, constName: string): string {
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) throw new Error(`could not find ${constName}`);

  // Start scanning AFTER the `=`. Searching for the first "[" from the
  // declaration would instead find the one in the type annotation
  // (`readonly BeagleSkin[]`) and slice an empty array.
  const eq = source.indexOf("=", start);
  if (eq === -1) throw new Error(`could not find = for ${constName}`);

  const open = source.indexOf("[", eq);
  if (open === -1) throw new Error(`could not find opening [ for ${constName}`);

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced brackets in ${constName}`);
}

const cosmeticsSrc = readFileSync(join(GAME_DIR, "cosmetics.ts"), "utf-8");
const themesSrc = readFileSync(join(GAME_DIR, "themes.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Increment 2: the constants the plausibility validator scores runs against.
//
// These MUST track the game exactly. If the game rebalances SCORE.biscuit or a
// maze gains pellets and the server keeps the old numbers, every honest run
// starts failing validation — a silent, infuriating bug. Generating them (and
// asserting on them in test-plausibility.ts) turns that into a build failure.

/** Pull a numeric field out of an `export const NAME = { ... }` block. */
function numberField(source: string, constName: string, field: string): number {
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) throw new Error(`could not find ${constName}`);
  const scope = source.slice(start, start + 900);
  const m = new RegExp(`\\b${field}:\\s*([0-9.]+)`).exec(scope);
  if (!m) throw new Error(`could not find ${constName}.${field}`);
  return Number(m[1]);
}

function numberConst(source: string, constName: string): number {
  const m = new RegExp(`export const ${constName}\\s*=\\s*([0-9.]+)`).exec(source);
  if (!m) throw new Error(`could not find ${constName}`);
  return Number(m[1]);
}

/** `export` is optional: FRUIT_THRESHOLDS is a module-local const in game.ts
 *  (deliberately, per that file's comment) while the others are exported from
 *  config.ts. */
function numberArray(source: string, constName: string): number[] {
  const m = new RegExp(`(?:export )?const ${constName}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!m) throw new Error(`could not find ${constName}`);
  return m[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

const configSrc = readFileSync(join(GAME_DIR, "config.ts"), "utf-8");
const challengesSrc = readFileSync(join(GAME_DIR, "challenges.ts"), "utf-8");
// FRUIT_THRESHOLDS lives in game.ts, not config.ts — deliberately, per that
// file's own comment. The validator still needs it to bound fruit per level.
const gameSrc = readFileSync(join(GAME_DIR, "game.ts"), "utf-8");

const scoring = {
  biscuit: numberField(configSrc, "SCORE", "biscuit"),
  bone: numberField(configSrc, "SCORE", "bone"),
  fruit: numberField(configSrc, "SCORE", "fruit"),
  ghostBase: numberField(configSrc, "SCORE", "ghostBase"),
  beagleSpeed: numberField(configSrc, "SPEEDS", "beagle"),
  readySeconds: numberField(configSrc, "TIMING", "readySeconds"),
  deathSeconds: numberField(configSrc, "TIMING", "deathSeconds"),
  startLives: numberConst(configSrc, "START_LIVES"),
  coinsPerPoints: numberField(configSrc, "COINS", "perPoints"),
  coinPickupValue: numberField(configSrc, "COINS", "pickupValue"),
  livesMilestonePoints: numberField(configSrc, "LIVES", "milestonePoints"),
};

const coinThresholds = numberArray(configSrc, "COIN_THRESHOLDS");
const lifeThresholds = numberArray(configSrc, "LIFE_THRESHOLDS");
const fruitThresholds = numberArray(gameSrc, "FRUIT_THRESHOLDS");

/** Per-maze pellet/bone/fruit counts, derived from the REAL maze data rather
 *  than hand-copied. These are the hard ceilings MAX-1 and MAX-4 rest on. */
interface MazeFacts {
  biscuits: number;
  bones: number;
  fruitTiles: number;
}

const mazesJson = JSON.parse(
  readFileSync(join(GAME_DIR, "mazes.json"), "utf-8"),
) as { cols: number; rows: number; mazes: string[][] };

const mazeFacts: MazeFacts[] = mazesJson.mazes.map((rows) => {
  const flat = rows.join("");
  const count = (ch: string) => flat.split(ch).length - 1;
  return { biscuits: count("."), bones: count("o"), fruitTiles: count("F") };
});

if (mazeFacts.length === 0) {
  console.error("[sync] no mazes found in mazes.json");
  process.exit(1);
}
for (const [i, facts] of mazeFacts.entries()) {
  if (facts.biscuits < 50) {
    console.error(`[sync] maze ${i} has only ${facts.biscuits} biscuits — parse looks wrong`);
    process.exit(1);
  }
}

/** Challenge level modifiers, needed because a challenge run's ghost count and
 *  speed change both the score ceiling and the time floor. */
const configFrightSeconds = numberField(configSrc, "TIMING", "frightSeconds");

// Parse ENTRY BY ENTRY. A single regex spanning the whole array is greedy
// across entries and silently merges levels — the count guard below caught
// exactly that. Each entry is `mazeIdx: N` followed by its own `modifiers: {…}`.
const challengeLevels = [
  ...challengesSrc.matchAll(/mazeIdx:\s*(\d+),\s*\n\s*modifiers:\s*\{([^}]*)\}/g),
].map((m) => {
  const mazeIdx = Number(m[1]);
  const mods = m[2];

  const pick = (field: string): number => {
    // frightSeconds is written as TIMING.frightSeconds on the levels that don't
    // shorten it, so resolve that reference rather than failing on it.
    const ref = new RegExp(`${field}:\\s*TIMING\\.frightSeconds`).exec(mods);
    if (ref) return configFrightSeconds;

    const num = new RegExp(`${field}:\\s*([0-9.]+)`).exec(mods);
    if (!num) throw new Error(`challenge level ${mazeIdx}: missing ${field}`);
    return Number(num[1]);
  };

  return {
    mazeIdx,
    speedMult: pick("speedMult"),
    ghostCount: pick("ghostCount"),
    frightSeconds: pick("frightSeconds"),
  };
});

if (challengeLevels.length !== 8) {
  console.error(
    `[sync] extracted ${challengeLevels.length} challenge levels, expected 8 — ` +
      `the CHALLENGE_LEVELS format probably changed.`,
  );
  process.exit(1);
}

const beagleSkins = extractIdPricePairs(sliceArray(cosmeticsSrc, "BEAGLE_SKINS"));
const enemySkins = extractIdPricePairs(sliceArray(cosmeticsSrc, "ENEMY_SKINS"));
const mazeThemes = extractIdPricePairs(sliceArray(themesSrc, "MAZE_THEMES"));

const defaults = {
  beagle: extractDefaultId(cosmeticsSrc, "DEFAULT_BEAGLE_SKIN_ID"),
  enemy: extractDefaultId(cosmeticsSrc, "DEFAULT_ENEMY_SKIN_ID"),
  theme: extractDefaultId(themesSrc, "DEFAULT_MAZE_THEME_ID"),
};

// Guard against a silently-short catalog: if a parse quirk dropped entries,
// the server would reject legitimate purchases with UNKNOWN_ITEM. Better to
// fail the build. Update these when the game genuinely gains cosmetics.
const EXPECTED = { beagle: 4, enemy: 4, theme: 6 } as const;
const counts = {
  beagle: beagleSkins.length,
  enemy: enemySkins.length,
  theme: mazeThemes.length,
};
for (const key of ["beagle", "enemy", "theme"] as const) {
  if (counts[key] < EXPECTED[key]) {
    console.error(
      `[sync] extracted only ${counts[key]} ${key} entries, expected at least ` +
        `${EXPECTED[key]}. The registry format in src/game probably changed — ` +
        `fix the extractor rather than lowering this number.`,
    );
    process.exit(1);
  }
}

for (const [kind, id] of Object.entries(defaults)) {
  const list =
    kind === "beagle" ? beagleSkins : kind === "enemy" ? enemySkins : mazeThemes;
  const found = list.find((e) => e.id === id);
  if (!found) {
    console.error(`[sync] default ${kind} id "${id}" is not in the extracted list`);
    process.exit(1);
  }
  if (found.price !== 0) {
    console.error(
      `[sync] default ${kind} id "${id}" has price ${found.price}, expected 0 — ` +
        `defaults must be free, since every new account owns them.`,
    );
    process.exit(1);
  }
}

const fmt = (entries: Array<{ id: string; price: number }>) =>
  entries.map((e) => `  { id: ${JSON.stringify(e.id)}, price: ${e.price} },`).join("\n");

// --- progression (IDEA-040) --------------------------------------------------
//
// The validator sizes each level's score ceiling from that level's GHOST COUNT,
// so it must agree with the game about which level has how many enemies. Pull
// the numbers out of the real progression.ts rather than restating them here:
// a hand-copied "3" that should have become a "4" would reject honest stage-3
// runs, which is the failure mode that cost players real scores in v5.0-v5.1.
const progressionSrc = readFileSync(join(GAME_DIR, "progression.ts"), "utf-8");

function progressionConst(name: string): number {
  const match = new RegExp(`export const ${name}\\s*=\\s*([0-9]+)`).exec(progressionSrc);
  if (!match) {
    console.error(`[sync] could not find ${name} in progression.ts — has it been renamed?`);
    process.exit(1);
  }
  return Number(match[1]);
}

const MAPS_PER_STAGE = progressionConst("MAPS_PER_STAGE");
const STAGE_COUNT = progressionConst("STAGE_COUNT");
const GHOSTS_STAGE_1_2 = progressionConst("GHOSTS_STAGE_1_2");
const GHOSTS_STAGE_3 = progressionConst("GHOSTS_STAGE_3");
const GHOSTS_BONUS_FIRST_LAP = progressionConst("GHOSTS_BONUS_FIRST_LAP");
const GHOSTS_BONUS_LATER_LAPS = progressionConst("GHOSTS_BONUS_LATER_LAPS");

const out = `// GENERATED FILE — DO NOT EDIT.
// Produced by server/scripts/sync-game-constants.ts from src/game/cosmetics.ts
// and src/game/themes.ts. Run \`npm run sync\` in server/ to regenerate.
//
// The server needs ids and PRICES so that POST /api/v1/profile/purchase can
// charge from its own copy rather than trusting a client-supplied price.
// scripts/test-catalog.ts fails if this drifts from the game source.

export interface CatalogItem {
  readonly id: string;
  readonly price: number;
}

export const BEAGLE_SKINS: readonly CatalogItem[] = [
${fmt(beagleSkins)}
];

export const ENEMY_SKINS: readonly CatalogItem[] = [
${fmt(enemySkins)}
];

export const MAZE_THEMES: readonly CatalogItem[] = [
${fmt(mazeThemes)}
];

export const DEFAULT_BEAGLE_SKIN_ID = ${JSON.stringify(defaults.beagle)};
export const DEFAULT_ENEMY_SKIN_ID = ${JSON.stringify(defaults.enemy)};
export const DEFAULT_MAZE_THEME_ID = ${JSON.stringify(defaults.theme)};

/** Challenge level count — the upper bound on users.challenge_progress.
 *  The sentinel value itself (== this number) means "all levels cleared". */
export const CHALLENGE_LEVEL_COUNT = ${challengeLevels.length};

// ---------------------------------------------------------------------------
// Scoring + timing constants, mirrored from src/game/config.ts (and
// FRUIT_THRESHOLDS from game.ts). The plausibility validator scores every
// submitted run against these, so they MUST track the game: if the game
// rebalances and the server doesn't, honest runs start getting rejected.

export const SCORING = {
  biscuit: ${scoring.biscuit},
  bone: ${scoring.bone},
  fruit: ${scoring.fruit},
  ghostBase: ${scoring.ghostBase},
  /** Tiles per second at speedMult 1. */
  beagleSpeed: ${scoring.beagleSpeed},
  readySeconds: ${scoring.readySeconds},
  deathSeconds: ${scoring.deathSeconds},
  startLives: ${scoring.startLives},
  coinsPerPoints: ${scoring.coinsPerPoints},
  coinPickupValue: ${scoring.coinPickupValue},
  livesMilestonePoints: ${scoring.livesMilestonePoints},
} as const;

/** Pellet-eaten counts at which a coin / bonus-life bone / fruit spawns. Each
 *  fires at most ONCE per level (see pickups.ts's shouldFireThreshold), so the
 *  array LENGTH is the per-level cap on each pickup. */
export const COIN_THRESHOLDS = ${JSON.stringify(coinThresholds)} as const;
export const LIFE_THRESHOLDS = ${JSON.stringify(lifeThresholds)} as const;
export const FRUIT_THRESHOLDS = ${JSON.stringify(fruitThresholds)} as const;

/** What each maze actually CONTAINS, derived from mazes.json rather than
 *  hand-copied. These are the hard ceilings the validator rests on: a run
 *  cannot eat more pellets than exist. */
export interface MazeFacts {
  readonly biscuits: number;
  readonly bones: number;
  readonly fruitTiles: number;
}

export const MAZE_FACTS: readonly MazeFacts[] = [
${mazeFacts
  .map(
    (f) =>
      `  { biscuits: ${f.biscuits}, bones: ${f.bones}, fruitTiles: ${f.fruitTiles} },`,
  )
  .join("\n")}
];

export const MAZE_COUNT = MAZE_FACTS.length;

/** Per-level challenge modifiers. A challenge run's ghost count and speed
 *  change BOTH the score ceiling and the minimum time, so the validator needs
 *  them to judge a challenge submission at all. */
export interface ChallengeLevelFacts {
  readonly mazeIdx: number;
  readonly speedMult: number;
  readonly ghostCount: number;
  readonly frightSeconds: number;
}

export const CHALLENGE_LEVELS: readonly ChallengeLevelFacts[] = [
${challengeLevels
  .map(
    (l) =>
      `  { mazeIdx: ${l.mazeIdx}, speedMult: ${l.speedMult}, ghostCount: ${l.ghostCount}, frightSeconds: ${l.frightSeconds} },`,
  )
  .join("\n")}
];

/** Classic mode's baseline — the explicit modifiers game.ts uses for a classic
 *  run (CLASSIC_MODIFIERS in challenges.ts). */
export const CLASSIC_MODIFIERS: ChallengeLevelFacts = {
  mazeIdx: -1,
  speedMult: 1,
  ghostCount: 3,
  frightSeconds: ${configFrightSeconds},
};

// --- classic progression (IDEA-040) ------------------------------------------
//
// Mirrors src/game/progression.ts. The constants below are EXTRACTED from that
// file by the sync script, and scripts/test-catalog.ts asserts planLevel() here
// agrees with the game's planLevel() on every level of the first four laps.
//
// The validator needs this because a level's score ceiling depends on how many
// ghosts it had: a 4-ghost stage-3 level can legitimately yield far more points
// than a 3-ghost one. Sizing every level at 3 would reject honest runs.

export const MAPS_PER_STAGE = ${MAPS_PER_STAGE};
export const STAGE_COUNT = ${STAGE_COUNT};
export const LEVELS_PER_LAP = ${STAGE_COUNT * (MAPS_PER_STAGE + 1)};
export const MAPS_PER_LAP = ${STAGE_COUNT * MAPS_PER_STAGE};
export const BONUS_MAZE_START = ${STAGE_COUNT * MAPS_PER_STAGE};
export const GHOSTS_STAGE_1_2 = ${GHOSTS_STAGE_1_2};
export const GHOSTS_STAGE_3 = ${GHOSTS_STAGE_3};
export const GHOSTS_BONUS_FIRST_LAP = ${GHOSTS_BONUS_FIRST_LAP};
export const GHOSTS_BONUS_LATER_LAPS = ${GHOSTS_BONUS_LATER_LAPS};

export interface LevelPlan {
  readonly mazeIdx: number;
  readonly ghostCount: number;
  readonly isBonus: boolean;
  readonly mapNumber: number | null;
  readonly lap: number;
  readonly stage: number;
}

export function planLevel(levelIdx: number): LevelPlan {
  const safeIdx = Number.isFinite(levelIdx) && levelIdx > 0 ? Math.floor(levelIdx) : 0;

  const lap = Math.floor(safeIdx / LEVELS_PER_LAP) + 1;
  const withinLap = safeIdx % LEVELS_PER_LAP;

  const stageIdx = Math.floor(withinLap / (MAPS_PER_STAGE + 1));
  const withinStage = withinLap % (MAPS_PER_STAGE + 1);
  const isBonus = withinStage === MAPS_PER_STAGE;

  if (isBonus) {
    return {
      mazeIdx: BONUS_MAZE_START + stageIdx,
      ghostCount: lap === 1 ? GHOSTS_BONUS_FIRST_LAP : GHOSTS_BONUS_LATER_LAPS,
      isBonus: true,
      mapNumber: null,
      lap,
      stage: stageIdx + 1,
    };
  }

  const mapIdx = stageIdx * MAPS_PER_STAGE + withinStage;

  return {
    mazeIdx: mapIdx,
    ghostCount: lap > 1 || stageIdx === STAGE_COUNT - 1 ? GHOSTS_STAGE_3 : GHOSTS_STAGE_1_2,
    isBonus: false,
    mapNumber: mapIdx + 1,
    lap,
    stage: stageIdx + 1,
  };
}
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, out, "utf-8");

console.log(
  `[sync] wrote catalog.generated.ts — ${beagleSkins.length} beagle skins, ` +
    `${enemySkins.length} enemy skins, ${mazeThemes.length} maze themes`,
);
