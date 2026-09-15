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
import { lobedFoliageGeometry } from "./foliage";
import { FENCE_H, fencePanelGeometry } from "./fence";
import { lit, rgbOf } from "./paint";

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
function brighten(hex: number, k: number): number {
  const [r0, g0, b0] = lit(rgbOf(hex), k);
  return (Math.round(r0 * 255) << 16) | (Math.round(g0 * 255) << 8) | Math.round(b0 * 255);
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
    color: brighten(pick(greens, (instanceHash * 7.3) % 1), 1.5),
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
