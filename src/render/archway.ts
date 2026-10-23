// OWNER: render-artist
// IDEA-067: THE TUNNEL ARCH — the hedge portal that marks where the beagle
// crosses from one side of the board to the other.
//
// Nuno, after IDEA-066 landed: "one thing that I feel that is missing is
// something on the sides that connect the beagle to go to one side to the
// other, is like a arch fence."
//
// That sentence names exactly one thing in this game. Measured across all 36
// shipped mazes there is ONE crossing and it is identical on every board:
// row 9, west and east, the only two tiles in the whole 19x21 border that are
// not wall. Every other apparent gap in the border is void, not floor. So the
// beagle walks off the left edge at (0, 9) and reappears at (18, 9), and until
// now nothing whatsoever marked either end — the dog simply stopped existing
// at the board's edge. The arch is the sign that says "this is a door".
//
// Built from `.img2threejs/reference/boardwalls/archhedgerow.png` (a clipped
// yew wall with an arched portal cut through it). The reference is a stock
// photograph and is SHAPE EVIDENCE ONLY, per the rule every subject since
// IDEA-053 has followed: no pixel of it is used as colour or PBR evidence. The
// measured proportions, the five ranked identity features, what the single
// view cannot show, and every shipped deviation with its reason live in
// `.img2threejs/garden-arch/measurements.json`. PROPORTION BASE: **HW = the
// height of the hedge WALL the portal is cut through**, for the crab's
// carapace-width reason a sixth time — the opening is the subject but it is
// not the object, and basing on it would make the crown band a ratio of a
// hole, which every number under it would then inherit.
//
// FIVE THINGS ARE LOAD-BEARING.
//
//  1. AT THIS CAMERA AN ARCH READS IN PLAN, NOT IN ELEVATION — so the opening
//     has to be open to the SKY, not to the far side. This is the whole shape
//     of the model and it cost a complete build to learn; the reasoning, the
//     arithmetic and what the failed version actually looked like are in
//     `makeArchway`'s own doc comment below, under RULE 6. Read that first.
//
//  2. THE PLAY CAMERA PITCHES 59 DEGREES DOWN, SO THE REFERENCE'S PROPORTIONS
//     DO NOT SURVIVE IT. A vertical opening projects at cos(59) = 0.515 of its
//     height while its width projects whole, so the reference's 2.48:1 portal
//     arrives on screen at 1.28:1 — very nearly square. The opening therefore
//     ships far wider than measured (0.500 HW against 0.338 — a full maze
//     tile, so it frames the tunnel corridor exactly) and the rise far higher
//     (1.30 against 0.70), because once the piers are low enough for the
//     corridor to show between them the BAND is the only part of the arch
//     above the hedge line, and a shallow band up there is a twig.
//     IDEA-065's log cabin learned the same lesson from the same angle.
//
//  3. IT INVERTS THE REFERENCE'S HEIGHT RELATIONSHIP ON PURPOSE. There the
//     portal's crown sits BELOW the wall top, because the wall is the
//     monument. Here the maze hedge is the wall and it is one unit tall, so an
//     arch that respected it would be shorter than the thing it exists to
//     mark. The arch is the landmark instead: HW = 2.05, so the crown clears
//     the hedge by a full unit and the tunnel mouth is findable from the far
//     side of the board.
//
//  4. THE DARK INSIDE IS CUT FROM THE GEOMETRY THAT IS ALREADY THERE. The
//     piers take it from `BoxGeometry`'s own six per-face material groups —
//     the face looking into the opening is simply group 0 or 1 — and the band
//     takes it from `splitSoffit`, which re-buckets the extrusion's triangles
//     by whether each one lies inside the opening's own superellipse. Neither
//     adds a mesh, so neither can z-fight, and both are classified by POSITION
//     rather than by NORMAL — at the crown the soffit points straight down and
//     at the springing it points straight sideways, so there is no normal test
//     that catches both. Same trap as IDEA-055's abdomen bands.
//
//  5. IT IS A PROP AND A FIXTURE AT THE SAME TIME, DELIBERATELY. `makeArchway`
//     is reachable two ways: as the `archway` PropBaseShape, so it can be
//     authored in the Props tab and hand-placed on the apron or the verge like
//     anything else; and through `buildTunnelArches`, which reads the GRID and
//     stands one at every border tunnel tile it finds. The second exists
//     because a per-theme hand placement meets a per-maze layout, and this
//     project has already shipped that defect: `theme.wallDecor` hung Night
//     City's lamps in mid-air over open corridor in 14 of 18 mazes because
//     nobody checked the tile was a wall (IDEA-060 rule 9). A tunnel arch that
//     reads the grid cannot be in the wrong place on any of the 36 boards, and
//     cannot miss one either.
import * as THREE from "three";
import type { PropParams } from "../game/props";
import { COLS, type Grid, ROWS, TILE, worldX, worldZ } from "../game/grid";
import { toon } from "./toon";
import { flaredTrunkProfile, lobedFoliageGeometry } from "./foliage";
import { taperedSweepGeometry, type SweepStation } from "./beagleSculpt";
import { FENCE_H, fencePanelGeometry } from "./fence";
import { hexOf, lit, mix, rgbOf } from "./paint";
import { makeGardenFlowerHead } from "./gardenProps";
import { wallTextureFor } from "./wallTexture";
import { NEON_EDGE_PARAMS } from "./neonEdges";

/** Deterministic per-instance variation from the placement hash — the same
 *  generator gardenProps.ts and forestProps.ts use, so an arch looks the same
 *  on every device and every rebuild. */
function rand(h: number): () => number {
  let a = ((h * 4294967296) | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], h: number): T {
  return list[Math.floor(h * list.length) % list.length];
}

/**
 * `hex` brightened by `k`.
 *
 * THE ARCH'S FOLIAGE IS NOT `palette.wall`, AND THAT IS THE RENDER'S FOURTH
 * VERDICT. The maze hedge bakes its colour into a TEXTURE, and wallTexture.ts's
 * own header says why that texture is much lighter than the value it is built
 * from: "cartoon foliage is mostly LIT leaves ABOVE the mass, which
 * multiplication cannot reach". So the wall a player sees is far brighter than
 * `palette.wall`, and flat foliage painted in `palette.wall` beside it reads as
 * a dark green sausage lying against a bright hedge — which is exactly how the
 * arch band came back. Lifting it is not a fudge, it is matching the surface
 * that is actually on screen rather than the number it was generated from.
 */
/**
 * A green shifted toward NEW GROWTH — yellower, not merely brighter.
 *
 * **BRIGHTENING CANNOT CHANGE A PALETTE ENTRY, AND UNDER THE SHIPPED STYLE
 * THAT IS THE WHOLE POINT OF THE CREST.** `brighten` scales all three
 * channels, which leaves the HUE exactly where it was — and IDEA-079's snap
 * weights hue at 3.0 against lightness at 0.1, so a foliage green and the
 * same green at 1.5x land on the SAME entry, become the same generated matcap
 * texture, and the lighter growth that is this arch's only internal contrast
 * is gone. Measured: 0x2e6337 and its own 1.52x both snap to `leaf`, and so
 * did the hedge arch's crest against its own foliage — a part correctly
 * built, correctly coloured, and invisible, which is IDEA-065 rule 9 ("no two
 * parts of one prop may share a palette entry") in a second place.
 *
 * Rotating the hue toward yellow-green puts it on `grass`, a rung up, and in
 * CLASSIC it still reads as this year's growth catching the sun. One change
 * that is right in both looks.
 */
function youngGrowth(hex: number): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // THREE's hue runs 0..1 with green at 1/3 and yellow at 1/6, so subtracting
  // walks a leaf green toward the `grass`/`lime` end of the palette.
  c.setHSL(Math.max(0, hsl.h - 0.055), Math.min(1, hsl.s * 1.2), Math.min(0.55, hsl.l * 1.7));
  return c.getHex();
}

function brighten(hex: number, k: number): number {
  // THROUGH paint.ts's CLAMPED PACKER. Doing the shift by hand here is what
  // turned this arch magenta: `lit()` does not clamp, so a foliage green of
  // 216 times 1.34 packed as 289 and wrapped round to 33, carrying into red.
  return hexOf(lit(rgbOf(hex), k));
}

/** A named mesh, so IDEA-033's part editor and the outliner have something to
 *  address. Stable child order matters: prop part edits are saved by
 *  depth-first INDEX PATH, so re-ordering these `add` calls silently repoints
 *  every edit already saved against this def. */
function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  parent.add(m);
  return m;
}

// --- the defaults, as ratios of HW ------------------------------------------
// Every one of these is `shippedRatios` in the measurement spec. They live
// here rather than inline so the Props tab's seed defaults and this factory
// cannot drift: propsInspector.ts seeds from a hand-written table, and a
// mismatch means turning a control ON visibly changes the prop — which is
// exactly the surprise IDEA-060's sunflower-repainted-as-a-daisy defect was.
export const ARCH_DEFAULTS = {
  /** World height of the portal, crown to ground, at height = 1. Twice the
   *  maze hedge and a little, per rule 3. */
  baseHeight: 2.4,
  /** Opening width / HW. 0.458 puts it at 1.10 world units — just over ONE
   *  MAZE TILE, so the arch frames the tunnel corridor with a little to
   *  spare. Deliberately far from the reference's 0.338; see rule 2 and rule
   *  6, which together are the whole reason this number moved. */
  opening: 0.458,
  /** Arch rise / opening half-width. Above 1 is past a semicircle. */
  rise: 1.29,
  /** Superellipse exponent of the arch head. 2 is a true ellipse; above 2
   *  flattens the crown and sharpens the shoulders into the reference's
   *  basket handle; below 2 draws it up into a gothic point. */
  curve: 2.1,
  /** Pier width / HW, each side. */
  pier: 0.208,
  /** Pier and band depth / HW. */
  depth: 0.354,
  /** The arch band's thickness / HW — the hedge ABOVE the opening. */
  crown: 0.142,
  /** The band's depth as a fraction of the PIERS' depth. Below 1 so the band
   *  is a ribbon rather than a lid; see rule 6. */
  ribbon: 0.6,
  /** How ragged the clipped pier tops are, 0..1. Identity rank 3 is "a LEVEL
   *  clipped top with a RAGGED edge": dead flat says topiary says garden, and
   *  the fuzz says hedge rather than masonry. At 0 it is a bare block. */
  crest: 0.55,
  /** Flower specks per pier face. */
  blossoms: 8,
} as const;

const HEDGE_GREENS: readonly number[] = [0x3f8f3a, 0x367f33, 0x47993f];
const STONE_DEFAULT = 0x9c9a90;
/** The garden's own picket timber. A default rather than a required param:
 *  an arch dropped into a theme that has no fence still needs a colour, and
 *  this one is `palette.fenceColor`'s shipped value. */
const FENCE_DEFAULT = 0xa9743f;
const BLOSSOM_DEFAULT = 0xf4efe6;
/** The tree arch's bark. The forest's own pine trunk, so the two stand in one
 *  wood rather than in two — and a rung clear of every green above it, which
 *  is the whole of this arch's value ladder (IDEA-065 rule 9). */
const TREE_ARCH_BARK = 0x7a6142;
/** The daisy's gold eye — fixed rather than a param, because it is the one
 *  mark that says "flower" and a theme retinting it has nothing to gain. */
const EYE_DEFAULT = 0xf2b632;

/**
 * The superellipse the arch head is drawn on: half-width `hw`, rise `r`,
 * exponent `n`, sampled from the right springing round to the left.
 *
 * ONE curve produces the band's inner edge, its outer edge and the soffit
 * classifier below — the pizza's `sectorOutline` reasoning in a new place:
 * anything derived from the same curve cannot disagree with it about where
 * the opening is.
 */
function archCurvePoints(
  hw: number,
  r: number,
  n: number,
  y0: number,
  segments: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const t = 1 - (i / segments) * 2; // +1 -> -1
    const a = Math.abs(t);
    out.push([t * hw, y0 + r * Math.pow(Math.max(0, 1 - Math.pow(a, n)), 1 / n)]);
  }
  return out;
}

/**
 * The hedge archway: two clipped piers with an arched band springing between
 * them.
 *
 * Centred on its own origin in X and Z, standing on y = 0, spanning its
 * opening along local X — so a placement's `rotationY` of PI/2 turns it to
 * straddle a corridor that runs east-west, which is what the tunnel needs.
 *
 * RULE 6, AND IT COST A WHOLE BUILD TO LEARN: AT THIS CAMERA AN ARCH READS IN
 * PLAN, NOT IN ELEVATION — so the opening has to be open to the SKY, not to
 * the far side.
 *
 * The first version was the reference literally: a 2.05-unit hedge WALL, 0.75
 * deep, with a portal cut through it, standing across the tunnel mouth. It
 * rendered as a **plain green slab**, and not approximately — the aperture
 * contributed exactly zero pixels. The cause is not subtle once the render
 * shows it: the arch spans the tunnel, the tunnel runs east-west, so the two
 * piers stand NORTH and SOUTH of the corridor — which is to say one directly
 * behind the other along the camera's own horizontal direction. The near pier
 * eclipsed the entire portal. The only thing on screen that hinted at an
 * opening at all was the grey threshold slab poking out at the corridor.
 *
 * The arithmetic afterwards agrees and is worth keeping, because it says what
 * the shape has to be rather than merely that the old one failed. The camera
 * looks down at 59 degrees, so a pier of height h hides everything within
 * h / tan(59) = 0.6h behind it; the corridor is one tile across and the
 * camera's horizontal heading crosses it at 0.86 of that. So the far side of
 * the corridor is visible only while **0.6h < 0.86 x openW**, i.e. while the
 * piers are under about 1.4 units. The reference's full-height jambs are 2.05
 * and could never clear it at any opening width a garden path would have.
 *
 * Hence: LOW CLIPPED PIERS (1.05, a whisker over the maze hedge's 1.0) with
 * the arch springing from their tops as a THIN BAND. Everything follows from
 * that one constraint — the opening widened to a full tile so the corridor is
 * framed exactly, the rise pushed past a semicircle so the band still has a
 * visible curve once it is the only part above the hedge line, and the band
 * given its own shallower depth (`ribbon`) so that from above it crosses the
 * gap rather than lidding it.
 *
 * It is also, as it happens, much closer to what a garden arch over a path
 * actually is. The reference is a portal in a wall; this is an arbour. Same
 * five identity features, carried by a construction this camera can read.
 */
