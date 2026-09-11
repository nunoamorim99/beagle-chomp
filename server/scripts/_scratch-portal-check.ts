// Scratch: does the portal's data layer answer correctly against the REAL dev
// database, after the IDEA-050/051 refresh for a 40-level ladder and 11 enemy
// skins? Read-only — it runs the same functions the admin routes run.
//
// Run inside the api container (DATABASE_URL is already set there):
//   docker compose exec api npx tsx scripts/_scratch-portal-check.ts

import * as analytics from "../src/repo/analytics.js";
import { challengeStandings, hardestChallenges, shares } from "../src/analytics/aggregate.js";
import { CHALLENGE_LEVEL_COUNT } from "../src/catalog.generated.js";
import { pool } from "../src/db.js";

const rows = await analytics.challengeFunnel();
const standings = challengeStandings(rows, CHALLENGE_LEVEL_COUNT);
const { ranked, insufficient } = hardestChallenges(standings);

console.log(`catalog level count      : ${CHALLENGE_LEVEL_COUNT}`);
console.log(`rows from SQL            : ${rows.length}  (indices ${rows.map((r) => r.challenge_idx).join(", ") || "none"})`);
console.log(`dense standings          : ${standings.length}`);
console.log(`indices are positions    : ${standings.every((s, i) => s.challengeIdx === i)}`);
console.log(`attempted at least once  : ${standings.filter((s) => s.attempts > 0).length}`);
console.log(`ranked / not ranked      : ${ranked.length} / ${insufficient.length}`);
console.log(`untried have null rate   : ${standings.filter((s) => s.attempts === 0).every((s) => s.clearRate === null)}`);

console.log("\n--- theme share, ALL runs vs CLASSIC only ---");
const allThemes = shares(await analytics.equippedShare("maze_theme_id"));
const classicThemes = shares(await analytics.equippedShare("maze_theme_id", "classic"));
console.log("all     :", allThemes.map((s) => `${s.value}=${s.runs}`).join(" ") || "(none)");
console.log("classic :", classicThemes.map((s) => `${s.value}=${s.runs}`).join(" ") || "(none)");

console.log("\n--- the other three, unfiltered ---");
for (const col of ["beagle_skin_id", "enemy_skin_id", "control_scheme"] as const) {
  const s = shares(await analytics.equippedShare(col));
  console.log(`${col.padEnd(16)}:`, s.map((x) => `${x.value}=${x.runs}`).join(" ") || "(none)");
}

await pool.end();
