// Headless tests for the classic-mode progression (IDEA-040, IDEA-061).
//   npx tsx scripts/test-progression.ts
//
// planLevel() decides which maze, how many enemies, and what the HUD says for
// EVERY classic level — and the server vendors a generated copy of it to size
// the per-level score ceiling. A wrong ghost count here doesn't just misbalance
// the game, it makes honest runs fail validation. Hence the paranoia.

import {
  planLevel,
  levelLabel,
  completesMaxDifficultyLap,
  LEVELS_PER_LAP,
  MAPS_PER_LAP,
  MAPS_PER_STAGE,
  BONUS_MAZE_START,
  REQUIRED_MAZE_COUNT,
  GHOSTS_STAGE_1_2,
  GHOSTS_STAGE_3_4,
  GHOSTS_STAGE_5_6,
  GHOSTS_BONUS_FIRST_LAP,
  GHOSTS_BONUS_LATER_LAPS,
} from "../src/game/progression";
import { MAZES } from "../src/game/mazes";

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

function section(title: string): void {
  console.log(`\n${title}`);
}

section("Shape of a lap");
ok("a lap is 36 levels", LEVELS_PER_LAP === 36, LEVELS_PER_LAP);
ok("30 numbered maps per lap", MAPS_PER_LAP === 30, MAPS_PER_LAP);
ok("36 mazes required in total", REQUIRED_MAZE_COUNT === 36, REQUIRED_MAZE_COUNT);
ok("bonus mazes start after the numbered ones", BONUS_MAZE_START === 30, BONUS_MAZE_START);
ok("mazes.json actually holds them", MAZES.length === REQUIRED_MAZE_COUNT, MAZES.length);

section("Stage 1 — maps 1-5, three enemies");
for (let i = 0; i < MAPS_PER_STAGE; i++) {
  const p = planLevel(i);
  ok(`level ${i} is map ${i + 1} on maze ${i}`, p.mapNumber === i + 1 && p.mazeIdx === i,
    `map=${p.mapNumber} maze=${p.mazeIdx}`);
  ok(`level ${i} has ${GHOSTS_STAGE_1_2} enemies`, p.ghostCount === GHOSTS_STAGE_1_2, p.ghostCount);
  ok(`level ${i} is not a bonus`, !p.isBonus);
}
// The five original mazes must keep their indices, or challenge mode (which
// hardcodes mazeIdx 0-4) would silently start loading different maps.
ok("maps 1-5 still use mazes 0-4 exactly",
  [0, 1, 2, 3, 4].every((i) => planLevel(i).mazeIdx === i));

section("The bonus level after map 5");
{
  const p = planLevel(5);
  ok("level 5 is a bonus", p.isBonus);
  ok("a bonus has no map number", p.mapNumber === null, p.mapNumber);
  ok("it uses the first bonus maze", p.mazeIdx === BONUS_MAZE_START, p.mazeIdx);
  ok(`it has ${GHOSTS_BONUS_FIRST_LAP} enemy on lap 1`,
    p.ghostCount === GHOSTS_BONUS_FIRST_LAP, p.ghostCount);
  ok("it closes stage 1", p.stage === 1, p.stage);
}

section("Stage 2 — maps 6-10, new mazes, still three enemies");
for (let i = 6; i <= 10; i++) {
  const p = planLevel(i);
  const expectedMap = i; // level 6 -> map 6
  const expectedMaze = i - 1; // maze 5..9
  ok(`level ${i} is map ${expectedMap} on maze ${expectedMaze}`,
    p.mapNumber === expectedMap && p.mazeIdx === expectedMaze,
    `map=${p.mapNumber} maze=${p.mazeIdx}`);
  ok(`level ${i} still has ${GHOSTS_STAGE_1_2} enemies`,
    p.ghostCount === GHOSTS_STAGE_1_2, p.ghostCount);
}
ok("level 11 is the second bonus", planLevel(11).isBonus && planLevel(11).mazeIdx === 31,
  planLevel(11).mazeIdx);

section("Stage 3 — maps 11-15, the FOURTH enemy");
for (let i = 12; i <= 16; i++) {
  const p = planLevel(i);
  const expectedMap = i - 1; // level 12 -> map 11
  const expectedMaze = i - 2; // maze 10..14
  ok(`level ${i} is map ${expectedMap} on maze ${expectedMaze}`,
    p.mapNumber === expectedMap && p.mazeIdx === expectedMaze,
    `map=${p.mapNumber} maze=${p.mazeIdx}`);
  ok(`level ${i} has ${GHOSTS_STAGE_3_4} enemies`,
    p.ghostCount === GHOSTS_STAGE_3_4, p.ghostCount);
}
ok("level 17 is the third bonus", planLevel(17).isBonus && planLevel(17).mazeIdx === 32,
  planLevel(17).mazeIdx);