export function makeArchway(p: PropParams, instanceHash: number): THREE.Group {
  if ((p.archKind ?? "hedge") === "trees") return makeTreeArch(p, instanceHash);
  if (p.archKind === "gate") return makeGateArch(p, instanceHash);
  if (p.archKind === "rocks") return makeRockArch(p, instanceHash);
  if (p.archKind === "ship") return makeShipArch(p, instanceHash);
  if (p.archKind === "neon") return makeNeonArch(p, instanceHash);
  if (p.archKind === "warp") return makeWarpArch(p, instanceHash);
  const r = rand(instanceHash);
  const g = new THREE.Group();

  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide;
  const depth = H * (p.archDepth ?? ARCH_DEFAULTS.depth) * wide;
  const bandT = H * (p.archCrown ?? ARCH_DEFAULTS.crown);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const hw = openW / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  // The piers carry whatever the band does not. Floored at 0.35 so a wild
  // `archRise` cannot take the springing underground and turn the arch into a
  // hoop lying on the lawn.
  const pierH = Math.max(0.35, H - rise - bandT);
  const ribbonD = depth * Math.min(1, Math.max(0.15, p.archRibbon ?? ARCH_DEFAULTS.ribbon));

  const greens = p.foliageColors ?? HEDGE_GREENS;
  const hedgeHex = pick(greens, instanceHash);
  // THE FOLIAGE IS LIFTED OFF `palette.wall`, AND THAT IS NOT A FUDGE. The maze
  // hedge bakes its colour into a TEXTURE, and wallTexture.ts's own header says
  // why the texture comes out far lighter than the value it is built from:
  // "cartoon foliage is mostly LIT leaves ABOVE the mass, which multiplication
  // cannot reach". So flat foliage painted in `palette.wall` beside a textured
  // hedge reads as a dark green sausage lying against a bright one — which is
  // exactly how the arch came back. This matches the surface that is actually
  // on screen rather than the number it was generated from.
  const foliageMat = toon({
    color: brighten(hedgeHex, 1.34),
    emissive: 0x0e2a0e,
    emissiveIntensity: 0.2,
  });
  // A value step lighter again, for the crest — this year's growth catching the
  // sun on a mass that is otherwise one tone. It is the only thing left giving
  // the arch internal contrast now that the flat pier faces are gone.
  const crestMat = toon({
    color: youngGrowth(pick(greens, (instanceHash * 7.3) % 1)),
    emissive: 0x16341a,
    emissiveIntensity: 0.18,
  });
  const stoneMat = toon({ color: p.stoneColor ?? STONE_DEFAULT });
  // The daisy EYE. A cream blob on green is a pebble; a cream blob with a
  // gold dot in it is a flower, and that is the entire difference — the maze
  // wall's painted daisies have had one all along, which is why the arch
  // looked like it was growing gravel beside them. One extra material, and
  // mergeBySignature welds every eye on the board into a single draw call.
  const eyeMat = toon({ color: EYE_DEFAULT, emissive: 0x3a2f10, emissiveIntensity: 0.2 });
  const blossomMat = toon({
    color: p.blossomColor ?? BLOSSOM_DEFAULT,
    emissive: 0x3a3630,
    emissiveIntensity: 0.2,
  });

  // --- 0: the hedge ----------------------------------------------------------
  // ONE CONTINUOUS CHAIN OF FOLIAGE, UP ONE LEG, ROUND THE HEAD AND DOWN THE
  // OTHER — and this is the render's fifth verdict, Nuno's own:
  //
  //   "the arch is the idea but the massive blocks we have on the bottom I
  //    don't like it, I prefer if everything was like the hedge arch... make
  //    the arch look more a plant and not a block."
  //
  // The piers were `BoxGeometry` wearing the wall texture. That was defensible
  // on paper — the maze hedge is literally a box wearing that texture, so the
  // arch matched it exactly — and it is wrong here for a reason the maze wall
  // does not have: a MAZE wall is a long run seen end-on at 25px, where a box
  // is all anyone can read anyway, while an arch is a single object the eye
  // goes to, seen against open lawn, with a lobed organic band already growing
  // out of its top. A flat-faced block under a lumpy arch does not read as the
  // bottom of the same plant; it reads as two masonry posts someone rested a
  // hedge on.
  //
  // So there are no piers as separate objects any more. `archPier` now sets
  // how much THICKER the chain is at the feet than at the crown, and the
  // radius eases between the two by height — which is also what a real clipped
  // arch does, because the thing has to hold itself up.
  //
  // `archHedgeTexture` went with them. It was a real dial with a real job and
  // it has no host left: a wall texture is authored to wrap a unit BOX, and an
  // icosphere's UVs are nothing like that. Keeping it would be a control wired
  // to nothing, which IDEA-041's rule rules out more firmly than an absent
  // feature.
  const hedge = new THREE.Group();
  hedge.name = "hedge";
  g.add(hedge);
  {
    // The path: left foot up, over the head, right foot down. Built as ONE
    // polyline so the chain cannot have a joint where the leg meets the arch —
    // which is the whole complaint.
    const legSteps = Math.max(2, Math.round(pierH / 0.16));
    const path: Array<[number, number]> = [];
    for (let i = 0; i <= legSteps; i++) path.push([-hw - bandT / 2, (i / legSteps) * pierH]);
    // archCurvePoints runs right-to-left, so reverse it to continue from the
    // LEFT springing — a chain that jumps to the far side and comes back leaves
    // its blobs in the wrong order and its radius easing inside out.
    const arc = archCurvePoints(hw + bandT / 2, rise, curve, pierH, 40);
    for (let i = arc.length - 1; i >= 0; i--) path.push(arc[i]);
    for (let i = legSteps; i >= 0; i--) path.push([hw + bandT / 2, (i / legSteps) * pierH]);

    // Radius eases by HEIGHT, so both legs thicken identically without the
    // chain having to know which half it is on.
    const crownY = pierH + rise;
    const bandRad = bandT * 0.62;
    // 3.2 rather than the 4.2 the first pass used. `lobedFoliageGeometry`
    // pushes vertices OUT past its nominal radius by `amplitude` and the
    // blobs are scaled 1.15 wider again, so the real reach of a foot blob is
    // about 1.5x its radius — at 4.2 the arch measured 2.69 units across,
    // which is most of three tiles and starts eating the wall either side of
    // the tunnel. scripts/test-archway.ts bounds it; the render does not show
    // it, because the thing it overlaps is more hedge.
    const footRad = bandRad * (1 + (p.archPier ?? ARCH_DEFAULTS.pier) * 3.2);
    const radAt = (y: number): number => {
      const t = Math.min(1, Math.max(0, y / Math.max(0.01, crownY)));
      // Cubic ease so the thickening lives in the bottom third — a linear
      // taper reads as a CONE, which is a different plant.
      return bandRad + (footRad - bandRad) * Math.pow(1 - t, 2.4);
    };
    // Depth eases the same way: full at the feet (a column is round) and down
    // to the ribbon at the crown, so the head crosses the gap rather than
    // lidding it (rule 6 is still doing its job).
    const depthAt = (y: number): number => {
      const t = Math.min(1, Math.max(0, y / Math.max(0.01, crownY)));
      return depth + (ribbonD - depth) * Math.pow(t, 1.6);
    };

    let acc = Infinity; // place one at the very first point
    let prev = path[0];
    let i = 0;
    for (const pt of path) {
      acc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
      prev = pt;
      const rad = radAt(pt[1]);
      // Step by the LOCAL radius: a fixed step leaves the thin crown as beads
      // and the thick feet as one smooth sausage. surroundProps.ts's
      // distantHedgeRun learned the tuning — few, wide, heavily overlapping.
      if (acc < rad * 0.78) continue;
      acc = 0;
      const blob = lobedFoliageGeometry(rad, {
        detail: 0,
        lobes: 6,
        sharpness: 6,
        amplitude: 0.3,
        scale: [1.15, 1.15, Math.max(0.55, depthAt(pt[1]) / (2 * rad))],
        seed: 31 + i,
      });
      // A BLOB SITTING AT y = 0 IS HALF UNDERGROUND, and no render says so —
      // a turntable has no floor and the board's own floor hides it. Measured,
      // the first build of this chain reached 0.45 units below the lawn. The
      // foot blobs are CLAMPED flat instead of lifted, because lifting them
      // leaves the arch standing on tiptoe with daylight under it, and a
      // clipped hedge does meet the ground in a flat line. Baked before the
      // random tilt, which would otherwise swing the flattened face back
      // under. (IDEA-060 rule 6: only vertices say where a prop's floor is.)
      const reach = rad * 1.5;
      if (pt[1] < reach) {
        const a = blob.getAttribute("position") as THREE.BufferAttribute;
        for (let v = 0; v < a.count; v++) {
          if (a.getY(v) < -pt[1]) a.setY(v, -pt[1]);
        }
        a.needsUpdate = true;
        blob.computeVertexNormals();
      }
      const m = part(blob, foliageMat, `hedge${i}`, hedge);
      m.position.set(pt[0], pt[1], 0);
      if (pt[1] >= reach) m.rotation.set((r() - 0.5) * 0.4, r() * Math.PI, (r() - 0.5) * 0.5);
      else m.rotation.y = r() * Math.PI;
      i++;
    }
  }

  // --- 1: the crest ----------------------------------------------------------
  // Identity rank 3's second half, and it now rides the whole OUTER edge
  // rather than sitting on two flat pier tops — there are no flat tops left.
  // It is a lighter green, so it reads as this year's growth catching the sun
  // on a mass that is otherwise one tone.
  const crestAmt = p.archCrest ?? ARCH_DEFAULTS.crest;
  const crest = new THREE.Group();
  crest.name = "crest";
  g.add(crest);
  if (crestAmt > 0.01) {
    const outer = archCurvePoints(hw + bandT, rise + bandT * 0.7, curve, pierH, 18);
    for (let i = 0; i < outer.length; i++) {
      if (i % 2 === 1) continue;
      const rad = (0.055 + r() * 0.05) * crestAmt + 0.02;
      const blob = lobedFoliageGeometry(rad, {
        detail: 0,
        lobes: 5,
        sharpness: 5,
        amplitude: 0.32,
        scale: [1.4, 0.8, 1.3],
        seed: 71 + i,
      });
      const m = part(blob, crestMat, `crest${i}`, crest);
      m.position.set(outer[i][0], outer[i][1], (r() - 0.5) * ribbonD * 0.8);
      m.rotation.y = r() * Math.PI;
    }
  }

  // --- 2: the footing --------------------------------------------------------
  // A PICKET FENCE ROUND EACH FOOT, and Nuno asked for it by name: "on the
  // bottom have a fence like the wall maze."
  //
  // It is the same fence, not a copy — `fencePanelGeometry` is fence.ts's own
  // builder, so the picket silhouette, the pitch and the dark rails behind the
  // gaps all come from `FENCE_PARAMS` and the World tab's dials move the maze's
  // fence and the arch's together. That shared identity is doing real work
  // here: the arch stands at the board's edge, right where the maze wall's own
  // fence ends, and anything else at that junction reads as a different garden.
  //
  // Three panels per foot and not four: the fourth would face INTO the
  // opening, which is the doorway the beagle walks through.
  const footing = new THREE.Group();
  footing.name = "footing";
  g.add(footing);
  if (p.archFence !== false) {
    const footW = bandT * 2 * (1 + (p.archPier ?? ARCH_DEFAULTS.pier) * 3.2) * 0.95;
    const front = fencePanelGeometry(footW / TILE);
    const side = fencePanelGeometry(depth / TILE);
    const fenceMat = toon({ color: p.fenceColor ?? FENCE_DEFAULT, vertexColors: true });
    let i = 0;
    for (const s of [-1, 1] as const) {
      const cx = s * (hw + bandT / 2);
      // Front and back, along the corridor — the two faces the play camera
      // actually sees.
      for (const dz of [-1, 1] as const) {
        const m = part(front.clone(), fenceMat, `footing${i++}`, footing);
        m.position.set(cx, 0, (dz * depth) / 2);
        m.rotation.y = dz > 0 ? 0 : Math.PI;
        m.castShadow = true;
      }
      // And the OUTER flank, away from the opening.
      const m = part(side.clone(), fenceMat, `footing${i++}`, footing);
      m.position.set(cx + (s * footW) / 2, 0, 0);
      m.rotation.y = (s * Math.PI) / 2;
      m.castShadow = true;
    }
    front.dispose();
    side.dispose();
  }

  // --- 3: the threshold ------------------------------------------------------
  // In the reference this is a stone slab across the foot of the opening.
  // Here it is flush rather than knee-high: the beagle crosses this tile, and
  // a step in the doorway would read as something in the way. A GROUP even
  // when empty, so `blossoms` keeps its index whatever this is set to — prop
  // part edits are addressed by depth-first index path, and a part that
  // appears and disappears with a checkbox silently repoints every one of them.
  const sillHost = new THREE.Group();
  sillHost.name = "threshold";
  g.add(sillHost);
  if (p.archThreshold !== false) {
    const sill = part(
      new THREE.BoxGeometry(openW * 0.98, 0.07, depth * 0.94),
      stoneMat,
      "sill",
      sillHost,
    );
    sill.position.y = 0.035;
    sill.castShadow = false;
  }

  // --- 4: the blossoms -------------------------------------------------------
  // THE ARCH IS GREEN, STANDING ON GREEN, BESIDE GREEN — and the render's third
  // verdict was that a correctly-built hedge arch at the board's edge reads as
  // one more bush. Nothing was wrong with it; there was simply no value step
  // anywhere in it.
  //
  // The maze hedge solves the same problem with white daisies (`hedgeFlower`),
  // so the arch borrows them, and MOST OF THEM GO ON THE HEAD rather than down
  // at the feet. That is the whole point: the head is the part that clears the
  // hedge line, so it is the only part with sky-coloured ground behind it and
  // the only part a player can pick out from across the board. Flowering the
  // feet instead decorates the half that is already lost against the wall.
  const blooms = new THREE.Group();
  blooms.name = "blossoms";
  g.add(blooms);
  const bn = Math.max(0, Math.round(p.archBlossoms ?? ARCH_DEFAULTS.blossoms));
  // 0.048..0.066 is the CARTOON floor at this distance, not a taste: the arch
  // stands at the board's own edge where a tile is about 34 px, so a 0.11-unit
  // speck is 3-4 px across. Smaller is grain, not detail.
  const bloomRad = (): number => 0.05 + r() * 0.02;
  /**
   * One blossom, FLATTENED ONTO THE SURFACE it sits on.
   *
   * A round icosahedron is a perfectly good 3px speck at the play camera and
   * a white CRYSTAL at any closer angle — which is what Nuno was looking at.
   * The maze wall solves the same problem by painting a daisy FLAT on the
   * face, so the arch does the geometric equivalent: squash the blob along
   * its outward normal and aim that normal out of the foliage. Same triangle
   * count, same silhouette from above, and from the side it reads as a petal
   * cluster lying on the hedge rather than a pebble stuck to it.
   */
  const OUT = new THREE.Vector3(0, 0, 1);
  function blossomAt(name: string, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const rad = bloomRad();
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    const s = part(new THREE.IcosahedronGeometry(rad, 0), blossomMat, name, blooms);
    s.position.set(x, y, z);
    s.quaternion.setFromUnitVectors(OUT, n);
    s.scale.set(1.15, 1.15, 0.38);
    s.castShadow = false;
    // The eye sits PROUD of the petals, not level with them — flush, it is
    // inside the cream blob and invisible, which is this project's oldest
    // recurring defect (the nori belt, the mouth floor, the birdhouse plate).
    const eye = part(new THREE.IcosahedronGeometry(rad * 0.42, 0), eyeMat, name + "Eye", blooms);
    eye.position.set(x + n.x * rad * 0.34, y + n.y * rad * 0.34, z + n.z * rad * 0.34);
    eye.quaternion.copy(s.quaternion);
    eye.scale.set(1, 1, 0.5);
    eye.castShadow = false;
  }
  const bandPts = archCurvePoints(hw + bandT / 2, rise, curve, pierH, 60);
  const cy = pierH + rise * 0.35;
  for (let i = 0; i < bn * 2; i++) {
    const pt = bandPts[Math.floor(r() * bandPts.length)];
    // Outward from the arch's own centre, which is what "on the surface" means
    // for a curved band. Mixed with a little +-Z so the crown is flowered from
    // above as well as from the side — at 59 degrees the top of the arc is most
    // of what a player sees of it.
    const nx = pt[0];
    const ny = pt[1] - cy;
    const len = Math.hypot(nx, ny) || 1;
    const zs = (r() - 0.5) * 2;
    blossomAt(
      `bloomBand${i}`,
      pt[0] + (nx / len) * bandT * 0.42,
      pt[1] + (ny / len) * bandT * 0.42,
      zs * ribbonD * 0.42,
      nx / len,
      ny / len,
      zs * 1.1,
    );
  }
  for (let i = 0; i < bn; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const front = i % 2 === 0 ? 1 : -1;
    blossomAt(
      `bloomLeg${i}`,
      side * (hw + bandT * (0.3 + r() * 0.8)),
      FENCE_H + 0.06 + r() * Math.max(0.1, pierH - FENCE_H - 0.2),
      front * (depth / 2 - 0.03),
      side * 0.35,
      0,
      front,
    );
  }

  return g;
}

