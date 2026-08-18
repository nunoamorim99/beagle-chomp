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
// Both are pinned by scripts/test-tutorial-carousel.ts.

import type { ControlScheme } from "../game/profileStore";

/** Which 3D subject the carousel stages behind a slide. Rendered by game.ts
 *  through the existing shopScene, so these are exactly the previews the shop
 *  already knows how to build. */
export type TutorialStage = "beagle" | "enemy" | "maze" | "goldenBone";

/** A flat input diagram, for the one thing 3D cannot show: a gesture. */
export type TutorialDiagram = "keys" | "swipe" | "dpad";

export interface TutorialSlide {
  id: string;
  title: string;
  body: string;
  stage: TutorialStage;
  diagram?: TutorialDiagram;
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
  return {
    body: "Swipe anywhere on the screen to send the beagle around the maze. It keeps going until you turn it.",
    diagram: "swipe",
  };
}

/**
 * The five slides, in teaching order: how to move, what to collect, what to
 * avoid, how to turn that around, and how to last longer.
 *
 * Five is deliberate. This is a wall between the player and the game they just
 * asked to play, so it has to be finishable in under a minute.
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
        "Fruit turns up now and then — grab it quickly for 100.",
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
      id: "lives",
      title: "Earning more lives",
      body:
        "Three ways: every 5,000 points, eating every enemy within a single bone, " +
        "and the golden bone that appears from time to time. You can hold five at once.",
      stage: "goldenBone",
    },
  ];
}