ok("map 15 is still the last map of stage 3", planLevel(16).mapNumber === 15,
  planLevel(16).mapNumber);

// IDEA-061's central compatibility claim: maps 1-15 must be EXACTLY what they
// were before the cycle doubled, on the same maze at the same enemy count.
// Anything else changes the difficulty of fifteen maps players already know.
section("IDEA-061 — maps 1-15 are untouched");
{
  const before: Array<[number, number, number]> = [];
  for (let i = 0; i <= 16; i++) {
    const p = planLevel(i);
    if (!p.isBonus) before.push([p.mapNumber!, p.mazeIdx, p.ghostCount]);
  }
  const expected = Array.from({ length: 15 }, (_, m): [number, number, number] =>
    [m + 1, m, m < 10 ? GHOSTS_STAGE_1_2 : GHOSTS_STAGE_3_4]);
  ok("maps 1-15 keep their maze and enemy count",
    JSON.stringify(before) === JSON.stringify(expected), JSON.stringify(before));
}

section("Stage 4 — maps 16-20, four enemies on the new mazes");
for (let i = 18; i <= 22; i++) {
  const p = planLevel(i);
  const expectedMap = i - 2; // level 18 -> map 16
  const expectedMaze = i - 3; // maze 15..19
  ok(`level ${i} is map ${expectedMap} on maze ${expectedMaze}`,
    p.mapNumber === expectedMap && p.mazeIdx === expectedMaze,
    `map=${p.mapNumber} maze=${p.mazeIdx}`);
  ok(`level ${i} has ${GHOSTS_STAGE_3_4} enemies`,
    p.ghostCount === GHOSTS_STAGE_3_4, p.ghostCount);
}
ok("level 23 is the fourth bonus", planLevel(23).isBonus && planLevel(23).mazeIdx === 33,
  planLevel(23).mazeIdx);

section("Stages 5 and 6 — maps 21-30, the FIFTH enemy");
for (const i of [24, 25, 26, 27, 28, 30, 31, 32, 33, 34]) {
  const p = planLevel(i);
  ok(`level ${i} has ${GHOSTS_STAGE_5_6} enemies`,
    p.ghostCount === GHOSTS_STAGE_5_6, p.ghostCount);
  ok(`level ${i} is not a bonus`, !p.isBonus);
}
ok("level 29 is the fifth bonus", planLevel(29).isBonus && planLevel(29).mazeIdx === 34,
  planLevel(29).mazeIdx);
ok("level 35 is the sixth bonus", planLevel(35).isBonus && planLevel(35).mazeIdx === 35,
  planLevel(35).mazeIdx);
ok("the last numbered map of lap 1 is map 30", planLevel(34).mapNumber === 30,
  planLevel(34).mapNumber);
ok("…on the last numbered maze", planLevel(34).mazeIdx === 29, planLevel(34).mazeIdx);

section("Lap 2 onward — five enemies everywhere, and the count keeps climbing");
{
  const first = planLevel(LEVELS_PER_LAP); // 36 — maze 0 again, but Map 31
  ok("level 36 returns to the FIRST maze", first.mazeIdx === 0, first.mazeIdx);
  ok("…but is called Map 31, not Map 1 (IDEA-061)", first.mapNumber === 31,
    first.mapNumber);
  ok("…on lap 2", first.lap === 2, first.lap);
  ok("…and now has 5 enemies", first.ghostCount === GHOSTS_STAGE_5_6, first.ghostCount);

  // The whole point of the change: the number NEVER goes backwards, however
  // long the run lasts. A reset to "Map 1" reads as having lost the progress.
  const seen: number[] = [];
  for (let i = 0; i < LEVELS_PER_LAP * 3; i++) {
    const n = planLevel(i).mapNumber;
    if (n !== null) seen.push(n);
  }
  ok("map numbers strictly increase across three laps",
    seen.every((n, idx) => idx === 0 || n === seen[idx - 1] + 1),
    seen.slice(28, 34).join(","));
  ok("…and reach 32-36 where Nuno expected them",
    seen.slice(31, 36).join(",") === "32,33,34,35,36", seen.slice(31, 36).join(","));
  ok("…with no map number ever repeating", new Set(seen).size === seen.length);

  // Every numbered map of lap 2 must be at max difficulty.
  const lap2Numbered = [];
  for (let i = LEVELS_PER_LAP; i < LEVELS_PER_LAP * 2; i++) {
    const p = planLevel(i);
    if (!p.isBonus) lap2Numbered.push(p.ghostCount);
  }
  ok("all 30 numbered maps on lap 2 have 5 enemies",
    lap2Numbered.length === 30 && lap2Numbered.every((g) => g === GHOSTS_STAGE_5_6),
    JSON.stringify(lap2Numbered));

  const bonusLap2 = planLevel(LEVELS_PER_LAP + 5);
  ok(`bonus levels rise to ${GHOSTS_BONUS_LATER_LAPS} enemies from lap 2`,
    bonusLap2.isBonus && bonusLap2.ghostCount === GHOSTS_BONUS_LATER_LAPS,
    bonusLap2.ghostCount);
}

