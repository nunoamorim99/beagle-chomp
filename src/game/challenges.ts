// OWNER: gameplay-engineer (IDEA-078)
//
// CHALLENGES: goals with rewards. NOT the 40-level ladder — that is the
// JOURNEY and it lives in journey.ts (IDEA-077 moved it out of this filename
// precisely so this module could have it).
//
// Pure and three-free per CLAUDE.md's layer rule: no DOM, no network, no
// imports at all. It is the DEFINITION TABLE — the source the server's copy is
// generated from — plus the presentation side of the screen. It deliberately
// does not judge anything (see THE SHAPE below).
//
// ---------------------------------------------------------------------------
// THE SHAPE, AND WHY IT IS THIS ONE
// ---------------------------------------------------------------------------
//
// 1. THE SERVER AWARDS THE COINS, SO THE SERVER MUST DECIDE WHAT IS DONE.
//    Coins are server-authoritative: plausibility.ts recomputes every award,
//    scoreService banks it, and the client reconciles its optimistic balance to
//    the returned profile (IDEA-016 v2). A coin this module handed out on the
//    client would vanish on the next sync. So completion is judged server-side
//    and this file's definitions reach it through catalog.generated.ts.
//
// 2. PROGRESS IS DERIVED, NEVER ACCUMULATED. Every number a challenge reads is
//    already in `run_stats` — one row per finished run, carrying the validated
//    telemetry, keyed by user (IDEA-050, migration 006). So a lifetime total is
//    a SUM over rows the server already writes and a personal best is a MAX. A
//    per-challenge counter maintained at run finish would be a SECOND copy of a
//    truth that table already holds, free to disagree with it — the failure
//    this project keeps writing post-mortems about. The ONLY new state is which
//    rewards have been CLAIMED.
//
// 3. THE SEAM IS A FLAT BAG OF NUMBERS, AND IT LIVES ON THE SERVER. SQL
//    produces a `ChallengeStats`; `evaluateChallenges` (server/src/validation/
//    challenges.ts) turns it into rows. Same split as plausibility.ts and
//    wire.ts, for the same reason: the interesting rules become testable with
//    no database. There is exactly ONE evaluator and this file is not it —
//    a client-side copy would be a second implementation of a judgement the
//    client does not get to make, and the day the two disagreed a player would
//    see a finished challenge and an error on Claim.
//
// 4. A CHALLENGE MAY ONLY READ A FIELD THE VALIDATOR ALREADY CHECKS. Every
//    metric below resolves to a column plausibility.ts bounds. A challenge that
//    read an unvalidated field would be farmable by a patched client, which is
//    worse than not shipping it.
//
// 5. `CHALLENGES` IS A LITERAL ARRAY AND MUST STAY ONE. sync-game-constants.ts
//    parses this file as TEXT — it cannot import across the frontend's bundler
//    moduleResolution boundary. A `ladder()` helper building these from a loop
//    would be beautiful TypeScript and would regex to NOTHING: the catalog
//    would ship zero challenges, every local test would pass, and nobody could
//    claim anything in production. That is IDEA-063 rule 6, which cost a
//    release once already. **Adding a challenge means `npm run sync` in
//    `server/`**; `npm run test:catalog` fails on drift.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** What the player is being asked to DO. The Challenges screen groups by this;
 *  it is deliberately the browsing axis rather than the mode, because a player
 *  picks a goal ("I want to hunt fruit") before picking a mode. */
export type ChallengeCategory = "collect" | "score" | "levels";

/**
 * Which mode's runs count.
 *
 * NOT optional. Power-ups and beagle perks are CLASSIC ONLY — a Journey run
 * reporting a power-up is rejected outright (IDEA-046, IDEA-064 rule 1) — so an
 * unscoped challenge is either uncompletable in half the game or scored against
 * perk-assisted numbers in one mode and bare ones in the other. `"both"` is
 * available and deliberately unused so far: it exists for a future "play the
 * game" goal, not as a default to reach for.
 */
export type ChallengeMode = "classic" | "journey" | "both";

/**
 * What is measured.
 *
 * `run*` is a PERSONAL BEST — the largest single run. `total*` is a lifetime
 * SUM. The `journey*` group is the per-level family, each a COUNT OF DISTINCT
 * Journey levels where something was true, which is how "do it in each level"
 * collapses from 40 booleans into one ladder (see THE LADDERS below).
 */
