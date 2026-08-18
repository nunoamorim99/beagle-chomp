// OWNER: gameplay-engineer (IDEA-040 first-run tutorial)
//
// The coaching brain: decides WHICH tip to show and WHEN, given things that
// happen during a real run. Pure and three-free, so the whole teaching order
// is unit-testable without a browser.
//
// WHY COACHED RATHER THAN SLIDES. A wall of instructions before the first game
// gets skipped, and nothing in it is retained — the player hasn't seen a
// biscuit yet, so "biscuits are 10 points" is noise. Each tip here fires at the
// moment its subject is on screen: the bone tip when a bone is within reach,
// the chain tip the first time a ghost is actually eaten. The game never stops;
// tips are captions over live play.
//
// Deliberately NOT a step-by-step gate. The player can ignore every tip and
// just play — nothing waits for acknowledgement, and nothing blocks input.

/** Things the game reports. Each maps to at most one tip. */
export type CoachEvent =
  | "levelStarted"
  | "firstMove"
  | "biscuitEaten"
  | "nearBone"
  | "boneEaten"
  | "ghostEaten"
  | "fruitSpawned"
  | "goldenBoneSpawned"
  | "scoreProgress";

export interface CoachTip {
  id: string;
  text: string;
  /** Seconds on screen before it fades by itself. */
  seconds: number;
}

export interface CoachState {
  /** Tips already shown, so nothing repeats within a run. */
  readonly seen: Set<string>;
  /** What is on screen right now, with its remaining time. */
  current: { tip: CoachTip; remaining: number } | null;
  /** Waiting to be shown — one at a time, so tips never stack or race. */
  queue: CoachTip[];
  /** Seconds left of the pause between one tip clearing and the next. */
  gap: number;
  finished: boolean;
}

/** A gap after one tip clears before the next appears, so two tips triggered
 *  close together don't read as one run-on sentence. */
const GAP_SECONDS = 0.45;

/**
 * The tips, in the order a player naturally meets them.
 *
 * Text rules learned from the rest of the game's copy: say the thing, not the
 * mechanic's name; use the real numbers; never more than two short lines,
 * because this sits over live play and the player is being chased.
 */
function tipFor(event: CoachEvent, scheme: "swipe" | "dpad"): CoachTip | null {
  switch (event) {
    case "levelStarted":
      return {
        id: "move",
        text:
          scheme === "dpad"
            ? "Use the pad to steer the beagle."
            : "Swipe anywhere to steer the beagle.",
        seconds: 5,
      };
    case "biscuitEaten":
      return {
        id: "biscuits",
        text: "Biscuits are 10 points. Eat every one to clear the map.",
        seconds: 5,
      };
    case "nearBone":
      return {
        id: "bone",
        text: "That big white bone scares the pack — it's the only time you can eat them.",
        seconds: 6,
      };
    case "boneEaten":
      return {
        id: "fright",
        text: "Go get them! Scared enemies are worth 200, then 400, 800, 1600.",
        seconds: 5,
      };
    case "ghostEaten":
      return {
        id: "chain",
        text: "Chain all four in one bone and you earn a life.",
        seconds: 5,
      };
    case "fruitSpawned":
      return {
        id: "fruit",
        text: "Fruit is worth 100 — grab it before it goes.",
        seconds: 5,
      };
    case "goldenBoneSpawned":
      return {
        id: "golden",
        text: "A golden bone is a free life. Don't let it slip away.",
        seconds: 5,
      };
    case "scoreProgress":
      return {
        id: "milestone",
        text: "Every 5,000 points earns another life too.",
        seconds: 5,
      };
    // Consumed to mark the run started; carries no tip of its own.
    case "firstMove":
      return null;
  }
}

/** Every tip the coach can show, so a test can assert full coverage. */
export const ALL_TIP_IDS = [
  "move",
  "biscuits",
  "bone",
  "fright",
  "chain",
  "fruit",
  "golden",
  "milestone",
] as const;

export function createCoach(): CoachState {
  return { seen: new Set<string>(), current: null, queue: [], gap: 0, finished: false };
}

/**
 * Report something that happened. Enqueues a tip the first time each subject
 * comes up, and ignores it forever after.
 *
 * Returns true if a tip was queued — handy for tests and for deciding whether
 * anything is worth rendering.
 */
export function coachEvent(
  state: CoachState,
  event: CoachEvent,
  scheme: "swipe" | "dpad" = "swipe",
): boolean {
  if (state.finished) return false;

  const tip = tipFor(event, scheme);
  if (!tip || state.seen.has(tip.id)) return false;

  // Marked seen at QUEUE time, not display time: a bone eaten twice in quick
  // succession must not queue the same tip twice.
  state.seen.add(tip.id);
  state.queue.push(tip);
  return true;
}

/**
 * Advance the clock. Returns the tip to render right now, or null.
 *
 * Call from the play update, not the frame loop — a tip should not tick down
 * while the game is paused or the shop is open.
 */
export function coachTick(state: CoachState, dt: number): CoachTip | null {
  if (state.current) {
    state.current.remaining -= dt;
    if (state.current.remaining > 0) return state.current.tip;
    // Expired. Start the gap before anything queued behind it appears, so two
    // tips triggered close together don't read as one run-on sentence.
    state.current = null;
    state.gap = GAP_SECONDS;
    return null;
  }

  if (state.gap > 0) {
    state.gap -= dt;
    return null;
  }

  const next = state.queue.shift();
  if (!next) return null;
  state.current = { tip: next, remaining: next.seconds };
  return next;
}

/** Has every lesson been delivered? */
export function coachComplete(state: CoachState): boolean {
  return ALL_TIP_IDS.every((id) => state.seen.has(id)) && state.current === null;
}

/** Stop coaching immediately — the Skip button, or the run ending. */
export function coachStop(state: CoachState): void {
  state.finished = true;
  state.current = null;
  state.queue = [];
  state.gap = 0;
}
