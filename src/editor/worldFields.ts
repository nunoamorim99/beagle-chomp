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
const SURROUND: SavableFile = "src/render/surround.ts";
const ARCH: SavableFile = "src/render/archway.ts";
const HEDGE: SavableFile = "src/render/hedgeWall.ts";

export const WORLD_GROUPS: readonly WorldGroup[] = [
  {
    title: "The surround",
    note:
      "Everything beyond the verge. The ground is NOT optional -- the no-sky-gap guarantee is unconditional, so a theme that wants the old void sets its surroundGround to its own bg. The extent numbers were MEASURED (scripts/_scratch-surround-coverage.ts sweeps eight aspects); do not trim them to the minimum, because a visible world edge is catastrophic and the margin costs one quad.",
    fields: [
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "halfWidth"],
        label: "ground half-width",
        min: 44,
        max: 80,
        step: 1,
        integer: true,
        hint:
          "The widest frame this game can be played at reaches |x| = 42.7 (ultrawide). Below ~44 the world's edge enters shot.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "zFar"],
        label: "ground far edge (z)",
        min: -80,
        max: -44,
        step: 1,
        integer: true,
        hint:
          "A tall phone sees to z = -42.1. Below ~-44 the far edge enters shot.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "zNear"],
        label: "ground near edge (z)",
        min: 26,
        max: 50,
        step: 1,
        integer: true,
        hint:
          "A tall phone sees to z = +24.4 -- the band UNDER the board, which only portrait ever shows.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "plotW"],
        label: "plot width (tiles)",
        min: 4,
        max: 14,
        step: 1,
        integer: true,
        hint:
          "The lattice is what makes this read as OTHER GARDENS rather than as scattered objects.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "plotD"],
        label: "plot depth (tiles)",
        min: 4,
        max: 14,
        step: 1,
        integer: true,
        hint:
          "As above.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "lane"],
        label: "lane between plots",
        min: 0,
        max: 4,
        step: 1,
        integer: true,
        hint:
          "At 0 the whole lattice closes into one field and the neighbourhood read is gone.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "density"],
        label: "plot density",
        min: 0,
        max: 1,
        step: 0.05,
        hint:
          "Fraction of eligible plots built. Checked AFTER the geometric rules, so turning it down thins the same population rather than shifting it.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "houseChance"],
        label: "house chance",
        min: 0,
        max: 1,
        step: 0.05,
        hint:
          "Ignored on the SOUTH band, which is portrait-only, unfogged and sits right under the HUD.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "allotmentChance"],
        label: "allotment chance",
        min: 0,
        max: 1,
        step: 0.05,
        hint:
          "Cumulative AFTER houseChance: a plot with a greenhouse and beds and no house at all. This is the archetype that makes the neighbourhood read as worked rather than as a development.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "southAllotmentChance"],
        label: "south: allotments",
        min: 0,
        max: 1,
        step: 0.01,
        hint:
          "The SOUTH band is portrait-only, unfogged, nearest the camera and right under the HUD and the D-pad -- only ONE plot row is ever visible there, so whatever stands in it is the biggest thing in the picture. It takes ALLOTMENTS and never houses: a greenhouse is 2.08 wide-over-tall against a house's 1.40, so it fills ground without standing up into the frame. Whatever is left over splits between orchards and lawn.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "southFringeBuildings"],
        label: "south: fringe buildings",
        min: 0,
        max: 1,
        step: 0.01,
        hint:
          "THIS is the dial that fills the south band, not the archetype mix. Measured on a phone the visible south window is z 14.5..22.4 while the plot lattice lands at 22.5..24.1 -- exactly ONE plot falls inside it, so the band looked empty because nothing was ever BUILT there. The fringe owns that annulus. Greenhouses and sheds only: the two buildings low enough for the nearest, unfogged band.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "southFringeTrees"],
        label: "south: fringe trees",
        min: 0,
        max: 1,
        step: 0.01,
        hint:
          "Short trees in the nearest band. Everything down here is held down for the same reason: unfogged, nearest the camera, and the largest anything in the surround ever draws -- a tree at the north band's size reads as standing ON the maze rather than behind it.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "orchardChance"],
        label: "orchard chance",
        min: 0,
        max: 1,
        step: 0.05,
        hint:
          "Cumulative after the two above. Trees and lawn, no building. Whatever is left over after all three is a LAWN plot -- keep some, it is what stops the surround reading as wall-to-wall stuff.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "keepClear"],
        label: "keep-clear (tiles)",
        min: 2,
        max: 8,
        step: 1,
        integer: true,
        hint:
          "Measured out from the board floor's edge. MUST cover the apron and every verge ring, or a procedural plot lands on something hand-placed.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "nearScale"],
        label: "near scale",
        min: 0.4,
        max: 2,
        step: 0.05,
        hint:
          "The size ramp's inner end. Scaling WITH distance holds on-screen silhouette roughly constant, so the far band stays readable on fewer, larger objects.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "farScale"],
        label: "far scale",
        min: 0.6,
        max: 3,
        step: 0.05,
        hint:
          "The ramp's outer end.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "rampDistance"],
        label: "ramp distance (tiles)",
        min: 8,
        max: 48,
        step: 1,
        integer: true,
        hint:
          "How far out the ramp takes to reach farScale.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "fringeWidth"],
        label: "fringe width (tiles)",
        min: 0,
        max: 16,
        step: 1,
        integer: true,
        hint:
          "The loose low scatter filling the gap between keep-clear and wherever the plot lattice actually starts. Rule 2 drops a straddling plot whole, and on the south side that left the nearest five units bare.",
      },
      {
        file: SURROUND,
        path: ["SURROUND_PARAMS", "fringeDensity"],
        label: "fringe density",
        min: 0,
        max: 1,
        step: 0.05,
        hint:
          "Fraction of fringe cells carrying something.",
      },
    ],
  },
  {
    title: "Hedge walls",
    note:
      "The maze wall itself. It is ONE InstancedMesh of one shared block -- one draw call for the whole maze -- so every tile is the same lump and the per-tile variety comes from the instance matrix. These apply ONLY to a theme whose wallTexture is a hedge; sand, brick and Arcade Night's flat keep their boxes. What actually reads at 17px a tile is not the bumps, it is that an undulating top falls into two or three bands of the toon ramp where a flat one is a single flat green.",
    fields: [
      {
        file: HEDGE,
        path: ["HEDGE_WALL_PARAMS", "crownDip"],
        label: "crown dip",
        min: 0,
        max: 0.35,
        step: 0.005,
        hint:
          "How deep the wall top may dip below its full height. DOWNWARD only -- blooms, leaf specks and wall-top props sit at fixed clearances above the crown, so an upward bump swallows them. This is the dial that does most of the work, since the top is the face the play camera sees nearly in plan.",
      },
      {
        file: HEDGE,
        path: ["HEDGE_WALL_PARAMS", "crownRoll"],
        label: "crown roll (vs per-tile)",
        min: 0,
        max: 1,
        step: 0.01,
        hint:
          "How much of the dip comes from the seam-safe rolling component rather than the per-tile one. At 0 every tile is its own dome and a straight run reads as a row of CUSHIONS; at 1 the crown rolls continuously across tile boundaries but every tile rolls the same way.",
      },
      {
        file: HEDGE,
        path: ["HEDGE_WALL_PARAMS", "heightVary"],
        label: "per-tile height variation",
        min: 0,
        max: 0.25,
        step: 0.005,
        hint:
          "Taken OFF a tile's height, never added. The strongest anti-grid signal available to a single shared block: it reads as separately clipped sections rather than as one extruded ribbon.",
      },
      {
        file: HEDGE,
        path: ["HEDGE_WALL_PARAMS", "bulge"],
        label: "flank bulge",
        min: 0,
        max: 0.2,
        step: 0.005,
        hint:
          "OUTWARD only, or neighbouring tiles open a gap you can see through the wall. A corridor is one tile, so two facing walls at 0.1 leave 0.8 against a beagle 0.6 across.",
      },
      {
        file: HEDGE,
        path: ["HEDGE_WALL_PARAMS", "bulgeCurve"],
        label: "bulge height ramp",
        min: 1,
        max: 3,
        step: 0.05,
        hint:
          "Above 1 keeps the foot tight and throws the growth to the top -- which is both what clears the picket fence at the base and what a clipped hedge looks like. At 1 it is a wedge.",
      },
      {
        file: HEDGE,
        path: ["HEDGE_WALL_PARAMS", "segments"],
        label: "subdivisions",
        min: 1,
        max: 6,
        step: 1,
        integer: true,
        hint:
          "The cost multiplier for the whole maze: 12n^2 triangles a tile, times ~200 tiles. It is also the resolution of the mottling -- at 2 the top is one dome, at 5 it starts reading as noise rather than as growth.",
      },
    ],
  },
  {
    title: "Tunnel arches",
    note:
      "The hedge portals at the board's tunnel mouths -- the one place the beagle crosses from one side to the other, and the same two tiles (row 9, west and east) on all 36 mazes. WHICH arch stands there is the theme's call (MazeTheme.tunnelArch, a prop id); the arch ITSELF is a normal library prop, so its shape lives in the Props tab under Hedge Arch. These four are only about where it stands.",
    fields: [
      {
        file: ARCH,
        path: ["ARCH_PARAMS", "outset"],
        label: "outset past the wall face",
        min: -0.2,
        max: 1.2,
        step: 0.01,
        hint:
          "Distance from the board's outer wall face to the arch's CENTRE. Below half the arch's own depth (0.375 at the shipped tuning) the two overlap and it reads as a portal cut THROUGH the hedge, which is the point; past that a gap opens and it becomes a frame parked next to one.",
      },
      {
        file: ARCH,
        path: ["ARCH_PARAMS", "scale"],
        label: "scale",
        min: 0.4,
        max: 2,
        step: 0.01,
        hint:
          "No camera-safety ceiling behind this one. A tunnel mouth is an EAST/WEST position, and the sightline sweep reports that east and west cannot occlude the maze at any height -- their shadow travels away from the board.",
      },
      {
        file: ARCH,
        path: ["ARCH_PARAMS", "yaw"],
        label: "extra yaw",
        min: -0.4,
        max: 0.4,
        step: 0.01,
        hint: "On top of the axis alignment, and applied symmetrically so the two mouths always agree.",
      },
      {
        file: ARCH,
        path: ["ARCH_PARAMS", "lift"],
        label: "lift off the ground",
        min: -0.3,
        max: 0.3,
        step: 0.005,
        hint: "Negative sinks the feet -- the honest fix if a retuned crest leaves the arch on tiptoe.",
      },
    ],
  },
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
