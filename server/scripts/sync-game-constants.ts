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
export const CHALLENGE_LEVEL_COUNT = 8;
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, out, "utf-8");

console.log(
  `[sync] wrote catalog.generated.ts — ${beagleSkins.length} beagle skins, ` +
    `${enemySkins.length} enemy skins, ${mazeThemes.length} maze themes`,
);
