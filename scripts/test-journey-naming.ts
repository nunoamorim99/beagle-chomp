// IDEA-077: guards the line between what a PLAYER reads and what crosses the
// wire, now that "Challenge" means two different things in this project.
//
// The rename that made the mode a JOURNEY was deliberately copy-only. That is
// easy to state and easy to lose, in both directions, and each direction has
// its own way of failing:
//
//  1. RENAMING TOO MUCH IS A PRODUCTION-ONLY OUTAGE. `mode: "challenge"`,
//     `challengeProgress`, `challenge_idx` and `challenge_progress` are a wire
//     value, a DTO field and two Postgres columns — one of them carrying a
//     named CHECK constraint. Renaming any of them is a migration plus a
//     lockstep deploy; renaming one by accident typechecks perfectly on the
//     side that changed and 400s against the side that did not. Nothing else
//     in the build would notice, which is why it is asserted here.
//
//  2. RENAMING TOO LITTLE LEAVES TWO FEATURES WEARING ONE WORD. The whole
//     point of the rename was to free "Challenges" for IDEA-078's goals and
//     rewards. If the menu tile still says Challenge, the game ships two
//     destinations with the same name and the same trophy.
//
//  3. AND THE SYNC SCRIPT OPENS A FILE BY PATH. `sync-game-constants.ts` reads
//     the journey ladder as TEXT rather than importing it (the frontend and
//     server cannot import across the bundler's moduleResolution boundary), so
//     the filename is a contract with no type behind it. Point it at a file
//     that does not exist and `npm run sync` throws; point it at the WRONG
//     existing file — which is now a live possibility, because IDEA-078 puts a
//     `challenges.ts` back beside it — and the catalog ships zero journey
//     levels while every local test passes. That is IDEA-063 rule 6's failure
//     wearing a new hat, and it ends with the validator rejecting honest runs
//     in production only.
//
// Headless: everything here is source read as text, so it runs in `npm test`.
import { existsSync, readFileSync } from "node:fs";
import { ICON } from "../src/ui/icons";
import { JOURNEY_LEVELS, JOURNEY_LEVEL_COUNT } from "../src/game/journey";

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
function section(t: string): void {
  console.log(`\n${t}`);
}

const read = (p: string): string => readFileSync(p, "utf8");

// ---------------------------------------------------------------------------
section("The ladder lives in journey.ts, and the sync script opens THAT file");

ok("src/game/journey.ts exists", existsSync("src/game/journey.ts"));
ok(`it holds all ${JOURNEY_LEVEL_COUNT} levels`, JOURNEY_LEVELS.length === JOURNEY_LEVEL_COUNT);

