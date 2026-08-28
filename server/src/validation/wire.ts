// OWNER: backend
//
// Reading a run submission off the wire. PURE — no database, no clock, no
// network — which is the entire reason it lives here next to plausibility.ts
// rather than inside scoreService.ts where it started.
//
// WHY IT MOVED (IDEA-040 v3): the client had been sending nothing for
// `levelIdxSequence` since the field was introduced, AND this parser had never
// read it off the body. Two independent halves of the same gap, and neither was
// catchable: scoreService.ts imports db.ts, which opens a Postgres pool the
// moment it is imported, so no DB-free test could ever construct a body and
// check what came out the other side. The bug was invisible by construction.
//
// The consequence was real. A stage-3 classic run has FOUR enemies, and without
// levelIdxSequence the validator falls back to assuming three for every level —
// so it sizes the score ceiling below what that run can legitimately produce,
// and a good stage-3 game is rejected as LEVEL_SCORE_CAP_EXCEEDED. Exactly the
// "my best-ever run vanished" failure the plausibility tests call the worse of
// the two failure modes.
//
// The rule this file encodes: EVERY field the client sends must be named here,
// or it is silently dropped. Adding a field to RunSubmission means adding it
// here and to the round-trip test in scripts/test-plausibility.ts.
import type { RunSubmission } from "./plausibility.js";

/** NaN for anything that isn't a number, so the validator's own
 *  `isNonNegativeInt` checks reject it as MALFORMED_SUBMISSION rather than this
 *  parser throwing. Judging a submission is the validator's job; this only
 *  shapes it. */
function num(value: unknown): number {
  return typeof value === "number" ? value : NaN;
}

/** An array of numbers, or [] — never undefined. Contents are NOT checked here:
 *  the validator independently verifies every index is in range and that the
 *  claimed levels match what planLevel() says they must be. */
function numArray(value: unknown): number[] {
  return Array.isArray(value) ? (value as number[]) : [];
}

/** An array of strings, or []. Contents unchecked here — the validator refuses
 *  any id that is not in the catalog. */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).map((v) => String(v)) : [];
}

export function readSubmission(body: Record<string, unknown>): RunSubmission {
  return {
    score: num(body.score),
    levelsCleared: num(body.levelsCleared),
    mazeIdxSequence: numArray(body.mazeIdxSequence),
    // IDEA-040 v3. OPTIONAL on the wire, and the distinction matters: an
    // ABSENT sequence means "old client, assume the classic 3 ghosts", while an
    // EMPTY one is what a challenge run legitimately sends (its modifiers are
    // fixed by the challenge level, not derived from a classic level index).
    // Collapsing the two to [] would be harmless today — the validator's guard
    // is `length > 0` — but it would quietly throw away the only signal that
    // says which of those two cases the server is looking at.
    levelIdxSequence:
      body.levelIdxSequence === undefined ? undefined : numArray(body.levelIdxSequence),
    pelletsEaten: num(body.pelletsEaten),
    bonesEaten: num(body.bonesEaten),
    fruitEaten: num(body.fruitEaten),
    // IDEA-045: optional on the wire — undefined when an older client (or a
    // run queued before the update) omits it, which the validator handles by
    // falling back to the wide fruit-value bound.
    fruitPoints: body.fruitPoints === undefined ? undefined : num(body.fruitPoints),
    // IDEA-046: optional on the wire, same backward-compat rule as fruitPoints.
    // An ABSENT list means "no power-ups", which is what every run queued before
    // this shipped truthfully was.
    powerupsCollected:
      body.powerupsCollected === undefined ? undefined : num(body.powerupsCollected),
    powerupIds: body.powerupIds === undefined ? undefined : strArray(body.powerupIds),
    ghostsEaten: num(body.ghostsEaten),
    coinsCollected: num(body.coinsCollected),
    livesLost: num(body.livesLost),
    playSeconds: num(body.playSeconds),
  };
}
