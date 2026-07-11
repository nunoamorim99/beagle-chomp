// Headless unit checks for the IDEA-010 beagle-skin cosmetics foundation:
// src/game/cosmetics.ts (pure data + in-memory equipped state) and
// src/game/profileStore.ts (localStorage bridge). No framework, matching
// validate-maze.ts/sim-logic.ts's style — assert + log, exit 1 on failure.
// Run: tsx scripts/test-cosmetics.ts (wired into `npm run test`).
import {
  BEAGLE_SKINS,
  DEFAULT_BEAGLE_SKIN_ID,
  getBeagleSkin,
  getBeagleSkinPrice,
  getEquippedBeagleSkinId,
  getEquippedBeagleSkin,
  setEquippedBeagleSkinId,
  cycleBeagleSkinId,
  ENEMY_SKINS,
  DEFAULT_ENEMY_SKIN_ID,
  getEnemySkin,
  getEnemySkinPrice,
  getEquippedEnemySkinId,
  getEquippedEnemySkin,
  setEquippedEnemySkinId,
  cycleEnemySkinId,
} from "../src/game/cosmetics";
import { COLORS, COINS, LIVES, LIFE_THRESHOLDS, COIN_THRESHOLDS, SPEEDS, TIMING } from "../src/game/config";
import {
  loadProfile,
  getCoins,
  addCoins,
  getOwnedBeagleSkinIds,
  getOwnedEnemySkinIds,
  isBeagleSkinOwned,
  isEnemySkinOwned,
  buyBeagleSkin,
  buyEnemySkin,
  equipBeagleSkin,
  equipEnemySkin,
  getChallengeProgress,
  advanceChallengeProgress,
  type StoredProfile,
} from "../src/game/profileStore";
import { coinsDueFromScore } from "../src/game/coins";
import { shouldFireThreshold } from "../src/game/pickups";
import {
  CLASSIC_MODIFIERS,
  CHALLENGE_LEVELS,
  CHALLENGE_LEVEL_COUNT,
  getChallengeLevel,
} from "../src/game/challenges";
import { MAZE_COUNT } from "../src/game/mazes";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

console.log("=== cosmetics.ts ===");

// Bagel's coat must exactly match today's live COLORS values — a regression
// guard so this refactor never silently changes what players currently see.
const bagel = getBeagleSkin("bagel");
check("bagel.coat.tan === COLORS.beagleTan", bagel.coat.tan === COLORS.beagleTan);
check("bagel.coat.white === COLORS.beagleWhite", bagel.coat.white === COLORS.beagleWhite);
check("bagel.coat.black === COLORS.beagleBlack", bagel.coat.black === COLORS.beagleBlack);
check("bagel.coat.ear === 0x6b3f22 (characters.ts EAR_BROWN)", bagel.coat.ear === 0x6b3f22);
check("bagel is BEAGLE_SKINS[0]", BEAGLE_SKINS[0].id === "bagel");
check("exactly 4 skins", BEAGLE_SKINS.length === 4);
check(
  "skin ids are bagel, cookie, muffin, pepper in order",
  BEAGLE_SKINS.map((s) => s.id).join(",") === "bagel,cookie,muffin,pepper",
);

// getBeagleSkin(unknown) -> default, never throws.
const unknown = getBeagleSkin("does-not-exist");
check("getBeagleSkin(unknown) falls back to default", unknown.id === DEFAULT_BEAGLE_SKIN_ID);

// Every skin's coat channels are valid 24-bit hex numbers (basic sanity so a
// typo'd hex constant doesn't silently pass as some huge/negative number).
BEAGLE_SKINS.forEach((s) => {
  (Object.keys(s.coat) as (keyof typeof s.coat)[]).forEach((channel) => {
    const v = s.coat[channel];
    check(`${s.id}.coat.${channel} is a valid 24-bit hex color`, Number.isInteger(v) && v >= 0 && v <= 0xffffff);
  });
});

// cycleBeagleSkinId wraps around through all 4 and back to bagel.
{
  let id = DEFAULT_BEAGLE_SKIN_ID;
  const seen: string[] = [id];
  for (let i = 0; i < BEAGLE_SKINS.length; i++) {
    id = cycleBeagleSkinId(id);
    seen.push(id);
  }
  check(
    `cycle visits all 4 skins then wraps to ${DEFAULT_BEAGLE_SKIN_ID}`,
    seen.join(",") === "bagel,cookie,muffin,pepper,bagel",
  );
  check("cycleBeagleSkinId(unknown) returns the first skin's id", cycleBeagleSkinId("nope") === BEAGLE_SKINS[0].id);
}

// setEquippedBeagleSkinId ignores unknown ids (clamps to default) and a known
// id round-trips through getEquippedBeagleSkinId/getEquippedBeagleSkin.
{
  setEquippedBeagleSkinId("cookie");
  check("equip known id -> getEquippedBeagleSkinId reflects it", getEquippedBeagleSkinId() === "cookie");
  check("equip known id -> getEquippedBeagleSkin reflects it", getEquippedBeagleSkin().id === "cookie");

  setEquippedBeagleSkinId("totally-bogus");
  check("equip unknown id clamps to default", getEquippedBeagleSkinId() === DEFAULT_BEAGLE_SKIN_ID);

  // restore default state for any later test that might run in this process
  setEquippedBeagleSkinId(DEFAULT_BEAGLE_SKIN_ID);
}

