// OWNER: qa-test-engineer (IDEA-064)
//
// The beagle perks, checked headlessly.
//
// Mirrors scripts/test-powerups.ts in shape and for the same reason: perks.ts
// is a pure module whose whole job is to answer four questions the same way
// every time, and a browser is the worst place to find out it answered one of
// them differently. Everything here runs in Node against the REAL registries.
//
// Two things carry most of the weight.
//
//   1. THE CLASSIC-ONLY RULE. Every accessor must return its neutral value for
//      a challenge run. It is asserted for all five coats and all four
//      accessors rather than for the one case somebody was thinking about,
//      because the failure mode is silent: a perk leaking into challenge mode
//      does not throw, it quietly rewrites a leaderboard that forty levels of
//      players set without it.
//
//   2. THE GRANT. The Pac-Beagle's perk is the only one that pays out at the
//      till, so it is tested through the real profileStore purchase path — the
//      Ghost AND the Arcade Night board, from one purchase, and the backfill
//      that hands the board to players who bought the coat before the board was
//      part of the bundle.
import {
  BEAGLE_SKINS,
  DEFAULT_BEAGLE_SKIN_ID,
  TRIBUTE_BEAGLE_SKIN_ID,
  TRIBUTE_ENEMY_SKIN_ID,
} from "../src/game/cosmetics";
import { TRIBUTE_MAZE_THEME_ID } from "../src/game/themes";
import { BEAGLE_PERKS } from "../src/game/config";
import {
  perkIdOf,
  perkStartShields,
  perkExtraLivesPerMap,
  perkCoinMultiplier,
  perkFruitBonusPoints,
} from "../src/game/perks";
import { setProfileCache, clearProfileCache } from "../src/game/profileCache";
import {
  defaultProfile,
  buyBeagleSkin,
  isEnemySkinOwned,
  isMazeThemeOwned,
  initProfileFromCache,
  type StoredProfile,
} from "../src/game/profileStore";