/**
 * Does this arch have a FRONT? A gate swung open has an outside and an inside;
 * every other kind is symmetric front-to-back and does not care which way it
 * is turned. `buildTunnelArches` reads this to turn a directed arch's open
 * side AWAY from the board at both tunnel mouths.
 */
export function archIsDirected(p: PropParams): boolean {
  return p.archKind === "gate";
}

/** The gate arch's flowers, in order round the band. Three kinds, three
 *  colours: the daisy's white, the rose's red, and the tulip YELLOW (the
 *  park's own bloom yellow). Rose and tulip are both red by default, and at
 *  this size their shapes alone would not separate them. */
const GATE_FLOWERS: ReadonlyArray<Pick<PropParams, "flowerKind" | "petalColor">> = [
  { flowerKind: "daisy" },
  { flowerKind: "rose" },
  { flowerKind: "tulip", petalColor: 0xf2d43a },
];

/**
 * THE GATE ARCH, the City Park's tunnel mouth (IDEA-081).
 *
 * Nuno: *"for this board I was thinking to put like a gate and above the gate
 * a arch of shrubs the same color as the maze wall and with some flowers like
 * the ones we made on the props, the daisy, roses and tulips per example, the
 * gate should be open."*
 *
 * It IS the hedge arch (the same one continuous chain of foliage, so rule 6
 * holds by construction and every shared dial means what it means there) with
 * two things added AFTER it, so a part edit saved against the hedge's own
 * children keeps its index:
 *
 *  - THE GATE, SWUNG OPEN, ON THE OUTSIDE FACE. Two painted posts at the
 *    portal's outward face and a picket leaf hung on each, opened a quarter
 *    turn so the leaves lie along the edges of the path beyond rather than
 *    across it. Hung INSIDE the portal they would come out of the hedge chain
 *    for most of their length (the chain is ~0.7 deep and a leaf ~0.55 long),
 *    leaving a stub; on the outer face they stand clear in the open. The
 *    leaves sit outboard of the corridor, so the beagle runs between them,
 *    and they are lower than a wall so the hedge is still the arch.
 *  - THE FLOWERS ARE THE PROPS LIBRARY'S OWN HEADS (`makeGardenFlowerHead`),
 *    not a new blossom: the same daisy, rose and tulip the Props tab authors,
 *    so retuning one there retunes it here. Each is aimed out of the arch
 *    along its own normal, which is what makes a head read as growing on the
 *    hedge rather than stuck to it.
 *
 * The gate is FRONTED, so `archIsDirected` says so and the tunnel builder
 * turns it to open toward the outside at both mouths.
 */
function makeGateArch(p: PropParams, instanceHash: number): THREE.Group {
  // The hedge arch, with its own footing and specks switched off: a picket
  // fence round each foot beside a picket GATE is two fences, and the daisy
  // specks are replaced by real flower heads below.
  const g = makeArchway({ ...p, archKind: "hedge", archFence: false, archBlossoms: 0 }, instanceHash);
  const r = rand((instanceHash * 0.731 + 0.17) % 1);

  // THE SHRUB IS THE MAZE WALL'S OWN SURFACE (Nuno: "the same color as the
  // maze wall"). The hedge arch paints flat foliage at 1.34x its colour, which
  // is tuned for the garden's darker wall; on the park's lighter one every
  // authored green snapped to `grass` and drew as a bright lime matcap beside a
  // mid-green textured hedge. No colour fixes that, because the wall is not a
  // colour: it is `wallTexture.ts`'s hedge canvas on a toon material, and the
  // style skips anything with a map. So the chain wears that same canvas, from
  // the same cache, and is drawn by the same shading as the wall it adjoins.
  // `foliageColors[0]` is the wall colour; the tunnel builder hands the theme's
  // own (lifted) value in, so the texture is the board's exact cache entry.
  const wallHex = (p.foliageColors ?? HEDGE_GREENS)[0];
  // Headless (the Node test suites) there is no canvas to paint it on, so the
  // chain keeps the hedge arch's flat foliage; every shape is identical.
  const wallMap = typeof document === "undefined" ? null : wallTextureFor("hedge", wallHex);
  if (wallMap) {
    const hedgeMat = toon({ color: 0xffffff, map: wallMap, emissive: 0x143a12, emissiveIntensity: 0.2 });
    g.getObjectByName("hedge")?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      (m.material as THREE.Material).dispose();
      m.material = hedgeMat;
    });
  }

  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide;
  const depth = H * (p.archDepth ?? ARCH_DEFAULTS.depth) * wide;
  const bandT = H * (p.archCrown ?? ARCH_DEFAULTS.crown);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const hw = openW / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const pierH = Math.max(0.35, H - rise - bandT);

  // --- 5: the gate -----------------------------------------------------------
  const gate = new THREE.Group();
  gate.name = "gate";
  g.add(gate);
  // Painted timber. `fenceColor` because it IS a fence's job, and because the
  // tunnel builder already lifts that param for the high-key style.
  const paintMat = toon({ color: p.fenceColor ?? 0xf2eee4 });
  const postW = 0.13;
  const postH = Math.min(pierH * 0.82, 1.0);
  const faceZ = depth / 2;
  const postX = hw - postW / 2;
  const leafL = hw - postW; // each leaf closes half the opening
  const leafH = postH * 0.72;
  for (const s of [-1, 1] as const) {
    const post = part(new THREE.BoxGeometry(postW, postH, postW), paintMat, s < 0 ? "postL" : "postR", gate);
    post.position.set(s * postX, postH / 2, faceZ);
    const cap = part(new THREE.SphereGeometry(postW * 0.62, 8, 6), paintMat, s < 0 ? "capL" : "capR", gate);
    cap.position.set(s * postX, postH + postW * 0.45, faceZ);

    // The leaf, built OPEN: hung on the post's inner corner and laid along +Z,
    // splayed a little further outward than square so it reads as swung open
    // rather than as a fence panel that happens to be there.
    const leaf = new THREE.Group();
    leaf.name = s < 0 ? "leafL" : "leafR";
    leaf.position.set(s * (postX - postW / 2), 0, faceZ + postW / 2);
    leaf.rotation.y = s * 0.18;
    gate.add(leaf);
    const rails: Array<[string, number]> = [
      ["railLow", 0.16],
      ["railHigh", leafH * 0.78],
    ];
    for (const [name, y] of rails) {
      const rail = part(new THREE.BoxGeometry(0.04, 0.07, leafL), paintMat, name, leaf);
      rail.position.set(0, y, leafL / 2);
    }
    const pickets = 5;
    for (let i = 0; i < pickets; i++) {
      const z = ((i + 0.5) / pickets) * leafL;
      const pk = part(new THREE.BoxGeometry(0.035, leafH, 0.07), paintMat, "picket" + i, leaf);
      pk.position.set(0, 0.04 + leafH / 2, z);
      // A pointed top, the one mark that says "picket" rather than "plank".
      const tip = part(new THREE.ConeGeometry(0.05, 0.09, 4), paintMat, "tip" + i, leaf);
      tip.position.set(0, 0.04 + leafH + 0.045, z);
      tip.rotation.y = Math.PI / 4;
      tip.scale.set(0.7, 1, 1);
    }
  }

  // --- 6: the flowers --------------------------------------------------------
  // Mostly on the HEAD, for the hedge arch's reason: it is the part that clears
  // the hedge line and has sky behind it, so it is where a player sees them.
  const flowers = new THREE.Group();
  flowers.name = "flowers";
  g.add(flowers);
  const n = Math.max(0, Math.round(p.archBlossoms ?? 12));
  const ribbonD = depth * Math.min(1, Math.max(0.15, p.archRibbon ?? ARCH_DEFAULTS.ribbon));
  const band = archCurvePoints(hw + bandT / 2, rise, curve, pierH, 48);
  const cy = pierH + rise * 0.35;
  const UP = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    // Even along the band, nudged: a regular spacing is a garland, a random
    // one leaves bald patches, a jittered even one reads as growing.
    const t = (i + 0.5 + (r() - 0.5) * 0.6) / n;
    const pt = band[Math.min(band.length - 1, Math.max(0, Math.round(t * (band.length - 1))))];
    const nx = pt[0];
    const ny = pt[1] - cy;
    const len = Math.hypot(nx, ny) || 1;
    // Alternate the two faces, so both the side a player sees and the crown
    // seen from above carry flowers.
    const zs = (i % 2 === 0 ? 1 : -1) * (0.35 + r() * 0.5);
    const normal = new THREE.Vector3(nx / len, ny / len, zs).normalize();
    const kind = GATE_FLOWERS[i % GATE_FLOWERS.length];
    const head = makeGardenFlowerHead({ ...kind } as PropParams, (instanceHash + i * 0.137) % 1);
    head.name = `flower${i}`;
    // The head is built facing UP; aim that at the arch's outward normal and
    // set it ON the foliage surface rather than inside it.
    head.quaternion.setFromUnitVectors(UP, normal);
    const out = bandT * 0.5;
    head.position.set(pt[0] + normal.x * out, pt[1] + normal.y * out, normal.z * ribbonD * 0.45);
    head.scale.setScalar(0.85 + r() * 0.3);
    flowers.add(head);
  }
  return g;
}

/** The neon gateway's defaults: outer tube, inner tube, bulbs-and-sign, the
 *  steel and the plinths. Night City's own neon (its `bloomColors`) and its
 *  sodium biscuit yellow. */
const NEON_TUBES: readonly number[] = [0xe860a8, 0x5fc8e8];
const NEON_BULB = 0xf4d060;
const NEON_STEEL = 0x2e2a36;
const NEON_PLINTH = 0x6e6a74;

/**
 * An emissive tube material: the colour AND its own glow. The city is a NIGHT
 * theme, so `shouldStyleBoard` leaves its board in toon and the emissive
 * survives — under the matcap style it would not, which is fine: a neon arch
 * on a daylight board would be the wrong prop anyway.
 */
function neonMat(hex: number, glow = 0.9): THREE.MeshToonMaterial {
  return toon({ color: hex, emissive: hex, emissiveIntensity: glow });
}

/** A tube following `pts` (in the arch's local XY plane, at depth `z`). */
function neonTube(pts: Array<[number, number]>, z: number, radius: number): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, y]) => new THREE.Vector3(x, y, z)),
    false,
    "centripetal",
  );
  return new THREE.TubeGeometry(curve, Math.max(24, pts.length * 3), radius, 6, false);
}

/**
 * The gateway's outline as one polyline: up one post, round the head, down
 * the other — the same `archCurvePoints` superellipse every other kind draws,
 * so `archRise`/`archCurve` mean exactly what they do on the hedge arch. The
 * legs carry intermediate points so the Catmull-Rom does not bow them.
 */
function neonOutline(hw: number, rise: number, curve: number, springY: number, footY: number): Array<[number, number]> {
  const legN = 5;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < legN; i++) out.push([hw, footY + ((springY - footY) * i) / legN]);
  out.push(...archCurvePoints(hw, rise, curve, springY, 28));
  for (let i = legN - 1; i >= 0; i--) out.push([-hw, footY + ((springY - footY) * i) / legN]);
  return out;
}

/**
 * THE NEON GATEWAY — Night City's tunnel mouth (IDEA-083).
 *
 * Nuno, choosing it from four: *"lets make the neon gateway."* Two slim steel
 * posts, an outline of neon tube — pink outside, cyan inside — running up one
 * post, round the head and down the other, a row of marquee bulbs along the
 * steel, and a neon BONE on the crown: the one sign in Night City that says
 * whose city it is.
 *
 * RULE 6 HOLDS BY BEING THIN, NOT BY BEING LOW. Every other kind keeps its
 * piers under ~1.4 units because a solid pier hides 0.6 of its own height
 * behind it from the 59-degree camera. A 0.12 post hides a strip 0.12 wide,
 * whatever its height, so the gateway can stand tall enough to be the
 * landmark at the tunnel mouth and still leave the corridor in view. There is
 * no lid anywhere: everything above the springing is tube.
 *
 * IT IS READ BY ITS GLOW. At the play camera the arch's own plane is seen
 * nearly edge-on, so its curve collapses into a short stroke; what carries it
 * is that the stroke is the brightest, most saturated thing at that edge of
 * the board. Two tubes of two hues — which a single neon line is not — are
 * what make it read as a SIGN rather than as a lit pipe.
 *
 * FOUR DIALS ARE REINTERPRETED and are listed so nobody hunts for them:
 * `archPier` is the post's width, `archCrown` the gap between the two tubes,
 * `archBlossoms` the number of marquee bulbs, and `archCrest` the bone sign's
 * size (0 = no sign). `foliageColors` are the two tubes, `blossomColor` the
 * bulbs and the bone, `trunkColor` the steel, `stoneColor` the plinths.
 * `archDepth`, `archRibbon`, `archFence` and `archThreshold` do nothing here.
 */