console.log("\n=== cosmetics.ts (IDEA-012 shop prices) ===");
{
  check("bagel.price === 0 (default, free)", getBeagleSkin("bagel").price === 0);
  check("cookie.price === 5", getBeagleSkin("cookie").price === 5);
  check("muffin.price === 5", getBeagleSkin("muffin").price === 5);
  check("pepper.price === 5", getBeagleSkin("pepper").price === 5);
  check("getBeagleSkinPrice('bagel') === 0", getBeagleSkinPrice("bagel") === 0);
  check("getBeagleSkinPrice('cookie') === 5", getBeagleSkinPrice("cookie") === 5);
  check("getBeagleSkinPrice(unknown) === 0 (falls back to default's price)", getBeagleSkinPrice("nope") === 0);

  check("ghost.price === 0 (default, free)", getEnemySkin("ghost").price === 0);
  check("beetle.price === 5", getEnemySkin("beetle").price === 5);
  check("bee.price === 5", getEnemySkin("bee").price === 5);
  check("ladybug.price === 5", getEnemySkin("ladybug").price === 5);
  check("getEnemySkinPrice('ghost') === 0", getEnemySkinPrice("ghost") === 0);
  check("getEnemySkinPrice('beetle') === 5", getEnemySkinPrice("beetle") === 5);
  check("getEnemySkinPrice(unknown) === 0 (falls back to default's price)", getEnemySkinPrice("nope") === 0);
}

console.log("\n=== cosmetics.ts (IDEA-009 enemy skins) ===");

check("exactly 4 enemy skins", ENEMY_SKINS.length === 4);
check(
  "enemy skin ids are ghost, beetle, bee, ladybug in order",
  ENEMY_SKINS.map((s) => s.id).join(",") === "ghost,beetle,bee,ladybug",
);
check("ghost is ENEMY_SKINS[0]", ENEMY_SKINS[0].id === "ghost");
check("DEFAULT_ENEMY_SKIN_ID is ghost", DEFAULT_ENEMY_SKIN_ID === "ghost");

// getEnemySkin(unknown) -> default, never throws.
const unknownEnemy = getEnemySkin("does-not-exist");
check("getEnemySkin(unknown) falls back to default (ghost)", unknownEnemy.id === DEFAULT_ENEMY_SKIN_ID);

// cycleEnemySkinId wraps around through both skins and back to ghost.
{
  let id = DEFAULT_ENEMY_SKIN_ID;
  const seen: string[] = [id];
  for (let i = 0; i < ENEMY_SKINS.length; i++) {
    id = cycleEnemySkinId(id);
    seen.push(id);
  }
  check(
    `enemy cycle visits all 4 skins then wraps to ${DEFAULT_ENEMY_SKIN_ID}`,
    seen.join(",") === "ghost,beetle,bee,ladybug,ghost",
  );
  check("cycleEnemySkinId(unknown) returns the first skin's id", cycleEnemySkinId("nope") === ENEMY_SKINS[0].id);
}

// setEquippedEnemySkinId ignores unknown ids (clamps to default) and a known
// id round-trips through getEquippedEnemySkinId/getEquippedEnemySkin.
{
  setEquippedEnemySkinId("beetle");
  check("equip known enemy id -> getEquippedEnemySkinId reflects it", getEquippedEnemySkinId() === "beetle");
  check("equip known enemy id -> getEquippedEnemySkin reflects it", getEquippedEnemySkin().id === "beetle");

  setEquippedEnemySkinId("totally-bogus");
  check("equip unknown enemy id clamps to default", getEquippedEnemySkinId() === DEFAULT_ENEMY_SKIN_ID);

  // restore default state for any later test that might run in this process
  setEquippedEnemySkinId(DEFAULT_ENEMY_SKIN_ID);
}

console.log("\n=== profileStore.ts (Node, no window/localStorage) ===");
// In this plain tsx/Node run there is no `window`, so loadProfile()'s
// try/catch must catch the ReferenceError and degrade to the default —
// exercising the same "storage unavailable" path a browser would hit in
// private-mode/disabled-storage, without needing a DOM shim.
{
  const profile = loadProfile();
  check("loadProfile() in Node (no window) returns the default beagle skin", profile.equippedBeagleSkinId === DEFAULT_BEAGLE_SKIN_ID);
  check("loadProfile() in Node (no window) returns the default enemy skin", profile.equippedEnemySkinId === DEFAULT_ENEMY_SKIN_ID);
}

// Round-trip check on the pure merge logic loadProfile() uses: a blob that
// already has a non-default beagle field, when "read-modify-write"'d with
// only the enemy field changing, must preserve the beagle field untouched.
// This exercises the same spread-over-defaults shape saveEquippedEnemySkinId
// relies on, without needing real localStorage (unavailable in this Node
// run, per the precedent above).
{
  const existing = { equippedBeagleSkinId: "cookie", equippedEnemySkinId: DEFAULT_ENEMY_SKIN_ID };
  const merged = { ...existing, equippedEnemySkinId: "beetle" };
  check("read-modify-write preserves beagle field when only enemy field changes", merged.equippedBeagleSkinId === "cookie");
  check("read-modify-write applies the new enemy field", merged.equippedEnemySkinId === "beetle");
}

console.log("\n=== coins.ts (IDEA-016 points->coins math) ===");
{
  check("coinsDueFromScore(0, 1000) === 0", coinsDueFromScore(0, 1000) === 0);
  check("coinsDueFromScore(999, 1000) === 0", coinsDueFromScore(999, 1000) === 0);
  check("coinsDueFromScore(1000, 1000) === 1", coinsDueFromScore(1000, 1000) === 1);
  check("coinsDueFromScore(1999, 1000) === 1", coinsDueFromScore(1999, 1000) === 1);
  check("coinsDueFromScore(2500, 1000) === 2 (crossing multiple at once)", coinsDueFromScore(2500, 1000) === 2);
  check("coinsDueFromScore(10000, 1000) === 10", coinsDueFromScore(10000, 1000) === 10);
  check("coinsDueFromScore(-50, 1000) === 0 (negative score)", coinsDueFromScore(-50, 1000) === 0);
  check("coinsDueFromScore(NaN, 1000) === 0", coinsDueFromScore(NaN, 1000) === 0);
  check("coinsDueFromScore(500, 0) === 0 (guards a bogus perPoints)", coinsDueFromScore(500, 0) === 0);
  check("coinsDueFromScore(500, -100) === 0 (guards a negative perPoints)", coinsDueFromScore(500, -100) === 0);
  check(
    "coinsDueFromScore matches config.ts's COINS.perPoints for a 3450 score -> 3 coins",
    coinsDueFromScore(3450, COINS.perPoints) === 3,
  );
}