let failures = 0;
function check(label: string, ok: boolean): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== perks.ts: the mapping ===");
{
  check("bagel carries startShield", perkIdOf("bagel") === "startShield");
  check("cookie carries extraLifePerMap", perkIdOf("cookie") === "extraLifePerMap");
  check("muffin carries doubleCoins", perkIdOf("muffin") === "doubleCoins");
  check("pepper carries fruitBonus", perkIdOf("pepper") === "fruitBonus");
  check("pacbeagle carries unlocksTribute", perkIdOf("pacbeagle") === "unlocksTribute");

  // getBeagleSkin degrades an unknown id to the default rather than throwing,
  // and perkIdOf inherits that on purpose: a profile carrying a renamed skin
  // must give the player the default coat's perk, not a crash mid-run.
  check(
    "an unknown skin id falls back to the default coat's perk",
    perkIdOf("was-renamed-in-v9") === perkIdOf(DEFAULT_BEAGLE_SKIN_ID),
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== perks.ts: each perk pays out, and ONLY for its own coat ===");
{
  check("bagel starts with a shield", perkStartShields("bagel", "classic") === BEAGLE_PERKS.startShields);
  check("the shield count is exactly 1 (once per run, not per life)", BEAGLE_PERKS.startShields === 1);
  check("cookie grants a life per map", perkExtraLivesPerMap("cookie", "classic") === BEAGLE_PERKS.extraLivesPerMap);
  check("muffin doubles coins", perkCoinMultiplier("muffin", "classic") === BEAGLE_PERKS.coinMultiplier);
  check("pepper adds to every fruit", perkFruitBonusPoints("pepper", "classic") === BEAGLE_PERKS.fruitBonusPoints);

  // The neutral values, spelled out: 1 for a multiplier and 0 for an addend, so
  // callers can multiply and add unconditionally rather than branching — which
  // is what keeps the perk out of game.ts's arithmetic.
  check("a non-Muffin coat multiplies coins by 1, not 0", perkCoinMultiplier("bagel", "classic") === 1);
  check("a non-Pepper coat adds 0 to fruit", perkFruitBonusPoints("bagel", "classic") === 0);
  check("a non-Cookie coat grants no per-map life", perkExtraLivesPerMap("muffin", "classic") === 0);
  check("a non-Bagel coat starts with no shield", perkStartShields("cookie", "classic") === 0);

  // Exactly one coat pays out on each accessor. A perk accidentally pointed at
  // two coats is the kind of thing that looks fine in the shop and quietly
  // doubles somebody's coins.
  const payers = (fn: (id: string) => number, neutral: number): string =>
    BEAGLE_SKINS.filter((s) => fn(s.id) !== neutral).map((s) => s.id).join(",");
  check("exactly one coat starts shielded", payers((id) => perkStartShields(id, "classic"), 0) === "bagel");
  check("exactly one coat grants per-map lives", payers((id) => perkExtraLivesPerMap(id, "classic"), 0) === "cookie");
  check("exactly one coat multiplies coins", payers((id) => perkCoinMultiplier(id, "classic"), 1) === "muffin");
  check("exactly one coat bonuses fruit", payers((id) => perkFruitBonusPoints(id, "classic"), 0) === "pepper");

  // The tribute coat's perk is paid at the till, so it must compute NOTHING
  // during a run — a Pac-Beagle player is on classic's own numbers.
  check(
    "the tribute coat has no run-time effect at all",
    perkStartShields("pacbeagle", "classic") === 0 &&
      perkExtraLivesPerMap("pacbeagle", "classic") === 0 &&
      perkCoinMultiplier("pacbeagle", "classic") === 1 &&
      perkFruitBonusPoints("pacbeagle", "classic") === 0,
  );
}

// ---------------------------------------------------------------------------
// THE RULE THAT MATTERS MOST. Every challenge score already on the board was
// set without perks, exactly as it was set without power-ups (IDEA-046) — and
// the server enforces the same rule from its own side, so a perk leaking in
// here would not just tilt a leaderboard, it would make honest runs disagree
// with the validator and be REJECTED.
console.log("\n=== perks.ts: perks are CLASSIC ONLY ===");
{
  for (const skin of BEAGLE_SKINS) {
    check(
      `${skin.id}: no perk of any kind reaches a challenge run`,
      perkStartShields(skin.id, "challenge") === 0 &&
        perkExtraLivesPerMap(skin.id, "challenge") === 0 &&
        perkCoinMultiplier(skin.id, "challenge") === 1 &&
        perkFruitBonusPoints(skin.id, "challenge") === 0,
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== the tribute grant: one purchase, three items ===");
{
  const seed = (over: Partial<StoredProfile> = {}): void => {
    clearProfileCache();
    setProfileCache({ ...defaultProfile(), coins: 500, ...over });
  };

  seed();
  check("before buying, the ghost is not owned", isEnemySkinOwned(TRIBUTE_ENEMY_SKIN_ID) === false);
  check("before buying, the arcade board is not owned", isMazeThemeOwned(TRIBUTE_MAZE_THEME_ID) === false);

  const bought = buyBeagleSkin(TRIBUTE_BEAGLE_SKIN_ID);
  check("the tribute coat is bought", bought.ok === true);
  check("buying the coat grants the ghost", isEnemySkinOwned(TRIBUTE_ENEMY_SKIN_ID) === true);
  check("buying the coat grants the arcade board", isMazeThemeOwned(TRIBUTE_MAZE_THEME_ID) === true);

  // THE BACKFILL. A player who bought the Pac-Beagle before the board joined
  // the bundle owns the coat and not the board — and would be shown the board
  // (visibleMazeThemes reveals it on the COAT) with a price on it, for
  // something the coat is advertised as unlocking. initProfileFromCache is
  // what closes that, on the next boot, for free.
  const profile = defaultProfile();
  seed({
    ownedBeagleSkinIds: [...profile.ownedBeagleSkinIds, TRIBUTE_BEAGLE_SKIN_ID],
    ownedEnemySkinIds: [...profile.ownedEnemySkinIds, TRIBUTE_ENEMY_SKIN_ID],
    coins: 0,
  });
  check("a legacy tribute owner starts without the board", isMazeThemeOwned(TRIBUTE_MAZE_THEME_ID) === false);
  initProfileFromCache();
  check(
    "initProfileFromCache backfills the board, with an empty wallet",
    isMazeThemeOwned(TRIBUTE_MAZE_THEME_ID) === true,
  );

  // And the other direction: somebody who does NOT own the coat is not handed
  // either tribute item by the backfill.
  seed({ coins: 0 });
  initProfileFromCache();
  check(
    "a player without the coat is granted neither tribute item",
    isEnemySkinOwned(TRIBUTE_ENEMY_SKIN_ID) === false &&
      isMazeThemeOwned(TRIBUTE_MAZE_THEME_ID) === false,
  );

  clearProfileCache();
}

console.log(`\nperk checks: ${failures === 0 ? "ALL OK" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