function makeNeonArch(p: PropParams, instanceHash: number): THREE.Group {
  const g = new THREE.Group();
  const r = rand(instanceHash);
  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide;
  const hw = openW / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const postW = H * (p.archPier ?? 0.05);
  const gap = H * (p.archCrown ?? 0.06);
  const springY = H - rise;
  const tubeR = 0.05;

  const steel = toon({ color: p.trunkColor ?? NEON_STEEL });
  const plinthMat = toon({ color: p.stoneColor ?? NEON_PLINTH });
  const tubes = p.foliageColors?.length ? p.foliageColors : NEON_TUBES;
  const outerMat = neonMat(tubes[0]);
  const innerMat = neonMat(tubes[Math.min(1, tubes.length - 1)]);
  const bulbHex = p.blossomColor ?? NEON_BULB;
  const bulbMat = neonMat(bulbHex, 1.0);

  // --- 1: the steel ----------------------------------------------------------
  // The posts stand OUTSIDE the opening (their inner faces at +-hw), so the
  // opening is the gap the beagle runs through, exactly as on every other kind.
  const frame = new THREE.Group();
  frame.name = "frame";
  g.add(frame);
  const postX = hw + postW / 2;
  const plinthH = 0.14;
  for (const s of [-1, 1] as const) {
    // Widened OUTWARD only: centred on the post, a 2.2x plinth lipped 0.015
    // into the corridor (test-archway's check). Its inner edge is the post's.
    const plinth = part(new THREE.BoxGeometry(postW * 1.9, plinthH, postW * 2.2), plinthMat, s < 0 ? "plinthL" : "plinthR", frame);
    plinth.position.set(s * (postX + postW * 0.45), plinthH / 2, 0);
    const post = part(new THREE.BoxGeometry(postW, springY - plinthH, postW), steel, s < 0 ? "postL" : "postR", frame);
    post.position.set(s * postX, plinthH + (springY - plinthH) / 2, 0);
  }
  // The head: a steel rail on the posts' own centreline, the thing the tubes
  // are fixed to. A rail rather than a band, so there is still nothing up
  // there wide enough to lid the corridor.
  const railPts = archCurvePoints(postX, rise + postW / 2, curve, springY, 32);
  part(neonTube(railPts, 0, postW * 0.42), steel, "rail", frame);

  // --- 2: the neon -----------------------------------------------------------
  // Pink OUTSIDE the steel, cyan INSIDE it, both on the camera-facing and the
  // far face alike (the tube is round, so one tube serves both sides).
  const neon = new THREE.Group();
  neon.name = "neon";
  g.add(neon);
  const outerX = postX + postW / 2 + tubeR + gap * 0.25;
  // The cyan is MOUNTED ON the posts' inner faces, sunk 40% into the steel:
  // stood off them by its own radius, its legs reached |x| 0.47 and cut into
  // the one-tile corridor the beagle runs down (test-archway caught it).
  const innerX = hw - tubeR * 0.6;
  part(
    neonTube(neonOutline(outerX, rise + (outerX - postX) * 1.1, curve, springY, plinthH + 0.08), 0, tubeR),
    outerMat,
    "tubeOuter",
    neon,
  );
  part(
    neonTube(neonOutline(innerX, Math.max(0.1, rise - (postX - innerX) * 1.1), curve, springY, plinthH + 0.08), 0, tubeR),
    innerMat,
    "tubeInner",
    neon,
  );

  // --- 3: the marquee bulbs --------------------------------------------------
  // Proud of the rail on BOTH faces, alternating, so whichever face a camera
  // sees carries half of them. Even along the rail: a marquee is regular.
  const bulbs = new THREE.Group();
  bulbs.name = "bulbs";
  g.add(bulbs);
  const nb = Math.max(0, Math.round(p.archBlossoms ?? 10));
  const bulbGeo = new THREE.SphereGeometry(0.06, 8, 6);
  // Spaced by ARC LENGTH. `archCurvePoints` samples evenly in x, which crowds
  // the points onto the steep shoulders, and a marquee spaced by index came
  // out bunched on one side of the crown.
  const railCurve = new THREE.CatmullRomCurve3(railPts.map(([x, y]) => new THREE.Vector3(x, y, 0)));
  for (let i = 0; i < nb; i++) {
    const t = (i + 0.5) / nb;
    const v = railCurve.getPointAt(t);
    const pt: [number, number] = [v.x, v.y];
    const b = part(bulbGeo, bulbMat, `bulb${i}`, bulbs);
    b.position.set(pt[0], pt[1], (i % 2 === 0 ? 1 : -1) * (postW / 2 + 0.04));
  }

  // --- 4: the bone sign ------------------------------------------------------
  // Glowing yellow, standing on the crown on two short steel stays. In the
  // arch's own plane, so it reads in elevation; at the play camera it is a
  // bright bar along the top of the stroke the arch makes.
  const crest = Math.max(0, p.archCrest ?? 1);
  if (crest > 0.01) {
    const sign = new THREE.Group();
    sign.name = "sign";
    const crownY = springY + rise + postW / 2 + postW * 0.21;
    const lift = 0.16 * crest;
    sign.position.set(0, crownY + lift, 0);
    g.add(sign);
    const L = 0.62 * crest;
    const shaftR = 0.065 * crest;
    const shaft = part(new THREE.CylinderGeometry(shaftR, shaftR, L, 10), bulbMat, "boneShaft", sign);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.y = 0.11 * crest;
    // The four knuckles that make a bar a BONE — the whole of its identity.
    const knobR = 0.085 * crest;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const k = part(new THREE.SphereGeometry(knobR, 10, 8), bulbMat, `boneKnob${sx < 0 ? "L" : "R"}${sy < 0 ? "Lo" : "Hi"}`, sign);
        k.position.set(sx * L / 2, 0.11 * crest + sy * knobR * 0.75, 0);
      }
    }
    for (const sx of [-1, 1]) {
      // From the crown (local y = -lift) up into the shaft (y = 0.11 crest).
      const top = 0.11 * crest;
      const stay = part(new THREE.BoxGeometry(0.04, lift + top, 0.04), steel, sx < 0 ? "stayL" : "stayR", sign);
      stay.position.set(sx * L * 0.22, (top - lift) / 2, 0);
    }
    // A hair of tilt per instance, so it reads as hung rather than machined.
    sign.rotation.z = (r() - 0.5) * 0.06;
  }
  return g;
}

/** The warp gate's defaults: the maze's own wall indigo for the pillars and
 *  Arcade Night's biscuit for the pellet trail. The tube colours come from
 *  neonEdges.ts so the gate and the maze outline are the same light. */
const WARP_PILLAR = 0x2b2b6b;
const WARP_PELLET = 0xe3b778;

/**
 * THE WARP GATE — Arcade Night's tunnel mouth (IDEA-084).
 *
 * Nuno, choosing it from five: *"ok lets go with the 1"* — the maze's own neon
 * outline lifting off the floor to frame the portal. Two pillars cut from the
 * wall block (the same indigo, the same height, outlined in the same pale
 * tube the maze edges carry), a glowing blue arc springing from pillar top to
 * pillar top, and a trail of biscuits strung along the arc with a big one at
 * the crown — the tribute board's own pellets, running over the gate.
 *
 * IT IS NOT THE NIGHT CITY GATEWAY RECOLOURED. That one is a SIGN — steel
 * posts, two hues, marquee bulbs, a bone. This one is the MAZE: the pillars
 * are wall blocks, so where the gate stands at the board's edge it reads as
 * the outline stepping up out of the wall line, one light with the strips.
 *
 * RULE 6 HOLDS BY BEING LOW. The pillars are WALL_H tall, exactly the hedge
 * line, and everything above them is tube — no lid anywhere, so from the
 * 59-degree camera the arc is a bright stroke across the tunnel mouth and the
 * corridor stays in view under it.
 *
 * THE LIGHT IS UNLIT. The tube core and the pillar edges are MeshBasic in the
 * maze outline's pale core colour, and the arc carries an additive halo tube
 * — this project has no bloom pass, and the outline (neonEdges.ts) makes its
 * glow the same way. Arcade Night is a night board, so the style never
 * reaches it; `madboxSkip` keeps that true in a showcase that restyles all.
 *
 * DIALS: `archPier` is the pillar's width, `archDepth` its depth,
 * `archBlossoms` the number of biscuits on the arc, `archCrest` the size of
 * the crown biscuit (0 = none). `foliageColors[0]` is the glow, `[1]` the
 * tube core, `blossomColor` the biscuits, `trunkColor` the pillars.
 * `archCrown`, `archRibbon`, `archFence` and `archThreshold` do nothing here.
 */
function makeWarpArch(p: PropParams, instanceHash: number): THREE.Group {
  const g = new THREE.Group();
  g.userData.madboxSkip = true;
  const r = rand(instanceHash);
  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const hw = (H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide) / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const springY = H - rise;
  const pw = H * (p.archPier ?? 0.2);
  const pd = H * (p.archDepth ?? 0.2);

  const glowHex = p.foliageColors?.[0] ?? NEON_EDGE_PARAMS.glow;
  const coreHex = p.foliageColors?.[1] ?? NEON_EDGE_PARAMS.core;
  const pillarHex = p.trunkColor ?? WARP_PILLAR;
  // The maze wall's own emissive lift (themes.ts: 0x14143a at 0.72), so a
  // pillar and the wall block beside it are the same value in the dark.
  const pillarMat = toon({ color: pillarHex, emissive: pillarHex, emissiveIntensity: 0.33 });
  const coreMat = new THREE.MeshBasicMaterial({ color: coreHex });
  const haloMat = new THREE.MeshBasicMaterial({
    color: glowHex,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pelletHex = p.blossomColor ?? WARP_PELLET;
  const pelletMat = toon({ color: pelletHex, emissive: pelletHex, emissiveIntensity: 0.45 });

  // --- 1: the pillars, outlined like the maze --------------------------------
  // Outside the opening (inner faces at +-hw), so the corridor is untouched.
  const pillars = new THREE.Group();
  pillars.name = "pillars";
  g.add(pillars);
  const px = hw + pw / 2;
  const e = 0.035; // edge tube thickness — the outline's width at this size
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? "L" : "R";
    const pillar = part(new THREE.BoxGeometry(pw, springY, pd), pillarMat, `pillar${side}`, pillars);
    pillar.position.set(s * px, springY / 2, 0);
    // Four vertical corner edges and the four top edges, each a thin box
    // standing a hair proud so it caps the corner rather than z-fighting it.
    const edges = new THREE.Group();
    edges.name = `edges${side}`;
    edges.position.copy(pillar.position);
    pillars.add(edges);
    const hx = pw / 2;
    const hz = pd / 2;
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        const v = part(new THREE.BoxGeometry(e, springY, e), coreMat, "edgeV", edges);
        v.position.set(cx * (hx - e / 2 + 0.004), 0, cz * (hz - e / 2 + 0.004));
        v.castShadow = false;
      }
    }
    const top = springY / 2 - e / 2 + 0.004;
    for (const cz of [-1, 1]) {
      const t = part(new THREE.BoxGeometry(pw + 0.008, e, e), coreMat, "edgeTopX", edges);
      t.position.set(0, top, cz * (hz - e / 2 + 0.004));
      t.castShadow = false;
    }
    for (const cx of [-1, 1]) {
      const t = part(new THREE.BoxGeometry(e, e, pd + 0.008), coreMat, "edgeTopZ", edges);
      t.position.set(cx * (hx - e / 2 + 0.004), top, 0);
      t.castShadow = false;
    }
  }

  // --- 2: the arc ------------------------------------------------------------
  // On the pillars' centreline, sunk a little into each top so it grows out of
  // the block rather than resting on it.
  const arc = new THREE.Group();
  arc.name = "arc";
  g.add(arc);
  const arcPts = archCurvePoints(px, rise, curve, springY - 0.04, 36);
  const core = part(neonTube(arcPts, 0, 0.045), coreMat, "tubeCore", arc);
  core.castShadow = false;
  const halo = part(neonTube(arcPts, 0, 0.09), haloMat, "tubeHalo", arc);
  halo.castShadow = false;
  halo.renderOrder = 1;

  // --- 3: the biscuit trail --------------------------------------------------
  // Spaced by ARC LENGTH (the gateway's marquee lesson) and kept off the very
  // ends, where they would sit on the pillar tops. The crown is left to the
  // big one.
  const pellets = new THREE.Group();
  pellets.name = "pellets";
  g.add(pellets);
  const arcCurve = new THREE.CatmullRomCurve3(arcPts.map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const n = Math.max(0, Math.round(p.archBlossoms ?? 6));
  const crest = Math.max(0, p.archCrest ?? 1);
  // LARGER than the halo tube (0.09): a biscuit inside the additive halo is
  // washed to pale pink and stops reading as a biscuit (v1's render).
  const pelletGeo = new THREE.SphereGeometry(0.1, 12, 9);
  // Evenly through (0.12 .. 0.88), skipping the slot nearest the crown when
  // the big biscuit is there, so the two never overlap.
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (0.76 * (i + 0.5)) / n;
    if (crest > 0.01 && Math.abs(t - 0.5) < 0.08) continue;
    const v = arcCurve.getPointAt(t);
    const b = part(pelletGeo, pelletMat, `pellet${k++}`, pellets);
    b.position.copy(v);
  }
  if (crest > 0.01) {
    const big = part(new THREE.SphereGeometry(0.16 * crest, 14, 10), pelletMat, "crownPellet", pellets);
    big.position.copy(arcCurve.getPointAt(0.5));
    big.position.y += 0.03;
    // A hair of turn per instance, so the two mouths are not stamped.
    big.rotation.y = r() * Math.PI;
  }
  return g;
}