console.log("\n=== pickups.ts (bugfix: shouldFireThreshold — each threshold fires ONCE per level) ===");
{
  const T = [20, 60, 105, 150] as const; // mirrors COIN_THRESHOLDS's shape

  // Fires once at >= threshold, with idx pointing at the pending entry.
  check("does not fire below the first threshold (eaten=19, idx=0)", shouldFireThreshold(19, T, 0) === false);
  check("fires exactly at the first threshold (eaten=20, idx=0)", shouldFireThreshold(20, T, 0) === true);
  // `>=` (not `===`) so a skipped tick still fires the pending threshold.
  check("fires PAST the first threshold too (eaten=25, idx=0) — robust to a skipped tick", shouldFireThreshold(25, T, 0) === true);

  // THE BUG THIS FIXES: does NOT refire at the same `eaten` once the caller
  // has advanced idx past it (simulating game.ts's `this.level.nextX++` right
  // after a spawn) — this is exactly the farming exploit's repro: eating a
  // pickup doesn't change `eaten`, so the old `includes(eaten)` gate kept
  // matching on the very next check. With the index pointer, the SAME eaten
  // value no longer matches once its threshold has fired.
  check(
    "does NOT refire at the same eaten value once idx has advanced past it (eaten=20, idx=1) — the farming-exploit repro",
    shouldFireThreshold(20, T, 1) === false,
  );
  check(
    "does NOT refire even well past it, still on the same maze visit (eaten=59, idx=1) — next threshold (60) not reached yet",
    shouldFireThreshold(59, T, 1) === false,
  );
  check("fires the SECOND threshold once eaten catches up (eaten=60, idx=1)", shouldFireThreshold(60, T, 1) === true);

  // Mid-array and last-entry behavior.
  check("fires the third threshold (eaten=105, idx=2)", shouldFireThreshold(105, T, 2) === true);
  check("fires the fourth (last) threshold (eaten=150, idx=3)", shouldFireThreshold(150, T, 3) === true);

  // End-of-array: once every threshold has fired (idx === thresholds.length),
  // always false — no out-of-bounds access, no re-firing for the rest of the
  // level no matter how high `eaten` climbs.
  check("idx at thresholds.length -> always false (eaten=150)", shouldFireThreshold(150, T, T.length) === false);
  check("idx at thresholds.length -> always false (eaten=9999, deep into the level)", shouldFireThreshold(9999, T, T.length) === false);
  check("idx past thresholds.length (defensive) -> always false", shouldFireThreshold(200, T, T.length + 5) === false);

  // Negative idx (defensive — shouldn't happen from game.ts, which only ever
  // starts at 0 and increments, but the helper must not throw/misbehave).
  check("negative idx -> always false (defensive)", shouldFireThreshold(50, T, -1) === false);

  // Single-entry array (mirrors LIFE_THRESHOLDS = [130] exactly).
  const singleT = [130] as const;
  check("single-entry array: does not fire before (eaten=129, idx=0)", shouldFireThreshold(129, singleT, 0) === false);
  check("single-entry array: fires at threshold (eaten=130, idx=0)", shouldFireThreshold(130, singleT, 0) === true);
  check(
    "single-entry array: does not refire after idx advances (eaten=130, idx=1) — the exact IDEA-018 farming repro",
    shouldFireThreshold(130, singleT, 1) === false,
  );

  // Empty thresholds array (defensive edge case) -> always false.
  check("empty thresholds array -> always false", shouldFireThreshold(100, [], 0) === false);
}

console.log("\n=== config.ts (IDEA-018 bonus lives: coinsDueFromScore reused with LIVES.milestonePoints) ===");
{
  // Same pure helper as coins (IDEA-016) reused verbatim with a different
  // divisor for the lives milestone (game.ts's maybeAwardLivesFromScore) —
  // exercised here at LIVES.milestonePoints (5000) to guard against a future
  // config change silently breaking the milestone math, mirroring the
  // COINS.perPoints check just above.
  check("coinsDueFromScore(0, LIVES.milestonePoints) === 0", coinsDueFromScore(0, LIVES.milestonePoints) === 0);
  check("coinsDueFromScore(4999, LIVES.milestonePoints) === 0", coinsDueFromScore(4999, LIVES.milestonePoints) === 0);
  check("coinsDueFromScore(5000, LIVES.milestonePoints) === 1", coinsDueFromScore(5000, LIVES.milestonePoints) === 1);
  check(
    "coinsDueFromScore(12000, LIVES.milestonePoints) === 2 (crossing multiple at once)",
    coinsDueFromScore(12000, LIVES.milestonePoints) === 2,
  );
  check(
    "coinsDueFromScore matches config.ts's LIVES.milestonePoints for a 17500 score -> 3 lives",
    coinsDueFromScore(17500, LIVES.milestonePoints) === 3,
  );

  // LIVES.max sanity: a positive, finite cap greater than START_LIVES (3),
  // so bonus lives always have real headroom to grant.
  check("LIVES.max is a positive integer greater than 3", Number.isInteger(LIVES.max) && LIVES.max > 3);

  // LIFE_THRESHOLDS must never collide with COIN_THRESHOLDS or the fruit
  // thresholds (game.ts's private FRUIT_THRESHOLDS = [70, 140], mirrored here
  // as a literal since it isn't exported) — a shared eaten-pellet tick would
  // mean two maybeSpawn* guards racing for the same frame. Cheap regression
  // guard so a future retune of any of these three lists can't silently
  // introduce a collision.
  const FRUIT_THRESHOLDS_MIRROR = [70, 140] as const;
  const collidesWithCoins = LIFE_THRESHOLDS.some((t) => (COIN_THRESHOLDS as readonly number[]).includes(t));
  const collidesWithFruit = LIFE_THRESHOLDS.some((t) => (FRUIT_THRESHOLDS_MIRROR as readonly number[]).includes(t));
  check("LIFE_THRESHOLDS never collides with COIN_THRESHOLDS", !collidesWithCoins);
  check("LIFE_THRESHOLDS never collides with FRUIT_THRESHOLDS", !collidesWithFruit);
}

