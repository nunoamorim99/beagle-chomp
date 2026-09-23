// OWNER: gameplay-engineer
//
// PURE PRESENTATION HELPERS FOR A JOURNEY LEVEL — what state a stone is in and
// how to say what its twists are.
//
// Lifted out of `levelMap.ts` when [[IDEA-079]] replaced the SVG trail with the
// island map. They were always pure and always had nothing to do with SVG; the
// new screen needs exactly these three and none of the 600 lines of path
// geometry that used to sit around them. Keeping them here rather than copying
// them into the new screen is the point — two presentations of the same ladder
// must not be able to disagree about what counts as a twist.
//
// No DOM, no `three`, no `innerHTML`: this is a formatting module.

import { CLASSIC_MODIFIERS, JOURNEY_LEVEL_COUNT, type JourneyLevel } from "../game/journey";

export type LevelNodeState = "cleared" | "current" | "locked";

/**
 * Resolves a level's state from the persisted progress, mirroring
 * `profileStore.ts`'s `challengeProgress` convention exactly:
 *
 *   idx <  progress  ->  "cleared"  (already beaten; replayable)
 *   idx === progress ->  "current"  (the next one to beat)
 *   idx >  progress  ->  "locked"
 *
 * When `progress === JOURNEY_LEVEL_COUNT` (everything cleared) every valid
 * index is strictly less than it, so "all cleared and replayable" falls out of
 * the first branch with no special case.
 */
export function levelNodeState(idx: number, progress: number): LevelNodeState {
  if (idx < progress) return "cleared";
  if (idx === progress) return "current";
  return "locked";
}

/** The default selection when the map opens: the CURRENT level, or the LAST
 *  one once every level is cleared — at `progress === JOURNEY_LEVEL_COUNT` no
 *  index is ever "current", so without this the screen would open with nothing
 *  selected for the players who have finished it. */
export function defaultSelectedLevel(progress: number): number {
  return progress >= JOURNEY_LEVEL_COUNT ? JOURNEY_LEVEL_COUNT - 1 : progress;
}

/**
 * The non-baseline modifier bullets for a level — `["x1.5 speed", "4 ghosts",
 * "3s fright"]` — omitting any dial sitting at its `CLASSIC_MODIFIERS` value,
 * because a level that does not touch a dial should not clutter the list
 * restating the default.
 *
 * Returns EMPTY for a level that matches classic on every field (L1, and every
 * one of the thirty Grand Tour levels, which are classic by design — see
 * [[IDEA-063]] rule 1), so callers fall back to a plain "classic pace" label.
 *
 * `speedMult` and `ghostSpeedMult` are equal in every shipped entry, so they
 * are reported as ONE bullet rather than two near-duplicates — but both are
 * checked, so a future level that diverges them still gets a truthful summary
 * instead of a silent one.
 */
export function twistParts(level: JourneyLevel): string[] {
  const { speedMult, ghostSpeedMult, ghostCount, frightSeconds } = level.modifiers;
  const parts: string[] = [];

  if (
    speedMult !== CLASSIC_MODIFIERS.speedMult ||
    ghostSpeedMult !== CLASSIC_MODIFIERS.ghostSpeedMult
  ) {
    const mult = speedMult === ghostSpeedMult ? speedMult : Math.max(speedMult, ghostSpeedMult);
    parts.push(`×${trimTrailingZero(mult)} speed`);
  }
  if (ghostCount !== CLASSIC_MODIFIERS.ghostCount) parts.push(`${ghostCount} ghosts`);
  if (frightSeconds !== CLASSIC_MODIFIERS.frightSeconds) {
    parts.push(`${trimTrailingZero(frightSeconds)}s fright`);
  }
  return parts;
}

/** The compact "·"-joined line — "x1.5 speed · 4 ghosts · 3s fright". Empty
 *  for a level with no twists (see {@link twistParts}). */
export function twistSummary(level: JourneyLevel): string {
  return twistParts(level).join(" · ");
}

/** Formats a multiplier without a pointless trailing ".0". */
function trimTrailingZero(n: number): string {
  return String(n);
}
