// OWNER: backend
//
// Guards src/catalog.generated.ts against drift from the real game registries.
//
// Why this test exists: prices are money. If a skin's price changes in
// src/game/cosmetics.ts and the server keeps charging the old one, nothing
// crashes — a player is just quietly over- or under-charged, and nobody notices
// until someone compares the shop UI with their coin balance. Same for a new
// skin: without regeneration the server returns UNKNOWN_ITEM for something the
// shop happily displays.
//
// Run: npm run test:catalog   (no database needed)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEAGLE_SKINS,
  ENEMY_SKINS,
  MAZE_THEMES,
  DEFAULT_BEAGLE_SKIN_ID,
  DEFAULT_ENEMY_SKIN_ID,
  DEFAULT_MAZE_THEME_ID,
  type CatalogItem,
} from "../src/catalog.generated.js";

const GAME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "game");

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

/** Read the price the GAME declares for an id, straight from source. Finds the
 *  id, then the first `price:` after it — the same shape the generator relies
 *  on, but implemented independently so a bug in one is unlikely to be mirrored
 *  in the other. */
function gamePriceFor(source: string, id: string): number | null {
  const idIdx = source.indexOf(`id: "${id}"`);
  if (idIdx === -1) return null;

  const after = source.slice(idIdx);
  const nextId = after.indexOf('id: "', 5);
  const scope = nextId === -1 ? after : after.slice(0, nextId);

  const m = /\bprice:\s*(\d+)/.exec(scope);
  return m ? Number(m[1]) : null;
}

function checkGroup(
  label: string,
  items: readonly CatalogItem[],
  source: string,
  defaultId: string,
): void {
  console.log(`\n${label}`);

  ok(`${label}: catalog is non-empty`, items.length > 0);

  for (const item of items) {
    const gamePrice = gamePriceFor(source, item.id);
    ok(
      `${item.id}: exists in the game source`,
      gamePrice !== null,
      "not found — regenerate with `npm run sync`",
    );
    if (gamePrice !== null) {
      ok(
        `${item.id}: price ${item.price} matches the game`,
        item.price === gamePrice,
        `server=${item.price} game=${gamePrice} — regenerate with \`npm run sync\``,
      );
    }
  }

  const ids = items.map((i) => i.id);
  ok(`${label}: no duplicate ids`, new Set(ids).size === ids.length, ids.join(","));

  const def = items.find((i) => i.id === defaultId);
  ok(`${label}: default "${defaultId}" is in the catalog`, def !== undefined);
  // Every new account owns the defaults, so a non-zero price would be a
  // free item the wallet never paid for.
  ok(`${label}: default is free`, def?.price === 0, `price=${def?.price}`);
}

const cosmeticsSrc = readFileSync(join(GAME_DIR, "cosmetics.ts"), "utf-8");
const themesSrc = readFileSync(join(GAME_DIR, "themes.ts"), "utf-8");

checkGroup("Beagle skins", BEAGLE_SKINS, cosmeticsSrc, DEFAULT_BEAGLE_SKIN_ID);
checkGroup("Enemy skins", ENEMY_SKINS, cosmeticsSrc, DEFAULT_ENEMY_SKIN_ID);
checkGroup("Maze themes", MAZE_THEMES, themesSrc, DEFAULT_MAZE_THEME_ID);

// Catch the other drift direction: the game gained an item and nobody ran
// `npm run sync`, so the server would reject buying something the shop shows.
console.log("\nCoverage — nothing in the game is missing from the catalog");
for (const [label, source, marker, items] of [
  ["beagle skin", cosmeticsSrc, "BEAGLE_SKINS", BEAGLE_SKINS],
  ["enemy skin", cosmeticsSrc, "ENEMY_SKINS", ENEMY_SKINS],
  ["maze theme", themesSrc, "MAZE_THEMES", MAZE_THEMES],
] as const) {
  const start = source.indexOf(`export const ${marker}`);
  const eq = source.indexOf("=", start);
  const open = source.indexOf("[", eq);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]" && --depth === 0) {
      end = i;
      break;
    }
  }
  const slice = source.slice(open, end);
  const gameIds = [...slice.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  // Only top-level entries carry a price; nested objects (coat colours, prop
  // placements) don't, so filter to the priced ones.
  const priced = gameIds.filter((id) => gamePriceFor(source, id) !== null);
  const missing = priced.filter((id) => !items.some((i) => i.id === id));
  ok(
    `every ${label} in the game is in the catalog`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")} — run \`npm run sync\`` : undefined,
  );
}

console.log(`\n${"-".repeat(60)}`);
console.log(`CATALOG: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