/**
 * THE TREE ARCH — the Deep Forest's tunnel mouth (IDEA-067 v3).
 *
 * Nuno: *"lets work in a arch to the deep forest, its the only thing that is
 * missing. The tunnel arch on the deep forest we can make like a tunnel with
 * like two trees one in each side and one branch from each tree making the
 * arch."*
 *
 * Same brief as the hedge arch and the same hard constraint — rule 6, the
 * opening has to be open to the SKY rather than to the far side — but a
 * different construction, and the constraint is what SHAPES it rather than
 * something it merely passes.
 *
 * **THE CROWNS ARE SMALL AND HIGH, AND THAT IS THE WHOLE DESIGN.** The
 * obvious tree arch is two broad canopies over two trunks, and it is the
 * green slab all over again. Worked out in the arch's own plane (the camera
 * descends at 59 degrees, so a mass between heights yb and yt whose inner
 * edge is at xi and outer at xo shadows the floor from xo - 0.6 yb inward),
 * a canopy of the usual width sitting just above the branch springing puts
 * the whole far half of the corridor in its own shadow — it reads exactly
 * like the portal-in-a-wall version that cost IDEA-067 a complete build.
 * The fix is not a narrower opening, it is a different TREE: tall and
 * slender, with a modest crown carried well above the crown of the arch, so
 * the mass that would close the sky is lifted well clear of the walk-through
 * and the BRANCHES become the arch. Which is also what Nuno asked for in so many
 * words — one branch from each tree, not two canopies meeting.
 *
 * `scripts/_scratch-arch-sightline.ts` measures the visible share of the
 * corridor floor by raycasting the built mesh rather than by re-deriving
 * that arithmetic, and `scripts/test-archway.ts` holds both arches to it.
 * The inequality the hedge arch is pinned by is the special case of this for
 * a solid pier standing on the ground; a tree is not that shape, so applying
 * its formula here would be measuring something else with confidence.
 *
 * THREE DIALS ARE REINTERPRETED and the rest mean exactly what they do on the
 * hedge arch. `archPier` is the TRUNK's girth rather than a pier's width,
 * `archDepth` how far the pair spreads through the portal, and `archCrest`
 * the leaf clusters riding the branches. `archFence` and `archThreshold` are
 * honoured and both ship OFF: the forest has `fence: "none"` and a cut stone
 * sill on leaf litter belongs to a garden.
 */
function makeTreeArch(p: PropParams, instanceHash: number): THREE.Group {
  const r = rand(instanceHash);
  const g = new THREE.Group();

  // The shared geometry, read exactly as the hedge arch reads it — so the
  // Props tab's dials move the same quantities and `test-archway.ts` can
  // recompute the springing height from the same three numbers.
  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide;
  const spread = H * (p.archDepth ?? ARCH_DEFAULTS.depth) * wide;
  const bandT = H * (p.archCrown ?? ARCH_DEFAULTS.crown);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const hw = openW / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const springH = Math.max(0.35, H - rise - bandT);
  const crownY = springH + rise;
  // 0.33 is what turns a PIER width into a TRUNK radius: the hedge arch's
  // default 0.208 of H is a pier you could lean on, and a third of that is a
  // tree you could not get your arms round — which at this scale is right,
  // since one maze tile is one world unit.
  const trunkR = Math.max(0.05, H * (p.archPier ?? ARCH_DEFAULTS.pier) * 0.33 * wide);
  // The trunks stand just OUTSIDE the opening, so `archOpening` is the clear
  // gap the beagle walks through rather than a centre-to-centre distance.
  const trunkX = hw + trunkR;
  const ribbon = Math.min(1, Math.max(0.15, p.archRibbon ?? ARCH_DEFAULTS.ribbon));

  const greens = p.foliageColors ?? HEDGE_GREENS;
  // Lifted off `palette.wall` for the hedge arch's own reason, which does not
  // change because the plant did: the maze wall is a TEXTURE and comes out far
  // lighter than the value it was generated from, so flat foliage painted in
  // that value reads dark beside it.
  const foliageMat = toon({
    color: brighten(pick(greens, instanceHash), 1.34),
    emissive: 0x0e2a0e,
    emissiveIntensity: 0.2,
  });
  const crestMat = toon({
    color: youngGrowth(pick(greens, (instanceHash * 7.3) % 1)),
    emissive: 0x16341a,
    emissiveIntensity: 0.18,
  });
  // THE BARK IS THE VALUE LADDER THIS ARCH HAS AND THE HEDGE ONE DOES NOT.
  // IDEA-067's third verdict was that a correctly-built green arch standing
  // on green beside green reads as one more bush, and the garden's answer was
  // to borrow the maze wall's white daisies. A tree arch does not need them:
  // two brown trunks under a green crown is already two rungs apart, which is
  // why `archBlossoms` ships at 0 here rather than being removed.
  const barkMat = toon({ color: p.trunkColor ?? TREE_ARCH_BARK });
  const eyeMat = toon({ color: EYE_DEFAULT, emissive: 0x3a2f10, emissiveIntensity: 0.2 });
  const blossomMat = toon({
    color: p.blossomColor ?? BLOSSOM_DEFAULT,
    emissive: 0x3a3630,
    emissiveIntensity: 0.2,
  });

  // --- 0: the trunks ---------------------------------------------------------
  // ONE SWEEP EACH, leaning slightly away from the corridor. A lathe would
  // give the flare for free and cannot lean; a leaning lathe is a cylinder
  // whose base no longer meets the floor, which is this project's own
  // only-vertices-say-where-a-prop's-floor-is defect waiting to happen. So the
  // path carries the lean and the station radii carry the flare — taken from
  // `flaredTrunkProfile` rather than retyped, so the garden's broadleaf tree
  // and this one splay by the same concave curve. (IDEA-060: a four-fold root
  // flare is the most characterful number in that whole set, and a
  // CylinderGeometry cannot express it.)
  // **THE TRUNK CONTINUES PAST THE FORK, AND THAT IS WHAT MAKES IT A TREE.**
  // The first two builds put the touch point at `H - bandT` -- the hedge
  // arch's own rule, where the crown of the arch IS the top of the prop --
  // so the limb rose higher than the bole it grew from and the trunk's own
  // head was hidden behind the crown. The eye joined trunk to limb into one
  // bending form, which is exactly what Nuno's sketch is correcting. A tree
  // carries its crown ABOVE the branch it forks at, so the trunk is taken
  // past `crownY` and the foliage goes on top of THAT.
  const trunkTopY = crownY + H * 0.14;
  // And a little past again, so its flat end cap is buried inside the
  // foliage: a swept solid is capped square, and a square cut across the top
  // of a tree is the one thing on it that says "mesh".
  const trunkCapY = trunkTopY + H * 0.055;
  const trunks = new THREE.Group();
  trunks.name = "trunks";
  g.add(trunks);
  // THE TRUNKS STAND UP (v3b, Nuno's sketch: *"instead of having the trees
  // making the arch, we can just make two branches touching"*). The first
  // build leaned them a whole trunk-radius outward and the branch left the
  // bole thicker than the bole itself, so the eye read ONE form — two trunks
  // bending over into each other — rather than two trees with limbs. A hint
  // of lean is life; a trunk-width of it is a bent tree.
  const lean = trunkR * 0.15;
  for (const s of [-1, 1] as const) {
    const flare = flaredTrunkProfile(trunkR, trunkCapY, 2.3, 7);
    const stations: SweepStation[] = flare.map(([rad, y]) => {
      const t = y / trunkCapY;
      // A real trunk is not a ruled surface either: the lean eases in, so the
      // foot stands straight and the head carries the bend. A linear lean is
      // a stick propped against a wall.
      const x = s * (trunkX + lean * Math.pow(t, 1.7));
      // Deliberate per-tree sway through the portal, so the pair does not read
      // as one object mirrored. Small: the two have to look like a gate.
      const z = (s * spread * 0.1 + (r() - 0.5) * spread * 0.06) * t;
      return { pos: [x, y, z] as [number, number, number], rx: rad, rz: rad };
    });
    // A SWEPT TRUNK'S BASE CAP IS NOT FLAT, and no render says so. The cap
    // lies in the plane perpendicular to the first TANGENT, and the lean
    // tilts that tangent off vertical — measured, the foot dipped 0.013 below
    // the lawn on a model that is correct in every other respect. Clamped
    // rather than lifted, for the hedge arch's own reason one part along:
    // lifting leaves the tree standing on tiptoe with daylight under it, and
    // a trunk does meet the soil in a flat line. (IDEA-060 rule 6 — only
    // vertices say where a prop's floor is.)
    const geo = taperedSweepGeometry(stations, 8);
    const a = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < a.count; v++) if (a.getY(v) < 0) a.setY(v, 0);
    a.needsUpdate = true;
    geo.computeVertexNormals();
    const m = part(geo, barkMat, s < 0 ? "trunkL" : "trunkR", trunks);
    m.castShadow = true;
  }

  // --- 1: the branches -------------------------------------------------------
  // ONE LIMB FROM EACH TREE, AND THEY TOUCH. They run on the SAME superellipse
  // the hedge arch's band does (`archCurvePoints`), so `archRise` and
  // `archCurve` still answer what KIND of arch this is and the two kinds
  // cannot disagree about where the opening's head sits.
  //
  // **A BRANCH THINNER THAN ITS OWN TRUNK IS THE WHOLE DIFFERENCE BETWEEN TWO
  // TREES AND ONE BENT ONE** (v3b, Nuno's sketch). The first build sized the
  // limb off `archCrown` — the hedge arch's BAND thickness, which is a
  // structural member carrying a hedge — and it came out 0.33 against a trunk
  // of 0.16, i.e. twice the bole it grew from. Nothing about that is wrong as
  // an arch; it simply is not two trees. The radius is a fraction of the
  // TRUNK now and the taper runs from there, which is the relationship the
  // sketch is actually about, and it cannot drift when the trunk is retuned.
  //
  // They MEET at the centre line with a knuckle over the joint rather than
  // running past each other: two solids crossing read as one continuous arc
  // (which is the thing being fixed), while two that butt leave a crease
  // exactly where the eye goes — IDEA-065 rule 17, answered by COVERING the
  // junction, which is also what a real graft looks like.
  const branches = new THREE.Group();
  branches.name = "branches";
  g.add(branches);
  const arc = archCurvePoints(hw, rise, curve, springH, 28);
  const mid = Math.floor(arc.length / 2);
  /** At the bole and at the touch, as fractions of the trunk's own radius. */
  const limbBase = trunkR * 0.58;
  const limbTip = trunkR * 0.34;
  const branchPaths: Array<Array<[number, number]>> = [];
  for (const s of [1, -1] as const) {
    // `archCurvePoints` runs from +hw round to -hw, so the right branch is its
    // head and the left branch its tail reversed — both then run OUTSIDE-IN,
    // which is what lets one radius easing serve both. One station PAST the
    // middle so the two overlap by a hair and the knuckle has something to
    // sit on; any more and they read as one arc again.
    const half = s > 0 ? arc.slice(0, mid + 1) : arc.slice(mid).reverse();
    // The branch leaves the TRUNK, not the opening's edge: it starts inside
    // the bark so there is no socket to see, and a touch below the springing
    // so it grows OUT of the tree rather than balancing on it.
    const path: Array<[number, number]> = [
      [s * (trunkX + lean * 0.6), springH - trunkR * 0.9],
      ...half,
    ];
    branchPaths.push(path);
    const n = path.length;
    const stations: SweepStation[] = path.map((pt, i) => {
      const t = i / (n - 1);
      // Eased, so the thickening lives near the bole — a constant-radius
      // branch is a pipe.
      const rad = limbTip + (limbBase - limbTip) * Math.pow(1 - t, 1.6);
      return {
        pos: [pt[0], pt[1], 0] as [number, number, number],
        rx: rad,
        // Flattened through the portal toward the touch, for rule 6's reason:
        // the head has to CROSS the gap rather than lid it.
        rz: rad * (1 + (ribbon - 1) * Math.pow(t, 1.5)),
      };
    });
    const m = part(
      taperedSweepGeometry(stations, 7),
      barkMat,
      s > 0 ? "branchR" : "branchL",
      branches,
    );
    m.castShadow = true;
  }
  // THE TOUCH ITSELF. A knuckle at the joint, the same answer `jointedLimb`
  // gives every bend in forestCritters.ts: two tapering solids meeting at an
  // angle leave an open wedge across the fold, and no amount of overlap along
  // their own axes closes it.
  const knuckle = part(
    new THREE.IcosahedronGeometry(limbTip * 1.32, 1),
    barkMat,
    "branchJoint",
    branches,
  );
  knuckle.position.set(0, crownY, 0);
  knuckle.scale.set(1.1, 0.9, ribbon);
  knuckle.castShadow = true;

  // --- 2: the crowns ---------------------------------------------------------
  // SMALL AND HIGH — see the header. Three blobs rather than one, so the crown
  // has a silhouette instead of being a ball on a stick, and offset OUTWARD so
  // the mass sits over the trunk's own side of the sightline rather than over
  // the corridor.
  const crowns = new THREE.Group();
  crowns.name = "crowns";
  g.add(crowns);
  // TWO BLOBS PER TREE AT detail 2, NOT THREE AT detail 1, AND THAT TRADE IS
  // THE WHOLE TUNING. Faceting is a function of how big a blob is ON SCREEN
  // (IDEA-071's flowering border and IDEA-072's pale hexagons are the same
  // finding twice), so a handful of small low-detail blobs read as a cluster
  // of cut EMERALDS at any angle closer than the board's own -- which is what
  // the first build came back as. Much the same triangle budget, spent on
  // smoothness rather than on count.
  const crownR = H * 0.13 * wide;
  for (const s of [-1, 1] as const) {
    const baseX = s * (trunkX + lean);
    // THREE, and the third is the one that makes it a tree rather than a
    // lollipop: it sits lower and further out, so the crown has a ragged
    // underside instead of a single round head balanced on a pole. It is the
    // cheap one (`detail: 1`) because it is also the smallest — faceting is
    // a function of how big a blob lands ON SCREEN, not of how many there
    // are.
    for (let i = 0; i < 3; i++) {
      const low = i === 2;
      const rad = crownR * (low ? 0.6 + r() * 0.16 : 0.86 + r() * 0.26);
      const blob = lobedFoliageGeometry(rad, {
        detail: low ? 1 : 2,
        lobes: 7,
        sharpness: 6,
        amplitude: 0.24,
        scale: [1.05, 0.84, 1.0],
        seed: 211 + i + (s > 0 ? 9 : 0),
      });
      const m = part(blob, foliageMat, `${s < 0 ? "crownL" : "crownR"}${i}`, crowns);
      m.position.set(
        baseX + s * crownR * (low ? 0.6 + r() * 0.3 : 0.05 + r() * 0.22),
        trunkTopY + crownR * (low ? -0.3 : 0.22 + i * 0.5),
        // Kept tight through the portal. A crown is the widest thing on this
        // prop, so its own jitter is what decides whether the arch still
        // reads as a portal rather than as a covered way -- measured, a
        // spread of 0.4 took the pair past a full tile deep.
        (r() - 0.5) * spread * 0.2,
      );
      m.rotation.set((r() - 0.5) * 0.4, r() * Math.PI, (r() - 0.5) * 0.4);
      m.castShadow = true;
    }
  }

  // --- 3: the leaves ---------------------------------------------------------
  // The clusters that make the branches read as an arch rather than as two
  // sticks. `archCrest` sizes them, as it sizes the hedge arch's own looser
  // growth, and they are the lighter green for the same reason: this year's
  // growth catching the sun is the only internal contrast a green mass gets.
  const leaves = new THREE.Group();
  leaves.name = "leaves";
  g.add(leaves);
  const crestAmt = p.archCrest ?? ARCH_DEFAULTS.crest;
  if (crestAmt > 0.01) {
    let i = 0;
    for (const path of branchPaths) {
      const n = path.length;
      for (let k = 1; k < n; k += 4) {
        const t = k / (n - 1);
        const pt = path[k];
        // Smaller toward the crown, so the foliage tapers with the wood it
        // rides on — even clusters on a tapering branch read as beads
        // threaded onto it rather than as leaves growing out of it.
        const rad = (0.2 + r() * 0.09) * crestAmt * (1 - 0.3 * t) + bandT * 0.34;
        const blob = lobedFoliageGeometry(rad, {
          detail: 1,
          lobes: 5,
          sharpness: 5,
          amplitude: 0.3,
          scale: [1.3, 0.8, 1.2],
          seed: 131 + i,
        });
        const m = part(blob, crestMat, `leaf${i}`, leaves);
        // Outward from the arch's own centre, so a cluster sits ON the branch
        // rather than inside it — and biased UPWARD, because at 59 degrees the
        // top of the arc is most of what a player sees of it.
        const nx = pt[0];
        const ny = pt[1] - (springH + rise * 0.35);
        const len = Math.hypot(nx, ny) || 1;
        m.position.set(
          pt[0] + (nx / len) * bandT * 0.3,
          pt[1] + (ny / len) * bandT * 0.3 + rad * 0.25,
          (r() - 0.5) * spread * 0.4,
        );
        m.rotation.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5);
        m.castShadow = true;
        i++;
      }
    }
    // THE JOINT GETS ITS OWN CLUSTER, and it is not decoration: the two
    // branches overlap at the crown and two solids meeting leave a crease
    // precisely where the eye goes.
    const capR = (0.12 + r() * 0.05) * crestAmt + bandT * 0.3;
    const cap = part(
      lobedFoliageGeometry(capR, {
        detail: 1,
        lobes: 6,
        sharpness: 5,
        amplitude: 0.3,
        scale: [1.5, 0.82, 1.15],
        seed: 177,
      }),
      crestMat,
      "leafCrown",
      leaves,
    );
    cap.position.set(0, crownY + capR * 0.22, 0);
    cap.castShadow = true;
  }

  // --- 4: the blossoms -------------------------------------------------------
  // Off by default here (`archBlossoms: 0` on the shipped def) and kept
  // because a flowering tree is a thing somebody might want. The hedge arch
  // needs them; this one has bark for its value step.
  const blooms = new THREE.Group();
  blooms.name = "blossoms";
  g.add(blooms);
  const bn = Math.max(0, Math.round(p.archBlossoms ?? 0));
  const OUT = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < bn; i++) {
    const path = branchPaths[i % 2];
    const pt = path[1 + Math.floor(r() * (path.length - 1))];
    const rad = 0.05 + r() * 0.02;
    const nx = pt[0];
    const ny = pt[1] - (springH + rise * 0.35);
    const len = Math.hypot(nx, ny) || 1;
    const zs = (r() - 0.5) * 2;
    const n = new THREE.Vector3(nx / len, ny / len, zs * 1.1).normalize();
    const x = pt[0] + n.x * bandT * 0.5;
    const y = pt[1] + n.y * bandT * 0.5;
    const z = zs * spread * 0.3;
    const s = part(new THREE.IcosahedronGeometry(rad, 0), blossomMat, `bloom${i}`, blooms);
    s.position.set(x, y, z);
    s.quaternion.setFromUnitVectors(OUT, n);
    s.scale.set(1.15, 1.15, 0.38);
    s.castShadow = false;
    const eye = part(new THREE.IcosahedronGeometry(rad * 0.42, 0), eyeMat, `bloom${i}Eye`, blooms);
    eye.position.set(x + n.x * rad * 0.34, y + n.y * rad * 0.34, z + n.z * rad * 0.34);
    eye.quaternion.copy(s.quaternion);
    eye.scale.set(1, 1, 0.5);
    eye.castShadow = false;
  }

  // --- 5: the trunk tufts ----------------------------------------------------
  // GREEN DOWN THE TREE, NOT ONLY ON TOP OF IT (Nuno: *"lets just add more
  // green to the trees to have more volume and not just on the top"*). Three
  // blobs hugging each bole between the fork and the crown, which is the one
  // stretch of this prop that was bare bark — and it is a real tree's own
  // habit rather than decoration: foliage clings to the trunk under the head.
  //
  // **THEY HANG OUTBOARD, AND THAT BOUND IS SOLVED RATHER THAN EYEBALLED.**
  // Everything below the branch springing has to leave the walk-through
  // alone, which is rule 6's whole subject — so a tuft of radius `rad`
  // centred at `trunkX + rad * 0.55` has its inner edge at
  // `trunkX - rad * 0.75` (the blob reaches ~1.3x its radius once the lobe
  // amplitude and the x scale are in), and keeping that at or outside the
  // opening's own half-width caps the radius at `(trunkX - hw) / 0.75`. Sized
  // past it they would close the gap the two trees exist to frame.
  //
  // Appended LAST, after the blossoms: a prop's part edits are saved by
  // depth-first INDEX PATH, so inserting a group anywhere earlier silently
  // repoints every edit already authored against this def (IDEA-065 rule 9's
  // log-cabin lesson).
  const tufts = new THREE.Group();
  tufts.name = "tufts";
  g.add(tufts);
  if (crestAmt > 0.01) {
    const maxRad = Math.max(0.04, (trunkX - hw) / 0.75);
    for (const s2 of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        const rad = Math.min(maxRad, crownR * (0.42 + r() * 0.2));
        const blob = lobedFoliageGeometry(rad, {
          detail: 1,
          lobes: 6,
          sharpness: 5,
          amplitude: 0.3,
          scale: [1.2, 0.8, 1.15],
          seed: 311 + i + (s2 > 0 ? 5 : 0),
        });
        const m = part(blob, foliageMat, `${s2 < 0 ? "tuftL" : "tuftR"}${i}`, tufts);
        // Spaced up the bare stretch, highest first so the lowest one still
        // sits clear of the fork.
        const span = Math.max(0.1, trunkTopY - crownY * 0.55);
        m.position.set(
          s2 * (trunkX + rad * 0.55),
          crownY * 0.55 + span * ((i + 0.5) / 3),
          (r() - 0.5) * spread * 0.3,
        );
        m.rotation.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5);
        m.castShadow = true;
      }
    }
  }

  return g;
}

