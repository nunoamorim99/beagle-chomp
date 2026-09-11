// OWNER: gameplay-engineer (IDEA-040 tutorial v2)
//
// WHAT the tutorial says, separated from how it looks. Pure — no DOM, no
// three — so every word can be asserted in Node.
//
// This file exists because v1's copy shipped two errors that only a human
// playing the game caught:
//
//   1. "Chain all four in one bone and you earn a life" — wrong. The life is
//      granted when the chain equals the LEVEL's ghost count, which is 3 in
//      stages 1-2, 4 in stage 3 and 1 on a bonus map (game.ts's grantLife
//      check). Naming any number is wrong somewhere, so the copy never does.
//   2. "Swipe anywhere to steer" on a desktop, where there is nothing to
//      swipe. Movement copy depends on the DEVICE, not the account.
//
// IDEA-045 added a third of the same kind: this file said fruit was worth 100,
// full stop, which was true right up until there were five fruits and four of
// them were not. Naming the RANGE and the trade-off (the good ones are rare) is
// the part a new player cannot work out by looking, which is what the tutorial
// is for. The exact ladder is not spelled out on purpose — the score popup over
// the fruit teaches that better than a wall of numbers here.
//
// IDEA-064 added a fourth, and it is the reason for the "coats" slide below:
// the shop stopped selling colours and started selling POWERS, and the tutorial
// went on describing a game where the beagle you pick changes nothing. That is
// the worst kind of stale copy — not wrong about a number, but silent about a
// whole decision the player is now being asked to make.
//
// SO THE COAT LIST IS DERIVED FROM BEAGLE_SKINS, NEVER TYPED OUT HERE. Every
// perk line the tutorial prints is the SAME string the shop card prints,
// because it is the same object: `perk.label` off cosmetics.ts. A sixth coat,
// or a reworded perk, updates this slide by existing. Hand-copying it would be
// ENEMY_ICONS' raw-string bug in a new file — three cards printed their own
// ligature names for three releases because a list was written out twice.
//
// All of it is pinned by scripts/test-tutorial-carousel.ts.

import type { ControlScheme } from "../game/profileStore";
import { BEAGLE_SKINS } from "../game/cosmetics";

/** Which 3D subject the carousel stages behind a slide. Rendered by game.ts
 *  through the existing shopScene, so these are exactly the previews the shop
 *  already knows how to build. */
export type TutorialStage = "beagle" | "enemy" | "maze" | "goldenBone" | "powerup";

/** A flat input diagram, for the one thing 3D cannot show: a gesture. */
export type TutorialDiagram = "keys" | "swipe" | "dpad" | "stick";

/** One coat and what it does, for the coats slide. A flat row rather than a
 *  BeagleSkin so the carousel needs nothing from cosmetics.ts except the paw —
 *  and so a test can read the copy without a shop. */
export interface TutorialPerkRow {
  /** The skin id, so the carousel can draw that coat's own paw swatch. */
  skinId: string;
  name: string;
  /** `BeagleSkin.perk.label`, verbatim. Never a paraphrase — see the note at
   *  the top of this file. */
  label: string;
}

export interface TutorialSlide {
  id: string;
  title: string;
  body: string;
  stage: TutorialStage;
  diagram?: TutorialDiagram;
  /** Present only on the coats slide. A list, because five coats written into
   *  one paragraph is a paragraph nobody finishes — and because the rows are
   *  what the player will scan for again in the shop. */
  perks?: TutorialPerkRow[];
}

export interface DeviceInput {
  /** True for touch devices — from matchMedia("(pointer: coarse)"), a
   *  capability check rather than a user-agent guess. */
  coarsePointer: boolean;
  /** The player's saved preference. Only meaningful on a touch device. */
  scheme: ControlScheme;
}