export type ChallengeMetric =
  // --- a single run ---
  | "runCoins"
  | "runGhosts"
  | "runFruit"
  | "runBones"
  | "runScore"
  | "runLevels"
  /** Levels cleared in one run in which NO life was lost. `lives_lost` is the
   *  run's total, so this is a whole-run property: it is "cleared N maps and
   *  never died", not "N of the maps were deathless". */
  | "runDeathlessLevels"
  // --- a lifetime ---
  | "totalCoins"
  | "totalGhosts"
  | "totalFruit"
  | "totalBones"
  | "totalScore"
  | "totalLevels"
  // --- the Journey, per level ---
  /** users.challenge_progress — how far up the ladder the player has unlocked.
   *  Read off the profile rather than counted from runs, because that column is
   *  the canonical number and is written max-write by scoreService. */
  | "journeyUnlocked"
  /** Distinct Journey levels cleared without losing a life. */
  | "journeyDeathless"
  /** Distinct Journey levels where every coin on the board was collected. */
  | "journeyAllCoins"
  /** Distinct Journey levels where every fruit that spawned was eaten. */
  | "journeyAllFruit"
  /** Distinct Journey levels where at least JOURNEY_GHOST_TARGET enemies were
   *  eaten. */
  | "journeyGhosts";

export interface ChallengeDef {
  /** Stable, kebab-case, and NEVER reused. It is the primary key of the claim
   *  row, so recycling an id would hand a player a reward they already took —
   *  or refuse them one they have not. Renaming a challenge is free; renaming
   *  its id is not. */
  readonly id: string;
  readonly category: ChallengeCategory;
  readonly mode: ChallengeMode;
  readonly metric: ChallengeMetric;
  /** The value `metric` must REACH (>=). */
  readonly target: number;
  /** Coins paid on claim. Recorded on the claim row as well, so a later
   *  rebalance cannot rewrite what somebody was actually paid. */
  readonly reward: number;
  readonly name: string;
  readonly blurb: string;
}

// ---------------------------------------------------------------------------
// The per-map ceilings the "all of them" challenges are sized against
// ---------------------------------------------------------------------------
//
// MEASURED, not assumed, and two of them are not what you would guess. A map
// holds FIVE coins (COIN_THRESHOLDS has five entries) but only FOUR fruit
// (FRUIT_THRESHOLDS has four) — so "collect all 5 fruits in a level" is
// uncompletable, and the fruit target is 4. Every one of the 36 mazes carries
// exactly 4 bones (MAZE_FACTS).
//
// They live here as named constants rather than inline in the blurbs because a
// balance change to either threshold table has to move these with it, and a
// number buried in prose is a number nobody finds. test-challenges.ts asserts
// all three against config.ts itself, so a fifth fruit fails the build instead
// of quietly making a challenge impossible.

/** Coin pickups on a board. */
export const COINS_PER_MAP = 5;
/** Fruit spawns on a board — FOUR, not five. */
export const FRUIT_PER_MAP = 4;
/** Enemies eaten in one Journey level to count for `journeyGhosts`. A tour
 *  level fields three enemies and four bones, so twelve is the ceiling and five
 *  means "used more than one bone well". */
export const JOURNEY_GHOST_TARGET = 5;

// ---------------------------------------------------------------------------
// THE LADDERS
// ---------------------------------------------------------------------------
//
// Nuno's own lists, with three changes and each one has a reason:
//
//  * "Collect all 5 fruits in each level" is FOUR (see above).
//
//  * "In one run" targets are NOT equally hard at the same number, so the
//    rewards are not equal either. A map holds 4 bones and 4 fruit but 5 coins,
//    and up to 12-16 enemies can be eaten on one — so 30 enemies is two or
//    three maps while 30 bones is eight, and fruit is hardest of all because it
//    is TIMED (FRUIT_LIFESPAN_SECONDS) and can expire uncollected. The reward
//    order is therefore enemies < coins < bones < fruit at every tier.
//
//  * "Pass each level without losing one live" x 40 levels x four kinds would
//    be 120 rows on a screen whose entire job is telling a player what to do
//    next. Each is "do it in N DIFFERENT levels" instead — the same
//    achievement, one COUNT(DISTINCT challenge_idx), and it reads as a ladder
//    like everything else here.
//
// REWARDS ARE SIZED AGAINST THE SHOP, WHICH COSTS ~550 COINS IN TOTAL (5
// beagles 125, 9 buyable enemies 225, 4 buyable themes 200) at 1 coin a pickup
// and 5 pickups a map. The whole set below pays ~670, earned across hundreds of
// maps — a real supplement to the pickups rather than a replacement for them.
// The FIRST tier of every ladder is deliberately tiny (1-3 coins): those exist
// to teach a new player that the screen pays out at all, and together they come
// to about one beagle in the first hour.