section("Every level in a lap is accounted for");
{
  let numbered = 0;
  let bonuses = 0;
  const mazesUsed = new Set<number>();
  for (let i = 0; i < LEVELS_PER_LAP; i++) {
    const p = planLevel(i);
    if (p.isBonus) bonuses++;
    else numbered++;
    mazesUsed.add(p.mazeIdx);
  }
  ok("30 numbered + 6 bonus", numbered === 30 && bonuses === 6, `${numbered}/${bonuses}`);
  ok("a lap uses 36 DISTINCT mazes (no repeats within a lap)", mazesUsed.size === 36,
    mazesUsed.size);

  // Map numbers must run 1..30 exactly once, in order — a duplicate or gap
  // would show the player "Map 7" twice.
  const numbers = [];
  for (let i = 0; i < LEVELS_PER_LAP; i++) {
    const n = planLevel(i).mapNumber;
    if (n !== null) numbers.push(n);
  }
  ok("map numbers are 1..30 in order",
    numbers.join(",") === Array.from({ length: 30 }, (_, i) => i + 1).join(","),
    numbers.join(","));
}

section("HUD labels");
ok('level 0 reads "Map 1"', levelLabel(0) === "Map 1", levelLabel(0));
ok('level 5 reads "Bonus"', levelLabel(5) === "Bonus", levelLabel(5));
ok('level 16 reads "Map 15"', levelLabel(16) === "Map 15", levelLabel(16));
ok('level 34 reads "Map 30"', levelLabel(34) === "Map 30", levelLabel(34));
// The lap suffix is gone: the number carries the lap now (IDEA-061).
ok('level 36 reads "Map 31", not "Map 1 ·2"', levelLabel(36) === "Map 31", levelLabel(36));
ok('level 41 reads "Bonus", with no lap mark', levelLabel(41) === "Bonus", levelLabel(41));
ok("no label ever carries a lap suffix",
  !Array.from({ length: LEVELS_PER_LAP * 3 }, (_, i) => levelLabel(i)).some((l) => l.includes("·")));
// hud.setLevel splits a leading "Map " into an eyebrow and shows the rest as
// the figure, so a two-digit number must still arrive in that exact shape.
ok("a numbered label is always `Map <n>`",
  Array.from({ length: LEVELS_PER_LAP * 2 }, (_, i) => i)
    .filter((i) => !planLevel(i).isBonus)
    .every((i) => /^Map \d+$/.test(levelLabel(i))));

section("The completion achievement");
ok("lap 1 never completes max difficulty",
  !Array.from({ length: LEVELS_PER_LAP }, (_, i) => i).some(completesMaxDifficultyLap));
ok("clearing the last level of lap 2 does", completesMaxDifficultyLap(LEVELS_PER_LAP * 2 - 1));
ok("…but the level before it does not", !completesMaxDifficultyLap(LEVELS_PER_LAP * 2 - 2));
ok("and it fires again at the end of lap 3", completesMaxDifficultyLap(LEVELS_PER_LAP * 3 - 1));

section("Defensive input");
ok("a negative index falls back to level 0", planLevel(-5).mapNumber === 1);
ok("a fractional index floors", planLevel(3.7).mapNumber === 4, planLevel(3.7).mapNumber);
ok("NaN falls back to level 0", planLevel(Number.NaN).mapNumber === 1);
ok("a very deep level still resolves", planLevel(10_000).ghostCount === GHOSTS_STAGE_5_6);