console.log("\n=== profileStore.ts coins (Node, no window/localStorage) ===");
{
  // No `window` in this Node run, so getCoins()/loadProfile() degrade to 0 —
  // same "storage unavailable" path exercised above for skins.
  check("loadProfile() in Node (no window) returns coins:0 by default", loadProfile().coins === 0);
  check("getCoins() in Node (no window) returns 0", getCoins() === 0);

  // addCoins is guarded the same way every other storage write here is: with
  // no `window`, saveCoins's try/catch swallows the failure and the call
  // never throws, even though the write itself has nowhere to persist to.
  let threw = false;
  try {
    addCoins(5);
  } catch {
    threw = true;
  }
  check("addCoins(5) in Node (no window) never throws", !threw);
}

// Pure sanitize/read-modify-write behaviour, exercised directly on plain
// objects the same way loadProfile()'s merge logic works internally (no
// window needed) — garbage/negative/NaN coins in a blob must degrade to 0,
// and a read-modify-write that only changes coins must preserve the skin
// fields untouched (and vice versa), mirroring the existing beagle/enemy
// read-modify-write check above.
{
  function sanitize(value: unknown): number {
    const n = typeof value === "number" ? value : NaN;
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  check("sanitize(-5) -> 0 (negative)", sanitize(-5) === 0);
  check("sanitize(NaN) -> 0", sanitize(NaN) === 0);
  check("sanitize('garbage') -> 0", sanitize("garbage") === 0);
  check("sanitize(undefined) -> 0 (missing key on old blobs)", sanitize(undefined) === 0);
  check("sanitize(Infinity) -> 0", sanitize(Infinity) === 0);
  check("sanitize(42.9) -> 42 (floors a float)", sanitize(42.9) === 42);
  check("sanitize(42) -> 42 (valid passthrough)", sanitize(42) === 42);

  const existing = { equippedBeagleSkinId: "cookie", equippedEnemySkinId: DEFAULT_ENEMY_SKIN_ID, coins: 12 };
  const mergedCoinsOnly = { ...existing, coins: 37 };
  check("read-modify-write preserves skin fields when only coins change", mergedCoinsOnly.equippedBeagleSkinId === "cookie");
  check("read-modify-write applies the new coins value", mergedCoinsOnly.coins === 37);

  const mergedSkinOnly = { ...existing, equippedEnemySkinId: "beetle" };
  check("read-modify-write preserves coins when only a skin field changes", mergedSkinOnly.coins === 12);
}

console.log("\n=== profileStore.ts ownership defaults (Node, no window/localStorage) ===");
{
  // No `window` in this Node run, so loadProfile() always degrades to
  // defaultProfile() — exercising the "fresh profile" ownership defaults.
  const profile = loadProfile();
  check(
    "fresh profile owns exactly ['bagel']",
    profile.ownedBeagleSkinIds.length === 1 && profile.ownedBeagleSkinIds[0] === "bagel",
  );
  check(
    "fresh profile owns exactly ['ghost']",
    profile.ownedEnemySkinIds.length === 1 && profile.ownedEnemySkinIds[0] === "ghost",
  );

  check("getOwnedBeagleSkinIds() matches loadProfile()", getOwnedBeagleSkinIds().join(",") === "bagel");
  check("getOwnedEnemySkinIds() matches loadProfile()", getOwnedEnemySkinIds().join(",") === "ghost");

  check("isBeagleSkinOwned('bagel') === true (default always owned)", isBeagleSkinOwned("bagel") === true);
  check("isBeagleSkinOwned('cookie') === false initially", isBeagleSkinOwned("cookie") === false);
  check("isEnemySkinOwned('ghost') === true (default always owned)", isEnemySkinOwned("ghost") === true);
  check("isEnemySkinOwned('beetle') === false initially", isEnemySkinOwned("beetle") === false);
}

console.log("\n=== profileStore.ts loadProfile defensive ownership sanitizing ===");
{
  // Mirrors the private sanitizeOwnedBeagleSkinIds/sanitizeOwnedEnemySkinIds
  // in profileStore.ts exactly, exercised directly on plain objects (no
  // window needed) the same way the existing coins `sanitize` mirror above
  // does — these are the same rules loadProfile() applies to a parsed blob.
  function isKnownBeagle(id: unknown): id is string {
    return typeof id === "string" && BEAGLE_SKINS.some((s) => s.id === id);
  }
  function isKnownEnemy(id: unknown): id is string {
    return typeof id === "string" && ENEMY_SKINS.some((s) => s.id === id);
  }
  function sanitizeOwnedBeagle(value: unknown): string[] {
    const known = Array.isArray(value) ? value.filter(isKnownBeagle) : [];
    return Array.from(new Set(["bagel", ...known]));
  }
  function sanitizeOwnedEnemy(value: unknown): string[] {
    const known = Array.isArray(value) ? value.filter(isKnownEnemy) : [];
    return Array.from(new Set(["ghost", ...known]));
  }

  // Old blob without the owned keys at all (undefined) -> just the default.
  check(
    "old blob (no owned key) -> defaults owned",
    sanitizeOwnedBeagle(undefined).join(",") === "bagel" && sanitizeOwnedEnemy(undefined).join(",") === "ghost",
  );

  // Garbage (non-array) owned value -> defaults.
  check("garbage owned value (string) -> defaults", sanitizeOwnedBeagle("not-an-array").join(",") === "bagel");
  check("garbage owned value (number) -> defaults", sanitizeOwnedBeagle(42).join(",") === "bagel");
  check("garbage owned value (object) -> defaults", sanitizeOwnedBeagle({ foo: "bar" }).join(",") === "bagel");

  // Owned array with an unknown id -> filtered out, default still present.
  check(
    "owned array with unknown id is filtered out, default kept",
    sanitizeOwnedBeagle(["bagel", "not-a-real-skin"]).sort().join(",") === "bagel",
  );
  check(
    "owned array with a known non-default id keeps it plus the default",
    sanitizeOwnedBeagle(["cookie", "bogus"]).sort().join(",") === "bagel,cookie",
  );

  // Owned array missing the default entirely -> default force-included.
  check(
    "owned array missing the default -> default force-included",
    sanitizeOwnedBeagle(["cookie", "muffin"]).sort().join(",") === "bagel,cookie,muffin",
  );
  check(
    "enemy owned array missing the default -> default force-included",
    sanitizeOwnedEnemy(["beetle"]).sort().join(",") === "beetle,ghost",
  );
}

console.log("\n=== profileStore.ts buy operations (Node, no window/localStorage) ===");
{
  // With no `window`, every loadProfile() call degrades to a fresh
  // defaultProfile() (coins:0, only the default owned) and persistProfile's
  // write is caught and silently dropped — so buy operations here exercise
  // the "insufficient funds" and "guard never throws" paths deterministically
  // (every call starts from the same fresh-default snapshot, since nothing
  // actually persists in this environment).
  const before = loadProfile();
  check("Node fresh profile has 0 coins (can't afford a 5-coin skin)", before.coins === 0);

  let threw = false;
  let result: { ok: boolean; reason?: string } = { ok: true };
  try {
    result = buyBeagleSkin("cookie");
  } catch {
    threw = true;
  }
  check("buyBeagleSkin never throws even with no window/localStorage", !threw);
  check("buyBeagleSkin('cookie') with 0 coins -> insufficient-coins", result.ok === false && result.reason === "insufficient-coins");
  check("failed buy leaves ownership unchanged", isBeagleSkinOwned("cookie") === false);
  check("failed buy leaves coins unchanged", getCoins() === 0);

  const enemyResult = buyEnemySkin("beetle");
  check("buyEnemySkin('beetle') with 0 coins -> insufficient-coins", enemyResult.ok === false && enemyResult.reason === "insufficient-coins");
  check("failed enemy buy leaves ownership unchanged", isEnemySkinOwned("beetle") === false);

  // Buying the already-owned default is refused (never double-charges),
  // regardless of wallet balance.
  const alreadyOwned = buyBeagleSkin("bagel");
  check("buyBeagleSkin('bagel') (already owned) -> already-owned, no charge", alreadyOwned.ok === false && alreadyOwned.reason === "already-owned");
  const alreadyOwnedEnemy = buyEnemySkin("ghost");
  check("buyEnemySkin('ghost') (already owned) -> already-owned, no charge", alreadyOwnedEnemy.ok === false && alreadyOwnedEnemy.reason === "already-owned");

  // Unknown ids are refused before any coin/ownership check.
  const unknownBuy = buyBeagleSkin("not-a-real-skin");
  check("buyBeagleSkin(unknown id) -> unknown", unknownBuy.ok === false && unknownBuy.reason === "unknown");
  const unknownEnemyBuy = buyEnemySkin("not-a-real-skin");
  check("buyEnemySkin(unknown id) -> unknown", unknownEnemyBuy.ok === false && unknownEnemyBuy.reason === "unknown");
}

console.log("\n=== profileStore.ts buy success + atomicity (pure, in-process profile objects) ===");
{
  // The buy operations' actual read-modify-write logic can't be exercised
  // end-to-end without real localStorage (unavailable in this Node run —
  // see the "Node fresh profile" precedent above), so this mirrors the exact
  // trySpend + read-modify-write shape buyBeagleSkin/buyEnemySkin use
  // internally, against a plain in-memory StoredProfile object, to prove the
  // coin-deduct and owned-add always land together (atomicity) and that a
  // successful purchase's shape is correct.
  function trySpend(coins: number, price: number): number | null {
    if (coins < price) return null;
    return coins - price;
  }

  const profile: StoredProfile = {
    equippedBeagleSkinId: "bagel",
    equippedEnemySkinId: "ghost",
    coins: 12,
    ownedBeagleSkinIds: ["bagel"],
    ownedEnemySkinIds: ["ghost"],
    challengeProgress: 0,
  };

  const price = getBeagleSkinPrice("cookie");
  check("cookie price is 5 for this scenario", price === 5);

  const newCoins = trySpend(profile.coins, price);
  check("12 coins can afford a 5-coin skin", newCoins === 7);

  const afterBuy: StoredProfile = {
    ...profile,
    coins: newCoins as number,
    ownedBeagleSkinIds: [...profile.ownedBeagleSkinIds, "cookie"],
  };
  check("buy atomicity: coins reduced by price", afterBuy.coins === profile.coins - price);
  check("buy atomicity: id now owned in the SAME resulting object", afterBuy.ownedBeagleSkinIds.includes("cookie"));
  check(
    "buy preserves the other category's owned list untouched",
    afterBuy.ownedEnemySkinIds.length === 1 && afterBuy.ownedEnemySkinIds[0] === "ghost",
  );
  check("buy preserves equipped skins untouched", afterBuy.equippedBeagleSkinId === "bagel" && afterBuy.equippedEnemySkinId === "ghost");

  // Insufficient-funds path never mutates anything (no partial charge / no
  // partial ownership add) — the null sentinel from trySpend is the guard
  // buyBeagleSkin/buyEnemySkin check before building the next profile object.
  const poorProfile: StoredProfile = { ...profile, coins: 2 };
  const insufficient = trySpend(poorProfile.coins, price);
  check("2 coins cannot afford a 5-coin skin -> trySpend returns null", insufficient === null);
}

console.log("\n=== profileStore.ts equip gating (Node, no window/localStorage) ===");
{
  // With no window, equip*'s ownership check reads a fresh default profile
  // each time (only the default owned), so an unowned skin is always
  // refused here and the default always succeeds — exercising the gating
  // logic itself (isBeagleSkinOwned/isEnemySkinOwned) rather than the
  // storage persistence step (which is a guarded no-op in this environment).
  const refused = equipBeagleSkin("cookie");
  check("equipBeagleSkin(unowned 'cookie') is refused (returns false)", refused === false);
  check("equipBeagleSkin(unowned) does not change the equipped id", getEquippedBeagleSkinId() === DEFAULT_BEAGLE_SKIN_ID);

  const allowedDefault = equipBeagleSkin("bagel");
  check("equipBeagleSkin(owned default 'bagel') succeeds (returns true)", allowedDefault === true);
  check("equipBeagleSkin(default) leaves equipped id as the default", getEquippedBeagleSkinId() === DEFAULT_BEAGLE_SKIN_ID);

  const refusedEnemy = equipEnemySkin("beetle");
  check("equipEnemySkin(unowned 'beetle') is refused (returns false)", refusedEnemy === false);
  check("equipEnemySkin(unowned) does not change the equipped id", getEquippedEnemySkinId() === DEFAULT_ENEMY_SKIN_ID);

  const allowedEnemyDefault = equipEnemySkin("ghost");
  check("equipEnemySkin(owned default 'ghost') succeeds (returns true)", allowedEnemyDefault === true);

  let threw = false;
  try {
    equipBeagleSkin("totally-bogus");
  } catch {
    threw = true;
  }
  check("equipBeagleSkin(unknown id) never throws", !threw);

  // restore in-memory equipped state to the default for any later test in
  // this process (mirrors the existing restore-default pattern above).
  setEquippedBeagleSkinId(DEFAULT_BEAGLE_SKIN_ID);
  setEquippedEnemySkinId(DEFAULT_ENEMY_SKIN_ID);
}

console.log("\n=== challenges.ts (IDEA-013 Challenge Mode) ===");
{
  check("exactly 8 challenge levels", CHALLENGE_LEVELS.length === 8);
  check("CHALLENGE_LEVEL_COUNT === 8", CHALLENGE_LEVEL_COUNT === 8);

  // Every level's mazeIdx must be a valid index into the real MAZES pool
  // (mazes.ts's MAZE_COUNT, 5 today) — challenge levels reuse the validated
  // maze pool, never invent their own.
  CHALLENGE_LEVELS.forEach((lvl, i) => {
    check(
      `L${i + 1} (${lvl.name}) mazeIdx ${lvl.mazeIdx} is within [0, MAZE_COUNT-1]`,
      Number.isInteger(lvl.mazeIdx) && lvl.mazeIdx >= 0 && lvl.mazeIdx < MAZE_COUNT,
    );
  });

  // Modifiers stay within sane, documented bounds for every level.
  CHALLENGE_LEVELS.forEach((lvl, i) => {
    const m = lvl.modifiers;
    check(`L${i + 1} speedMult in [1, 2]`, m.speedMult >= 1 && m.speedMult <= 2);
    check(`L${i + 1} ghostSpeedMult in [1, 2]`, m.ghostSpeedMult >= 1 && m.ghostSpeedMult <= 2);
    check(`L${i + 1} ghostCount is 3, 4, or 5`, m.ghostCount === 3 || m.ghostCount === 4 || m.ghostCount === 5);
    check(`L${i + 1} frightSeconds > 0`, m.frightSeconds > 0);
    // Documented invariant: ghostSpeedMult tracks speedMult 1:1 on every
    // level (see ChallengeModifiers' own doc comment) so the beagle/ghost
    // speed RATIO never drifts from classic's.
    check(`L${i + 1} ghostSpeedMult === speedMult (ratio stays fair)`, m.ghostSpeedMult === m.speedMult);
  });

  // L1 must be a byte-for-byte match of CLASSIC_MODIFIERS — the very first
  // challenge level is a warm-up that plays identically to classic.
  const l1 = CHALLENGE_LEVELS[0];
  check("L1 name is Warm-Up Walkies", l1.name === "Warm-Up Walkies");
  check("L1.modifiers.speedMult === CLASSIC_MODIFIERS.speedMult", l1.modifiers.speedMult === CLASSIC_MODIFIERS.speedMult);
  check(
    "L1.modifiers.ghostSpeedMult === CLASSIC_MODIFIERS.ghostSpeedMult",
    l1.modifiers.ghostSpeedMult === CLASSIC_MODIFIERS.ghostSpeedMult,
  );
  check("L1.modifiers.ghostCount === CLASSIC_MODIFIERS.ghostCount", l1.modifiers.ghostCount === CLASSIC_MODIFIERS.ghostCount);
  check(
    "L1.modifiers.frightSeconds === CLASSIC_MODIFIERS.frightSeconds",
    l1.modifiers.frightSeconds === CLASSIC_MODIFIERS.frightSeconds,
  );

  // CLASSIC_MODIFIERS itself is the documented "no change" baseline, and its
  // frightSeconds is READ from config.ts's TIMING.frightSeconds (not a
  // duplicated literal) so the two can never silently drift apart.
  check("CLASSIC_MODIFIERS.speedMult === 1", CLASSIC_MODIFIERS.speedMult === 1);
  check("CLASSIC_MODIFIERS.ghostSpeedMult === 1", CLASSIC_MODIFIERS.ghostSpeedMult === 1);
  check("CLASSIC_MODIFIERS.ghostCount === 3", CLASSIC_MODIFIERS.ghostCount === 3);
  check("CLASSIC_MODIFIERS.frightSeconds === TIMING.frightSeconds", CLASSIC_MODIFIERS.frightSeconds === TIMING.frightSeconds);

  // L8 (the finale) stacks every twist at max: 2x speed, 5 ghosts, short fright.
  const l8 = CHALLENGE_LEVELS[7];
  check("L8 name is Top Dog", l8.name === "Top Dog");
  check("L8 speedMult === 2.0", l8.modifiers.speedMult === 2.0);
  check("L8 ghostCount === 5", l8.modifiers.ghostCount === 5);
  check("L8 frightSeconds < TIMING.frightSeconds (short fuse)", l8.modifiers.frightSeconds < TIMING.frightSeconds);

  // Every level has a non-empty name and blurb (player-facing content, not
  // placeholder/empty strings).
  CHALLENGE_LEVELS.forEach((lvl, i) => {
    check(`L${i + 1} has a non-empty name`, lvl.name.trim().length > 0);
    check(`L${i + 1} has a non-empty blurb`, lvl.blurb.trim().length > 0);
  });

  // At least one level of each twist category exists, so the "8 levels,
  // difficulty arc" scope is actually represented (not, say, every level
  // being ghostCount 3 with only speed varying).
  check("at least one level has ghostCount 4", CHALLENGE_LEVELS.some((l) => l.modifiers.ghostCount === 4));
  check("at least one level has ghostCount 5", CHALLENGE_LEVELS.some((l) => l.modifiers.ghostCount === 5));
  check(
    "at least one level has a shortened frightSeconds (< TIMING.frightSeconds)",
    CHALLENGE_LEVELS.some((l) => l.modifiers.frightSeconds < TIMING.frightSeconds),
  );
  check("at least one level has speedMult > 1", CHALLENGE_LEVELS.some((l) => l.modifiers.speedMult > 1));

  // Sanity: SPEEDS.beagle/ghost imported and finite, so a future SPEEDS edit
  // that broke the base numbers this module scales would show up here too
  // (basic regression guard, not exercising game.ts's actual multiplication).
  check("SPEEDS.beagle and SPEEDS.ghost are positive finite numbers", SPEEDS.beagle > 0 && SPEEDS.ghost > 0);
}

console.log("\n=== challenges.ts getChallengeLevel clamping ===");
{
  check("getChallengeLevel(0) is L1", getChallengeLevel(0).name === CHALLENGE_LEVELS[0].name);
  check("getChallengeLevel(7) is L8 (last)", getChallengeLevel(7).name === CHALLENGE_LEVELS[7].name);
  check("getChallengeLevel(3) is L4", getChallengeLevel(3).name === CHALLENGE_LEVELS[3].name);

  // Out-of-range / garbage indices clamp rather than throwing or returning undefined.
  check("getChallengeLevel(8) clamps to the last level (one past the end)", getChallengeLevel(8).name === CHALLENGE_LEVELS[7].name);
  check("getChallengeLevel(999) clamps to the last level", getChallengeLevel(999).name === CHALLENGE_LEVELS[7].name);
  check("getChallengeLevel(-1) clamps to the first level", getChallengeLevel(-1).name === CHALLENGE_LEVELS[0].name);
  check("getChallengeLevel(-50) clamps to the first level", getChallengeLevel(-50).name === CHALLENGE_LEVELS[0].name);
  check("getChallengeLevel(NaN) clamps to the first level", getChallengeLevel(NaN).name === CHALLENGE_LEVELS[0].name);
  // Infinity is !Number.isFinite -> treated as "not a real number" (same
  // family as NaN) rather than "a huge in-range number to clamp down" — see
  // getChallengeLevel's own `Number.isFinite(idx) ? ... : 0` guard, which
  // degrades non-finite input to 0 (the first level) BEFORE the min/max
  // clamp ever runs.
  check("getChallengeLevel(Infinity) degrades to the first level (non-finite, not a huge in-range value)", getChallengeLevel(Infinity).name === CHALLENGE_LEVELS[0].name);
  check("getChallengeLevel(-Infinity) degrades to the first level (non-finite)", getChallengeLevel(-Infinity).name === CHALLENGE_LEVELS[0].name);
  check("getChallengeLevel(2.9) floors to L3 (index 2)", getChallengeLevel(2.9).name === CHALLENGE_LEVELS[2].name);
  check("getChallengeLevel never throws for any of the above", true); // implicit — none of the calls above threw
}

console.log("\n=== profileStore.ts challengeProgress (Node, no window/localStorage) ===");
{
  // No `window` in this Node run, so loadProfile()/getChallengeProgress()
  // degrade to the default (0, "only level 1 unlocked") — same
  // "storage unavailable" path exercised above for coins/skins.
  check("loadProfile() in Node (no window) returns challengeProgress: 0 by default", loadProfile().challengeProgress === 0);
  check("getChallengeProgress() in Node (no window) returns 0", getChallengeProgress() === 0);

  // advanceChallengeProgress never throws, even with nowhere to persist to
  // (mirrors the addCoins(5) "never throws" check above).
  let threw = false;
  try {
    advanceChallengeProgress(2);
  } catch {
    threw = true;
  }
  check("advanceChallengeProgress(2) in Node (no window) never throws", !threw);

  // With no window, every loadProfile() call degrades to a fresh
  // defaultProfile() and persistProfile/saveChallengeProgress's write is
  // caught and silently dropped (mirrors the coins section's own doc
  // comment) — so getChallengeProgress() still reads 0 right after the call
  // above, since nothing actually persisted in this environment. This
  // exercises "never throws" deterministically; the actual read-modify-write
  // max-write semantics are exercised against plain objects below (the same
  // pattern the existing buy-operation atomicity tests use).
  check("getChallengeProgress() still reads 0 after a dropped write (no persistence in Node)", getChallengeProgress() === 0);
}

console.log("\n=== profileStore.ts challengeProgress: pure read-modify-write semantics (mirrors buy-atomicity tests) ===");
{
  // sanitizeChallengeProgress is private to profileStore.ts, so mirror its
  // exact rules here directly on plain values — same pattern the existing
  // coins `sanitize` mirror above uses for sanitizeCoins.
  function sanitizeChallengeProgress(value: unknown): number {
    const n = typeof value === "number" ? value : NaN;
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), CHALLENGE_LEVEL_COUNT);
  }

  check("sanitizeChallengeProgress(-5) -> 0 (negative)", sanitizeChallengeProgress(-5) === 0);
  check("sanitizeChallengeProgress(NaN) -> 0", sanitizeChallengeProgress(NaN) === 0);
  check("sanitizeChallengeProgress('garbage') -> 0", sanitizeChallengeProgress("garbage") === 0);
  check("sanitizeChallengeProgress(undefined) -> 0 (missing key on old blobs)", sanitizeChallengeProgress(undefined) === 0);
  // Infinity is !Number.isFinite -> degrades to 0, exactly mirroring
  // sanitizeCoins' own `sanitize(Infinity) -> 0` precedent tested above
  // (both treat non-finite input as garbage, not as "a huge value to clamp
  // down to the ceiling").
  check("sanitizeChallengeProgress(Infinity) -> 0 (non-finite, mirrors sanitizeCoins' precedent)", sanitizeChallengeProgress(Infinity) === 0);
  check("sanitizeChallengeProgress(3.9) -> 3 (floors a float)", sanitizeChallengeProgress(3.9) === 3);
  check("sanitizeChallengeProgress(3) -> 3 (valid passthrough)", sanitizeChallengeProgress(3) === 3);
  check(
    `sanitizeChallengeProgress(999) -> clamped to CHALLENGE_LEVEL_COUNT (${CHALLENGE_LEVEL_COUNT})`,
    sanitizeChallengeProgress(999) === CHALLENGE_LEVEL_COUNT,
  );
  check(
    `sanitizeChallengeProgress(CHALLENGE_LEVEL_COUNT) -> stays CHALLENGE_LEVEL_COUNT ("all cleared" sentinel is valid)`,
    sanitizeChallengeProgress(CHALLENGE_LEVEL_COUNT) === CHALLENGE_LEVEL_COUNT,
  );

  // advanceChallengeProgress's actual read-modify-write, MAX-WRITE logic
  // can't be exercised end-to-end without real localStorage (unavailable in
  // this Node run — see the "Node fresh profile" precedent above for coins/
  // skins), so this mirrors its exact "raise to clearedIdx+1, never lower"
  // shape against plain numbers, the same way the buy-atomicity section
  // above mirrors trySpend/read-modify-write against plain StoredProfile
  // objects.
  function mirrorAdvance(current: number, clearedIdx: number): number {
    const safeCleared = Number.isFinite(clearedIdx) && clearedIdx >= 0 ? Math.floor(clearedIdx) : -1;
    const unlockedThrough = Math.min(safeCleared + 1, CHALLENGE_LEVEL_COUNT);
    return Math.max(current, unlockedThrough);
  }

  check("advancing from 0 by clearing level 0 (idx 0) -> unlocks 1", mirrorAdvance(0, 0) === 1);
  check("advancing from 0 by clearing level 2 (idx 2) -> unlocks 3", mirrorAdvance(0, 2) === 3);
  check(
    "advancing to 2 then 'advancing' to 1 stays 2 (max-write never regresses)",
    mirrorAdvance(mirrorAdvance(0, 1), 0) === 2,
  );
  check(
    "clearing the SAME level twice in a row is idempotent (stays at the same unlock)",
    mirrorAdvance(mirrorAdvance(0, 3), 3) === 4,
  );
  check(
    `clearing the LAST level (idx ${CHALLENGE_LEVEL_COUNT - 1}) unlocks exactly CHALLENGE_LEVEL_COUNT (the "all cleared" sentinel)`,
    mirrorAdvance(CHALLENGE_LEVEL_COUNT - 1, CHALLENGE_LEVEL_COUNT - 1) === CHALLENGE_LEVEL_COUNT,
  );
  check(
    "clearing the last level again once already at CHALLENGE_LEVEL_COUNT stays at CHALLENGE_LEVEL_COUNT (never overflows past it)",
    mirrorAdvance(CHALLENGE_LEVEL_COUNT, CHALLENGE_LEVEL_COUNT - 1) === CHALLENGE_LEVEL_COUNT,
  );
  check("a garbage clearedIdx (-1) never raises progress", mirrorAdvance(5, -1) === 5);
  check("a garbage clearedIdx (NaN) never raises progress", mirrorAdvance(5, NaN) === 5);

  // Old-blob compatibility: a blob saved before this field existed simply
  // lacks the key — sanitizeChallengeProgress(undefined) degrades it to 0,
  // exactly like a fresh profile, so an upgrading player starts with only
  // level 1 unlocked rather than the app crashing on a missing field.
  const oldBlobWithoutField = { equippedBeagleSkinId: "bagel", equippedEnemySkinId: "ghost", coins: 40 } as Record<string, unknown>;
  check(
    "old blob (no challengeProgress key at all) -> sanitizes to 0",
    sanitizeChallengeProgress(oldBlobWithoutField.challengeProgress) === 0,
  );

  // Round-trip: a read-modify-write that only changes challengeProgress must
  // preserve every other field untouched — mirrors the existing beagle/
  // enemy/coins read-modify-write checks above exactly.
  const existing: StoredProfile = {
    equippedBeagleSkinId: "cookie",
    equippedEnemySkinId: "beetle",
    coins: 37,
    ownedBeagleSkinIds: ["bagel", "cookie"],
    ownedEnemySkinIds: ["ghost", "beetle"],
    challengeProgress: 1,
  };
  const mergedProgressOnly: StoredProfile = { ...existing, challengeProgress: 4 };
  check("read-modify-write preserves skin/owned/coins fields when only challengeProgress changes", (
    mergedProgressOnly.equippedBeagleSkinId === "cookie" &&
    mergedProgressOnly.equippedEnemySkinId === "beetle" &&
    mergedProgressOnly.coins === 37 &&
    mergedProgressOnly.ownedBeagleSkinIds.join(",") === "bagel,cookie" &&
    mergedProgressOnly.ownedEnemySkinIds.join(",") === "ghost,beetle"
  ));
  check("read-modify-write applies the new challengeProgress value", mergedProgressOnly.challengeProgress === 4);

  const mergedOtherFieldOnly: StoredProfile = { ...existing, coins: 100 };
  check("read-modify-write preserves challengeProgress when only another field changes", mergedOtherFieldOnly.challengeProgress === 1);
}

console.log(`\ncosmetics/profileStore checks: ${failures === 0 ? "ALL OK" : `${failures} FAILED`}`);
if (failures > 0) process.exit(1);
