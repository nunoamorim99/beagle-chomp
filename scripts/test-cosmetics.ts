// Headless unit checks for the IDEA-010 beagle-skin cosmetics foundation:
// src/game/cosmetics.ts (pure data + in-memory equipped state) and
// src/game/profileStore.ts (localStorage bridge). No framework, matching
// validate-maze.ts/sim-logic.ts's style — assert + log, exit 1 on failure.
// Run: tsx scripts/test-cosmetics.ts (wired into `npm run test`).
import {
  BEAGLE_SKINS,
  DEFAULT_BEAGLE_SKIN_ID,
  getBeagleSkin,
  getEquippedBeagleSkinId,
  getEquippedBeagleSkin,
  setEquippedBeagleSkinId,
  cycleBeagleSkinId,
} from "../src/game/cosmetics";
import { COLORS } from "../src/game/config";
import { loadProfile } from "../src/game/profileStore";

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

console.log("\n=== profileStore.ts (Node, no window/localStorage) ===");
// In this plain tsx/Node run there is no `window`, so loadProfile()'s
// try/catch must catch the ReferenceError and degrade to the default —
// exercising the same "storage unavailable" path a browser would hit in
// private-mode/disabled-storage, without needing a DOM shim.
{
  const profile = loadProfile();
  check("loadProfile() in Node (no window) returns the default profile", profile.equippedBeagleSkinId === DEFAULT_BEAGLE_SKIN_ID);
}

console.log(`\ncosmetics/profileStore checks: ${failures === 0 ? "ALL OK" : `${failures} FAILED`}`);
if (failures > 0) process.exit(1);