section("Every maze shares one identical ghost pen");
// A ghost may walk '=', '-' and 'G'. If the pen is not sealed on every side
// except its door, ghosts leave through what LOOKS to the player like a solid
// wall — which is exactly what happened on the first bonus map, and on three
// other mazes nobody had reached yet. The pen is fixed geometry, so the
// simplest guarantee is that every maze carries byte-identical rows here.
{
  const PEN = { 8: "##-##", 9: "#=G=#", 10: "#####" } as const;
  const offenders: string[] = [];

  MAZES.forEach((rows, i) => {
    for (const [y, block] of Object.entries(PEN)) {
      const actual = rows[Number(y)].slice(7, 12);
      if (actual !== block) offenders.push(`maze ${i} row ${y}: "${actual}" != "${block}"`);
    }
    // The shared pen-front floor sits directly above the door, and there is
    // exactly one of it — a stray ':' elsewhere is a beagle-walkable hole in
    // whatever wall it landed in.
    const colons = rows.join("").split(":").length - 1;
    if (colons !== 1) offenders.push(`maze ${i} has ${colons} ':' tiles, expected 1`);
    if (rows[7][9] !== ":") offenders.push(`maze ${i} row 7 col 9 is "${rows[7][9]}", expected ":"`);
  });

  ok(
    "all 36 mazes carry the identical pen block",
    offenders.length === 0,
    offenders.slice(0, 3).join(" | "),
  );

  // Ghost spawn and beagle spawn must exist exactly once each, or resetActors
  // silently falls back to a default tile.
  const spawnProblems: string[] = [];
  MAZES.forEach((rows, i) => {
    const joined = rows.join("");
    const g = joined.split("G").length - 1;
    const p = joined.split("P").length - 1;
    if (g !== 1) spawnProblems.push(`maze ${i}: ${g} ghost spawns`);
    if (p !== 1) spawnProblems.push(`maze ${i}: ${p} beagle spawns`);
  });
  ok("every maze has exactly one G and one P", spawnProblems.length === 0,
    spawnProblems.join(" | "));
}

section("Bonus maps carry no bones");
// A bone opens a fright window; on a bonus level that means eating the lone
// enemy for a free life on top of an already generous point haul. The golden
// bone (a life pickup) already covers earning a life there.
{
  const bonusMazes = [30, 31, 32, 33, 34, 35];
  const withBones = bonusMazes.filter((i) => MAZES[i].join("").includes("o"));
  ok("no bonus map contains a white bone", withBones.length === 0, withBones.join(","));

  const numbered = Array.from({ length: 30 }, (_, i) => i);
  const wrongCount = numbered.filter(
    (i) => (MAZES[i].join("").match(/o/g) ?? []).length !== 4,
  );
  ok("every numbered map still has 4 bones", wrongCount.length === 0, wrongCount.join(","));

  // planLevel must actually route bonus levels to those mazes, or the rule
  // above protects the wrong maps.
  const bonusPlanned = [5, 11, 17, 23, 29, 35].map((idx) => planLevel(idx).mazeIdx);
  ok("bonus levels map to mazes 30-35",
    bonusPlanned.join(",") === "30,31,32,33,34,35", bonusPlanned.join(","));

  // On a bonus map the pen sits alone in an open field, so any wall tile
  // touching it reads as a lump fused to the side of the house rather than
  // part of a maze. (Numbered maps deliberately embed the pen in their walls,
  // so this only applies to the three bonus maps.)
  const stubs: string[] = [];
  for (const i of bonusMazes) {
    const rows = MAZES[i];
    for (const y of [8, 9, 10]) {
      for (const x of [6, 12]) if (rows[y][x] === "#") stubs.push(`maze ${i} (${x},${y})`);
    }
    for (const x of [7, 8, 9, 10, 11]) {
      if (rows[7][x] === "#") stubs.push(`maze ${i} (${x},7)`);
      if (rows[11][x] === "#") stubs.push(`maze ${i} (${x},11)`);
    }
  }
  ok("the pen stands free on every bonus map", stubs.length === 0, stubs.join(" "));
}

section("No maze is a copy of another");
// Maze 10 and maze 14 were byte-identical from IDEA-040 until IDEA-061 — every
// other check passed, because a duplicate is a perfectly valid maze. It is a
// maze LIST, and the one thing it must not contain is the same board twice.
{
  const first = new Map<string, number>();
  const repeats: string[] = [];
  MAZES.forEach((rows, i) => {
    const key = rows.join("\n");
    const seenAt = first.get(key);
    if (seenAt !== undefined) repeats.push(`maze ${i} == maze ${seenAt}`);
    else first.set(key, i);
  });
  ok("every maze is a distinct layout", repeats.length === 0, repeats.join(" | "));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`PROGRESSION: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