/** The sea arch's palette (IDEA-080). Rock and its weathered top sit two
 *  rungs apart on IDEA-079's warm ladder (`bark` / `wood`), the corals on
 *  `pink` and `violet`, the crabs on `coral` and the algae on `leaf` / `grass`
 *  — and none of them on `sand`, which is the beach wall's own entry, or the
 *  arch would melt into the maze it stands at the end of. Checked with
 *  `scripts/_scratch-snap-probe.ts` and pinned by `test-archway.ts`. */
const SEA_ROCK = 0xa07a58;
const SEA_ALGAE: readonly number[] = [0x3f8a5a, 0x8fbf5a];
const SEA_CORAL = 0xe8789a;
const SEA_CORAL_B = 0xa070d0;
const SEA_CRAB = 0xd84a2a;
const SEA_EYE = 0xf4f1ea;
const SEA_INK = 0x2b2724;

/**
 * THE SEA ARCH — the Sunny Beach's tunnel mouth (IDEA-080).
 *
 * Nuno: *"for the arch on the beach I was thinking in something like a rock
 * arch with corals and beach flora, like algae, and some small crabs on the
 * rocks."* A natural sea arch — the Algarve's limestone kind — rather than
 * anything built.
 *
 * **IT IS THE HEDGE ARCH'S CONSTRUCTION IN STONE, AND THAT IS FORCED.** Rule 6
 * is about MASS, not material: a solid leg of height h hides 0.6h of the floor
 * behind it from 59 degrees, so the legs spring at the hedge arch's own height
 * from the same three numbers (`archRise`, `archCrown`, `height`) and
 * `test-archway.ts` holds this arch to the identical inequality. One chain of
 * boulders up a leg, over the head and down the other, stepped by the LOCAL
 * radius and thickening toward the feet — the hedge chain's reasoning, with
 * sharper lobes, because sharp lobes are what make `lobedFoliageGeometry` read
 * as rock rather than as foliage (groundDetail.ts tunes it the same way).
 *
 * **THE VALUE LADDER IS ROCK, WEATHERED TOP, THEN LIFE.** A brown arch standing
 * on tan sand beside tan walls is IDEA-067's "one more bush" in a new colour.
 * So the cap stones along the top are a rung lighter (`bark` to `wood`), the
 * tide line is draped in dark algae, and the feet carry the saturated things —
 * pink and violet coral, red crabs — which are the only marks on the board
 * that say SEA up close.
 *
 * **NOTHING ALIVE STANDS IN THE OPENING.** Corals, algae and sea grass all sit
 * OUTBOARD of the legs or on their front and back faces; the beagle walks
 * through this tile, and a coral in the doorway reads as something in the way
 * (the threshold's own reasoning, below).
 *
 * The dials mean what they mean on the hedge arch, with three reinterpreted:
 * `archCrest` sizes the weathered cap stones, `archBlossoms` is the number of
 * coral clusters at each foot, and `foliageColors` are the algae. `stoneColor`
 * is the rock, `blossomColor` the coral.
 */
