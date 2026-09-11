// OWNER: editor (IDEA-062 v5, dev-only).
// WHICH world-dressing numbers the World tab exposes — the IDEA-060 garden
// machinery that no theme palette can reach.
//
// These live in RENDER modules rather than in config.ts, so each field names
// its file as well as its path. `configRewrite.ts` does the actual writing:
// FENCE_PARAMS and GROUND_DETAIL_PARAMS are plain exported object literals,
// which is exactly the shape it already walks.
//
// WHAT IS DELIBERATELY ABSENT, and it is most of the module list:
//  - **foliage.ts.** `lobedFoliageGeometry` is already options-driven, so live
//    tuning would be free — but all six `gardenProps.ts` call sites override
//    `lobes`/`sharpness`/`detail` explicitly, so a control bound to the module
//    defaults would change NOTHING. That is IDEA-041's rule violated in the
//    most misleading way available. The honest fix is lifting those six into a
//    named `GARDEN_FOLIAGE` table first; until then it stays out.
//  - **wallTexture.ts / floorTexture.ts.** ~1000 lines of hand-authored
//    painters with no parameter surface at all. Inventing one means touching
//    every painter, and that is its own idea.
import type { SavableFile } from "./saveFile";
import type { ConfigPath } from "./configRewrite";

export interface WorldField {
  file: SavableFile;
  path: ConfigPath;
  label: string;
  min: number;
  max: number;
  step: number;
  /** True for a value that must be a whole number. `pickets` is the only one,
   *  and it is a CONSTRAINT rather than a preference — see its hint. */
  integer?: boolean;
  hint?: string;
}

export interface WorldGroup {
  title: string;
  note?: string;
  fields: WorldField[];
}

const FENCE: SavableFile = "src/render/fence.ts";
const GROUND: SavableFile = "src/render/groundDetail.ts";

export const WORLD_GROUPS: readonly WorldGroup[] = [
  {
    title: "Picket fence",
    note:
      "The garden's wall is a flowering shrub behind a picket fence. The fence is GEOMETRY because a gap is the one thing a texture cannot draw.",
    fields: [
      {
        file: FENCE,
        path: ["FENCE_PARAMS", "pickets"],
        label: "pickets per tile",
        min: 2,
        max: 8,
        step: 1,
        integer: true,
        hint:
          "A CONSTRAINT, not a preference: the pitch (1 / pickets) must divide the tile EXACTLY or every tile boundary shows a seam and a straight run reads as a row of separate gates.",
      },
      {
        file: FENCE,
        path: ["FENCE_PARAMS", "picketWidth"],
        label: "picket width",
        min: 0.04,
        max: 0.24,
        step: 0.005,
        hint: "At ~25px a tile the GAP is what has to survive, not the picket. Watch the readout.",
      },
      { file: FENCE, path: ["FENCE_PARAMS", "picketThickness"], label: "picket thickness", min: 0.01, max: 0.15, step: 0.005 },
      {
        file: FENCE,
        path: ["FENCE_PARAMS", "proud"],
        label: "stands proud",
        min: 0,
        max: 0.16,
        step: 0.005,
        hint:
          "How far in front of the hedge. Two panels face each other across a one-tile corridor and the beagle is ~0.6 across, so this eats clearance twice over.",
      },
      { file: FENCE, path: ["FENCE_PARAMS", "railLow"], label: "lower rail height", min: 0, max: 1, step: 0.01 },
      { file: FENCE, path: ["FENCE_PARAMS", "railHigh"], label: "upper rail height", min: 0, max: 1, step: 0.01 },
      { file: FENCE, path: ["FENCE_PARAMS", "railHeight"], label: "rail thickness (Y)", min: 0.01, max: 0.2, step: 0.005 },
      { file: FENCE, path: ["FENCE_PARAMS", "railThickness"], label: "rail depth (Z)", min: 0.01, max: 0.12, step: 0.005 },
      {
        file: FENCE,
        path: ["FENCE_PARAMS", "railShade"],
        label: "rail darkness",
        min: 0.2,
        max: 1,
        step: 0.05,
        hint:
          "1.0 makes the rails the same brown as the pickets — and then a gap shows brown behind brown and the whole fence reads as a SKIRTING BOARD. That was a real bug.",
      },
    ],
  },
  {
    title: "Ground detail (rocks)",
    note:
      "Real rock meshes, not paint. The stepping stones were a floor TEXTURE first and needed three separate concessions to stop fighting the biscuit trail.",
    fields: [
      {
        file: GROUND,
        path: ["GROUND_DETAIL_PARAMS", "chance"],
        label: "corridor density",
        min: 0,
        max: 1,
        step: 0.01,
        hint: "Sparse on purpose — the corridor belongs to the biscuits.",
      },
      { file: GROUND, path: ["GROUND_DETAIL_PARAMS", "apronChance"], label: "apron density", min: 0, max: 1, step: 0.01 },
      {
        file: GROUND,
        path: ["GROUND_DETAIL_PARAMS", "minOffset"],
        label: "min offset from centre",
        min: 0,
        max: 0.5,
        step: 0.01,
        hint:
          "NOTHING sits at a tile CENTRE — biscuits do, and a rock there reads as a pickup that will not go away.",
      },
      { file: GROUND, path: ["GROUND_DETAIL_PARAMS", "maxOffset"], label: "max offset from centre", min: 0, max: 0.5, step: 0.01 },
      {
        file: GROUND,
        path: ["GROUND_DETAIL_PARAMS", "radius"],
        label: "rock radius",
        min: 0.05,
        max: 0.4,
        step: 0.01,
        hint: "Stay under a fifth of a tile tall (radius x flatten) or a corridor starts to look blocked.",
      },
      { file: GROUND, path: ["GROUND_DETAIL_PARAMS", "flatten"], label: "rock flatten", min: 0.1, max: 1, step: 0.02 },
    ],
  },
];

export function allWorldFields(): WorldField[] {
  return WORLD_GROUPS.flatMap((g) => g.fields);
}

/**
 * The two numbers the fence is actually judged on, at the size it is actually
 * seen: a wall face is about 25px at the game camera, so a picket and its gap
 * are single-digit pixel counts. The CARTOON rule's floor is "nothing smaller
 * than a couple of pixels", and this is the only place in the tool where that
 * rule can be checked while you drag rather than after you render.
 */
export function fenceReadability(pickets: number, picketWidth: number, tilePx = 25): {
  picketPx: number;
  gapPx: number;
  ok: boolean;
} {
  const pitch = 1 / pickets;
  const picketPx = picketWidth * tilePx;
  const gapPx = (pitch - picketWidth) * tilePx;
  // The floor is 1.95, not 2.0, and the 0.05 is not a fudge: the SHIPPED fence
  // (4 pickets, 0.17 wide) lands on a gap of exactly 2.0px, so a hard `>= 2`
  // has the reference configuration flip in and out of "too thin" on float
  // noise alone — 0.25 - 0.17 is 0.08000000000000002 on one path and can land
  // a hair under on another. An instrument that cries wolf about the value it
  // is calibrated against teaches you to ignore it.
  return { picketPx, gapPx, ok: gapPx >= 1.95 && picketPx >= 1.95 };
}
