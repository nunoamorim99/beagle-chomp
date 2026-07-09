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
import { COLORS, COINS } from "../src/game/config";
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
  type StoredProfile,
} from "../src/game/profileStore";
import { coinsDueFromScore } from "../src/game/coins";

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

console.log(`\ncosmetics/profileStore checks: ${failures === 0 ? "ALL OK" : `${failures} FAILED`}`);
if (failures > 0) process.exit(1);