{
  const sync = read("server/scripts/sync-game-constants.ts");
  // The path the script actually opens, read back out of its own source. An
  // assertion that merely says "journey" appears somewhere in the file would
  // pass on a comment.
  const m = sync.match(/readFileSync\(join\(GAME_DIR,\s*"([^"]+)"\),\s*"utf-8"\)/g) ?? [];
  const opened = m
    .map((s) => s.match(/"([^"]+)"/)?.[1])
    .filter((s): s is string => Boolean(s));
  ok("the sync script opens journey.ts", opened.includes("journey.ts"), opened.join(", "));
  for (const f of opened) {
    ok(`…and "${f}" is really on disk`, existsSync(`src/game/${f}`));
  }

  // THE PAIRING IS THE INVARIANT, not which files get opened.
  //
  // This check originally said the sync script must NEVER open challenges.ts,
  // which was exactly right while that filename was free. IDEA-078 then put the
  // challenge DEFINITIONS there and the script has to read both — so the
  // assertion was rewritten rather than deleted, because the danger it was
  // guarding did not go away, it got sharper: two sibling files, two literal
  // arrays, two text parses, and swapping them ships a catalog with no journey
  // levels and no challenges while everything compiles.
  //
  // So: each array is sliced from ITS OWN source variable, and each variable is
  // read from its own file.
  ok(
    "journey.ts is read into journeySrc",
    /const journeySrc = readFileSync\(join\(GAME_DIR, "journey\.ts"\)/.test(sync),
  );
  ok(
    "challenges.ts is read into challengesSrc",
    /const challengesSrc = readFileSync\(join\(GAME_DIR, "challenges\.ts"\)/.test(sync),
  );
  ok(
    "JOURNEY_LEVELS is sliced from journeySrc",
    sync.includes('sliceArray(journeySrc, "JOURNEY_LEVELS")'),
  );
  ok(
    "CHALLENGES is sliced from challengesSrc",
    sync.includes('sliceArray(challengesSrc, "CHALLENGES")'),
  );
  ok(
    "…and neither array is sliced from the other's source",
    !sync.includes('sliceArray(challengesSrc, "JOURNEY_LEVELS")') &&
      !sync.includes('sliceArray(journeySrc, "CHALLENGES")'),
  );
}

// ---------------------------------------------------------------------------
section("What crosses the wire and what sits in Postgres did NOT get renamed");

{
  // The run-start payload. `mode` is a string the server CHECKs in two tables.
  const endpoints = read("src/net/endpoints.ts");
  ok('the session mode is still "challenge" on the wire', endpoints.includes('"classic" | "challenge"'));
  ok("…and the run-start body still sends challengeIdx", /challengeIdx/.test(endpoints));

  const types = read("server/src/repo/types.ts");
  ok("the users row still has challenge_progress", types.includes("challenge_progress"));
  ok("PublicProfile still carries challengeProgress", types.includes("challengeProgress"));

  const sessions = read("server/src/repo/gameSessions.ts");
  ok(
    'SessionMode is still "classic" | "challenge"',
    sessions.includes('"classic" | "challenge"'),
  );
  ok("game_sessions still has challenge_idx", sessions.includes("challenge_idx"));

  // The named CHECK from migration 010. Renaming the column would need a
  // migration; this is the cheap tripwire that says so before it is written.
  const mig = read("server/migrations/010_challenge_levels_40.sql");
  ok("migration 010 still names challenge_idx_matches_mode", mig.includes("challenge_idx_matches_mode"));
}

// ---------------------------------------------------------------------------
section("What a player reads says Journey");

{
  const html = read("index.html");
  ok("the menu tile is labelled Journey", html.includes('<span class="menu-tile-label">Journey</span>'));
  ok("…and no tile is labelled Challenge", !html.includes('menu-tile-label">Challenge<'));
  ok("…and its id is #journeyBtn", html.includes('id="journeyBtn"'));

  const map = read("src/ui/levelMap.ts");
  ok("the level-map page is titled The Journey", map.includes(">The Journey<"));
  ok('…and its path aria-label says Journey', map.includes('aria-label="Journey path"'));

  ok("the account screen's stat row says Journey", read("src/ui/profile.ts").includes("<dt>Journey</dt>"));
}

// ---------------------------------------------------------------------------
section("Two destinations, two marks");

// The trophy moved to IDEA-078's Challenges, where it means something. Both
// roles pointing at one glyph is how a player learns that neither mark means
// anything — and it is exactly the state this rename existed to leave behind.
// Widened to string on purpose: with both sides literal types TypeScript
// decides the comparison "has no overlap" and refuses to compile the very
// assertion that is meant to survive somebody changing one of them.
const journeyGlyph: string = ICON.journey;
const challengeGlyph: string = ICON.challenge;
ok("ICON.journey is its own glyph", journeyGlyph !== challengeGlyph, `${journeyGlyph} vs ${challengeGlyph}`);
ok("ICON.challenge is the trophy", challengeGlyph === "trophy", challengeGlyph);
{
  // index.html writes ligature names raw (as every menu tile does), so the
  // tile's glyph has to be a value in ICON or it is not in the font subset and
  // the button prints its own name — shop.ts's ENEMY_ICONS defect, which
  // shipped for three releases.
  const html = read("index.html");
  const values = new Set<string>(Object.values(ICON));
  const tileGlyphs = [...html.matchAll(/menu-tile-icon bc-i" aria-hidden="true">([a-z_]+)</g)].map((m) => m[1]);
  ok("every menu tile glyph is a value in ICON", tileGlyphs.every((g) => values.has(g)), tileGlyphs.join(", "));
  ok("the Journey tile wears ICON.journey", tileGlyphs.includes(ICON.journey), tileGlyphs.join(", "));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`JOURNEY NAMING: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