function makeRockArch(p: PropParams, instanceHash: number): THREE.Group {
  const r = rand(instanceHash);
  const g = new THREE.Group();

  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide;
  const depth = H * (p.archDepth ?? ARCH_DEFAULTS.depth) * wide;
  const bandT = H * (p.archCrown ?? ARCH_DEFAULTS.crown);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const hw = openW / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const pierH = Math.max(0.35, H - rise - bandT);
  const crownY = pierH + rise;
  const ribbonD = depth * Math.min(1, Math.max(0.15, p.archRibbon ?? ARCH_DEFAULTS.ribbon));

  const rockHex = p.stoneColor ?? SEA_ROCK;
  const algae = p.foliageColors ?? SEA_ALGAE;
  const rockMat = toon({ color: rockHex, emissive: 0x2a1a0c, emissiveIntensity: 0.12 });
  // A rung LIGHTER and a touch YELLOWER — the sun-bleached top of a sea stack.
  // Brightening alone keeps the hue, and under the shipped style the snap
  // weights hue at 3.0, so a pure brighten can land on the SAME entry as the
  // rock and the whole ladder collapses (the crest finding in youngGrowth).
  const capMat = toon({ color: bleached(rockHex), emissive: 0x2a1e0c, emissiveIntensity: 0.12 });
  const algaeMat = toon({ color: algae[0], emissive: 0x0c2414, emissiveIntensity: 0.14 });
  const grassMat = toon({ color: algae[algae.length - 1], emissive: 0x16240a, emissiveIntensity: 0.14 });
  const coralMat = toon({ color: p.blossomColor ?? SEA_CORAL, emissive: 0x3a1420, emissiveIntensity: 0.18 });
  const coralMatB = toon({ color: SEA_CORAL_B, emissive: 0x24143a, emissiveIntensity: 0.18 });
  const crabMat = toon({ color: SEA_CRAB, emissive: 0x3a1008, emissiveIntensity: 0.2 });
  const eyeMat = toon({ color: SEA_EYE });
  const inkMat = toon({ color: SEA_INK });
  // A pupil is a MARKING: without the declared role the snap matches a
  // near-black against the neutrals and lifts it to `slate`, a blue-grey —
  // IDEA-065 rule 10's six blue-eyed woodland animals.
  inkMat.userData.madboxRole = "ink";

  /** Clamp a blob's vertices to the floor — the hedge chain's rule: lifted, a
   *  rock stands on tiptoe with daylight under it; clamped, it sits. */
  const seat = (geo: THREE.BufferGeometry, y: number): void => {
    const a = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < a.count; v++) if (a.getY(v) < -y) a.setY(v, -y);
    a.needsUpdate = true;
    geo.computeVertexNormals();
  };

  // --- 0: the rock -----------------------------------------------------------
  const rock = new THREE.Group();
  rock.name = "rock";
  g.add(rock);
  const bandRad = bandT * 0.66;
  const footRad = bandRad * (1 + (p.archPier ?? ARCH_DEFAULTS.pier) * 3.4);
  const radAt = (y: number): number => {
    const t = Math.min(1, Math.max(0, y / Math.max(0.01, crownY)));
    return bandRad + (footRad - bandRad) * Math.pow(1 - t, 2.2);
  };
  // EACH LEG BOULDER'S CENTRE SITS ONE LOCAL RADIUS OUTBOARD OF THE OPENING,
  // so its inner face is the door jamb. The hedge chain centres its legs at a
  // fixed `hw + bandT / 2` and lets the thick feet bulge inward, which a
  // hedge gets away with; a rock leg doing the same measured 0.27 units INTO
  // a 1.1-unit doorway — a quarter of the corridor the beagle walks through,
  // found by test-archway.ts's doorway check rather than by any render.
  // 1.6, not 1.0: a lobed blob reaches ~1.2x its nominal radius once the
  // lobe amplitude is in, the chain scales it 1.1 wider again, and its own
  // random spin points the longest lobe anywhere — measured, 1.3 still left
  // a dozen vertices in the doorway, and the probe measured 1.55.
  const legXAt = (y: number): number => hw + radAt(y) * 1.6;
  /** Where the leg meets the sand — everything outboard is placed from here. */
  const footX = legXAt(0);
  {
    const legSteps = Math.max(2, Math.round(pierH / 0.16));
    const path: Array<[number, number]> = [];
    for (let i = 0; i <= legSteps; i++) {
      const y = (i / legSteps) * pierH;
      path.push([-legXAt(y), y]);
    }
    const arc = archCurvePoints(legXAt(pierH), rise, curve, pierH, 40);
    for (let i = arc.length - 1; i >= 0; i--) path.push(arc[i]);
    for (let i = legSteps; i >= 0; i--) {
      const y = (i / legSteps) * pierH;
      path.push([legXAt(y), y]);
    }
    const depthAt = (y: number): number => {
      const t = Math.min(1, Math.max(0, y / Math.max(0.01, crownY)));
      return depth + (ribbonD - depth) * Math.pow(t, 1.6);
    };
    let acc = Infinity;
    let prev = path[0];
    let i = 0;
    for (const pt of path) {
      acc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
      prev = pt;
      const rad = radAt(pt[1]);
      // 0.6, tighter than the hedge's 0.78: a stone chain spaced like a
      // hedge reads as BEADS on a string, and a sea arch is one mass of rock.
      if (acc < rad * 0.6) continue;
      acc = 0;
      const blob = lobedFoliageGeometry(rad, {
        detail: 1,
        lobes: 5,
        sharpness: 7,
        amplitude: 0.24,
        scale: [1.1, 1.0, Math.max(0.6, depthAt(pt[1]) / (2 * rad))],
        seed: 401 + i,
      });
      if (pt[1] < rad * 1.4) seat(blob, pt[1]);
      const m = part(blob, rockMat, `rock${i}`, rock);
      // Pushed OUTWARD a little on the legs, never in: a stone that bulges
      // into the opening narrows the door the beagle walks through.
      const out = pt[1] < pierH ? Math.sign(pt[0]) * r() * rad * 0.12 : 0;
      m.position.set(pt[0] + out, pt[1], (r() - 0.5) * rad * 0.15);
      m.rotation.y = r() * Math.PI;
      i++;
    }
    // A boulder at each foot, outboard, so the arch grows out of a rocky
    // outcrop rather than standing on the sand like furniture.
    for (const s of [-1, 1] as const) {
      const br = footRad * (0.8 + r() * 0.15);
      const b = lobedFoliageGeometry(br, {
        detail: 1,
        lobes: 5,
        sharpness: 7,
        amplitude: 0.26,
        scale: [1.25, 0.72, 1.1],
        seed: 451 + (s > 0 ? 1 : 0),
      });
      seat(b, 0);
      const m = part(b, rockMat, s < 0 ? "footL" : "footR", rock);
      m.position.set(s * (footX + footRad * 0.6), 0, (r() - 0.5) * depth * 0.2);
      m.rotation.y = r() * Math.PI;
    }
  }

  // --- 1: the weathered caps -------------------------------------------------
  // Lighter flattened slabs along the OUTER top of the arch — the bleached
  // stone a sea stack carries on top, and this arch's first value step.
  const caps = new THREE.Group();
  caps.name = "caps";
  g.add(caps);
  const crestAmt = p.archCrest ?? ARCH_DEFAULTS.crest;
  // Offset by a full boulder radius, not a fraction of one: the chain's
  // lobes reach ~1.2x their nominal radius, and the first build set the caps
  // at 0.55-0.75 of it — every one of them inside the rock, built, coloured
  // and invisible (this project's buried-part defect, once more).
  const capPts = archCurvePoints(legXAt(pierH) + bandRad * 0.95, rise + bandRad * 1.05, curve, pierH, 14);
  if (crestAmt > 0.01) {
    for (let i = 1; i < capPts.length - 1; i += 2) {
      const rad = (0.13 + r() * 0.06) * crestAmt + bandT * 0.22;
      const blob = lobedFoliageGeometry(rad, {
        detail: 1,
        lobes: 5,
        sharpness: 6,
        amplitude: 0.22,
        scale: [1.5, 0.5, 1.25],
        seed: 471 + i,
      });
      const m = part(blob, capMat, `cap${i}`, caps);
      m.position.set(capPts[i][0], capPts[i][1], (r() - 0.5) * ribbonD * 0.3);
      // Tilted to follow the arch, so a cap lies ALONG the curve instead of
      // sitting level on a slope like a hat.
      const prevPt = capPts[i - 1];
      const nextPt = capPts[i + 1];
      m.rotation.set(0, 0, Math.atan2(nextPt[1] - prevPt[1], nextPt[0] - prevPt[0]) + Math.PI);
    }
    for (const s of [-1, 1] as const) {
      const rad = footRad * 0.55 * (0.6 + crestAmt * 0.6);
      const blob = lobedFoliageGeometry(rad, {
        detail: 1,
        lobes: 5,
        sharpness: 6,
        amplitude: 0.22,
        scale: [1.4, 0.45, 1.2],
        seed: 491 + (s > 0 ? 1 : 0),
      });
      const m = part(blob, capMat, s < 0 ? "capFootL" : "capFootR", caps);
      m.position.set(s * (footX + footRad * 0.65), footRad * 0.62, 0);
      m.rotation.y = r() * Math.PI;
    }
  }

  // --- 2: the algae ----------------------------------------------------------
  // A TIDE LINE, not a scatter: dark weed draped on the lower legs' front and
  // back faces up to about the height a wave reaches, which is what says
  // "this rock stands in the sea" — plus sea-grass tufts at the outboard feet.
  // The weed is FLATTENED ONTO the face (the hedge arch's blossom rule): a
  // round blob stuck to a rock is a sponge; a squashed one is a drape.
  const weed = new THREE.Group();
  weed.name = "algae";
  g.add(weed);
  {
    let i = 0;
    for (const s of [-1, 1] as const) {
      for (const f of [-1, 1] as const) {
        const n = 2 + Math.floor(r() * 2);
        for (let k = 0; k < n; k++) {
          const rad = 0.1 + r() * 0.05;
          const blob = lobedFoliageGeometry(rad, {
            detail: 1,
            lobes: 6,
            sharpness: 4,
            amplitude: 0.32,
            scale: [1.3, 0.9, 0.38],
            seed: 511 + i,
          });
          const m = part(blob, algaeMat, `weed${i++}`, weed);
          // Clear of the sand by its own squashed half-height, so no frond
          // sinks below the beach.
          const y = rad * 1.25 + (k / n) * 0.4 + r() * 0.06;
          // ON the face, a hair proud, and centred far enough outboard that
          // its inner edge (~1.7x its radius once the lobes and the x scale
          // are in) stops at the door jamb rather than in the doorway.
          m.position.set(s * (hw + rad * 1.75 + r() * footRad * 0.5), y, f * (depth / 2 + 0.01));
        }
      }
    }
    // Sea grass: fans of flattened blades, outboard of each foot boulder. A
    // blade is a SQUASHED CONE, thick at the root — a thin rod returns the
    // matcap's bounce colour rather than its own (IDEA-065 rule 27) and a
    // grass blade that renders near-white is a feather.
    for (const s of [-1, 1] as const) {
      for (let t = 0; t < 2; t++) {
        const tuft = new THREE.Group();
        tuft.name = `grass${s < 0 ? "L" : "R"}${t}`;
        weed.add(tuft);
        tuft.position.set(
          s * (footX + footRad * (1.15 + r() * 0.2)),
          0,
          (t === 0 ? 1 : -1) * depth * (0.25 + r() * 0.2),
        );
        for (let b = 0; b < 4; b++) {
          const h = 0.24 + r() * 0.12;
          const blade = part(new THREE.ConeGeometry(0.038, h, 5), grassMat, `blade${b}`, tuft);
          const a = (b / 4) * Math.PI * 2 + r() * 0.6;
          const lean = 0.25 + r() * 0.3;
          // Centre offset ALONG the lean, so the root stays planted at the
          // tuft's own spot rather than swinging out with the tip.
          const off = 0.03 + (h / 2) * Math.sin(lean);
          // Lifted by the base ring's own tilt, or the low side of a leaning
          // cone's base dips under the sand.
          blade.position.set(Math.cos(a) * off, (h / 2) * Math.cos(lean) + 0.038 * Math.sin(lean), Math.sin(a) * off);
          blade.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
          blade.scale.set(1, 1, 0.45);
        }
      }
    }
  }

  // --- 3: the corals ---------------------------------------------------------
  // At the feet, outboard. Two kinds, because two is what reads as a REEF
  // rather than a planted ornament: BRANCHING coral (round-tipped capsules
  // splaying up from a knot) and BRAIN coral (a tight-lobed dome). Different
  // silhouettes AND different hues — the five-flowers rule (IDEA-060): two of
  // a kind that differ only by colour read as one thing in two paints.
  const corals = new THREE.Group();
  corals.name = "corals";
  g.add(corals);
  const perFoot = Math.max(0, Math.round(p.archBlossoms ?? 3));
  {
    let i = 0;
    for (const s of [-1, 1] as const) {
      for (let k = 0; k < perFoot; k++) {
        const c = new THREE.Group();
        const branching = (k + (s > 0 ? 1 : 0)) % 2 === 0;
        c.name = `coral${i++}`;
        corals.add(c);
        // Around the outboard half of the foot, front and back alternately —
        // the faces the play camera sees.
        const ang = (k / Math.max(1, perFoot - 1) - 0.5) * 2.2 + (r() - 0.5) * 0.3;
        const rr = footRad * (1.05 + r() * 0.2);
        c.position.set(s * (footX + footRad * 0.45 + Math.cos(ang) * rr * 0.5), 0, Math.sin(ang) * rr);
        c.rotation.y = r() * Math.PI * 2;
        const sc = 0.9 + r() * 0.3;
        c.scale.setScalar(sc);
        if (branching) {
          part(new THREE.SphereGeometry(0.06, 7, 5), coralMat, "knot", c).position.y = 0.06;
          const n = 4 + Math.floor(r() * 2);
          for (let b = 0; b < n; b++) {
            const len = 0.1 + r() * 0.08;
            const br = part(new THREE.CapsuleGeometry(0.032, len, 3, 6), coralMat, `branch${b}`, c);
            const a = (b / n) * Math.PI * 2 + r() * 0.5;
            const tilt = 0.35 + r() * 0.35;
            const reach = (len / 2 + 0.03) * Math.sin(tilt);
            br.position.set(Math.cos(a) * reach, 0.06 + (len / 2 + 0.03) * Math.cos(tilt), Math.sin(a) * reach);
            br.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
          }
        } else {
          const brain = lobedFoliageGeometry(0.11, {
            detail: 2,
            lobes: 10,
            sharpness: 3,
            amplitude: 0.16,
            scale: [1, 0.72, 1],
            seed: 531 + k,
          });
          seat(brain, 0.03);
          part(brain, coralMatB, "brain", c).position.y = 0.03;
        }
      }
    }
  }

  // --- 4: the crabs ----------------------------------------------------------
  // SMALL, RED, AND SIDEWAYS. One on the crown — the highest point on the
  // board's edge, where a player's eye goes when it finds the arch — and one
  // on a foot boulder. Rule 27 again for the legs: thick enough to keep their
  // own colour. Every crab is turned to face a little off the camera, because
  // a crab walks sideways and a crab seen head-on is a red bead.
  const crabs = new THREE.Group();
  crabs.name = "crabs";
  g.add(crabs);
  const crabAt = (name: string, x: number, y: number, z: number, yaw: number, tilt = 0): void => {
    const c = new THREE.Group();
    c.name = name;
    c.position.set(x, y, z);
    c.rotation.set(0, yaw, tilt);
    crabs.add(c);
    const body = part(new THREE.SphereGeometry(0.085, 10, 6), crabMat, "shell", c);
    body.position.y = 0.05;
    body.scale.set(1.25, 0.55, 0.9);
    for (const s of [-1, 1] as const) {
      // Claws forward (+Z), a chunky ball each — the identity at 10 px.
      const claw = part(new THREE.SphereGeometry(0.042, 8, 5), crabMat, s < 0 ? "clawL" : "clawR", c);
      claw.position.set(s * 0.085, 0.05, 0.085);
      claw.scale.set(1, 0.8, 1.2);
      for (let l = 0; l < 3; l++) {
        const leg = part(new THREE.CapsuleGeometry(0.014, 0.07, 2, 4), crabMat, `leg${s < 0 ? "L" : "R"}${l}`, c);
        leg.position.set(s * 0.12, 0.045, -0.04 + l * 0.04);
        leg.rotation.set(0, 0, s * 1.05);
      }
      const eye = part(new THREE.SphereGeometry(0.022, 7, 5), eyeMat, s < 0 ? "eyeL" : "eyeR", c);
      eye.position.set(s * 0.032, 0.1, 0.05);
      const pupil = part(new THREE.SphereGeometry(0.012, 6, 4), inkMat, s < 0 ? "pupilL" : "pupilR", c);
      pupil.position.set(s * 0.032, 0.105, 0.068);
    }
  };
  // On TOP of the cap stones, which sit a boulder radius above the chain's
  // crown line and are themselves ~0.08 thick — at the chain's own crown the
  // crab was under the caps and could not be seen.
  crabAt("crabCrown", (r() - 0.5) * hw * 0.4, crownY + bandRad * 1.05 + 0.07, ribbonD * 0.1, 0.5 + r() * 0.4);
  crabAt("crabFoot", -(footX + footRad * 0.65), footRad * 0.62 + 0.02, depth * 0.15, -0.9 - r() * 0.4);
  if (r() < 0.6) {
    crabAt("crabSand", footX + footRad * 1.5, 0, -depth * 0.4, 2.2 + r() * 0.6);
  }

  // --- 5: the threshold ------------------------------------------------------
  // A GROUP even when empty, so the parts after it keep their index — the
  // hedge arch's rule. Ships OFF on the beach: a cut stone sill on sand is a
  // garden's idea, and the beach floor is already the threshold.
  const sillHost = new THREE.Group();
  sillHost.name = "threshold";
  g.add(sillHost);
  if (p.archThreshold === true) {
    const sill = part(new THREE.BoxGeometry(openW * 0.98, 0.06, depth * 0.9), capMat, "sill", sillHost);
    sill.position.y = 0.03;
    sill.castShadow = false;
  }

  return g;
}

const SHIP_HULL = 0x6b4426;
const SHIP_PLANK = 0xb07a3e;
const SHIP_ROPE = 0xf1f0ec;
const SHIP_INK = 0x2b2724;
const SHIP_LAMP = 0xf8d048;

/**
 * THE SHIP ARCH — the Pirate Island's tunnel mouth.
 *
 * Nuno: *"The arch of the maze can be like wood parts of the ship."* Two low
 * plank posts (the outer planks carry the ribs, the centre one is a BROKEN
 * MAST stump), a pair of curved HULL RIBS springing between them with deck
 * planks laid across the crown, rope lashings and iron straps, and a pirate
 * pennant on top.
 *
 * It keeps the sea arch's mass rule (IDEA-067 rule 6): the posts spring at
 * `H - rise - bandT`, the same three numbers, so `archAperture` needs no
 * special case. Everything below the springing sits OUTBOARD of the opening.
 *
 * Value ladder: hull (dark), plank (mid), bleached caps (hue-shifted lighter),
 * rope (near-white, under the neutral threshold so it stays pale), iron (ink).
 * Dials reinterpreted: `stoneColor` hull, `fenceColor` plank, `blossomColor`
 * rope, `archBlossoms` lashings per post, `archCrest` the bleached caps.
 */