export const CHALLENGES: readonly ChallengeDef[] = [
  // --- classic · coins in one run ------------------------------------------
  {
    id: "classic-run-coins-5",
    category: "collect",
    mode: "classic",
    metric: "runCoins",
    target: 5,
    reward: 1,
    name: "Pocket Money",
    blurb: "Collect 5 coins in a single classic run.",
  },
  {
    id: "classic-run-coins-10",
    category: "collect",
    mode: "classic",
    metric: "runCoins",
    target: 10,
    reward: 2,
    name: "Loose Change",
    blurb: "Collect 10 coins in a single classic run.",
  },
  {
    id: "classic-run-coins-15",
    category: "collect",
    mode: "classic",
    metric: "runCoins",
    target: 15,
    reward: 3,
    name: "Jingling",
    blurb: "Collect 15 coins in a single classic run.",
  },
  {
    id: "classic-run-coins-20",
    category: "collect",
    mode: "classic",
    metric: "runCoins",
    target: 20,
    reward: 5,
    name: "Heavy Pockets",
    blurb: "Collect 20 coins in a single classic run.",
  },
  {
    id: "classic-run-coins-25",
    category: "collect",
    mode: "classic",
    metric: "runCoins",
    target: 25,
    reward: 8,
    name: "Piggy Bank",
    blurb: "Collect 25 coins in a single classic run.",
  },
  {
    id: "classic-run-coins-30",
    category: "collect",
    mode: "classic",
    metric: "runCoins",
    target: 30,
    reward: 12,
    name: "Treasure Hound",
    blurb: "Collect 30 coins in a single classic run.",
  },

  // --- classic · enemies in one run ----------------------------------------
  {
    id: "classic-run-ghosts-5",
    category: "collect",
    mode: "classic",
    metric: "runGhosts",
    target: 5,
    reward: 1,
    name: "First Bites",
    blurb: "Eat 5 enemies in a single classic run.",
  },
  {
    id: "classic-run-ghosts-10",
    category: "collect",
    mode: "classic",
    metric: "runGhosts",
    target: 10,
    reward: 2,
    name: "Snack Run",
    blurb: "Eat 10 enemies in a single classic run.",
  },
  {
    id: "classic-run-ghosts-15",
    category: "collect",
    mode: "classic",
    metric: "runGhosts",
    target: 15,
    reward: 3,
    name: "Pest Control",
    blurb: "Eat 15 enemies in a single classic run.",
  },
  {
    id: "classic-run-ghosts-20",
    category: "collect",
    mode: "classic",
    metric: "runGhosts",
    target: 20,
    reward: 4,
    name: "Chomping Spree",
    blurb: "Eat 20 enemies in a single classic run.",
  },
  {
    id: "classic-run-ghosts-25",
    category: "collect",
    mode: "classic",
    metric: "runGhosts",
    target: 25,
    reward: 6,
    name: "Garden Cleared",
    blurb: "Eat 25 enemies in a single classic run.",
  },
  {
    id: "classic-run-ghosts-30",
    category: "collect",
    mode: "classic",
    metric: "runGhosts",
    target: 30,
    reward: 10,
    name: "Top Dog",
    blurb: "Eat 30 enemies in a single classic run.",
  },

  // --- classic · fruit in one run ------------------------------------------
  {
    id: "classic-run-fruit-5",
    category: "collect",
    mode: "classic",
    metric: "runFruit",
    target: 5,
    reward: 2,
    name: "Fruit Picker",
    blurb: "Eat 5 fruits in a single classic run. They vanish if you dawdle.",
  },
  {
    id: "classic-run-fruit-10",
    category: "collect",
    mode: "classic",
    metric: "runFruit",
    target: 10,
    reward: 3,
    name: "Fruit Bowl",
    blurb: "Eat 10 fruits in a single classic run.",
  },
  {
    id: "classic-run-fruit-15",
    category: "collect",
    mode: "classic",
    metric: "runFruit",
    target: 15,
    reward: 4,
    name: "Orchard Raider",
    blurb: "Eat 15 fruits in a single classic run.",
  },
  {
    id: "classic-run-fruit-20",
    category: "collect",
    mode: "classic",
    metric: "runFruit",
    target: 20,
    reward: 6,
    name: "Five a Day",
    blurb: "Eat 20 fruits in a single classic run.",
  },
  {
    id: "classic-run-fruit-25",
    category: "collect",
    mode: "classic",
    metric: "runFruit",
    target: 25,
    reward: 9,
    name: "Greengrocer",
    blurb: "Eat 25 fruits in a single classic run.",
  },
  {
    id: "classic-run-fruit-30",
    category: "collect",
    mode: "classic",
    metric: "runFruit",
    target: 30,
    reward: 14,
    name: "Harvest Festival",
    blurb: "Eat 30 fruits in a single classic run. Four a map, and they are timed.",
  },

  // --- classic · golden bones in one run -----------------------------------
  {
    id: "classic-run-bones-5",
    category: "collect",
    mode: "classic",
    metric: "runBones",
    target: 5,
    reward: 2,
    name: "Bone Idle",
    blurb: "Chomp 5 golden bones in a single classic run.",
  },
  {
    id: "classic-run-bones-10",
    category: "collect",
    mode: "classic",
    metric: "runBones",
    target: 10,
    reward: 2,
    name: "Buried Treasure",
    blurb: "Chomp 10 golden bones in a single classic run.",
  },
  {
    id: "classic-run-bones-15",
    category: "collect",
    mode: "classic",
    metric: "runBones",
    target: 15,
    reward: 4,
    name: "Bone Collector",
    blurb: "Chomp 15 golden bones in a single classic run.",
  },
  {
    id: "classic-run-bones-20",
    category: "collect",
    mode: "classic",
    metric: "runBones",
    target: 20,
    reward: 5,
    name: "Marrow Deep",
    blurb: "Chomp 20 golden bones in a single classic run.",
  },
  {
    id: "classic-run-bones-25",
    category: "collect",
    mode: "classic",
    metric: "runBones",
    target: 25,
    reward: 8,
    name: "Bone Dry",
    blurb: "Chomp 25 golden bones in a single classic run.",
  },
  {
    id: "classic-run-bones-30",
    category: "collect",
    mode: "classic",
    metric: "runBones",
    target: 30,
    reward: 12,
    name: "The Whole Skeleton",
    blurb: "Chomp 30 golden bones in a single classic run. Four a map.",
  },

  // --- classic · lifetime totals -------------------------------------------
  {
    id: "classic-total-coins-50",
    category: "collect",
    mode: "classic",
    metric: "totalCoins",
    target: 50,
    reward: 3,
    name: "Saving Up",
    blurb: "Collect 50 coins across all your classic runs.",
  },
  {
    id: "classic-total-coins-100",
    category: "collect",
    mode: "classic",
    metric: "totalCoins",
    target: 100,
    reward: 5,
    name: "Coin Counter",
    blurb: "Collect 100 coins across all your classic runs.",
  },
  {
    id: "classic-total-coins-150",
    category: "collect",
    mode: "classic",
    metric: "totalCoins",
    target: 150,
    reward: 8,
    name: "Well Off",
    blurb: "Collect 150 coins across all your classic runs.",
  },
  {
    id: "classic-total-coins-200",
    category: "collect",
    mode: "classic",
    metric: "totalCoins",
    target: 200,
    reward: 12,
    name: "Rich Pickings",
    blurb: "Collect 200 coins across all your classic runs.",
  },
  {
    id: "classic-total-ghosts-50",
    category: "collect",
    mode: "classic",
    metric: "totalGhosts",
    target: 50,
    reward: 2,
    name: "Fifty Chomps",
    blurb: "Eat 50 enemies across all your classic runs.",
  },
  {
    id: "classic-total-ghosts-100",
    category: "collect",
    mode: "classic",
    metric: "totalGhosts",
    target: 100,
    reward: 4,
    name: "Century of Chomps",
    blurb: "Eat 100 enemies across all your classic runs.",
  },
  {
    id: "classic-total-ghosts-150",
    category: "collect",
    mode: "classic",
    metric: "totalGhosts",
    target: 150,
    reward: 6,
    name: "Exterminator",
    blurb: "Eat 150 enemies across all your classic runs.",
  },
  {
    id: "classic-total-ghosts-200",
    category: "collect",
    mode: "classic",
    metric: "totalGhosts",
    target: 200,
    reward: 10,
    name: "Nothing Left to Chase",
    blurb: "Eat 200 enemies across all your classic runs.",
  },
  {
    id: "classic-total-fruit-50",
    category: "collect",
    mode: "classic",
    metric: "totalFruit",
    target: 50,
    reward: 4,
    name: "Fruit Fly",
    blurb: "Eat 50 fruits across all your classic runs.",
  },
  {
    id: "classic-total-fruit-100",
    category: "collect",
    mode: "classic",
    metric: "totalFruit",
    target: 100,
    reward: 6,
    name: "Market Stall",
    blurb: "Eat 100 fruits across all your classic runs.",
  },
  {
    id: "classic-total-fruit-150",
    category: "collect",
    mode: "classic",
    metric: "totalFruit",
    target: 150,
    reward: 9,
    name: "Fruit Baron",
    blurb: "Eat 150 fruits across all your classic runs.",
  },
  {
    id: "classic-total-fruit-200",
    category: "collect",
    mode: "classic",
    metric: "totalFruit",
    target: 200,
    reward: 14,
    name: "Two Hundred a Day",
    blurb: "Eat 200 fruits across all your classic runs.",
  },
  {
    id: "classic-total-bones-50",
    category: "collect",
    mode: "classic",
    metric: "totalBones",
    target: 50,
    reward: 3,
    name: "Bone Yard",
    blurb: "Chomp 50 golden bones across all your classic runs.",
  },
  {
    id: "classic-total-bones-100",
    category: "collect",
    mode: "classic",
    metric: "totalBones",
    target: 100,
    reward: 5,
    name: "Hundred Bones",
    blurb: "Chomp 100 golden bones across all your classic runs.",
  },
  {
    id: "classic-total-bones-150",
    category: "collect",
    mode: "classic",
    metric: "totalBones",
    target: 150,
    reward: 8,
    name: "Deep Digger",
    blurb: "Chomp 150 golden bones across all your classic runs.",
  },
  {
    id: "classic-total-bones-200",
    category: "collect",
    mode: "classic",
    metric: "totalBones",
    target: 200,
    reward: 12,
    name: "Gold Standard",
    blurb: "Chomp 200 golden bones across all your classic runs.",
  },

  // --- classic · score ------------------------------------------------------
  //
  // The one ladder Nuno did not spell out but named the category for. Sized off
  // a real board: ~180 biscuits at 10 plus four bones at 50 puts one cleared
  // map around 2,000-3,000 before fruit and enemies, so 5,000 is about two maps
  // and 60,000 is a long, clean run.
  {
    id: "classic-run-score-5000",
    category: "score",
    mode: "classic",
    metric: "runScore",
    target: 5000,
    reward: 2,
    name: "Warming Up",
    blurb: "Score 5,000 points in a single classic run.",
  },
  {
    id: "classic-run-score-15000",
    category: "score",
    mode: "classic",
    metric: "runScore",
    target: 15000,
    reward: 5,
    name: "Good Innings",
    blurb: "Score 15,000 points in a single classic run.",
  },
  {
    id: "classic-run-score-30000",
    category: "score",
    mode: "classic",
    metric: "runScore",
    target: 30000,
    reward: 10,
    name: "Board Climber",
    blurb: "Score 30,000 points in a single classic run.",
  },
  {
    id: "classic-run-score-60000",
    category: "score",
    mode: "classic",
    metric: "runScore",
    target: 60000,
    reward: 20,
    name: "Name in Lights",
    blurb: "Score 60,000 points in a single classic run.",
  },

  // --- classic · maps -------------------------------------------------------
  {
    id: "classic-run-levels-5",
    category: "levels",
    mode: "classic",
    metric: "runLevels",
    target: 5,
    reward: 3,
    name: "Stage One Done",
    blurb: "Clear 5 maps in a single classic run.",
  },
  {
    id: "classic-run-levels-10",
    category: "levels",
    mode: "classic",
    metric: "runLevels",
    target: 10,
    reward: 6,
    name: "Double Figures",
    blurb: "Clear 10 maps in a single classic run.",
  },
  {
    id: "classic-run-levels-15",
    category: "levels",
    mode: "classic",
    metric: "runLevels",
    target: 15,
    reward: 10,
    name: "Halfway Round",
    blurb: "Clear 15 maps in a single classic run.",
  },
  {
    id: "classic-run-levels-20",
    category: "levels",
    mode: "classic",
    metric: "runLevels",
    target: 20,
    reward: 16,
    name: "Long Walkies",
    blurb: "Clear 20 maps in a single classic run.",
  },
  {
    id: "classic-run-levels-30",
    category: "levels",
    mode: "classic",
    metric: "runLevels",
    target: 30,
    reward: 30,
    name: "Full Lap",
    blurb: "Clear 30 maps in a single classic run — a whole cycle.",
  },

  // --- classic · deathless --------------------------------------------------
  //
  // `lives_lost` is a whole-RUN total, so these mean "got this far and never
  // died once", not "N of the maps happened to be clean".
  {
    id: "classic-deathless-1",
    category: "levels",
    mode: "classic",
    metric: "runDeathlessLevels",
    target: 1,
    reward: 4,
    name: "Not a Scratch",
    blurb: "Clear a map without losing a single life.",
  },
  {
    id: "classic-deathless-3",
    category: "levels",
    mode: "classic",
    metric: "runDeathlessLevels",
    target: 3,
    reward: 12,
    name: "Untouchable",
    blurb: "Clear 3 maps in one run without losing a single life.",
  },
  {
    id: "classic-deathless-5",
    category: "levels",
    mode: "classic",
    metric: "runDeathlessLevels",
    target: 5,
    reward: 28,
    name: "Ghost Dog",
    blurb: "Clear 5 maps in one run without losing a single life.",
  },

  // --- journey · how far up the ladder --------------------------------------
  {
    id: "journey-unlocked-5",
    category: "levels",
    mode: "journey",
    metric: "journeyUnlocked",
    target: 5,
    reward: 3,
    name: "First Steps",
    blurb: "Clear 5 Journey levels.",
  },
  {
    id: "journey-unlocked-10",
    category: "levels",
    mode: "journey",
    metric: "journeyUnlocked",
    target: 10,
    reward: 5,
    name: "Finding the Path",
    blurb: "Clear 10 Journey levels.",
  },
  {
    id: "journey-unlocked-15",
    category: "levels",
    mode: "journey",
    metric: "journeyUnlocked",
    target: 15,
    reward: 8,
    name: "Halfway Up",
    blurb: "Clear 15 Journey levels.",
  },
  {
    id: "journey-unlocked-20",
    category: "levels",
    mode: "journey",
    metric: "journeyUnlocked",
    target: 20,
    reward: 12,
    name: "Twenty Stones",
    blurb: "Clear 20 Journey levels.",
  },
  {
    id: "journey-unlocked-25",
    category: "levels",
    mode: "journey",
    metric: "journeyUnlocked",
    target: 25,
    reward: 18,
    name: "The Long Walk",
    blurb: "Clear 25 Journey levels.",
  },
  {
    id: "journey-unlocked-30",
    category: "levels",
    mode: "journey",
    metric: "journeyUnlocked",
    target: 30,
    reward: 25,
    name: "Grand Tour",
    blurb: "Clear 30 Journey levels — every playable maze in the game.",
  },

  // --- journey · deathless levels -------------------------------------------
  {
    id: "journey-deathless-1",
    category: "levels",
    mode: "journey",
    metric: "journeyDeathless",
    target: 1,
    reward: 3,
    name: "Clean Sheet",
    blurb: "Clear a Journey level without losing a life.",
  },
  {
    id: "journey-deathless-5",
    category: "levels",
    mode: "journey",
    metric: "journeyDeathless",
    target: 5,
    reward: 8,
    name: "Five Clean",
    blurb: "Clear 5 different Journey levels without losing a life.",
  },
  {
    id: "journey-deathless-10",
    category: "levels",
    mode: "journey",
    metric: "journeyDeathless",
    target: 10,
    reward: 15,
    name: "Steady Paws",
    blurb: "Clear 10 different Journey levels without losing a life.",
  },
  {
    id: "journey-deathless-20",
    category: "levels",
    mode: "journey",
    metric: "journeyDeathless",
    target: 20,
    reward: 30,
    name: "Half the Ladder, Unharmed",
    blurb: "Clear 20 different Journey levels without losing a life.",
  },
  {
    id: "journey-deathless-40",
    category: "levels",
    mode: "journey",
    metric: "journeyDeathless",
    target: 40,
    reward: 60,
    name: "Flawless Journey",
    blurb: "Clear every Journey level without losing a life.",
  },

  // --- journey · every coin on the board ------------------------------------
  {
    id: "journey-allcoins-1",
    category: "collect",
    mode: "journey",
    metric: "journeyAllCoins",
    target: 1,
    reward: 2,
    name: "Swept Clean",
    blurb: "Collect all 5 coins in a Journey level.",
  },
  {
    id: "journey-allcoins-5",
    category: "collect",
    mode: "journey",
    metric: "journeyAllCoins",
    target: 5,
    reward: 6,
    name: "Five Sweeps",
    blurb: "Collect all 5 coins in 5 different Journey levels.",
  },
  {
    id: "journey-allcoins-10",
    category: "collect",
    mode: "journey",
    metric: "journeyAllCoins",
    target: 10,
    reward: 12,
    name: "Nothing Left Behind",
    blurb: "Collect all 5 coins in 10 different Journey levels.",
  },
  {
    id: "journey-allcoins-20",
    category: "collect",
    mode: "journey",
    metric: "journeyAllCoins",
    target: 20,
    reward: 25,
    name: "Coin Cartographer",
    blurb: "Collect all 5 coins in 20 different Journey levels.",
  },

  // --- journey · every fruit on the board -----------------------------------
  //
  // FOUR, not five: FRUIT_THRESHOLDS has four entries. And they are timed, so
  // this is the harder of the two "all of them" ladders.
  {
    id: "journey-allfruit-1",
    category: "collect",
    mode: "journey",
    metric: "journeyAllFruit",
    target: 1,
    reward: 3,
    name: "Bowl Emptied",
    blurb: "Eat all 4 fruits in a Journey level before they vanish.",
  },
  {
    id: "journey-allfruit-5",
    category: "collect",
    mode: "journey",
    metric: "journeyAllFruit",
    target: 5,
    reward: 8,
    name: "Five Bowls",
    blurb: "Eat all 4 fruits in 5 different Journey levels.",
  },
  {
    id: "journey-allfruit-10",
    category: "collect",
    mode: "journey",
    metric: "journeyAllFruit",
    target: 10,
    reward: 16,
    name: "Fruit Route",
    blurb: "Eat all 4 fruits in 10 different Journey levels.",
  },
  {
    id: "journey-allfruit-20",
    category: "collect",
    mode: "journey",
    metric: "journeyAllFruit",
    target: 20,
    reward: 32,
    name: "Orchard Tour",
    blurb: "Eat all 4 fruits in 20 different Journey levels.",
  },

  // --- journey · hunting ----------------------------------------------------
  {
    id: "journey-ghosts-1",
    category: "collect",
    mode: "journey",
    metric: "journeyGhosts",
    target: 1,
    reward: 2,
    name: "Hunting Trip",
    blurb: "Eat 5 enemies in a Journey level.",
  },
  {
    id: "journey-ghosts-5",
    category: "collect",
    mode: "journey",
    metric: "journeyGhosts",
    target: 5,
    reward: 5,
    name: "Five Hunts",
    blurb: "Eat 5 enemies in each of 5 different Journey levels.",
  },
  {
    id: "journey-ghosts-10",
    category: "collect",
    mode: "journey",
    metric: "journeyGhosts",
    target: 10,
    reward: 10,
    name: "Seasoned Hunter",
    blurb: "Eat 5 enemies in each of 10 different Journey levels.",
  },
  {
    id: "journey-ghosts-20",
    category: "collect",
    mode: "journey",
    metric: "journeyGhosts",
    target: 20,
    reward: 20,
    name: "The Pack Fears You",
    blurb: "Eat 5 enemies in each of 20 different Journey levels.",
  },
];

