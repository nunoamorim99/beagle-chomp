// OWNER: editor (IDEA-062 v4, dev-only).
// WHICH numbers in src/game/config.ts the Balance tab exposes, grouped and
// ranged. Pure data + a `three`-free import list, so the catalogue can be
// checked by a Node test rather than only by opening the tab.
//
// HAND-WRITTEN ON PURPOSE, and this is the same trap boardCodegen's palette
// writer and propsCodegen's PARAM_FIELD_ORDER already have: a number added to
// config.ts that is not listed here simply does not appear in the editor. That
// is the safe direction to fail — an unlisted number is untouched, not
// silently mangled — but it does mean this list needs a line when a tunable is
// added. scripts/test-config-rewrite.ts resolves EVERY path below against the
// real config.ts, so a field that is renamed or removed fails the build rather
// than rendering a control wired to nothing (IDEA-041's rule).
//
// WHAT IS DELIBERATELY ABSENT:
//  - Anything that is not a number. FRUITS' `id`/`name`, COLORS' hexes,
//    ENEMY_SLOTS — a colour picker here would be a second, competing home for
//    values the Character tab already owns properly.
//  - ADDING or REMOVING an array element. A sixth fruit is not a slider: it
//    changes `FruitId`, `rollFruit`, five pickup builders,
//    `catalog.generated.ts` and the server's plausibility bounds. That is a
//    feature, and it belongs in code.
import type { ConfigPath } from "./configRewrite";

export interface BalanceField {
  path: ConfigPath;
  /** The control's label. Short — the group already gives the context. */
  label: string;
  min: number;
  max: number;
  step: number;
  /** One line under the control. Say what the number DOES, and where a change
   *  bites hardest — these are balance numbers, and the consequence is rarely
   *  visible from the name. */
  hint?: string;
}

export interface BalanceGroup {
  title: string;
  /** Shown once at the top of the folder. Use it for the thing you would want
   *  to know BEFORE dragging anything in here. */
  note?: string;
  fields: BalanceField[];
}