/** How to steer, in the words that match the device in the player's hands. */
function movement(input: DeviceInput): { body: string; diagram: TutorialDiagram } {
  if (!input.coarsePointer) {
    return {
      body: "Use the arrow keys or W A S D to send the beagle around the maze. It keeps going until you turn it.",
      diagram: "keys",
    };
  }
  if (input.scheme === "dpad") {
    return {
      body: "Tap the pad at the bottom of the screen to send the beagle around the maze. It keeps going until you turn it.",
      diagram: "dpad",
    };
  }
  if (input.scheme === "stick") {
    return {
      body: "Rest your thumb on the stick at the bottom of the screen and push the way you want to go. It keeps going until you turn it — so you can leave your thumb where it is.",
      diagram: "stick",
    };
  }
  return {
    body: "Swipe anywhere on the screen to send the beagle around the maze. It keeps going until you turn it.",
    diagram: "swipe",
  };
}

/** Every coat and the one line the shop prints for it, in shop order.
 *
 *  Derived, not typed out. See the note at the top of this file: the moment
 *  these five lines exist in two places, the pair that drifts is never the pair
 *  you are looking at. */
function perkRows(): TutorialPerkRow[] {
  return BEAGLE_SKINS.map((skin) => ({
    skinId: skin.id,
    name: skin.name,
    label: skin.perk.label,
  }));
}

/**
 * The slides, in teaching order: how to move, what to collect, what to avoid,
 * how to turn that around, what changes the rules, how to last longer, and
 * which dog to take in.
 *
 * The count is deliberate and kept tight. This is a wall between the player and
 * the game they just asked to play, so it has to be finishable in under a
 * minute — IDEA-046 earned its slide by changing what the pickups DO, and
 * IDEA-064 earned the seventh by making the beagle itself a choice with
 * consequences. Both are things a new player cannot work out by looking, which
 * is the only bar a slide clears.
 */
export function buildSlides(input: DeviceInput): TutorialSlide[] {
  const move = movement(input);

  return [
    {
      id: "move",
      title: "Steer the beagle",
      body: move.body,
      stage: "beagle",
      diagram: move.diagram,
    },
    {
      id: "biscuits",
      title: "Clear every biscuit",
      body:
        "Biscuits are 10 points each, and eating all of them finishes the map. " +
        "Fruit turns up now and then, worth anywhere from 100 for an apple to " +
        "500 for a mango — the best ones show up least, and none of them wait " +
        "around, so go when you see one.",
      stage: "maze",
    },
    {
      id: "pack",
      title: "Mind the pack",
      body:
        "They hunt you through the maze, each in their own way. " +
        "Let one touch you and it costs a life.",
      stage: "enemy",
    },
    {
      id: "bones",
      title: "Bones turn the tables",
      body:
        "Eat a big white bone and the whole pack turns scared and edible — " +
        "that is the only time you can eat them. The first is worth 200, " +
        "then 400, 800 and 1600 if you keep going before it wears off.",
      stage: "maze",
    },
    {
      id: "powerups",
      title: "Power-ups change the rules",
      body:
        "Some pickups do not give points — they give you an edge. Doubled points, " +
        "slower enemies, a star that scares them and speeds you up, or a shield that takes " +
        "one hit for you. Watch the corner of the screen to see what you are holding: " +
        "some run on a timer, and the doublers stay with you from map to map until you " +
        "lose a life.",
      stage: "powerup",
    },
    {
      id: "lives",
      title: "Earning more lives",
      body:
        "Three ways: every 10,000 points, eating every enemy within a single bone, " +
        "and the golden bone that appears from time to time. You can hold five at once.",
      stage: "goldenBone",
    },
    {
      // IDEA-064. Last on purpose, and it is the only slide that asks the
      // player to do something AFTER the tutorial rather than during the run.
      // It also has to come last because every line in it leans on a slide
      // above: a shield, a life, a fruit and a coin all have to mean something
      // before "starts every run with a shield" is an offer rather than a
      // sentence.
      //
      // The coins line lives here rather than on the biscuits slide because
      // this is where it becomes actionable — and because coins have ONE source
      // since IDEA-016 v2, which is a rule a player who remembers the old
      // points-to-coins conversion would otherwise get wrong.
      id: "coats",
      title: "Every beagle has a power",
      body:
        "The shop sells dogs, not paint jobs — the one you take in changes how the run plays. " +
        "Coins buy them, and coins come from the maze and nowhere else — grab them before they " +
        "vanish. Powers work in classic runs; challenge levels are played straight.",
      stage: "beagle",
      perks: perkRows(),
    },
  ];
}
