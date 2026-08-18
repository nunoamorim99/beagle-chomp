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
  LEVELS_PER_LAP,
  MAPS_PER_STAGE,
  STAGE_COUNT,
  GHOSTS_STAGE_1_2,
  GHOSTS_STAGE_3,
  GHOSTS_BONUS_FIRST_LAP,
  GHOSTS_BONUS_LATER_LAPS,
  planLevel as serverPlanLevel,
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

// --- progression drift (IDEA-040) --------------------------------------------
//
// THE most important assertion in this file. The validator sizes each level's
// score ceiling from that level's ghost count, so if the server's planLevel()
// ever disagrees with the game's, honest runs get rejected — the exact failure
// that cost real players their scores in v5.0-v5.1. Comparing the two
// implementations level-by-level turns any divergence into a build failure.
//
// The game's planLevel() cannot simply be imported here: server/ has its own
// rootDir and NodeNext resolution, and reaching across into the Vite-compiled
// frontend fights both (the same boundary that made this catalog generated in
// the first place). So the game's constants are re-read from its SOURCE and the
// server's planLevel() is checked against an independently-derived expectation
// — which is a stronger test than comparing two copies of the same code anyway.
{
  const progressionSrc = readFileSync(join(GAME_DIR, "progression.ts"), "utf-8");
  const gameConst = (name: string): number | null => {
    const m = new RegExp(`export const ${name}\\s*=\\s*([0-9]+)`).exec(progressionSrc);
    return m ? Number(m[1]) : null;
  };

  const mapsPerStage = gameConst("MAPS_PER_STAGE");
  const stageCount = gameConst("STAGE_COUNT");
  const gameLevelsPerLap =
    mapsPerStage !== null && stageCount !== null ? stageCount * (mapsPerStage + 1) : null;

  ok(
    "LEVELS_PER_LAP agrees with the game's constants",
    gameLevelsPerLap === LEVELS_PER_LAP,
    `game=${gameLevelsPerLap} server=${LEVELS_PER_LAP} — run \`npm run sync\``,
  );

  for (const [name, serverValue] of [
    ["MAPS_PER_STAGE", MAPS_PER_STAGE],
    ["STAGE_COUNT", STAGE_COUNT],
    ["GHOSTS_STAGE_1_2", GHOSTS_STAGE_1_2],
    ["GHOSTS_STAGE_3", GHOSTS_STAGE_3],
    ["GHOSTS_BONUS_FIRST_LAP", GHOSTS_BONUS_FIRST_LAP],
    ["GHOSTS_BONUS_LATER_LAPS", GHOSTS_BONUS_LATER_LAPS],
  ] as const) {
    ok(
      `${name} matches the game source`,
      gameConst(name) === serverValue,
      `game=${gameConst(name)} server=${serverValue} — run \`npm run sync\``,
    );
  }

  // An independent restatement of the progression, written from the DESIGN
  // rather than from either implementation. If planLevel() and this disagree,
  // one of them has drifted from what was actually specified.
  const gamePlan = (idx: number) => {
    const perLap = stageCount! * (mapsPerStage! + 1);
    const lap = Math.floor(idx / perLap) + 1;
    const withinLap = idx % perLap;
    const stageIdx = Math.floor(withinLap / (mapsPerStage! + 1));
    const withinStage = withinLap % (mapsPerStage! + 1);
    const isBonus = withinStage === mapsPerStage;
    if (isBonus) {
      return {
        mazeIdx: stageCount! * mapsPerStage! + stageIdx,
        ghostCount: lap === 1 ? GHOSTS_BONUS_FIRST_LAP : GHOSTS_BONUS_LATER_LAPS,
        isBonus: true,
        mapNumber: null as number | null,
        lap,
        stage: stageIdx + 1,
      };
    }
    const mapIdx = stageIdx * mapsPerStage! + withinStage;
    return {
      mazeIdx: mapIdx,
      ghostCount:
        lap > 1 || stageIdx === stageCount! - 1 ? GHOSTS_STAGE_3 : GHOSTS_STAGE_1_2,
      isBonus: false,
      mapNumber: mapIdx + 1 as number | null,
      lap,
      stage: stageIdx + 1,
    };
  };

  // Four laps covers lap 1 (mixed difficulty) and the lap 2+ steady state.
  const mismatches: string[] = [];
  for (let idx = 0; idx < LEVELS_PER_LAP * 4; idx++) {
    const a = gamePlan(idx);
    const b = serverPlanLevel(idx);
    if (
      a.mazeIdx !== b.mazeIdx ||
      a.ghostCount !== b.ghostCount ||
      a.isBonus !== b.isBonus ||
      a.mapNumber !== b.mapNumber ||
      a.lap !== b.lap ||
      a.stage !== b.stage
    ) {
      mismatches.push(
        `level ${idx}: game=${JSON.stringify(a)} server=${JSON.stringify(b)}`,
      );
    }
  }
  ok(
    "planLevel agrees with the game on every level of 4 laps",
    mismatches.length === 0,
    mismatches.length ? `${mismatches.length} mismatch(es): ${mismatches[0]} — run \`npm run sync\`` : undefined,
  );

  // Spot-check the values the whole design turns on, so a silently "agreeing"
  // pair of wrong implementations still fails.
  ok("stage 3 really has 4 ghosts", serverPlanLevel(12).ghostCount === 4,
    serverPlanLevel(12).ghostCount);
  ok("stage 1 really has 3 ghosts", serverPlanLevel(0).ghostCount === 3,
    serverPlanLevel(0).ghostCount);
  ok("a lap-1 bonus really has 1 ghost", serverPlanLevel(5).ghostCount === 1,
    serverPlanLevel(5).ghostCount);
  ok("lap 2 map 1 really has 4 ghosts", serverPlanLevel(18).ghostCount === 4,
    serverPlanLevel(18).ghostCount);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`CATALOG: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