export const BALANCE_GROUPS: readonly BalanceGroup[] = [
  {
    title: "Speeds",
    note: "Tiles per second. The beagle being faster than the ghosts is what makes a chase winnable.",
    fields: [
      { path: ["SPEEDS", "beagle"], label: "beagle", min: 1, max: 12, step: 0.1 },
      { path: ["SPEEDS", "ghost"], label: "ghost", min: 1, max: 12, step: 0.1 },
      {
        path: ["SPEEDS", "frightened"],
        label: "frightened",
        min: 0.5,
        max: 12,
        step: 0.1,
        hint: "Slower than the beagle, or a bone is not a reward.",
      },
      {
        path: ["SPEEDS", "eaten"],
        label: "eaten (eyes home)",
        min: 1,
        max: 20,
        step: 0.1,
        hint: "Fast on purpose — the pause after eating a ghost should be short.",
      },
    ],
  },
  {
    title: "Score",
    note: "Changing these changes the SERVER's plausibility bounds. Sync after saving.",
    fields: [
      { path: ["SCORE", "biscuit"], label: "biscuit", min: 1, max: 100, step: 1 },
      { path: ["SCORE", "bone"], label: "bone", min: 1, max: 500, step: 1 },
      {
        path: ["SCORE", "ghostBase"],
        label: "ghost (base)",
        min: 10,
        max: 2000,
        step: 10,
        hint: "Doubles per ghost eaten inside one fright window.",
      },
    ],
  },
  {
    title: "Timing",
    fields: [
      {
        path: ["TIMING", "frightSeconds"],
        label: "fright",
        min: 1,
        max: 20,
        step: 0.5,
        hint: "How long a bone keeps the ghosts edible.",
      },
      { path: ["TIMING", "readySeconds"], label: "ready", min: 0.2, max: 5, step: 0.1 },
      { path: ["TIMING", "deathSeconds"], label: "death", min: 0.2, max: 5, step: 0.1 },
    ],
  },
  {
    title: "Scatter / chase schedule",
    note: "Seconds, alternating scatter and chase. The last entry is the 1e9 'chase forever' — leave it alone.",
    fields: [
      { path: ["TIMING", "schedule", 0], label: "scatter 1", min: 1, max: 60, step: 1 },
      { path: ["TIMING", "schedule", 1], label: "chase 1", min: 1, max: 60, step: 1 },
      { path: ["TIMING", "schedule", 2], label: "scatter 2", min: 1, max: 60, step: 1 },
      { path: ["TIMING", "schedule", 3], label: "chase 2", min: 1, max: 60, step: 1 },
      { path: ["TIMING", "schedule", 4], label: "scatter 3", min: 1, max: 60, step: 1 },
    ],
  },
  {
    title: "Lives",
    fields: [
      { path: ["START_LIVES"], label: "start", min: 1, max: 5, step: 1 },
      {
        path: ["LIVES", "max"],
        label: "cap",
        min: 1,
        max: 9,
        step: 1,
        hint: "The HUD always draws this many hearts. Past 5 the row stops fitting a 390px phone — see CLAUDE.md's 4px budget.",
      },
      {
        path: ["LIVES", "milestonePoints"],
        label: "points per extra life",
        min: 1000,
        max: 50000,
        step: 500,
        hint: "The one points-milestone left in the game. Coarse on purpose.",
      },
      { path: ["LIVES", "pickupLifespanSeconds"], label: "golden bone lifespan", min: 3, max: 60, step: 1 },
      { path: ["LIFE_THRESHOLDS", 0], label: "bone spawns at (pellets)", min: 1, max: 250, step: 1 },
    ],
  },
  {
    title: "Coins",
    note: "Coins come from the MAZE and only the maze. If earning is too slow, raise the pickup value — do not reinstate a points milestone.",
    fields: [
      { path: ["COINS", "pickupValue"], label: "per pickup", min: 1, max: 20, step: 1 },
      { path: ["COINS", "lifespanSeconds"], label: "lifespan", min: 3, max: 60, step: 1 },
      { path: ["COIN_THRESHOLDS", 0], label: "spawn 1 (pellets)", min: 1, max: 250, step: 1 },
      { path: ["COIN_THRESHOLDS", 1], label: "spawn 2", min: 1, max: 250, step: 1 },
      { path: ["COIN_THRESHOLDS", 2], label: "spawn 3", min: 1, max: 250, step: 1 },
      { path: ["COIN_THRESHOLDS", 3], label: "spawn 4", min: 1, max: 250, step: 1 },
      { path: ["COIN_THRESHOLDS", 4], label: "spawn 5", min: 1, max: 250, step: 1 },
    ],
  },
  {
    title: "Fruit",
    note: "Five fruits on a weighted roll. Change a VALUE and the server's MAX/MIN_FRUIT_POINTS must be re-synced or honest runs fail SCORE_ITEM_MISMATCH.",
    fields: [
      { path: ["FRUITS", 0, "points"], label: "apple", min: 10, max: 2000, step: 10 },
      { path: ["FRUITS", 1, "points"], label: "banana", min: 10, max: 2000, step: 10 },
      { path: ["FRUITS", 2, "points"], label: "carrot", min: 10, max: 2000, step: 10 },
      { path: ["FRUITS", 3, "points"], label: "strawberry", min: 10, max: 2000, step: 10 },
      { path: ["FRUITS", 4, "points"], label: "mango", min: 10, max: 2000, step: 10 },
      {
        path: ["FRUIT_LIFESPAN_SECONDS"],
        label: "lifespan",
        min: 3,
        max: 60,
        step: 1,
        hint: "The most generous of the three timed pickups — fruit lands on the maze's fixed F tiles, not near the beagle.",
      },
      { path: ["FRUIT_THRESHOLDS", 0], label: "spawn 1 (pellets)", min: 1, max: 250, step: 1 },
      { path: ["FRUIT_THRESHOLDS", 1], label: "spawn 2", min: 1, max: 250, step: 1 },
      { path: ["FRUIT_THRESHOLDS", 2], label: "spawn 3", min: 1, max: 250, step: 1 },
      { path: ["FRUIT_THRESHOLDS", 3], label: "spawn 4", min: 1, max: 250, step: 1 },
    ],
  },
  {
    title: "Power-ups",
    note: "Classic mode only — a challenge run reporting a power-up is rejected outright.",
    fields: [
      {
        path: ["POWERUP_MULTIPLIER"],
        label: "doubler multiplier",
        min: 2,
        max: 10,
        step: 1,
        hint: "Feeds the server's score CEILING, which is sized from what a run reports collecting.",
      },
      { path: ["POWERUP_SLOW_MULT"], label: "anchor slow", min: 0.1, max: 1, step: 0.05 },
      { path: ["POWERUP_STAR_SPEED_MULT"], label: "star speed", min: 1, max: 3, step: 0.05 },
      {
        path: ["POWERUP_SHIELD_GRACE_SECONDS"],
        label: "shield grace",
        min: 0.2,
        max: 6,
        step: 0.1,
        hint: "Invulnerability after a shielded hit — a shielded hit is NOT a death.",
      },
      { path: ["POWERUP_LIFESPAN_SECONDS"], label: "lifespan", min: 3, max: 60, step: 1 },
      { path: ["POWERUP_THRESHOLDS", 0], label: "spawn 1 (pellets)", min: 1, max: 250, step: 1 },
      { path: ["POWERUP_THRESHOLDS", 1], label: "spawn 2", min: 1, max: 250, step: 1 },
      { path: ["POWERUP_THRESHOLDS", 2], label: "spawn 3", min: 1, max: 250, step: 1 },
      { path: ["POWERUP_THRESHOLDS", 3], label: "spawn 4", min: 1, max: 250, step: 1 },
    ],
  },
];

/** Every path the tab can write — used by the test to prove each one resolves
 *  against the real config.ts. */
export function allBalancePaths(): ConfigPath[] {
  return BALANCE_GROUPS.flatMap((g) => g.fields.map((f) => f.path));
}