export const CHALLENGE_COUNT = CHALLENGES.length;

/** Category order for the screen. Explicit rather than derived from the array,
 *  because the array is grouped by LADDER (all the coin tiers together) and the
 *  screen groups by category — deriving the order from first-appearance would
 *  make reordering one ladder silently reorder the tabs. */
export const CHALLENGE_CATEGORIES: readonly ChallengeCategory[] = ["collect", "score", "levels"];

export const CATEGORY_LABELS: Readonly<Record<ChallengeCategory, string>> = {
  collect: "Collect",
  score: "Score",
  levels: "Levels",
};

export const MODE_LABELS: Readonly<Record<ChallengeMode, string>> = {
  classic: "Classic",
  journey: "Journey",
  both: "Any mode",
};

export function getChallenge(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// The view side
// ---------------------------------------------------------------------------
//
// THE SERVER EVALUATES; THIS SIDE RENDERS. There is deliberately no second
// evaluator here. The numbers a challenge is judged on live in `run_stats`,
// which only the server can read, and the coins are banked by the server — so
// a client-side copy of the rule would be a second implementation of a
// judgement it does not get to make. When the two disagreed the player would
// see a finished challenge and get an error on Claim.
//
// So the API returns the VALUE, the TARGET and the REWARD it judged against,
// and this file supplies only what the server has no business knowing: the
// name, the blurb, the category and the order they are listed in. Drift
// between the two def lists is caught the way every other generated-catalog
// drift is — `npm run test:catalog` fails on it.

/** One row exactly as `GET /api/v1/challenges` returns it. `target` and
 *  `reward` come from the SERVER's copy of the definitions on purpose: showing
 *  a local target while the server judged a different one is the one drift a
 *  player could actually be hurt by. */
export interface ChallengeRow {
  readonly id: string;
  readonly value: number;
  readonly target: number;
  readonly reward: number;
  readonly done: boolean;
  readonly claimed: boolean;
}

/** A row joined to its local definition, which is what the screen draws. */
export interface ChallengeView extends ChallengeRow {
  readonly def: ChallengeDef;
  /** Done and not yet taken — the only state Claim is offered in, and what the
   *  menu chip's badge counts. */
  readonly claimable: boolean;
}

/**
 * Join the server's rows to the local definitions.
 *
 * A row the client has no definition for is DROPPED (the server is ahead — a
 * card with no name is worse than no card), and a definition with no row is
 * shown at zero (the server is behind, or the player has simply never played).
 * Neither is an error state to surface: both are the ordinary consequence of
 * deploying two halves of an app, and both resolve themselves on the next
 * deploy.
 */
export function viewChallenges(rows: readonly ChallengeRow[]): ChallengeView[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return CHALLENGES.map((def) => {
    const row = byId.get(def.id);
    const value = row ? Math.min(row.value, row.target) : 0;
    const target = row?.target ?? def.target;
    const reward = row?.reward ?? def.reward;
    const done = row?.done ?? false;
    const claimed = row?.claimed ?? false;
    return { id: def.id, def, value, target, reward, done, claimed, claimable: done && !claimed };
  });
}

/** What the menu chip's badge shows. Zero means no badge at all. */
export function claimableCount(rows: readonly ChallengeView[]): number {
  return rows.reduce((n, r) => n + (r.claimable ? 1 : 0), 0);
}

/** Coins waiting to be collected — the figure the Challenges screen leads with,
 *  because "3 rewards" says less than "23 coins". */
export function claimableCoins(rows: readonly ChallengeView[]): number {
  return rows.reduce((n, r) => n + (r.claimable ? r.reward : 0), 0);
}