function makeShipArch(p: PropParams, instanceHash: number): THREE.Group {
  const r = rand(instanceHash);
  const g = new THREE.Group();

  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide;
  const depth = H * (p.archDepth ?? ARCH_DEFAULTS.depth) * wide;
  const bandT = H * (p.archCrown ?? ARCH_DEFAULTS.crown);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const hw = openW / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const pierH = Math.max(0.35, H - rise - bandT);

  const postW = bandT * 1.15;
  const postCX = hw + 0.01 + postW / 2;
  const ribD = depth * 0.22;
  const ribZ = depth / 2 - ribD / 2;

  const hullMat = toon({ color: p.stoneColor ?? SHIP_HULL, emissive: 0x2a1a0c, emissiveIntensity: 0.1 });
  const plankMat = toon({ color: p.fenceColor ?? SHIP_PLANK, emissive: 0x2a1a0c, emissiveIntensity: 0.12 });
  const capMat = toon({ color: hexOf(mix(rgbOf(p.fenceColor ?? SHIP_PLANK), rgbOf(0xf0d8a8), 0.7)), emissive: 0x2a1e0c, emissiveIntensity: 0.12 });
  const ropeMat = toon({ color: p.blossomColor ?? SHIP_ROPE, emissive: 0x2a2a24, emissiveIntensity: 0.1 });
  const inkMat = toon({ color: SHIP_INK });
  inkMat.userData.madboxRole = "ink";
  const lampMat = toon({ color: SHIP_LAMP, emissive: 0xf8d048, emissiveIntensity: 0.55 });

  const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);
  const lowH = pierH * 0.78;

  // --- 0: the posts ----------------------------------------------------------
  const posts = new THREE.Group();
  posts.name = "posts";
  g.add(posts);
  for (const s of [-1, 1] as const) {
    const n = s < 0 ? "L" : "R";
    for (const [k, z, h] of [
      ["Front", ribZ, pierH],
      ["Mast", 0, lowH],
      ["Back", -ribZ, pierH],
    ] as const) {
      const pl = part(box(postW, h, ribD * 0.98), k === "Mast" ? hullMat : plankMat, `post${n}${k}`, posts);
      pl.position.set(s * postCX, h / 2, z);
    }
  }

  // --- 1: the hull ribs ------------------------------------------------------
  const ribs = new THREE.Group();
  ribs.name = "ribs";
  g.add(ribs);
  const pts = archCurvePoints(postCX, rise, curve, pierH, 18);
  const t = Math.min(postW, bandT) * 0.95;
  for (const [fz, zn] of [[1, "Front"], [-1, "Back"]] as const) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = part(box(len * 1.18, t, ribD), hullMat, `rib${zn}${i}`, ribs);
      m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, fz * ribZ);
      m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  // Deck planks laid ACROSS the crown, between the ribs — what the play camera
  // looks straight down on.
  const deck = new THREE.Group();
  deck.name = "deck";
  g.add(deck);
  for (let i = 1; i < pts.length - 1; i += 2) {
    const a = pts[i - 1];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    const m = part(box(len * 0.9, t * 0.8, depth - 2 * ribD + 0.02), plankMat, `deck${i}`, deck);
    m.position.set(pts[i][0], pts[i][1] + t * 0.08, 0);
    m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  // --- 2: the weathered caps -------------------------------------------------
  const caps = new THREE.Group();
  caps.name = "caps";
  g.add(caps);
  const crest = p.archCrest ?? ARCH_DEFAULTS.crest;
  const mid = Math.floor(pts.length / 2);
  if (crest > 0.01) {
    for (const s of [-1, 1] as const) {
      const c = part(box(postW * 1.1, 0.07 + 0.05 * crest, ribD * 1.15), capMat, s < 0 ? "capL" : "capR", caps);
      c.position.set(s * postCX, lowH + 0.05, 0);
      c.rotation.y = (r() - 0.5) * 0.15;
    }
    const top = part(box(postW * 1.6, 0.06 + 0.05 * crest, depth * 0.95), capMat, "capCrown", caps);
    top.position.set(pts[mid][0], pts[mid][1] + t / 2 + 0.05, 0);
  }

  // --- 3: rope lashings ------------------------------------------------------
  const rope = new THREE.Group();
  rope.name = "rope";
  g.add(rope);
  const lashes = Math.max(0, Math.round(p.archBlossoms ?? 2));
  for (const s of [-1, 1] as const) {
    for (let k = 0; k < lashes; k++) {
      const y = lowH * (0.3 + (0.5 * k) / Math.max(1, lashes - 1));
      const b = part(box(postW + 0.04, 0.075, depth * 0.9), ropeMat, `lash${s < 0 ? "L" : "R"}${k}`, rope);
      b.position.set(s * postCX, y, 0);
    }
  }
  const coil = part(new THREE.TorusGeometry(0.12, 0.055, 6, 12), ropeMat, "coil", rope);
  coil.rotation.x = Math.PI / 2;
  coil.position.set(-(postCX + postW / 2 + 0.2), 0.056, depth * 0.18);

  // --- 4: iron straps --------------------------------------------------------
  const iron = new THREE.Group();
  iron.name = "iron";
  g.add(iron);
  for (const s of [-1, 1] as const) {
    const b = part(box(postW + 0.03, 0.06, depth * 0.96), inkMat, s < 0 ? "strapL" : "strapR", iron);
    b.position.set(s * postCX, pierH * 0.12 + 0.03, 0);
  }
  for (const [fz, zn] of [[1, "Front"], [-1, "Back"]] as const) {
    const b = part(box(t * 0.7, t * 1.15, ribD * 1.1), inkMat, `bracket${zn}`, iron);
    b.position.set(pts[mid][0] + 0.18, pts[mid][1], fz * ribZ);
  }

  // --- 5: the barrel and the lantern ----------------------------------------
  const props = new THREE.Group();
  props.name = "props";
  g.add(props);
  const barrel = new THREE.Group();
  barrel.name = "barrel";
  props.add(barrel);
  barrel.position.set(postCX + postW / 2 + 0.22, 0, -depth * 0.12);
  part(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 10), plankMat, "staves", barrel).position.y = 0.15;
  for (const [i, y] of [0.07, 0.23].entries()) {
    part(new THREE.CylinderGeometry(0.157, 0.157, 0.04, 10), inkMat, `hoop${i}`, barrel).position.y = y;
  }
  const lantern = new THREE.Group();
  lantern.name = "lantern";
  props.add(lantern);
  lantern.position.set(-postCX, lowH + 0.1, 0);
  part(box(0.17, 0.04, 0.17), inkMat, "lampBase", lantern).position.y = 0.02;
  part(new THREE.CylinderGeometry(0.075, 0.075, 0.15, 8), lampMat, "lampGlass", lantern).position.y = 0.115;
  part(new THREE.ConeGeometry(0.11, 0.09, 8), inkMat, "lampCap", lantern).position.y = 0.235;

  // --- 6: the pennant --------------------------------------------------------
  const flag = new THREE.Group();
  flag.name = "flag";
  g.add(flag);
  flag.position.set(pts[mid][0], pts[mid][1] + t / 2 + 0.1, 0);
  part(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6), hullMat, "pole", flag).position.y = 0.25;
  const cloth = new THREE.Group();
  cloth.name = "cloth";
  flag.add(cloth);
  cloth.position.set(0.22, 0.38, 0);
  cloth.rotation.x = -0.6;
  part(box(0.44, 0.3, 0.035), inkMat, "pennant", cloth);
  const skull = part(new THREE.SphereGeometry(0.07, 8, 6), ropeMat, "skull", cloth);
  skull.position.set(0, 0.02, 0.03);
  for (const [i, a] of [0.6, -0.6].entries()) {
    const bone = part(box(0.3, 0.035, 0.02), ropeMat, `bones${i}`, cloth);
    bone.position.set(0, -0.06, 0.025);
    bone.rotation.z = a;
  }

  // --- 7: the threshold ------------------------------------------------------
  const sillHost = new THREE.Group();
  sillHost.name = "threshold";
  g.add(sillHost);
  if (p.archThreshold === true) {
    const sill = part(box(openW * 0.98, 0.06, depth * 0.9), plankMat, "sill", sillHost);
    sill.position.y = 0.03;
    sill.castShadow = false;
  }

  return g;
}

/** Sun-bleached stone: the rock mixed two thirds of the way toward a pale
 *  warm tan, in sRGB. Measured with `scripts/_scratch-cap-snap.ts`: that lands
 *  a rung up the warm ladder (`bark` to `wood`) for every rock from #8c6a4c to
 *  #b08560. An HSL lift does NOT — three's HSL is in the linear working space,
 *  so a 1.3x lightness there moved the shipped rock's cap nowhere at all and
 *  it rendered the same brown as the stone under it. */
function bleached(hex: number): number {
  return hexOf(mix(rgbOf(hex), rgbOf(0xe0a868), 0.65));
}

/**
 * WHERE THE TUNNEL ARCHES STAND, as live dials.
 *
 * A NAMED MUTABLE TABLE under FENCE_PARAMS' / SURROUND_PARAMS' exact contract:
 * production never writes it, the editor's World tab does, and the editor then
 * writes the values back to THESE literals so the file stays the source of
 * truth. The alternative was threading an options argument through
 * `buildTunnelArches` that every shipped call site would leave empty.
 */
export const ARCH_PARAMS = {
  /**
   * How far the arch's CENTRE sits beyond the board's outer wall face, in
   * world units (1 = one maze tile).
   *
   * Default 0.30 against a default depth of 0.75 puts roughly the inner half
   * of the arch over the board's own edge, which is what makes it read as a
   * portal cut THROUGH the hedge rather than a free-standing frame parked
   * next to it. Push it past depth/2 and the join opens into a visible gap;
   * pull it to 0 and the crown starts eating the first corridor.
   */
  outset: 0.3,
  /** Uniform scale on the placed arch. A tunnel mouth is an EAST/WEST
   *  position, which `_scratch-surround-sightline.ts` reports cannot occlude
   *  the maze at any height — an east prop's shadow travels further east — so
   *  this dial has no camera-safety ceiling behind it and is pure taste. */
  scale: 1,
  /** Fine yaw in radians on top of the axis alignment, for a hand-tuned lean.
   *  Applied symmetrically, so the two mouths always agree. */
  yaw: 0,
  /** Lift off the ground. Negative sinks the feet, which is the honest fix if
   *  a retuned crest ever leaves the arch standing on tiptoe. */
  lift: 0,
};

/** Its own hash band, clear of buildProps (200/201), buildWallDecor (301),
 *  buildHedgeDecor (1-7), groundDetail (401-406), the verge (501) and the
 *  surround (600-639). */
export const ARCH_INSTANCE_HASH_SEED = 701;

/**
 * IDEA-083: the CLEAR OPENING of an arch built from `p`, in the arch's own
 * frame (spanning local X, standing on y = 0): straight sides to `springY`,
 * then the same superellipse head every kind draws with `archCurvePoints`.
 *
 * Pure, and derived from the SAME dials each builder reads, so a retuned
 * `archOpening` / `archRise` / `archCurve` reshapes the tunnel portal with it.
 * The neon gateway and the warp gate spring at `H - rise` (no band); every other kind
 * carries its band above the head and springs `bandT` lower. The figure is the
 * NOMINAL outline — a hedge band's blobs and a gate's posts bulge inside it,
 * which is fine for the portal: it is depth-tested, so whatever of it runs
 * into the arch's own mass is hidden by that mass.
 */
export function archAperture(p: PropParams): {
  hw: number;
  springY: number;
  rise: number;
  curve: number;
} {
  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const wide = p.width ?? 1;
  const hw = (H * (p.archOpening ?? ARCH_DEFAULTS.opening) * wide) / 2;
  const rise = hw * (p.archRise ?? ARCH_DEFAULTS.rise);
  const curve = Math.max(1.05, p.archCurve ?? ARCH_DEFAULTS.curve);
  const springY =
    p.archKind === "neon" || p.archKind === "warp"
      ? H - rise
      : Math.max(0.35, H - rise - H * (p.archCrown ?? ARCH_DEFAULTS.crown));
  return { hw, springY, rise, curve };
}

/** One tunnel mouth: the border tile, and which way out of the board it
 *  faces. `axis` is the axis the beagle TRAVELS along, so the arch has to
 *  span the other one. */
export interface TunnelMouth {
  tx: number;
  ty: number;
  axis: "x" | "z";
  sign: -1 | 1;
}

/**
 * Every border tile that is a TUNNEL.
 *
 * Exported so `scripts/test-archway.ts` can assert against all 36 real mazes
 * the same answer this builder acts on, rather than against a copy of the
 * rule. Reading the grid is the whole point: a hand-authored placement of a
 * fixture like this is a per-THEME fact meeting a per-MAZE layout, which is
 * the shape of IDEA-060's wall-decor defect.
 */
export function tunnelMouths(grid: Grid): TunnelMouth[] {
  const out: TunnelMouth[] = [];
  for (let ty = 0; ty < ROWS; ty++) {
    if (grid.cells[ty][0] === "T") out.push({ tx: 0, ty, axis: "x", sign: -1 });
    if (grid.cells[ty][COLS - 1] === "T") out.push({ tx: COLS - 1, ty, axis: "x", sign: 1 });
  }
  // No maze shipped today has a north or south tunnel, and `Grid` only wraps
  // ROWS — but enumerating them costs two loops and means this builder never
  // needs revisiting if one is ever authored. Enumerating rather than
  // assuming is the same discipline buildWallDecor had to learn the hard way.
  for (let tx = 0; tx < COLS; tx++) {
    if (grid.cells[0][tx] === "T") out.push({ tx, ty: 0, axis: "z", sign: -1 });
    if (grid.cells[ROWS - 1][tx] === "T") out.push({ tx, ty: ROWS - 1, axis: "z", sign: 1 });
  }
  return out;
}

/** Where one mouth's arch stands and how it is turned. Pure, so the test can
 *  check the placement without a renderer. */
export function archTransformFor(m: TunnelMouth): {
  x: number;
  z: number;
  rotationY: number;
} {
  // The board's outer wall FACE, not its tile centre: the wall box at the
  // border spans half a tile past `worldX(tx)`, and the arch is positioned
  // against the face because that is the surface a player sees it meet.
  const out = 0.5 + ARCH_PARAMS.outset;
  if (m.axis === "x") {
    // The beagle travels along X, so the arch spans Z — its local +X must
    // point along world Z, which is a quarter turn.
    return { x: worldX(m.tx) + m.sign * out, z: worldZ(m.ty), rotationY: Math.PI / 2 + ARCH_PARAMS.yaw };
  }
  return { x: worldX(m.tx), z: worldZ(m.ty) + m.sign * out, rotationY: ARCH_PARAMS.yaw };
}

/**
 * The yaw one mouth's arch is placed at, for THIS arch's params.
 *
 * `archTransformFor` turns every arch the same way, which is all a symmetric
 * arch needs. A DIRECTED one (a gate swung open, see `archIsDirected`) opens
 * toward its local +Z, and that turn points +Z out of the board only at a
 * +sign mouth, so the other half are turned round. Swung inward, a gate's
 * leaves would go straight into the maze walls flanking the tunnel. Pure, so
 * `scripts/test-archway.ts` asserts it at every mouth of every maze: the merge
 * that follows in buildTunnelArches leaves nothing to inspect afterwards.
 */
export function archYawFor(m: TunnelMouth, p: PropParams): number {
  return archTransformFor(m).rotationY + (archIsDirected(p) && m.sign < 0 ? Math.PI : 0);
}
