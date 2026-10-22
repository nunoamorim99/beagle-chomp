// OWNER: render-artist (IDEA-066 — the world around the maze)
//
// The things that stand in the surround. NOT library props, and the difference
// is the whole reason this file exists.
//
// A PROP_LIBRARY prop is authored for the apron — one to three tiles from the
// camera, with named parts the editor's part tree can address and its OWN
// materials so `disposePropGroup` is safe. Four hundred of those in the far
// band would cost about five times the triangles, defeat the material dedup
// that makes the surround affordable at all, and put a `makePropFromDef` +
// `applyPropParts` call on the build path four hundred times. The VERGE uses
// library props; that is what the verge is for. The far band does not.
//
// THREE RULES EVERY BUILDER HERE FOLLOWS:
//
// 1. IT TAKES ITS MATERIALS, IT NEVER MAKES THEM. Every mesh must land on a
//    member of the shared `SurroundMaterials` set, because propMerge.ts's
//    `mergeBySignature` collapses the entire surround to one mesh per distinct
//    material. A builder that calls `toon()` for itself still WORKS and still
//    LOOKS right — it just quietly adds draw calls, which is a failure with no
//    visual symptom at all. `scripts/test-surround.ts` asserts the ceiling
//    precisely because review cannot catch that.
//
// 2. NOTHING SMALLER THAN ~0.12 WORLD UNITS. The CARTOON rule ("nothing under
//    a couple of pixels") in 3D: the far band renders at roughly 15-25 px per
//    tile, so 0.12 is about two pixels. No window mullions, no door handles,
//    no roof tiles. A window is ONE dark rectangle.
//
// 3. LOW SEGMENT COUNTS, AS AN AUTHORING DECISION RATHER THAN AN LOD.
//    `THREE.LOD` exists to swap detail as a camera approaches and needs a
//    per-frame update; this camera is FIXED (computeFitDistance floors the
//    dolly, and only portrait moves at all). So there is no runtime LOD to
//    build — the detail is simply chosen once, here. Budgets, as spec inputs:
//    house <= 450 tris, tree <= 280, hedge segment <= 80, shrub <= 90.
import * as THREE from "three";
import { toon } from "./toon";
import { flaredTrunkProfile, lobedFoliageGeometry, trunkGeometry } from "./foliage";
// The distant conifer IS the hero pine at a lower resolution (IDEA-065 v4).
// Importing a sculpt module from here does not breach rule 1: `pineWhorlStack`
// returns GEOMETRY and makes no materials, so the shared set still owns every
// colour in the band.
import { pineWhorlStack } from "./forestProps";
import { mergeGrouped, splitByGroup } from "./propMerge";
import { hexOf, lit, mix, rgbOf } from "./paint";
import { pavingColorFor } from "./floorTexture";


/**
 * The surround's whole palette, as ONE shared set.
 *
 * Seventeen materials for however much geometry the recipes produce — that is
 * what `mergeBySignature` collapses to, and it does not grow with density.
 * Deliberately fewer roles than the board has: distant things should be
 * simpler and more unified than near ones, so this is art direction and a
 * budget at the same time.
 */
export interface SurroundMaterials {
  hedgeLit: THREE.MeshToonMaterial;
  hedgeDark: THREE.MeshToonMaterial;
  foliageLit: THREE.MeshToonMaterial;
  foliageDark: THREE.MeshToonMaterial;
  trunk: THREE.MeshToonMaterial;
  wallLight: THREE.MeshToonMaterial;
  wallDark: THREE.MeshToonMaterial;
  roof: THREE.MeshToonMaterial;
  roofTrim: THREE.MeshToonMaterial;
  glass: THREE.MeshToonMaterial;
  glassPale: THREE.MeshToonMaterial;
  bloomA: THREE.MeshToonMaterial;
  bloomB: THREE.MeshToonMaterial;
  bloomC: THREE.MeshToonMaterial;
  stone: THREE.MeshToonMaterial;
  soil: THREE.MeshToonMaterial;
  groundAccent: THREE.MeshToonMaterial;
  sand: THREE.MeshToonMaterial;
  /** The park lake (IDEA-081). Deep water and the lighter shallows / ripple
   *  marks. Every theme builds them; only the park draws them, and a material
   *  nothing draws costs no draw call after the merge. */
  water: THREE.MeshToonMaterial;
  waterLight: THREE.MeshToonMaterial;
  /** Night City's streets (IDEA-082). The carriageway, a lit window, and a
   *  street tree's two greens. Every theme builds them; only the city draws
   *  them, and a material nothing draws costs no draw call after the merge. */
  asphalt: THREE.MeshToonMaterial;
  windowLit: THREE.MeshToonMaterial;
  streetLeaf: THREE.MeshToonMaterial;
  streetLeafDark: THREE.MeshToonMaterial;
}

/** Everything the set needs off a theme. Kept structural so `src/game` never
 *  has to import this module for anything but the `SurroundKind` type. */
export interface SurroundPaletteInput {
  wall: number;
  surroundGround: number;
  fenceColor: number;
  bloomColors: readonly number[];
  groundDetailColor: number;
}

/**
 * Build the shared set from a theme.
 *
 * Almost every colour is DERIVED from the palette rather than fixed, so a
 * surround harmonises with the board it surrounds without six hand-tuned
 * tables. The hedge and foliage come off `palette.wall` (the theme's own
 * hedge/brick/sand), the lawn accents off `surroundGround`, the timber off
 * `fenceColor`, the flowers off `bloomColors`. The building colours are the
 * exception and are only TINTED by the theme: a house has to read as built
 * rather than grown, so it keeps its own warm-neutral identity.
 */
export function makeSurroundMaterials(p: SurroundPaletteInput): SurroundMaterials {
  const wall = rgbOf(p.wall);
  const ground = rgbOf(p.surroundGround);
  const timber = rgbOf(p.fenceColor);
  const blooms = p.bloomColors.length ? p.bloomColors : [0xf4efe6, 0xd8483f];
  // A hair toward the ground so distant greenery sits in its field rather than
  // standing out as a second, louder green.
  const leaf = mix(wall, ground, 0.18);
  const canopy = mix(leaf, [0.55, 0.72, 0.3], 0.22);
  return {
    hedgeLit: toon({ color: hexOf(lit(leaf, 1.12)) }),
    hedgeDark: toon({ color: hexOf(lit(leaf, 0.74)) }),
    foliageLit: toon({ color: hexOf(lit(canopy, 1.06)) }),
    foliageDark: toon({ color: hexOf(lit(canopy, 0.7)) }),
    trunk: toon({ color: hexOf(lit(timber, 0.78)) }),
    // Also the park avenue's PAVING, so it shares one definition with the
    // walk painted down the board's corridors (floorTexture.ts).
    wallLight: toon({ color: pavingColorFor(p.surroundGround) }),
    wallDark: toon({ color: hexOf(mix([0.72, 0.67, 0.58], ground, 0.14)) }),
    roof: toon({ color: hexOf(mix([0.62, 0.26, 0.2], wall, 0.12)) }),
    roofTrim: toon({ color: hexOf(mix([0.86, 0.82, 0.76], wall, 0.1)) }),
    // TWO glasses, because the two jobs are opposites and one material cannot
    // do both. A WINDOW has to read as an opening in a wall, so it is the
    // darkest thing on the building. A GREENHOUSE is a whole volume of glass
    // with sky behind it, so it has to be the LIGHTEST -- the first build
    // shared the dark one and every greenhouse rendered as a featureless
    // charcoal slab sitting in a garden.
    //
    // Neither is transparent: a pane at this size is one flat rectangle, and
    // transparency would buy a sorting problem for nothing.
    glass: toon({ color: hexOf(mix([0.3, 0.38, 0.42], wall, 0.2)) }),
    glassPale: toon({ color: hexOf(mix([0.79, 0.88, 0.88], ground, 0.12)) }),
    bloomA: toon({ color: blooms[0] }),
    bloomB: toon({ color: blooms[blooms.length - 1] }),
    // A THIRD BLOOM, and it buys exactly one draw call for the whole surround.
    // Every theme's `bloomColors` carries three or four hues and this set was
    // throwing the middle ones away -- garden's [cream, yellow, pink, red]
    // shipped as cream and red only. A flower bed's rank-3 read is that it is
    // MULTICOLOURED (the reference is magenta, red, yellow and white in one
    // clump), and two hues in a mass reads as a two-tone shrub. The measured
    // surround runs 13-14 calls against a ceiling of 18, so the third is
    // affordable; a fourth would not obviously be.
    bloomC: toon({ color: blooms[Math.min(1, blooms.length - 1)] }),
    stone: toon({ color: p.groundDetailColor }),
    // Turned earth, and it needed its own role. The beds first borrowed
    // `trunk`, which is `fenceColor` darkened — a warm WOOD. At review size a
    // field of those reads as scattered red bricks, not as planting. Soil has
    // to be dark AND desaturated: pulled toward the ground it sits in so it
    // stays in the theme's family, then well down in value so the blooms on
    // it have something to stand against.
    soil: toon({ color: hexOf(lit(mix(ground, [0.34, 0.25, 0.18], 0.75), 0.82)) }),
    groundAccent: toon({ color: hexOf(lit(ground, 1.14)) }),
    // BARELY lighter than the ground, and that is the whole point. A dune is
    // made of the same sand it sits on; the only thing separating it is the
    // way light falls on a curve. The first build mixed halfway to a pale
    // sand and every mound came back as a pale BOULDER on a dark plain --
    // a beach that read as a quarry. Value contrast is what made them objects.
    sand: toon({ color: hexOf(mix(ground, [0.92, 0.84, 0.62], 0.18)) }),
    // Fixed blues, only TINTED by the ground, for the buildings' reason: water
    // has to read as water on any lawn. Two values a full step apart, because
    // a lake that is one flat colour is a hole in the ground — the shallows
    // round the edge are what give it a shore and a depth.
    water: toon({ color: hexOf(mix([0.2, 0.47, 0.64], ground, 0.1)) }),
    waterLight: toon({ color: hexOf(mix([0.5, 0.76, 0.84], ground, 0.08)) }),
    // The road has to be DARKER than the ground it crosses, because on the
    // city the ground already IS asphalt-coloured (0x3a3640): a carriageway in
    // the ground's own colour is only its markings floating on nothing.
    asphalt: toon({ color: hexOf(lit(mix(ground, [0.16, 0.16, 0.19], 0.5), 0.72)) }),
    // A lit window is the one thing in a night city that must GLOW, so it is
    // the only material in the set with a real emissive. Warm sodium, the same
    // family as the biscuits and the streetlights.
    windowLit: toon({ color: 0xffd98a, emissive: 0xffb84a, emissiveIntensity: 0.65 }),
    // FIXED greens, only tinted by the ground — the foliage pair is derived
    // from `palette.wall`, which on the city is grey BRICK, so a street tree
    // built from it is a grey-purple lump. A tree has to read as a tree on
    // any street, the water's reasoning.
    streetLeaf: toon({ color: hexOf(mix([0.33, 0.58, 0.32], ground, 0.12)) }),
    streetLeafDark: toon({ color: hexOf(mix([0.2, 0.4, 0.24], ground, 0.12)) }),
  };
}

export function disposeSurroundMaterials(m: SurroundMaterials): void {
  for (const mat of Object.values(m)) mat.dispose();
}

// ---------------------------------------------------------------------------
// Geometry helpers

/**
 * A triangular prism — the gable roof, and the one shape three.js has no
 * primitive for.
 *
 * Built by hand rather than with ExtrudeGeometry on purpose: an extrusion's
 * `bevelSize` grows OUTWARD, so a roof extruded to a measured footprint ends up
 * wider than it, and everything positioned against that footprint ends up
 * inside the result (IDEA-057 lost a nori belt, a grain skirt and a whole face
 * to exactly that). An extrusion is also non-indexed, so its bevel steps cannot
 * be smoothed and the toon ramp quantises them into rectangular patches.
 *
 * Spans x in [-w/2, w/2], y in [0, h], z in [-d/2, d/2], ridge along z.
 *
 * IT EMITS AN UNDERSIDE. A roof that overhangs its box leaves a wedge open at
 * the wall top, which is daylight between roof and wall — the defect IDEA-060
 * had to fix on BOTH garden buildings. Closing it here means no caller can
 * forget.
 */
function gableGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  // 0,1 front base; 2 front apex; 3,4 back base; 5 back apex
  const v = [
    [-x, 0, z],
    [x, 0, z],
    [0, h, z],
    [-x, 0, -z],
    [x, 0, -z],
    [0, h, -z],
  ];
  const tri = [
    [0, 1, 2], // front gable
    [4, 3, 5], // back gable
    [1, 4, 5],
    [1, 5, 2], // right pitch
    [3, 0, 2],
    [3, 2, 5], // left pitch
    [3, 4, 1],
    [3, 1, 0], // underside
  ];
  const pos = new Float32Array(tri.length * 9);
  let o = 0;
  for (const t of tri) {
    for (const i of t) {
      pos[o++] = v[i][0];
      pos[o++] = v[i][1];
      pos[o++] = v[i][2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Add a named mesh to a group, at a position, and return it. */
function part(
  g: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  name: string,
  pos?: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  g.add(m);
  return m;
}

/** Deterministic 0..1 from an integer seed — one more call, one more value. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The builders. Every one returns a Group standing on y = 0.

export type HouseKind = "house" | "shed" | "greenhouse";

/**
 * A neighbour's house, seen over its own hedge.
 *
 * IDEA-066 phase 4, rebuilt from a reference. Proportion base **EW = the EAVES
 * WIDTH**, and every number below is in EW units — not height, because a
 * house's height depends on whether the chimney is in frame and this
 * reference's is. Measurements, the reasoning and every deviation are in
 * `.img2threejs/garden-house/measurements.json`; read that rather than
 * re-deriving these by eye.
 *
 * TWO FEATURES CARRY THE WHOLE IDENTITY at 15-40px, and every number that
 * costs either was cut against them:
 *
 * 1. **WIDER THAN TALL.** The only thing separating this from the three
 *    buildings the cast already has — the treehouse and the log cabin are both
 *    tall-and-narrow, the city tower is a slab.
 * 2. **A CHIMNEY, OFF-CENTRE.** Nothing else in the cast has one. Centred, it
 *    reads as a finial on the ridge rather than as a chimney, so the
 *    reference's -0.09 EW offset is kept almost exactly.
 *
 * **IT SHIPS WIDER THAN THE REFERENCE** — 1.39 against a measured 1.16 — and
 * that is the one deviation worth knowing about. 1.16 reads as SQUARE at
 * twenty pixels, which costs rank 1 entirely. It is bought by flattening the
 * roof (35.8 degrees against a measured 52.4), never by widening the box: a
 * wider box is a hall, and a plot has to hold it. Same shape as IDEA-059's
 * burger, where the reference's own band division did not survive this
 * renderer either.
 *
 * The reference has a main gable, a long left sweep with a dormer AND a front
 * cross-gable. One ridge is what survives; three roof events at this size is
 * mud. A shed is the same builder with no upper storey and no chimney; a
 * greenhouse swaps the walls for pale glass.
 *
 * No colour comes from the reference — it is watermarked stock, and the
 * standing rule is shape evidence only.
 */
export function distantHouse(
  m: SurroundMaterials,
  o: { kind?: HouseKind; eavesWidth?: number; depth?: number; seed?: number } = {},
): THREE.Group {
  const kind = o.kind ?? "house";
  const r = seeded(o.seed ?? 1);
  const g = new THREE.Group();
  // TAGGED, so a test can find the buildings again after the recipe has placed
  // them. `mergeBySignature` welds the whole band into one mesh per material,
  // which is exactly what makes "does this greenhouse sit inside that house"
  // unanswerable from the finished group -- and that defect shipped.
  g.name = `building-${kind}`;

  // EW is the widest horizontal span, and it means the same thing for all
  // three kinds so a caller never has to ask which axis it got.
  const EW = o.eavesWidth ?? (kind === "house" ? 2.15 + r() * 0.75 : 1.5 + r() * 0.45);
  const OVERHANG = 0.035;
  const bodyW = EW * (1 - 2 * OVERHANG);

  // THE GREENHOUSE IS A DIFFERENT BUILDING, measured separately
  // (.img2threejs/garden-greenhouse/measurements.json). Its own base is
  // GW = the GABLE span, read off the reference's near end because that end is
  // face-on and the long axis is buried in perspective. GW = EW / 2 makes it
  // LOW AND LONG — 2.08 wide-over-tall against the house's 1.40 — which is the
  // separator that matters, because the two share a plot and get compared.
  const glass = kind === "greenhouse";
  const GW = EW * 0.5;
  const depth = o.depth ?? (glass ? GW : EW * 0.62); // house depth is an ASSUMPTION: a front elevation shows no plan
  // The plinth is rank 1 and it exists only here.
  const plinthH = glass ? GW * 0.224 : 0;
  // THE DWARF WALL. Measured 0.41 GW, shipped 0.22 -- and the height it gives
  // back is what pays for the steeper roof below. Two reasons it is the right
  // number to take it from. It is the least visible thing on the building from
  // 59 degrees up (a vertical face projects at cos(59) = 0.515 and the roof
  // overhangs it), so a tall one is height spent where nobody is looking; and a
  // real greenhouse IS mostly roof, glazed nearly to the ground above a low
  // brick course, which is what the reference photograph shows. It now stands
  // almost exactly as tall as the plinth under it, so the base reads as one
  // dark band rather than as a storey.
  const wallH = glass ? GW * 0.22 : EW * 0.26;
  // THE MEASURED 0.328 PITCH RENDERS AS A FLAT CARD, and the arithmetic says
  // why. The toon ramp has three texels sampled NEAREST, so a surface lands in
  // the top band whenever `dot(N, L) > 2/3`. The key light sits at (6, 20, 10),
  // i.e. 59.8 degrees up; at a 0.328 rise the two roof slopes measure 0.90 and
  // 0.74 against that light and BOTH clear 2/3 -- so the gable is painted one
  // uniform value and the whole greenhouse reads as a blank white card lying on
  // the grass. Solving `0.864 cos a - 0.259 sin a = 2/3` puts the split at a
  // pitch of 25.6 degrees; 0.52 is 27.5, past it with margin. It costs the
  // wide-over-tall ratio (2.08 measured -> 1.73) and that is worth paying: the
  // house is 1.40, so the two are still plainly the long building and the tall
  // one, and a correct proportion nobody can see is not a proportion.
  // (IDEA-059 rule 2's finding in a new place -- the reference's own division
  // does not survive this renderer.)
  const rise = glass ? GW * 0.52 : EW * 0.36;

  // RANK 1, AND THE REFERENCE VOLUNTEERED IT. The brief asked for a gable and
  // a glazing grid; what actually survives at twenty pixels is that the whole
  // pale box stands on a DARK brick base — roughly three pixels of dark under
  // a pale mass. A glazing bar at that size is nothing; a value step is
  // everything. `soil` is reused rather than adding an eighteenth material:
  // the surround's whole affordability is one mesh per material, so a new role
  // has to earn its draw call and "dark, desaturated, in the theme's family"
  // is exactly what soil already is.
  if (glass) {
    part(g, new THREE.BoxGeometry(bodyW, plinthH, depth), m.soil, "plinth", [0, plinthH / 2, 0]);
  }

  // THE WALLS ARE DARK AND THE ROOF IS PALE, and getting that backwards is
  // why Nuno said *"the greenhouses are not transparent, it's just a small
  // white house."* Both were `glassPale`, so the whole building was one pale
  // mass — which is what a white house is.
  //
  // The photograph he sent settles it, and no drawing would have: a real
  // greenhouse is NOT pale all over. Its ROOF is translucent polycarbonate,
  // opaque and near-white; its WALLS are CLEAR, so what you see through them
  // is the dark interior, the plants and the shaded ground — the walls read
  // as the DARKEST part of the building, not the lightest. The pale-roof /
  // dark-wall split IS the identity at this size, and it costs nothing: both
  // materials already exist.
  //
  // It also buys the separation that matters. A HOUSE is pale walls under a
  // red roof; a greenhouse is now dark walls under a pale one — inverted on
  // both counts, where before they differed only in the roof's hue.
  const wallMat = glass ? m.glass : r() < 0.5 ? m.wallLight : m.wallDark;
  part(g, new THREE.BoxGeometry(bodyW, wallH, depth), wallMat, "body", [0, plinthH + wallH / 2, 0]);

  const eaveY = plinthH + wallH;
  part(g, gableGeometry(EW, rise, depth * 1.08), glass ? m.glassPale : m.roof, "roof", [
    0,
    eaveY,
    0,
  ]);
  if (glass) {
    // THE DARK RIDGE, and it is the half of the fix that cannot fail. The
    // steeper pitch above splits the two slopes into different bands at MOST
    // yaws -- but not at all of them: a ridge pointing along the key light's
    // own azimuth (59 degrees off +x) puts both slopes at the same angle to it
    // whatever the pitch, and the gable goes flat again. A painted line is a
    // colour rather than a shading accident, so it reads at every yaw.
    //
    // It is IDEA-060's pale ridge cap on the house INVERTED -- twelve triangles
    // and the difference between a roof and a lump -- and it costs no draw
    // call, because `m.glass` is already on this building.
    part(
      g,
      new THREE.BoxGeometry(EW * 0.038, EW * 0.032, depth * 1.12),
      m.glass,
      "ridge",
      [0, eaveY + rise, 0],
    );
    // THE DARK PANES, and they are the answer to "it is just a small white
    // house" -- not a glazing grid, which was built and measured and cannot
    // work. At this distance the whole building is ~25 CSS px across, so one
    // world unit is ~15 px and a glazing bar thick enough to READ (2 px, the
    // CARTOON floor) is EW * 0.08 -- four of them would be 59% of the roof.
    // Small detail is simply not available here; what is available is VALUE
    // over a LARGE AREA, which is this project's one reliable lever at board
    // size.
    //
    // So the roof is broken up by whole PANES instead of by the lines between
    // them: a few big rectangles of the dark glass, lying flush on each slope.
    // That is also what a real glasshouse looks like from above -- some panes
    // return the sky and some return the dark interior -- and it is the same
    // construction as the maze wall's own trick, a pale field mottled by a few
    // large darker areas rather than textured by many small ones.
    //
    // FLUSH, not propped. They shipped for one render as vents hinged open at
    // -0.55 rad, and a thin box tilted that far foreshortens from 59 degrees
    // into a TRIANGLE: three black wedges on a white slab, which reads as
    // damage rather than as glazing. A pane lying on the slope stays a
    // rectangle from every yaw.
    const alpha = Math.atan2(rise, EW / 2);
    const sinA = Math.sin(alpha);
    const cosA = Math.cos(alpha);
    const paneL = EW * 0.3; // along the slope, eave-to-ridge
    const paneW = depth * 0.26; // along the ridge
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        // `u` is the fraction of the way UP the slope. Kept off both ends: a
        // pane touching the ridge fuses with the ridge line into one dark
        // blot, and one touching the eave breaks the building's own outline.
        const u = 0.34 + (side > 0 ? 0.3 : 0);
        const px = side * (EW / 2) * (1 - u);
        const py = eaveY + rise * u;
        const pane = part(
          g,
          new THREE.BoxGeometry(paneL, EW * 0.01, paneW),
          m.glass,
          `pane${side > 0 ? "R" : "L"}${i}`,
          [
            px + side * sinA * 0.01,
            py + cosA * 0.01,
            (i - 0.5) * depth * 0.46,
          ],
        );
        pane.rotation.z = -side * alpha;
      }
    }
  }
  if (kind !== "greenhouse") {
    // The eaves band. It is what stops roof and wall closing into one mass on
    // the themes where both take a warm tint.
    part(g, new THREE.BoxGeometry(EW * 1.01, EW * 0.03, depth * 1.11), m.roofTrim, "eaves", [
      0,
      eaveY + EW * 0.012,
      0,
    ]);
    // A PALE RIDGE CAP, and the clay render is what asked for it.
    //
    // At the play camera's 59 degrees of elevation a vertical wall projects at
    // cos(59) = 0.515 of its height while the roof is seen almost in plan — so
    // THE HOUSE IS ITS ROOF from above, and the two windows on the front face
    // contribute nothing at all (they are kept for the shop stage and any
    // lower angle, not for the board). That makes the roof the only surface
    // worth spending identity on, and in clay it was one undifferentiated dark
    // mass with a chimney on it. One pale bar along the ridge is twelve
    // triangles and it is the difference between a roof and a lump.
    //
    // Exactly the fix IDEA-065's log cabin needed for the same reason, and the
    // same lesson as IDEA-059's burger: what the reference emphasises and what
    // this camera shows are different surfaces.
    part(g, new THREE.BoxGeometry(EW * 0.06, EW * 0.035, depth * 1.1), m.roofTrim, "ridge", [
      0,
      eaveY + rise,
      0,
    ]);
  }

  if (kind === "house") {
    // Rank 2. Width and offset are the reference's, near enough exactly; the
    // height is set so the cap clears the RIDGE by 0.10 EW, which is what
    // makes it break the roofline instead of hiding behind it.
    const chimW = EW * 0.1;
    const above = EW * 0.1;
    const chimH = rise + above;
    part(g, new THREE.BoxGeometry(chimW, chimH, chimW), m.wallDark, "chimney", [
      (r() < 0.5 ? -1 : 1) * EW * 0.09,
      eaveY + chimH / 2,
      0,
    ]);
  }

  if (kind !== "greenhouse") {
    // ONE dark rectangle each, per the 0.12-unit floor. Sized from the
    // reference (0.19 x 0.15 EW) and set LOW on the wall, which is where the
    // reference's ground-floor band sits and what keeps the wall from reading
    // as blank above them.
    const ww = EW * 0.19;
    const wh = EW * 0.15;
    for (const sx of [-1, 1]) {
      part(g, new THREE.BoxGeometry(ww, wh, 0.05), m.glass, sx < 0 ? "windowL" : "windowR", [
        sx * EW * 0.24,
        plinthH + wallH * 0.52,
        depth / 2 + 0.01,
      ]);
    }
  } else {
    // A greenhouse reads on its FRAME, so it gets the one exception to "no
    // mullions": three uprights under the 0.12 floor, deliberately — they are
    // not meant to resolve individually, only to break the glass up so it
    // stops reading as a solid block of colour.
    for (const i of [-1, 0, 1]) {
      part(g, new THREE.BoxGeometry(EW * 0.03, wallH, EW * 0.03), m.roofTrim, "mullion" + (i + 1), [
        i * EW * 0.3,
        plinthH + wallH / 2,
        depth / 2,
      ]);
    }
  }
  return g;
}

/**
 * A run of boundary hedge.
 *
 * IDEA-066 phase 4, rebuilt from a reference (measurements in
 * `.img2threejs/garden-hedgerow/measurements.json`). THE BOUNDARIES ARE THE
 * IDEA: a scatter of objects on grass reads as a scatter of objects on grass;
 * the same objects inside hedged plots read as OTHER GARDENS, which is the
 * brief. So this is the most-used builder in the `plots` recipe.
 *
 * FOUR THINGS CARRY IT, and two of them are corrections to earlier builds:
 *
 * 1. **IT IS ONE CONTINUOUS RIDGE.** Blobs must OVERLAP — at a spacing of
 *    2.4x the crown height they merely touched and every boundary rendered as
 *    a dotted line round each plot. And ONE MATERIAL PER RUN: alternating
 *    lit/dark per blob is not shading at this size, it is a CHAIN OF BEADS.
 *    That second one cost 37k triangles to learn, because the first fix tried
 *    was tightening the spacing, which was never the defect.
 *
 * 2. **SECTIONS WITH STEPS BETWEEN THEM**, which is what the reference
 *    actually shows and what replaced the per-blob radius jitter. The hedge's
 *    top is not one line: three visible notches across the run where one
 *    maintained section ends and the next begins, each section fairly flat.
 *    At twenty pixels per-blob jitter is noise; a step is legible, and it
 *    reads as something somebody clips.
 *
 * 3. **ROUNDED TOP CORNERS**, from the lobed field. The maze wall is a
 *    flat-topped BOX, and this must never read as more maze.
 *
 * 4. **HEIGHT IS THE REAL SEPARATOR** and it is a GAME rule, not a measured
 *    one: the caller caps the crown at 0.7 of WALL_H. The reference cannot
 *    supply it — the run recedes and the only scale cue is a tree at another
 *    depth — and it would not matter if it could, because the maze wall is
 *    exactly one tile tall everywhere.
 */
export function distantHedgeRun(
  m: SurroundMaterials,
  o: { length: number; height?: number; seed?: number },
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 2);
  const h = o.height ?? 0.5;
  const mat = r() < 0.5 ? m.hedgeLit : m.hedgeDark;

  // Few, wide, overlapping. Each blob is stretched ALONG the run and squeezed
  // across it, which is both the cross-section a hedge has and what lets a
  // spacing this loose still read as continuous.
  const step = h * 2.4;
  const n = Math.max(2, Math.round(o.length / step) + 1);

  // 2..4 maintained sections, each at its own height. Assigned by blob INDEX
  // rather than by position so a section is a contiguous block of blobs — the
  // whole point is a hard notch between sections and a flat top within one.
  const sections = 2 + Math.floor(r() * 3);
  const sectionH: number[] = [];
  for (let i = 0; i < sections; i++) sectionH.push(1 - (r() - 0.5) * 2 * 0.12);

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = (t - 0.5) * o.length;
    const sec = Math.min(sections - 1, Math.floor(t * sections));
    // The section's own height, plus a little undulation so a section is not
    // machined flat either.
    const hh = h * sectionH[sec] * (1 + (r() - 0.5) * 2 * 0.05);
    const geo = lobedFoliageGeometry(hh * 0.72, {
      detail: 0,
      lobes: 5,
      sharpness: 5,
      amplitude: 0.24,
      scale: [1.5, 1, 0.7],
      seed: 7 + i,
    });
    part(g, geo, mat, "hedge" + i, [x, hh * 0.5, (r() - 0.5) * 0.08]);
  }
  return g;
}

/** A broadleaf: one trunk, one or two lobed crowns. */
export function distantBroadleaf(
  m: SurroundMaterials,
  o: { height?: number; seed?: number; street?: boolean } = {},
): THREE.Group {
  // `street` swaps the crown onto the fixed street greens (see the material
  // set) — the city's own foliage pair is derived from grey brick.
  const leafLit = o.street ? m.streetLeaf : m.foliageLit;
  const leafDark = o.street ? m.streetLeafDark : m.foliageDark;
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 3);
  const h = o.height ?? 1.8 + r() * 1.1;
  const trunkH = h * 0.42;
  part(g, new THREE.CylinderGeometry(h * 0.055, h * 0.085, trunkH, 6), m.trunk, "trunk", [
    0,
    trunkH / 2,
    0,
  ]);
  const rad = h * 0.34;
  part(
    g,
    lobedFoliageGeometry(rad, { detail: 1, lobes: 9, sharpness: 7, amplitude: 0.24, seed: 11 }),
    leafLit,
    "crownA",
    [0, trunkH + rad * 0.78, 0],
  );
  if (r() < 0.65) {
    const r2 = rad * 0.66;
    part(
      g,
      lobedFoliageGeometry(r2, { detail: 0, lobes: 7, sharpness: 6, amplitude: 0.26, seed: 13 }),
      leafDark,
      "crownB",
      [(r() - 0.5) * rad, trunkH + rad * 1.24, (r() - 0.5) * rad],
    );
  }
  return g;
}

/**
 * A conifer — the forest band's workhorse, and 92% of what is in it.
 *
 * IDEA-065 v4, Nuno: *"the deep forest theme the atmosphere are using the old
 * pines, lets change the pines that are on the space around the maze, not in
 * the props area, the ones that are illustrative, lets use the same style as
 * the new pines we have made."* It WAS three stacked `ConeGeometry`s — the
 * exact shape IDEA-065 rebuilt the apron's pine to get away from — so the
 * theme showed two different conifers in one frame, a drooping serrated stack
 * on the apron and a green traffic cone six units behind it.
 *
 * It is now the SAME geometry as `makeForestPine`, through
 * `forestProps.ts`'s `pineWhorlStack`, at the band's own resolution. Three
 * things make that affordable, and they were all measured first
 * (`scripts/_scratch-pine-census.ts`) because the hero pine is ~2,600
 * triangles and the cone stack was 66:
 *
 *  1. **THE GROUPS ARE SPLIT INTO ONE GEOMETRY PER MATERIAL.** The hero's
 *     canopy is one mesh with a material ARRAY, which `mergeBySignature`
 *     skips by contract — so dropped in as-is, every tree would have survived
 *     the band's merge whole and cost a draw call per group (IDEA-067 rule 7).
 *     585 trees, ~1,200 draw calls, against a band that spends 6. Split, it
 *     welds into the same one-mesh-per-material batch as everything else and
 *     the forest band stays at SIX calls.
 *  2. **THE RESOLUTION COMES DOWN, THE WHORL COUNT BARELY.** A band tree is
 *     ~45px tall, so the azimuth count and the cross-section are nearly free
 *     to cut — two segments per tooth, four teeth, and a profile of hub, rim
 *     and one return ring. The WHORL COUNT is the one knob that is not free
 *     (rule 2: spacing over reach must stay under ~0.45 or the stack reads as
 *     mushroom caps), so it only goes 8 -> 7, which is 0.345. ~280 triangles.
 *  3. **THE WOOD IS THINNED TO HOLD ITS COVERAGE** — see `woodlandContent`.
 *
 * `detail: 1` is for the SHOWCASE ring, which is a different problem: that
 * camera sits at 9-33 degrees rather than 59, so the trees are seen nearly
 * level, from below the crown, and much larger on screen (IDEA-072 found a
 * detail-0 blob reading as a pale hexagon out there). It buys back the convex
 * shoulder and a finer rim.
 */
export function distantConifer(
  m: SurroundMaterials,
  o: { height?: number; seed?: number; detail?: 0 | 1 } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 4);
  const h = o.height ?? 2.2 + r() * 1.4;
  const near = (o.detail ?? 0) === 1;
  const shape = pineWhorlStack({
    height: h,
    // `width === height` is the measured 0.718 aspect, which is 1.2x wider
    // than the cone stack this replaces at the same height.
    width: h,
    whorls: 7,
    teeth: near ? 6 : 4,
    segsPerTooth: 2,
    profileDetail: near ? 1 : 0,
    spirePoints: 3,
    rnd: r,
  });

  // Short, flared, mostly buried: the few pixels of warm brown under the
  // bottom skirt that stop the tree reading as a cut-out. Two flare steps and
  // five sides out here, against the hero's five and eight.
  part(
    g,
    trunkGeometry(flaredTrunkProfile(shape.trunkTopRadius, shape.trunkHeight, 2.4, 2), 5),
    m.trunk,
    "trunk",
  );

  // LIT TOP OVER SHADED UNDERSIDE, exactly as the hero pine has it — and NOT
  // the alternating whole skirts the cone stack used, which was built here,
  // rendered, and cut.
  //
  // The argument for alternating was sound on paper and worth recording: the
  // band CASTS NO SHADOWS (`ensureSurround` turns `castShadow` off for the
  // whole batch, because the merged band spans the ground plane and overlaps
  // the key light's shadow camera), so a band tree cannot borrow the
  // self-shading that gives the apron's pine its depth, and the old conifer
  // painted its value structure in instead. Rendered, it is the WORSE read of
  // the two and the reason is a rhythm rather than an amount: what defines a
  // tier from above is the hard dark LINE at its rim, which exists because
  // the order down the tree is lit top, dark underside, lit top. Darken every
  // other skirt's top and half those rims become dark-under-dark, the line
  // disappears, and the stack smooths back into a cone with a crinkly edge —
  // i.e. the alternation costs the tiers in order to add value, which is the
  // opposite of the trade it looks like.
  const canopy = mergeGrouped(shape.geos, [m.foliageLit, m.foliageDark], shape.transforms);
  const [lit, dark] = splitByGroup(canopy);
  canopy.dispose();
  if (lit) part(g, lit, m.foliageLit, "canopyLit");
  if (dark) part(g, dark, m.foliageDark, "canopyDark");
  return g;
}

/** Two or three lobed blobs — the filler that keeps a plot from being a lawn. */
export function distantShrubClump(
  m: SurroundMaterials,
  o: { radius?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 5);
  const rad = o.radius ?? 0.3 + r() * 0.2;
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const rr = rad * (0.6 + r() * 0.5);
    part(
      g,
      lobedFoliageGeometry(rr, { detail: 0, lobes: 6, sharpness: 6, amplitude: 0.25, seed: 17 + i }),
      i % 2 === 0 ? m.hedgeLit : m.hedgeDark,
      "blob" + i,
      [(r() - 0.5) * rad * 1.6, rr * 0.8, (r() - 0.5) * rad * 1.6],
    );
  }
  return g;
}

/**
 * A FLOWERING BORDER: a low run of planting whose whole surface is the flower,
 * in blocks of two or three colours.
 *
 * From Nuno's reference (`.img2threejs/reference/flowershrub/image.png`, a
 * border of forsythia, berberis, aubretia, spiraea and astilbe). Two things
 * the photograph says, and the second one cost a build to learn.
 *
 *  1. ON A SHRUB IN FULL FLOWER THERE IS NO GREEN LEFT. Each plant is a solid
 *     block of one saturated colour and the border reads as slabs of poster
 *     paint. That is an ideal subject for this renderer -- pure hue over a
 *     large area, no detail needed at all.
 *  2. IT IS A BORDER, NOT A SET OF SHRUBS. The first build was exactly what
 *     the brief sounded like: an object called a flowering shrub, a drift of
 *     two or three of them, scattered through the plots. Rendered, a saturated
 *     mass 0.9 units tall standing alone on a lawn reads as LITTER -- a red
 *     crisp packet, a yellow bag -- and the faceting of a detail-0 icosphere,
 *     which green-on-green hides completely, is glaring the moment the colour
 *     is loud. The colour has to be LOW and LONG and CONTINUOUS before it
 *     reads as something planted.
 *
 * So it is built on `distantHedgeRun`'s skeleton rather than on
 * `distantShrubClump`'s: few, wide, heavily overlapping blobs along a line,
 * stretched along the run and squeezed across it. The one difference is that
 * the sections vary by HUE instead of by height, which is the same
 * contiguous-block construction doing a different job -- and it is the one
 * place in this file where alternating material per blob would be right and
 * still is not, because a hue that changes every blob is a string of beads in
 * colour rather than in light.
 *
 * Height is a GAME rule like the hedgerow's: at 0.26 it is about a quarter of
 * the maze wall, which is what keeps a loud colour reading as a border rather
 * than as a second, brighter hedge.
 */
export function distantFlowerBorder(
  m: SurroundMaterials,
  o: { length?: number; height?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 12);
  const h = o.height ?? 0.22 + r() * 0.08;
  const length = o.length ?? 1.4 + r() * 0.8;

  // FEWER AND MUCH WIDER THAN THE HEDGE RUN'S, and this is the number that
  // decides whether it is a border or a caterpillar. The hedge gets away with
  // a step of 2.4h against a blob 2.16h wide -- a hair under continuous --
  // because it is green on green and a seam between two greens is invisible.
  // Here the two neighbours are DIFFERENT SATURATED HUES, so every gap is a
  // hard edge and the first build rendered as a string of red beads. At a
  // 2.8 stretch the blob spans 4.4h against a 2.0h step: better than a
  // 2x overlap, and it uses fewer blobs than the tight version did.
  const step = h * 2.0;
  const n = Math.max(3, Math.round(length / step) + 1);

  // Two or three colour blocks, assigned by blob INDEX so each is a contiguous
  // run. Neighbours are forced apart in the palette: `bloomColors` is ordered
  // and adjacent entries are the closest hues in it, so a border that happened
  // to roll two neighbours is a border of one colour with a seam in it.
  const hues = [m.bloomA, m.bloomC, m.bloomB];
  const blocks = 2 + Math.floor(r() * 2);
  const blockHue: THREE.MeshToonMaterial[] = [];
  let last = Math.floor(r() * 3) % 3;
  for (let i = 0; i < blocks; i++) {
    if (i > 0) last = (last + 1 + Math.floor(r() * 2)) % 3;
    blockHue.push(hues[last]);
  }

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hh = h * (1 + (r() - 0.5) * 2 * 0.14);
    const geo = lobedFoliageGeometry(hh * 0.78, {
      detail: 0,
      lobes: 6,
      sharpness: 6,
      amplitude: 0.26,
      // ACROSS the run as well as along it. At 0.95 the border came out a
      // 0.33-wide RIBBON two units long, which reads as a painted stripe or a
      // path rather than as planting -- and the pale hue read as concrete.
      // The reference's borders are roughly a third as deep as they are long;
      // 1.9 puts this one at ~0.65 deep, which is a BAND.
      scale: [2.8, 0.85, 1.9],
      seed: 41 + i,
    });
    part(g, geo, blockHue[Math.min(blocks - 1, Math.floor(t * blocks))], "flower" + i, [
      (t - 0.5) * length,
      hh * 0.5,
      (r() - 0.5) * 0.09,
    ]);
  }
  return g;
}

/**
 * A flower bed: a KERBED bed of dense, multicoloured planting.
 *
 * REBUILT from Nuno's reference (`.img2threejs/reference/flowerbed/image.png`,
 * a circular bed with a chunky pale stone kerb, dark mulch, a packed mass of
 * magenta/red/yellow/white blooms and a small tree in the middle) after his
 * note that *"the flower beds don't look like flowers."* He was right, and the
 * previous build explains why: a brown RECTANGLE carrying four small spheres
 * of two colours, spaced apart. Four separated dots on dirt read as pebbles.
 *
 * Three things carry it at fifteen pixels, in rank order, and all three are
 * about VALUE AND HUE OVER AN AREA rather than about detail:
 *
 *  1. IT IS ROUND. Every other object out here is a rectangle -- houses,
 *     greenhouses, plots, hedgerow runs. A disc is instantly not a building,
 *     which is most of the recognition done before any colour arrives.
 *  2. A PALE RING AROUND A DARK INTERIOR. The same two-mass trick as the
 *     greenhouse's brick plinth, and the reference volunteers it just as
 *     plainly: stone kerb, mulch inside. It is the one edge treatment that
 *     survives, where a scalloped brick pattern is nothing.
 *  3. THE BLOOMS ARE ONE PACKED MASS, NOT A SCATTER, AND THEY ARE THREE HUES.
 *     Placed on a golden-angle spiral with `sqrt(t)` radii so they distribute
 *     evenly BY AREA and overlap into a single form -- `distantHedgeRun`'s own
 *     rule (few, wide, heavily overlapping) with the one amendment that here
 *     alternating COLOUR is the feature rather than the string-of-beads defect,
 *     because what is alternating is hue and not the light on one hue.
 *
 * It stays ELLIPTICAL rather than strictly circular because two callers ask
 * for a long shallow border (1.5 x 0.55) as well as a round island, and an
 * oval bed with a stone edge is a real thing. The centre tree is only planted
 * on a roughly round one -- a sapling in the middle of a 3:1 border is not.
 */
export function distantBed(
  m: SurroundMaterials,
  o: { width?: number; depth?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 6);
  const w = o.width ?? 0.85 + r() * 0.45;
  const d = o.depth ?? w * (0.82 + r() * 0.3);
  const rx = w / 2;
  const rz = d / 2;
  const kerbH = 0.085;

  // The kerb: an OPEN-ENDED cylinder, so it is twenty-eight triangles rather
  // than a solid with two caps nobody can see. Scaled on the mesh rather than
  // on the group, so the blooms inside it stay spherical.
  const kerb = part(
    g,
    new THREE.CylinderGeometry(1, 1, kerbH, 14, 1, true),
    m.stone,
    "kerb",
    [0, kerbH / 2, 0],
  );
  kerb.scale.set(rx, 1, rz);

  // The mulch, inset and sitting just below the kerb's top edge so the pale
  // ring is a RING rather than a disc with a darker disc laid on it.
  const soil = part(g, new THREE.CircleGeometry(1, 14), m.soil, "soil", [0, kerbH * 0.8, 0]);
  soil.rotation.x = -Math.PI / 2;
  soil.scale.set(rx * 0.93, rz * 0.93, 1);

  const bloomMats = [m.bloomA, m.bloomC, m.bloomB];
  const n = 6 + Math.floor(r() * 3);
  const unit = Math.min(rx, rz);
  for (let i = 0; i < n; i++) {
    // Golden angle + sqrt radius: the standard even-area disc packing. An
    // `r()`-scattered version leaves holes and clumps at this count, and a
    // hole in a flower bed reads as a bald patch of mulch.
    const ang = i * 2.3999632;
    const rad = Math.sqrt((i + 0.6) / n) * 0.66;
    const br = unit * (0.31 + r() * 0.09);
    const b = part(
      g,
      new THREE.SphereGeometry(br, 5, 3),
      bloomMats[i % 3],
      "bloom" + i,
      [Math.cos(ang) * rad * rx, kerbH * 0.8 + br * 0.42, Math.sin(ang) * rad * rz],
    );
    // Flattened, because a bed is a low cushion of colour seen from above and
    // full spheres out here read as a bowl of marbles.
    b.scale.y = 0.6;
  }

  // The reference's centre sapling. It is what stops a round bed reading as a
  // paved circle or a pond, and it is the only vertical the object has.
  const roundish = rx / rz > 0.7 && rx / rz < 1.4;
  if (roundish && r() < 0.62) {
    const stemH = unit * 0.9;
    part(g, new THREE.CylinderGeometry(unit * 0.07, unit * 0.09, stemH, 5), m.trunk, "stem", [
      0,
      kerbH + stemH / 2,
      0,
    ]);
    const crown = part(
      g,
      new THREE.SphereGeometry(unit * 0.48, 6, 4),
      m.foliageLit,
      "crown",
      [0, kerbH + stemH + unit * 0.3, 0],
    );
    crown.scale.y = 0.78;
  }
  return g;
}

/**
 * A PICKET FENCE RUN — the garden's plot boundary (IDEA-083), built along its
 * local +X, centred, standing on y = 0. Same frame as `distantHedgeRun`, so
 * the same `atan2(-dz, dx)` aims it.
 *
 * Nuno: *"we can make some fences too and have like squares that have these
 * components inside."* A hedge round every plot said OTHER PEOPLE'S GARDENS
 * when each one held a house; with the houses gone it said nothing, and a
 * timber fence is what still reads as somebody's plot. It is the maze's own
 * fence family — `fenceColor`, darker rails behind the pickets — because
 * IDEA-060 rule 2 holds at every distance: a gap only reads as a gap if
 * something darker steps across it, and brown-on-brown is a skirting board.
 *
 * Boxes, not fence.ts's domed pickets: that panel is 152 triangles a tile,
 * tuned for 25px a face, and a plot perimeter is ~26 tiles. A dome on a
 * 3px-wide picket is nothing. Pitch 0.3 against a 0.12 picket keeps both the
 * picket and the gap at or above rule 2's floor.
 */
export function distantPicketFence(
  m: SurroundMaterials,
  o: { length: number; height?: number; seed?: number; rail?: boolean },
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 21);
  const h = o.height ?? 0.4;
  // `rail` is the far plots' POST-AND-RAIL fence: posts and two rails, no
  // pickets. It is a garden fence in its own right rather than a degraded
  // picket one, and it is what lets the far band stay fenced — a picket run
  // is ~280 triangles every seven units, and past `detailReach` a picket is a
  // pixel and its gap is nothing.
  const pitch = o.rail ? 2.2 : 0.33;
  const n = Math.max(1, Math.round(o.length / pitch));
  for (let i = 0; i <= n; i++) {
    // Posts at both ends and every fifth picket: a little taller and thicker,
    // which is what turns a comb into a fence built in bays.
    const post = o.rail || i === 0 || i === n || i % 5 === 0;
    const w = post ? 0.13 : 0.11;
    const hh = h * (post ? 1.12 : 1 + (r() - 0.5) * 0.04);
    part(g, new THREE.BoxGeometry(w, hh, post ? 0.09 : 0.05), m.trunk, "picket" + i, [
      (i / n - 0.5) * o.length,
      hh / 2,
      0,
    ]);
  }
  // Two rails. Behind the pickets on a picket fence, so they show only
  // through the gaps; through the posts' centre on a post-and-rail, where
  // they ARE the fence and take the timber colour.
  for (const [k, f] of [0.32, 0.74].entries()) {
    part(
      g,
      new THREE.BoxGeometry(o.length, o.rail ? 0.07 : 0.06, 0.04),
      o.rail ? m.trunk : m.soil,
      "rail" + k,
      [0, h * f, o.rail ? 0 : -0.045],
    );
  }
  return g;
}

/**
 * A FLOWERING SHRUB — a shrub clump wearing its blooms (IDEA-083).
 *
 * One hue per shrub, as a real flowering shrub is: a mix of colours on one
 * bush reads as confetti. The blooms sit on the UPPER half of each blob,
 * pushed past the lobed surface's mean so they are not swallowed by it — the
 * lobe field reaches about 1.25x the nominal radius, so some still sink into
 * a lobe, which reads as flowers among leaves rather than as a defect.
 */
export function distantFloweringShrub(
  m: SurroundMaterials,
  o: { radius?: number; seed?: number } = {},
): THREE.Group {
  const g = distantShrubClump(m, o);
  const r = seeded((o.seed ?? 5) + 7919);
  const hue = [m.bloomA, m.bloomB, m.bloomC][Math.floor(r() * 3) % 3];
  const blobs = g.children.slice();
  let k = 0;
  for (const blob of blobs) {
    const geo = (blob as THREE.Mesh).geometry;
    geo.computeBoundingSphere();
    const rr = geo.boundingSphere!.radius / 1.25;
    const count = 3 + Math.floor(r() * 2);
    for (let i = 0; i < count; i++) {
      const az = r() * Math.PI * 2;
      const el = 0.35 + r() * 0.9; // radians above the equator
      const d = rr * 1.02;
      const b = part(
        g,
        // An octahedron: eight triangles, and at a few pixels a bloom's
        // outline is not something anyone can count the sides of.
        new THREE.OctahedronGeometry(rr * 0.4, 0),
        hue,
        "bloom" + k++,
        [
          blob.position.x + Math.cos(az) * Math.cos(el) * d,
          blob.position.y + Math.sin(el) * d,
          blob.position.z + Math.sin(az) * Math.cos(el) * d,
        ],
      );
      b.scale.y = 0.7;
    }
  }
  return g;
}

/** The five flowers the Props tab authors, in the order a patch rolls them. */
export const PATCH_FLOWER_IDS = [
  "flower-daisy",
  "flower-tulip",
  "flower-rose",
  "flower-sunflower",
  "flower-blossom",
] as const;

/** A recognisable flower: the hero prop's SHAPE, built by the caller. */
export type FlowerMaker = (id: string, hash: number, petal: number, centre: number) => THREE.Group;

const PETAL_SENTINEL = 0x010203;
const CENTRE_SENTINEL = 0x040506;
const SEED_BROWN = 0x4a2c17;

/**
 * A FLOWER PATCH: a bed of one of the Props tab's five real flowers (IDEA-083,
 * Nuno: *"we can make some groups of flowers using the ones we have on the
 * props"*).
 *
 * THE ONE PLACE THIS FILE USES A LIBRARY SHAPE, AND RULE 1 STILL HOLDS. The
 * flowers come from `makeGardenFlower` — the same daisy, tulip, rose,
 * sunflower and blossom the apron plants — but every material they build is
 * swapped onto the shared set and the originals disposed, so the patch costs
 * no draw call of its own. To know which material is which without reaching
 * into the factory, the petal and centre are built in two SENTINEL colours and
 * identified by those; everything else is foliage, bar the sunflower's seed
 * disc. The flower itself is passed in (`make`) so this module never imports
 * the prop library and its own call graph stays the band's.
 *
 * Colour comes from the theme's `bloomColors`, not the flower's authored
 * petals, for the same reason: an authored petal is a sixth material.
 *
 * A leafy cushion under it, because a flower standing alone on lawn at this
 * size reads as litter (IDEA-071 rule 6) and a clump of them reads as planted.
 */
export function distantFlowerPatch(
  m: SurroundMaterials,
  make: FlowerMaker,
  o: { radius?: number; count?: number; seed?: number; flowerScale?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 31);
  const rad = o.radius ?? 0.5 + r() * 0.2;
  const n = o.count ?? 5 + Math.floor(r() * 3);
  const fs = o.flowerScale ?? 2.6;
  const id = PATCH_FLOWER_IDS[Math.floor(r() * PATCH_FLOWER_IDS.length) % PATCH_FLOWER_IDS.length];

  // Petal hue by flower, so the shape and the colour agree with what the
  // Props tab shows: a daisy is cream, a sunflower gold, the rest red.
  const petal =
    id === "flower-daisy" ? m.bloomA : id === "flower-sunflower" ? m.bloomC : m.bloomB;
  const centre = petal === m.bloomC ? m.soil : id === "flower-daisy" ? m.bloomC : m.bloomA;

  // A LOW CUSHION OF LEAVES, not a soil disc. The disc was the first build
  // and under the matcap a flat face aimed at the sky returns the matcap's
  // brightest texel whatever colour it is given, so dark mulch rendered
  // CREAM and every patch read as a plate of fruit. A flattened lobed mound
  // has normals turning away from the camera all round it, and reads as the
  // foliage the flowers grow out of.
  const bed = part(
    g,
    lobedFoliageGeometry(1, { detail: 0, lobes: 5, sharpness: 5, amplitude: 0.22, seed: 3 }),
    m.hedgeDark,
    "bed",
    [0, 0, 0],
  );
  bed.scale.set(rad * 1.1, 0.11, rad * (0.85 + r() * 0.25));

  const pS = new THREE.Color(PETAL_SENTINEL);
  const cS = new THREE.Color(CENTRE_SENTINEL);
  const seedC = new THREE.Color(SEED_BROWN);
  const spent = new Set<THREE.Material>();
  for (let i = 0; i < n; i++) {
    const ang = i * 2.3999632 + r() * 0.3;
    const d = Math.sqrt((i + 0.5) / n) * rad * 0.82;
    const f = make(id, Math.floor(r() * 1e6), PETAL_SENTINEL, CENTRE_SENTINEL);
    f.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshToonMaterial;
      spent.add(src);
      mesh.material = src.color.equals(pS)
        ? petal
        : src.color.equals(cS)
          ? centre
          : src.color.equals(seedC)
            ? m.soil
            : m.hedgeDark;
    });
    f.position.set(Math.cos(ang) * d, 0, Math.sin(ang) * d);
    f.scale.multiplyScalar(fs * (0.88 + r() * 0.24));
    f.name = "flower" + i;
    g.add(f);
  }
  for (const mat of spent) mat.dispose();
  return g;
}

/** A city block: a slab with a window grid. The one recipe whose regularity is
 *  correct rather than a smell. */
export function distantTower(
  m: SurroundMaterials,
  o: { height?: number; width?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 7);
  const h = o.height ?? 2.5 + r() * 3.5;
  const w = o.width ?? 1.2 + r() * 0.8;
  const d = w * (0.7 + r() * 0.5);
  part(g, new THREE.BoxGeometry(w, h, d), r() < 0.5 ? m.wallDark : m.wallLight, "block", [
    0,
    h / 2,
    0,
  ]);
  const rows = Math.max(2, Math.floor(h / 0.55));
  const cols = Math.max(2, Math.floor(w / 0.42));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (r() < 0.35) continue; // an unlit window is just wall
      part(
        g,
        new THREE.BoxGeometry((w / cols) * 0.45, (h / rows) * 0.4, 0.04),
        m.glass,
        "win" + y + "_" + x,
        [(x + 0.5 - cols / 2) * (w / cols), (y + 0.6) * (h / rows), d / 2 + 0.01],
      );
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Night City's streets (IDEA-082). Laid out by cityLayout.ts.
//
// Nuno: *"the building look too basic and we have a lack of details."* The
// tower above is a slab with a window grid, and a slab reads as a slab however
// many windows it carries — at 15-40px what separates a BUILDING from a box is
// that it has a bottom, a top and a front: a shopfront at street level, a
// cornice where it stops, and something on the roof. Those three are what
// `distantCityBuilding` adds, and every one is a value step large enough to
// survive the board camera rather than a detail that needs magnifying.

/** Lit and dark windows on one face, as thin plates a hair proud of it.
 *  `along` is the face's width, `across` sets which axis it lies on. */
function windowGrid(
  g: THREE.Group,
  m: SurroundMaterials,
  r: () => number,
  o: {
    face: "front" | "left" | "right";
    along: number;
    y0: number;
    y1: number;
    /** Distance from the building's centre to this face. */
    off: number;
    litShare: number;
    tag: string;
  },
): void {
  const floorH = 0.5;
  const rows = Math.max(1, Math.floor((o.y1 - o.y0) / floorH));
  const cols = Math.max(1, Math.floor(o.along / 0.42));
  const pitchY = (o.y1 - o.y0) / rows;
  const pitchA = o.along / cols;
  const ww = Math.max(0.13, pitchA * 0.5);
  const wh = Math.max(0.13, pitchY * 0.46);
  for (let y = 0; y < rows; y++) {
    for (let a = 0; a < cols; a++) {
      const lit = r() < o.litShare;
      // Most dark windows are simply wall: a full grid of dark plates reads as
      // a chequerboard, while lit ones scattered on a plain face read as people
      // at home.
      if (!lit && r() < 0.45) continue;
      const along = (a + 0.5 - cols / 2) * pitchA;
      const yy = o.y0 + (y + 0.55) * pitchY;
      const mat = lit ? m.windowLit : m.glass;
      const name = `${o.tag}win${y}_${a}`;
      // A PLANE, not a box: two triangles against twelve, and a window is only
      // ever seen from outside. The city carries ~150 buildings at the
      // surround's full extent and the windows were 80% of its triangles.
      if (o.face === "front") {
        part(g, new THREE.PlaneGeometry(ww, wh), mat, name, [along, yy, o.off + 0.012]);
      } else {
        const s = o.face === "right" ? 1 : -1;
        const pane = part(g, new THREE.PlaneGeometry(ww, wh), mat, name, [s * (o.off + 0.012), yy, along]);
        // Ry(t) sends the plane's +Z normal to (sin t, cos t).
        pane.rotation.y = s * (Math.PI / 2);
      }
    }
  }
}

/**
 * A downtown building with a FRONT (local +Z), a shopfront at street level, a
 * cornice and roof clutter. Stands on y = 0, centred on the origin.
 *
 * Three reads, in order: the lit windows (it is night — a dark facade with a
 * few warm squares is what a city at night IS), the shopfront band with its
 * coloured awning (the one place the theme's neon lands on a building), and
 * the cornice line where the mass stops, which is what turns a box into
 * architecture at twenty pixels. A water tank or a plant room on the roof
 * breaks the skyline so a row of these is not a row of identical lids.
 */
export function distantCityBuilding(
  m: SurroundMaterials,
  o: { height?: number; width?: number; depth?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  g.name = "city-building";
  const r = seeded(o.seed ?? 21);
  const h = o.height ?? 2.6 + r() * 2.6;
  const w = o.width ?? 1.8 + r() * 0.9;
  const d = o.depth ?? 1.5 + r() * 0.7;
  const bodies = [m.wallDark, m.wallLight, m.roof];
  const body = bodies[Math.floor(r() * bodies.length)];
  const base = 0.55;

  // Street level: a darker plinth, recessed glazing and an awning over it.
  part(g, new THREE.BoxGeometry(w, base, d), m.glass, "plinth", [0, base / 2, 0]);
  part(g, new THREE.BoxGeometry(w * 0.82, base * 0.62, 0.04), m.windowLit, "shopfront", [
    0,
    base * 0.4,
    d / 2 + 0.01,
  ]);
  const awnings = [m.bloomA, m.bloomB, m.bloomC];
  part(g, new THREE.BoxGeometry(w * 0.86, 0.06, 0.26), awnings[Math.floor(r() * 3)], "awning", [
    0,
    base * 0.82,
    d / 2 + 0.12,
  ]);

  // The body, sitting on a ledge that marks where the shop ends.
  part(g, new THREE.BoxGeometry(w + 0.06, 0.07, d + 0.06), m.roofTrim, "ledge", [0, base + 0.035, 0]);
  part(g, new THREE.BoxGeometry(w * 0.96, h - base, d * 0.96), body, "body", [0, base + (h - base) / 2, 0]);
  const litShare = 0.35 + r() * 0.25;
  windowGrid(g, m, r, { face: "front", along: w * 0.96, y0: base + 0.1, y1: h - 0.15, off: (d * 0.96) / 2, litShare, tag: "f" });
  windowGrid(g, m, r, { face: "left", along: d * 0.96, y0: base + 0.1, y1: h - 0.15, off: (w * 0.96) / 2, litShare, tag: "l" });
  windowGrid(g, m, r, { face: "right", along: d * 0.96, y0: base + 0.1, y1: h - 0.15, off: (w * 0.96) / 2, litShare, tag: "r" });
  part(g, new THREE.BoxGeometry(w + 0.12, 0.12, d + 0.12), m.roofTrim, "cornice", [0, h + 0.06, 0]);

  // A setback tier on the taller ones, so the skyline steps.
  let top = h + 0.12;
  if (h > 3.8 && r() < 0.6) {
    const th = 0.7 + r() * 0.6;
    part(g, new THREE.BoxGeometry(w * 0.62, th, d * 0.62), body, "tier", [0, top + th / 2, 0]);
    windowGrid(g, m, r, { face: "front", along: w * 0.62, y0: top + 0.05, y1: top + th - 0.05, off: (d * 0.62) / 2, litShare, tag: "t" });
    part(g, new THREE.BoxGeometry(w * 0.66, 0.1, d * 0.66), m.roofTrim, "tierCornice", [0, top + th + 0.05, 0]);
    top += th + 0.1;
  } else {
    // Roof clutter on a flat roof: a plant room, and sometimes a water tank.
    part(g, new THREE.BoxGeometry(w * 0.32, 0.22, d * 0.3), m.stone, "plantRoom", [
      (r() - 0.5) * w * 0.4,
      top + 0.11,
      -d * 0.18,
    ]);
    if (r() < 0.45) {
      const tx = (r() < 0.5 ? -1 : 1) * w * 0.24;
      const tz = d * 0.12;
      for (const s of [-1, 1]) {
        part(g, new THREE.BoxGeometry(0.05, 0.2, 0.05), m.trunk, s < 0 ? "tankLegL" : "tankLegR", [
          tx + s * 0.11,
          top + 0.1,
          tz,
        ]);
      }
      part(g, new THREE.CylinderGeometry(0.17, 0.17, 0.3, 8), m.trunk, "tank", [tx, top + 0.35, tz]);
      part(g, new THREE.ConeGeometry(0.2, 0.14, 8), m.wallDark, "tankCap", [tx, top + 0.57, tz]);
    }
  }
  g.userData.top = top;
  return g;
}

export type VehicleKind = "car" | "taxi" | "bus";

/**
 * A car, a taxi or a bus. Long axis along local +X, which is FORWARD: the
 * headlights are on +X and the tail lights on -X.
 *
 * From 59 degrees above a car is mostly its ROOF and BONNET, so the body
 * colour carries it and the dark cabin glass between the two is what says
 * "car" rather than "box". The wheels barely show and are kept anyway — they
 * are what stops it reading as a brick lying in the road at any lower angle.
 */
export function distantCar(
  m: SurroundMaterials,
  o: { kind?: VehicleKind; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 31);
  const kind = o.kind ?? "car";
  g.name = "city-" + kind;
  const wheelR = 0.12;
  const wheel = (x: number, z: number, i: number): void => {
    const wm = part(g, new THREE.CylinderGeometry(wheelR, wheelR, 0.08, 8), m.glass, "wheel" + i, [x, wheelR, z]);
    wm.rotation.x = Math.PI / 2;
  };
  const lamps = (L: number, W: number, y: number): void => {
    for (const s of [-1, 1]) {
      part(g, new THREE.BoxGeometry(0.04, 0.08, 0.14), m.windowLit, s < 0 ? "headL" : "headR", [L / 2 + 0.01, y, s * W * 0.3]);
      part(g, new THREE.BoxGeometry(0.04, 0.08, 0.14), m.roof, s < 0 ? "tailL" : "tailR", [-L / 2 - 0.01, y, s * W * 0.3]);
    }
  };

  if (kind === "bus") {
    const L = 2.5;
    const W = 0.72;
    const H = 0.78;
    part(g, new THREE.BoxGeometry(L, H, W), m.bloomC, "body", [0, 0.1 + H / 2, 0]);
    // One long window band each side and a windscreen: a bus at this size is a
    // long box with a dark stripe round it.
    part(g, new THREE.BoxGeometry(L * 0.86, 0.22, W + 0.02), m.glass, "windows", [-L * 0.04, 0.1 + H * 0.68, 0]);
    part(g, new THREE.BoxGeometry(0.04, 0.26, W * 0.84), m.glass, "windscreen", [L / 2 + 0.01, 0.1 + H * 0.66, 0]);
    part(g, new THREE.BoxGeometry(L * 0.94, 0.05, W * 0.9), m.roofTrim, "roof", [0, 0.1 + H + 0.025, 0]);
    lamps(L, W, 0.24);
    [-L * 0.32, L * 0.32].forEach((x, i) => {
      wheel(x, W / 2, i * 2);
      wheel(x, -W / 2, i * 2 + 1);
    });
    return g;
  }

  const L = 1.2 + r() * 0.15;
  const W = 0.6;
  const paints = [m.bloomB, m.bloomC, m.roofTrim, m.roof, m.wallDark, m.wallLight];
  const paint = kind === "taxi" ? m.bloomA : paints[Math.floor(r() * paints.length)];
  part(g, new THREE.BoxGeometry(L, 0.26, W), paint, "body", [0, 0.1 + 0.13, 0]);
  part(g, new THREE.BoxGeometry(L * 0.56, 0.22, W * 0.86), m.glass, "cabin", [-L * 0.05, 0.36 + 0.11, 0]);
  part(g, new THREE.BoxGeometry(L * 0.5, 0.05, W * 0.82), paint, "carRoof", [-L * 0.06, 0.58 + 0.025, 0]);
  if (kind === "taxi") {
    part(g, new THREE.BoxGeometry(0.2, 0.08, 0.13), m.windowLit, "taxiSign", [-L * 0.06, 0.61 + 0.04, 0]);
  }
  lamps(L, W, 0.27);
  [-L * 0.32, L * 0.32].forEach((x, i) => {
    wheel(x, W / 2, i * 2);
    wheel(x, -W / 2, i * 2 + 1);
  });
  return g;
}

/**
 * A two-lane carriageway along local Z: asphalt, a dashed centre line and a
 * white edge line each side. The kerbs belong to the pavements either side
 * (`distantPath`), so a road can butt against them with no double kerb.
 */
export function distantRoad(
  m: SurroundMaterials,
  o: { length: number; width?: number; dashPitch?: number },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "city-road";
  const w = o.width ?? 3.4;
  const len = o.length;
  const top = 0.015;
  part(g, new THREE.BoxGeometry(w, 0.04, len), m.asphalt, "carriageway", [0, top - 0.02, 0]);
  // Markings a hair PROUD, never flush (flush is a z-fight).
  const pitch = o.dashPitch ?? 2;
  const n = Math.floor(len / pitch);
  for (let i = 0; i < n; i++) {
    part(g, new THREE.BoxGeometry(0.13, 0.006, pitch * 0.5), m.bloomA, "dash" + i, [
      0,
      top + 0.003,
      -len / 2 + (i + 0.5) * pitch,
    ]);
  }
  for (const s of [-1, 1]) {
    part(g, new THREE.BoxGeometry(0.12, 0.006, len), m.roofTrim, s < 0 ? "edgeL" : "edgeR", [
      s * (w / 2 - 0.22),
      top + 0.003,
      0,
    ]);
  }
  return g;
}

/** A zebra crossing across a road of `roadWidth` (along local Z), `width`
 *  wide along local X. Bars are long along X — the traffic direction —
 *  repeated across the road, which is what a zebra is. */
export function distantCrosswalk(
  m: SurroundMaterials,
  o: { roadWidth: number; width?: number },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "city-crosswalk";
  const w = o.width ?? 1.3;
  const pitch = 0.5;
  const n = Math.floor((o.roadWidth - 0.3) / pitch);
  for (let i = 0; i < n; i++) {
    // Above the road's own markings (whose tops are at 0.021), so a bar
    // crossing the centre dash or an edge line does not z-fight it.
    part(g, new THREE.BoxGeometry(w, 0.007, 0.26), m.roofTrim, "bar" + i, [
      0,
      0.025,
      -((n - 1) * pitch) / 2 + i * pitch,
    ]);
  }
  return g;
}

/** A dune: one heavily flattened lobed blob. A beach's read is the horizon, so
 *  almost nothing out there has vertical mass. */
export function distantDune(
  m: SurroundMaterials,
  o: { radius?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 8);
  const rad = o.radius ?? 1.8 + r() * 2.2;
  const geo = lobedFoliageGeometry(rad, {
    detail: 1,
    // Fewer, softer lobes than anything else in the set. Sharp lobes are what
    // make a rock read as a rock (groundDetail.ts tunes the same generator
    // that way on purpose), and a dune is the opposite object.
    lobes: 4,
    sharpness: 2.5,
    amplitude: 0.14,
    scale: [1, 0.12 + r() * 0.05, 0.85],
    seed: 23,
  });
  part(g, geo, m.sand, "dune", [0, 0, 0]);
  return g;
}

// ---------------------------------------------------------------------------
// IDEA-080: THE BEACH'S PEOPLE. Nuno: *"on the left we will add some beach
// towels and umbrella, on the right we will add some tents."*
//
// ALL OF IT IS PAINTED IN THE THREE BLOOM ROLES, and that is the budget and
// the art direction at once. The beach's `bloomColors` are shell white,
// seafoam and coral — which is exactly the palette of a striped umbrella, a
// towel and a tent — so these cost NO new material and no draw call, and they
// are the only saturated things on an otherwise sand-and-sea board, which is
// what makes them read as PEOPLE'S things from 30 units away. A beach is the
// one theme where the colourful objects are the neighbourhood.
//
// AT THE PLAY CAMERA A BEACH SPOT IS ITS UMBRELLA FROM ABOVE. The camera looks
// down 59 degrees, so the canopy is seen nearly in plan — a striped disc — and
// a towel is a flat rectangle seen face-on, which is the best case this camera
// has. Both identities are therefore carried by STRIPES IN PLAN, never by
// anything vertical; the pole is there to cast the canopy up off the sand, not
// to be seen.

/**
 * A cone split into alternating wedges, one geometry per parity.
 *
 * Returns the two halves as separate geometries so each lands on its own
 * shared material — a material ARRAY would survive `mergeBySignature` as a
 * draw call per group (IDEA-067 rule 7). Includes the underside, flat at the
 * rim, because from 59 degrees the canopy's near edge is seen from below.
 */
function stripedConeGeometries(
  radius: number,
  height: number,
  segments: number,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const halves: number[][] = [[], []];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: [number, number, number] = [Math.cos(a0) * radius, 0, -Math.sin(a0) * radius];
    const p1: [number, number, number] = [Math.cos(a1) * radius, 0, -Math.sin(a1) * radius];
    const apex: [number, number, number] = [0, height, 0];
    const under: [number, number, number] = [0, height * 0.35, 0];
    // Anticlockwise seen from above, so the top faces up and out.
    halves[i % 2].push(...p0, ...p1, ...apex);
    // The underside: a shallow cone up into the canopy, wound the other way.
    halves[i % 2].push(...p1, ...p0, ...under);
  }
  return halves.map((pos) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    return g;
  }) as [THREE.BufferGeometry, THREE.BufferGeometry];
}

/**
 * A striped beach umbrella over one or two towels, sometimes with a ball.
 *
 * ONE SPOT, NOT THREE PROPS, because the composition is the identity: an
 * umbrella alone on sand is a parasol, a towel alone is a rug, and together
 * they say somebody is lying there. Built as one group so the recipe places a
 * spot, never a scatter of parts that could drift apart.
 *
 * Sizes are above the CARTOON floor at 15-25 px a tile: the canopy is ~1.5
 * across (25-35 px), a towel 0.5 x 1.0, and each stripe on it ~0.16 wide —
 * the narrowest mark here, at about three pixels.
 */
export function distantBeachSpot(
  m: SurroundMaterials,
  o: { seed?: number } = {},
): THREE.Group {
  const r = seeded(o.seed ?? 3);
  const g = new THREE.Group();
  g.name = "beach-spot";

  // --- the umbrella ---------------------------------------------------------
  const canopyR = 0.68 + r() * 0.14;
  const poleH = 1.05 + r() * 0.15;
  // Stripe pairs: coral/white or seafoam/white. Both read as "beach" and
  // alternating them across spots is the variety a row of umbrellas needs.
  const stripe = r() < 0.5 ? m.bloomB : m.bloomC;
  const umbrella = new THREE.Group();
  umbrella.name = "umbrella";
  // Leaning a little, as a planted umbrella does — and toward the towels, so
  // it shades them.
  umbrella.rotation.z = 0.12 + r() * 0.1;
  g.add(umbrella);
  part(umbrella, new THREE.CylinderGeometry(0.035, 0.04, poleH, 5), m.roofTrim, "pole", [0, poleH / 2, 0]);
  const [ga, gb] = stripedConeGeometries(canopyR, 0.26, 8);
  part(umbrella, ga, stripe, "canopyA", [0, poleH - 0.12, 0]);
  part(umbrella, gb, m.bloomA, "canopyB", [0, poleH - 0.12, 0]);

  // --- the towels -----------------------------------------------------------
  // Laid in the umbrella's shade on the side it leans toward (-X), side by
  // side, slightly splayed: two people, not a carpet.
  const towels = 1 + (r() < 0.55 ? 1 : 0);
  for (let i = 0; i < towels; i++) {
    const t = new THREE.Group();
    t.name = "towel" + i;
    const base = i === 0 ? (r() < 0.5 ? m.bloomB : m.bloomC) : r() < 0.5 ? m.bloomC : m.bloomB;
    const tw = 0.5;
    const tl = 1.0;
    // The towel body, then two pale stripes LYING ON it — a hair proud, never
    // flush, or they z-fight (and flush-inside is this project's oldest
    // defect).
    part(t, new THREE.BoxGeometry(tw, 0.03, tl), base, "cloth", [0, 0.015, 0]);
    for (const s of [-1, 1]) {
      part(t, new THREE.BoxGeometry(tw * 1.001, 0.012, 0.15), m.bloomA, "band", [0, 0.034, s * tl * 0.27]);
    }
    t.position.set(-0.55 - i * 0.62, 0, (r() - 0.5) * 0.3);
    t.rotation.y = (r() - 0.5) * 0.35;
    g.add(t);
  }

  // --- the ball -------------------------------------------------------------
  // Sometimes. Two hemispheres in two colours is the whole mark, and it is the
  // one round thing on a beach of flat rectangles and discs.
  if (r() < 0.35) {
    const br = 0.15;
    const ball = new THREE.Group();
    ball.name = "ball";
    part(ball, new THREE.SphereGeometry(br, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), m.bloomB, "top");
    const bottom = part(
      ball,
      new THREE.SphereGeometry(br, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      m.bloomA,
      "bottom",
    );
    bottom.rotation.y = Math.PI / 8;
    ball.position.set(0.7 + r() * 0.3, br, 0.4 + r() * 0.3);
    ball.rotation.set(0.6, r() * Math.PI, 0.3);
    g.add(ball);
  }
  return g;
}

export type TentKind = "ridge" | "dome";

/**
 * A tent. Two kinds, because a campsite of one shape is a car park.
 *
 * THE RIDGE TENT IS A STEEP GABLE, and steep is not a style choice. IDEA-071
 * solved where the toon ramp splits a roof: a slope is in the top band
 * whenever `dot(N, L) > 2/3`, which this key light reaches below about 25
 * degrees of pitch — so a shallow tent is painted one flat value and reads as
 * a coloured card on the sand. A tent is ~50 degrees, well past the split, so
 * its two sides fall into different bands and the ridge reads for free.
 *
 * THE DOOR IS A DARK TRIANGLE PROUD OF THE FRONT, in `glass` — the same
 * material that makes a house's window read as an opening, for the same
 * reason: an opening is the darkest thing on a building. It sits proud of the
 * face rather than flush, because flush is inside.
 *
 * The DOME is a flattened hemisphere with a dark door patch and a
 * contrasting fly band round its base: round where everything else in the
 * band is a box, which is what separates it from the ridge tents at 20 px.
 */
export function distantTent(
  m: SurroundMaterials,
  o: { kind?: TentKind; seed?: number } = {},
): THREE.Group {
  const r = seeded(o.seed ?? 4);
  const kind = o.kind ?? (r() < 0.55 ? "ridge" : "dome");
  const g = new THREE.Group();
  g.name = `tent-${kind}`;
  // Seafoam and coral bodies, never white: a white tent on pale sand is the
  // greenhouse-as-white-card defect (IDEA-071) on a beach.
  const body = r() < 0.5 ? m.bloomC : m.bloomB;
  const accent = body === m.bloomC ? m.bloomB : m.bloomC;

  // THE GROUNDSHEET IS THE CONTACT SHADOW. The surround casts no shadows (the
  // merged band overlaps the key light's shadow camera), and the first build
  // had nothing where a tent met the sand — every tent read as a box hovering
  // over the beach. A dark sheet a little larger than the footprint is the
  // greenhouse plinth's trick (IDEA-066 phase 4): a value step under a mass is
  // what seats it.
  if (kind === "ridge") {
    // NEARLY AS TALL AS IT IS WIDE, AND SHORT. The first build was a long,
    // low ridge (1.4 deep, 0.7 tall) and every one read as a BOOK lying open
    // on the sand: from 59 degrees a long pitch is a big flat parallelogram
    // and the triangle at its end is a sliver. A pup tent's triangle is its
    // identity, so the end gets the proportion.
    //
    // AND NO STEEPER THAN ABOUT 47 DEGREES, which is the other half of the same
    // read. At 60 degrees the far pitch is a BACK FACE from this camera — a
    // tent 25 units east of the board is seen from the west and from above,
    // and its east pitch's normal points away — so the two-tone fly below
    // showed one colour and the tent was a tile again. Measured on the render,
    // not on the model: the geometry was right the whole time.
    const w = 1.08 + r() * 0.14;
    const h = 0.56 + r() * 0.06;
    const d = 1.0 + r() * 0.15;
    part(g, new THREE.BoxGeometry(w * 1.2, 0.012, d * 1.14), m.soil, "sheet", [0, 0.006, 0]);
    // THE SLOPES AND THE ENDS ARE TWO MATERIALS, and that is the whole read.
    // Built as one gable in one colour the tent was a parallelogram of flat
    // paint, and at 20 px a parallelogram is a box. Nothing here is WHITE: the
    // beach's shell white snaps to the palette's `sand` under the shipped
    // style — the same entry as the beach itself — so white ends vanished into
    // the ground and took the triangle with them.
    const x = w / 2;
    const z = d / 2;
    // A TWO-TONE FLY, ONE PITCH IN EACH COLOUR. From 59 degrees up the two
    // pitches are most of what a tent IS on screen, and in one colour they
    // merged into a single flat diamond — a coloured tile on the sand. Split
    // by colour along the ridge, the ridge is the first thing the eye finds,
    // and a ridge is what says tent rather than box.
    const pitch = (sx: number): THREE.BufferGeometry => {
      const pos =
        sx > 0
          ? [x, 0, z, x, 0, -z, 0, h, -z, x, 0, z, 0, h, -z, 0, h, z]
          : [-x, 0, -z, -x, 0, z, 0, h, z, -x, 0, -z, 0, h, z, 0, h, -z];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.computeVertexNormals();
      return geo;
    };
    part(g, pitch(1), accent, "flyR", [0, 0.012, 0]);
    part(g, pitch(-1), body, "flyL", [0, 0.012, 0]);
    const ends = new Float32Array([-x, 0, z, x, 0, z, 0, h, z, x, 0, -z, -x, 0, -z, 0, h, -z]);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.BufferAttribute(ends, 3));
    eg.computeVertexNormals();
    part(g, eg, body, "ends", [0, 0.012, 0]);
    // The door, on +Z: a smaller dark triangle a hair in front of the end.
    const dw = w * 0.24;
    const dh = h * 0.7;
    const door = new THREE.BufferGeometry();
    door.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-dw, 0, 0, dw, 0, 0, 0, dh, 0]), 3),
    );
    door.computeVertexNormals();
    part(g, door, m.glass, "door", [0, 0.014, z + 0.012]);
    // A pale ridge line between the two pitches, so the split reads as a
    // RIDGE rather than as a colour boundary painted across a flat tile.
    part(g, new THREE.BoxGeometry(0.07, 0.07, d * 1.1), m.roofTrim, "ridge", [0, h + 0.012, 0]);
  } else {
    const rad = 0.62 + r() * 0.12;
    // LOW. A hemisphere at 0.78 of its radius tall read as a BALL on the sand
    // — the beach already has beach balls, which is exactly the collision. A
    // dome tent is a squat dome, and what tells it from a ball is the POLES.
    const squash = 0.56;
    part(g, new THREE.CircleGeometry(rad * 1.16, 12), m.soil, "sheet").rotation.x = -Math.PI / 2;
    g.getObjectByName("sheet")!.position.y = 0.006;
    const shell = new THREE.Group();
    shell.name = "shell";
    shell.scale.set(1, squash, 1);
    shell.position.y = 0.012;
    g.add(shell);
    part(shell, new THREE.SphereGeometry(rad, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), body, "dome");
    // THE POLES: two arcs crossing over the top, in the accent colour, sitting
    // proud of the shell. A pole is the dome tent's whole identity at this
    // size, and it is thick on purpose — under the matcap a thin rod returns
    // the bounce colour rather than its own (IDEA-065 rule 27).
    for (const yaw of [Math.PI / 4, -Math.PI / 4]) {
      const pole = part(shell, new THREE.TorusGeometry(rad * 1.01, 0.045, 4, 16, Math.PI), accent, "pole");
      pole.rotation.y = yaw;
    }
    // The door: a PATCH OF THE DOME'S OWN SPHERE, 1.5% proud. A flat disc laid
    // on a curved dome floats off it at every edge by the sagitta (~0.05
    // here), which reads as a sticker; a patch cut from the same surface
    // cannot. Front is +Z, i.e. phi = pi/2 in SphereGeometry's own
    // parametrisation.
    part(
      shell,
      new THREE.SphereGeometry(rad * 1.015, 5, 4, Math.PI / 2 - 0.42, 0.84, Math.PI / 2 - 0.95, 0.95),
      m.glass,
      "door",
    );
  }
  return g;
}

/** A rock outcrop — the forest's and the park's punctuation. */
export function distantRockOutcrop(
  m: SurroundMaterials,
  o: { radius?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 9);
  const n = 1 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const rad = (o.radius ?? 0.35) * (0.7 + r() * 0.6);
    part(
      g,
      lobedFoliageGeometry(rad, {
        detail: 0,
        lobes: 6,
        sharpness: 7,
        amplitude: 0.3,
        scale: [1, 0.7, 0.9],
        seed: 29 + i,
      }),
      m.stone,
      "rock" + i,
      [(r() - 0.5) * 0.5, rad * 0.55, (r() - 0.5) * 0.5],
    );
  }
  return g;
}

// ---------------------------------------------------------------------------
// The City Park's avenue (IDEA-081). Laid out by parkLayout.ts.

/**
 * A straight paved path, `length` along local Z, with a stone KERB down each
 * side.
 *
 * The kerb is what makes it read as a path at all. A pale strip lying flush on
 * a green field is a stripe of paint; the two raised edges give it a real step
 * at the boundary, which is IDEA-071's kerbed flower bed and IDEA-059's ledge
 * one scale up.
 *
 * It is a SLAB, not a plane laid on the ground: the surround ground is at
 * y = -0.02 and the board floor at -0.01, so a plane at either height is a
 * z-fight waiting for a far camera. The slab's top sits at +0.02, clear of
 * both, and its underside is buried in the ground where nobody can see it.
 *
 * Paving JOINTS run across it at a slow pitch. Every slab seam would be a
 * ladder at this size; one joint every few units is what says "paved" rather
 * than "a long pale box".
 */
export function distantPath(
  m: SurroundMaterials,
  o: { length: number; width?: number; jointPitch?: number },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "park-path";
  const w = o.width ?? 2.6;
  const len = o.length;
  const top = 0.02;
  const kerbW = 0.16;
  const kerbH = 0.07;
  part(g, new THREE.BoxGeometry(w, 0.04, len), m.wallLight, "paving", [0, top - 0.02, 0]);
  for (const s of [-1, 1]) {
    part(g, new THREE.BoxGeometry(kerbW, kerbH, len), m.stone, s < 0 ? "kerbL" : "kerbR", [
      s * (w / 2 + kerbW / 2),
      kerbH / 2 - 0.02,
      0,
    ]);
  }
  const pitch = o.jointPitch ?? 3;
  const n = Math.floor(len / pitch);
  for (let i = 1; i < n; i++) {
    // A hair PROUD of the paving, never flush: flush is a z-fight, and buried
    // is the defect this project has shipped more often than any other.
    part(g, new THREE.BoxGeometry(w, 0.006, 0.12), m.stone, "joint" + i, [
      0,
      top + 0.003,
      -len / 2 + i * pitch,
    ]);
  }
  return g;
}

/**
 * A park bench: wooden seat and back on two dark iron frames. Long axis
 * along local X, sitting side facing local +Z.
 *
 * TWO VALUES, AND THE FRAME IS THE DARK ONE. From 59 degrees above, a bench
 * is mostly its SEAT, so the warm timber carries the object — and the dark
 * end frames standing either side of it are what make it read as furniture
 * rather than as a plank lying on the grass.
 */
export function distantBench(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = "park-bench";
  const r = seeded(o.seed ?? 5);
  const len = 1.1 + r() * 0.15;
  const seatY = 0.3;
  const seatD = 0.36;
  part(g, new THREE.BoxGeometry(len, 0.07, seatD), m.trunk, "seat", [0, seatY, 0]);
  const back = part(g, new THREE.BoxGeometry(len, 0.24, 0.06), m.trunk, "back", [
    0,
    seatY + 0.2,
    -seatD / 2 + 0.03,
  ]);
  // Raked back a little, as every bench is — upright, it reads as a box.
  back.rotation.x = -0.18;
  for (const s of [-1, 1]) {
    // One frame per end: leg, arm and back-post as one dark slab. Inset from
    // the ends so the timber overhangs it, which is what real benches do and
    // what keeps the frame from reading as the bench's whole silhouette.
    part(g, new THREE.BoxGeometry(0.08, seatY, seatD), m.glass, s < 0 ? "frameL" : "frameR", [
      s * (len / 2 - 0.12),
      seatY / 2,
      0,
    ]);
    part(g, new THREE.BoxGeometry(0.08, 0.3, 0.06), m.glass, s < 0 ? "postL" : "postR", [
      s * (len / 2 - 0.12),
      seatY + 0.13,
      -seatD / 2 + 0.03,
    ]);
  }
  return g;
}

/** A litter bin: a dark drum under a pale stone lid. */
export function distantBin(m: SurroundMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = "park-bin";
  const h = 0.5;
  part(g, new THREE.CylinderGeometry(0.19, 0.16, h, 8), m.glass, "drum", [0, h / 2, 0]);
  // The lid is WIDER than the drum and pale: from above it is the only part
  // of a bin the camera really sees, and a dark disc on grass is a hole.
  part(g, new THREE.CylinderGeometry(0.23, 0.23, 0.07, 8), m.stone, "lid", [0, h + 0.035, 0]);
  return g;
}

// ---------------------------------------------------------------------------
// The City Park's playground (IDEA-081 phase 3). Laid out by parkLayout.ts.
//
// THE EQUIPMENT IS PAINTED IN THE THEME'S BLOOM COLOURS, and that is the
// cheapest correct answer rather than a shortcut. Play equipment is the one
// thing in a park that is SATURATED on purpose, the park's `bloomColors` are
// already its loud yellow / pink / purple, and they are already in the shared
// set: the playground costs no draw call and still reads as the loudest
// corner of the picture, which is what a playground is.

/** A tube between two points, the one primitive every frame here needs.
 *  Aimed with setFromUnitVectors, never with Euler angles (IDEA-055 rule 4). */
function rod(
  g: THREE.Group,
  a: [number, number, number],
  b: [number, number, number],
  radius: number,
  mat: THREE.Material,
  name: string,
): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const mesh = part(g, new THREE.CylinderGeometry(radius, radius, len, 5), mat, name);
  mesh.position.copy(va).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/**
 * A slide: ladder up the back (-Z), a roofed platform, a chute down the front
 * (+Z). The CHUTE is the identity (a long bright ramp is the one shape no
 * other object in the band has), so it is the widest, brightest part.
 */
export function distantSlide(m: SurroundMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = "play-slide";
  const deckY = 1.0;
  const half = 0.36;
  const postH = 1.6;
  const cz = -0.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rod(g, [sx * half, 0, cz + sz * half], [sx * half, postH, cz + sz * half], 0.05, m.bloomC, `post${sx}${sz}`);
    }
  }
  part(g, new THREE.BoxGeometry(half * 2 + 0.1, 0.08, half * 2 + 0.1), m.trunk, "deck", [0, deckY, cz]);
  const roof = part(g, new THREE.ConeGeometry(0.62, 0.42, 4), m.bloomB, "roof", [0, postH + 0.21, cz]);
  roof.rotation.y = Math.PI / 4;
  // The ladder leans on the deck's back edge.
  const lz0 = cz - half - 0.55;
  const lz1 = cz - half;
  for (const sx of [-1, 1]) rod(g, [sx * 0.2, 0, lz0], [sx * 0.2, deckY, lz1], 0.035, m.glass, `rail${sx}`);
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    part(g, new THREE.BoxGeometry(0.4, 0.04, 0.05), m.glass, "rung" + i, [0, deckY * t, lz0 + (lz1 - lz0) * t]);
  }
  // The chute: deck front edge down to the ground, running out along +Z.
  const z0 = cz + half;
  const z1 = 1.55;
  const run = z1 - z0;
  const drop = deckY - 0.1;
  const len = Math.hypot(run, drop);
  const chute = new THREE.Group();
  chute.name = "chute";
  chute.position.set(0, deckY, z0);
  // Rx(t) sends +Z to (0, -sin t, cos t): a positive angle tilts it DOWN.
  chute.rotation.x = Math.atan2(drop, run);
  g.add(chute);
  part(chute, new THREE.BoxGeometry(0.5, 0.06, len), m.bloomA, "bed", [0, 0, len / 2]);
  for (const sx of [-1, 1]) {
    part(chute, new THREE.BoxGeometry(0.06, 0.16, len), m.bloomA, sx < 0 ? "lipL" : "lipR", [sx * 0.25, 0.06, len / 2]);
  }
  return g;
}

/**
 * A dome climber, the round bar-frame every playground had. Four meridian
 * arches crossing at the top and three horizontal rings.
 *
 * Built from TUBES along curves rather than from an icosahedron's edges: an
 * icosahedron is not pole-aligned in three.js, so cutting it at y = 0 leaves a
 * ragged rim, and a ragged rim reads as a broken one.
 */
export function distantClimbDome(m: SurroundMaterials, o: { radius?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = "play-dome";
  const R = o.radius ?? 0.95;
  const tube = 0.045;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = (k / 10) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(t) * R * ca, Math.sin(t) * R, Math.cos(t) * R * sa));
    }
    part(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, tube, 4), m.bloomC, "arch" + i);
  }
  const rings = [0.02, 0.4, 0.75];
  rings.forEach((h, i) => {
    const y = h * R;
    const r = Math.sqrt(R * R - y * y);
    const ring = part(g, new THREE.TorusGeometry(r, tube, 4, 16), i === 0 ? m.glass : m.bloomA, "ring" + i, [0, y, 0]);
    ring.rotation.x = Math.PI / 2;
  });
  return g;
}

/** An A-frame double swing. Beam along local X, seats hanging under it. */
export function distantSwing(m: SurroundMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = "play-swing";
  const H = 1.45;
  const hx = 1.15;
  const splay = 0.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      rod(g, [sx * hx, 0, sz * splay], [sx * hx, H, 0], 0.055, m.bloomB, `leg${sx}${sz}`);
    }
  }
  rod(g, [-hx - 0.08, H, 0], [hx + 0.08, H, 0], 0.06, m.bloomB, "beam");
  const seats = [-0.48, 0.48];
  seats.forEach((x, i) => {
    const seatY = 0.4;
    for (const s of [-1, 1]) rod(g, [x + s * 0.17, H, 0], [x + s * 0.17, seatY, 0], 0.018, m.glass, `chain${i}${s}`);
    part(g, new THREE.BoxGeometry(0.42, 0.05, 0.2), m.bloomA, "seat" + i, [x, seatY, 0]);
  });
  return g;
}

/**
 * The play area's ground and boundary: a soft-surface pad inside a stone
 * kerb, and a low pale fence with a GATE gap on the side `gateSide` names
 * (+X "east" or -Z "north").
 *
 * THE PAD IS `soil`, AND THE TWO STYLES READ IT TWO WAYS — both of them
 * right. In classic it is dark bark mulch, which is what real playgrounds
 * stand on and a value step under every bright piece. Under IDEA-079's style
 * the snap lands it on the warm sand rung (the flower beds' mulch does the
 * same), so it reads as a SANDPIT, which is the other thing a playground
 * stands on. Either way the equipment is saturated and the pad is not, and
 * that hue step is what separates them — under that style a value step has to
 * be a hue step (IDEA-067).
 *
 * A PALE fence, for the garden picket's reason (IDEA-060 rule 2): dark rails
 * on dark mulch and green lawn would be a line nobody can see.
 */
export function distantPlayArea(
  m: SurroundMaterials,
  o: { width: number; depth: number; gate?: number; gateSide?: "east" | "north" },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "play-area";
  const w = o.width;
  const d = o.depth;
  part(g, new THREE.BoxGeometry(w, 0.04, d), m.soil, "mulch", [0, 0, 0]);
  const kerbW = 0.16;
  part(g, new THREE.BoxGeometry(w + kerbW * 2, 0.07, kerbW), m.stone, "kerbN", [0, 0.015, -d / 2 - kerbW / 2]);
  part(g, new THREE.BoxGeometry(w + kerbW * 2, 0.07, kerbW), m.stone, "kerbS", [0, 0.015, d / 2 + kerbW / 2]);
  part(g, new THREE.BoxGeometry(kerbW, 0.07, d), m.stone, "kerbW", [-w / 2 - kerbW / 2, 0.015, 0]);
  part(g, new THREE.BoxGeometry(kerbW, 0.07, d), m.stone, "kerbE", [w / 2 + kerbW / 2, 0.015, 0]);

  // The fence stands on the kerb line.
  const gate = o.gate ?? 1.6;
  const fx = w / 2 + kerbW / 2;
  const fz = d / 2 + kerbW / 2;
  const postH = 0.55;
  const pitch = 0.9;
  const north = o.gateSide === "north";
  const runs: Array<[[number, number], [number, number], string]> = [
    [[-fx, fz], [fx, fz], "S"],
    [[-fx, -fz], [-fx, fz], "W"],
    // The gated side in two halves either side of the gap.
    ...(north
      ? ([
          [[-fx, -fz], [-gate / 2, -fz], "N0"],
          [[gate / 2, -fz], [fx, -fz], "N1"],
          [[fx, -fz], [fx, fz], "E"],
        ] as Array<[[number, number], [number, number], string]>)
      : ([
          [[-fx, -fz], [fx, -fz], "N"],
          [[fx, -fz], [fx, -gate / 2], "E0"],
          [[fx, gate / 2], [fx, fz], "E1"],
        ] as Array<[[number, number], [number, number], string]>)),
  ];
  for (const [a, b, name] of runs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / pitch));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      part(g, new THREE.BoxGeometry(0.08, postH, 0.08), m.roofTrim, `post${name}_${i}`, [
        a[0] + (b[0] - a[0]) * t,
        postH / 2,
        a[1] + (b[1] - a[1]) * t,
      ]);
    }
    [0.22, 0.45].forEach((y, k) => {
      const rail = part(g, new THREE.BoxGeometry(len, 0.06, 0.05), m.roofTrim, `rail${name}_${k}`, [
        (a[0] + b[0]) / 2,
        y,
        (a[1] + b[1]) / 2,
      ]);
      // A box's long axis is local +X; Ry(t) sends +X to (cos t, 0, -sin t).
      rail.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    });
  }
  return g;
}

// ---------------------------------------------------------------------------
// The City Park's lake (IDEA-081 phase 4). Laid out by parkLayout.ts.

/**
 * The lake's outline as a radius multiplier at angle `t` — an ellipse with two
 * slow wobbles, so the shore reads as a pond somebody dug rather than a
 * stamped oval. Shared by the water, its bank and the footpath round it, so the
 * three can never disagree about where the shore is (the pizza's
 * `sectorOutline` reasoning).
 */
export function lakeShore(t: number, seed = 0): number {
  return 1 + 0.07 * Math.sin(2 * t + 1.1 + seed) + 0.05 * Math.sin(3 * t + 2.3 + seed * 0.7);
}

/** The most `lakeShore` can return — what a caller sizes clearances with. */
export const LAKE_SHORE_MAX = 1.12;

/**
 * A flat ring or disc following the lake's outline, `inner`..`outer` times
 * the ellipse, lying on the ground at height `y`. `inner` 0 is a full disc.
 *
 * Built as a polar GRID rather than a `Shape` with a hole: ShapeGeometry only
 * emits contour vertices, and a ring is cleaner as quads between two rings of
 * points whose angles match by construction.
 */
function lakeBand(
  rx: number,
  rz: number,
  inner: number,
  outer: number,
  y: number,
  seed: number,
  seg = 48,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const k = lakeShore(t, seed);
    const c = Math.cos(t);
    const s = Math.sin(t);
    pos.push(c * rx * k * inner, y, s * rz * k * inner);
    pos.push(c * rx * k * outer, y, s * rz * k * outer);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    // Wound to face UP. Angle increases from +X toward +Z, which seen from
    // above is CLOCKWISE, so the counter-clockwise-from-above order is
    // inner(i), inner(i+1), outer(i) — the obvious order faces down and is
    // culled whole (journeyWater's ribbon shipped exactly that once).
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The water body: a sandy bank, pale shallows round the shore, deep water in
 * the middle, and a few ripple marks on it.
 *
 * THREE VALUES, OUTSIDE IN, and the order is the whole read. A lake that is
 * one flat blue is a HOLE in the lawn; the pale band at its edge is what says
 * the ground slopes down into water, and the bank under that is what gives it
 * a shore rather than a cut edge.
 */
export function distantLake(
  m: SurroundMaterials,
  o: { rx: number; rz: number; seed?: number },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "lake";
  const seed = o.seed ?? 0;
  const { rx, rz } = o;
  // The layers step up by 0.02 — comfortably over this camera's depth
  // resolution at 50 units (~0.0015 with a 0.1 near plane), so nothing fights.
  part(g, lakeBand(rx, rz, 0, 1.06, 0.0, seed), m.soil, "bank");
  part(g, lakeBand(rx, rz, 0, 1.0, 0.02, seed), m.waterLight, "shallows");
  part(g, lakeBand(rx, rz, 0, 0.8, 0.04, seed), m.water, "deep");
  // Ripples: short pale arcs on the deep water. Flat, a hair proud of it.
  const r = seeded(91 + seed);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.2 + r() * 0.4;
    const ripple = part(
      g,
      new THREE.TorusGeometry(0.32 + r() * 0.2, 0.035, 3, 10, Math.PI * 0.7),
      m.waterLight,
      "ripple" + i,
      [Math.cos(a) * rx * d, 0.06, Math.sin(a) * rz * d],
    );
    ripple.rotation.set(-Math.PI / 2, 0, r() * Math.PI * 2);
    ripple.scale.set(1, 1, 0.3);
  }
  return g;
}

/**
 * The gravel footpath round the lake: a ring a fixed distance out from the
 * shore. Same `lakeShore` outline, so it follows every bay and point the water
 * makes.
 */
export function distantLakePath(
  m: SurroundMaterials,
  o: { rx: number; rz: number; offset: number; width: number; seed?: number },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "lake-path";
  // Offset in WORLD units, not as a multiplier: the ellipse's two radii
  // differ, and a multiplier would give a path that is twice as far from the
  // water at the ends as at the sides.
  const rxIn = o.rx + o.offset;
  const rzIn = o.rz + o.offset;
  const outerK = 1 + o.width / Math.min(rxIn, rzIn);
  part(g, lakeBand(rxIn, rzIn, 1, outerK, 0.025, o.seed ?? 0, 64), m.wallLight, "gravel");
  return g;
}

/**
 * A duck, floating. White body, yellow bill — the one bird everybody draws,
 * and the only small thing in the band that is WHITE, which is how it reads at
 * a few pixels on blue.
 */
export function distantDuck(m: SurroundMaterials, o: { size?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = "duck";
  const s = o.size ?? 1;
  const body = part(g, new THREE.SphereGeometry(0.17 * s, 7, 5), m.roofTrim, "body", [0, 0.1 * s, 0]);
  body.scale.set(1, 0.62, 1.45);
  // The tail flicks UP at the back — the duck silhouette's one hook.
  const tail = part(g, new THREE.ConeGeometry(0.07 * s, 0.16 * s, 5), m.roofTrim, "tail", [0, 0.16 * s, -0.26 * s]);
  tail.rotation.x = -0.9;
  part(g, new THREE.SphereGeometry(0.095 * s, 6, 4), m.roofTrim, "head", [0, 0.27 * s, 0.17 * s]);
  const bill = part(g, new THREE.ConeGeometry(0.045 * s, 0.13 * s, 5), m.bloomA, "bill", [0, 0.25 * s, 0.3 * s]);
  // A cone points up its +Y; Rx(+pi/2) sends +Y to +Z, i.e. forward.
  bill.rotation.x = Math.PI / 2;
  return g;
}

/**
 * A clump of reeds with bulrush heads. Stems as thin CONES so each comes to a
 * point, and the brown heads are what say "bulrush" rather than "grass".
 */
export function distantReeds(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = "reeds";
  const r = seeded(o.seed ?? 4);
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.55 + r() * 0.35;
    const x = (r() - 0.5) * 0.45;
    const z = (r() - 0.5) * 0.45;
    const stem = part(g, new THREE.ConeGeometry(0.05, h, 4), i % 2 ? m.foliageDark : m.hedgeLit, "stem" + i, [x, h / 2, z]);
    stem.rotation.set((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
    if (i % 3 === 0) {
      part(g, new THREE.CylinderGeometry(0.055, 0.055, 0.16, 5), m.trunk, "head" + i, [x, h * 0.8, z]);
    }
  }
  return g;
}

/** A lily pad — a flat green disc with a notch — and sometimes its flower. */
export function distantLilyPad(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = "lily";
  const r = seeded(o.seed ?? 8);
  const rad = 0.2 + r() * 0.1;
  const pad = part(g, new THREE.CircleGeometry(rad, 10, 0.4, Math.PI * 2 - 0.4), m.foliageLit, "pad", [0, 0.065, 0]);
  pad.rotation.x = -Math.PI / 2;
  if (r() < 0.45) {
    const f = part(g, new THREE.SphereGeometry(0.08, 6, 3), m.bloomC, "flower", [rad * 0.2, 0.1, 0]);
    f.scale.y = 0.6;
  }
  return g;
}

/**
 * A low CLIPPED hedge — a run, not a row of bushes. Long axis local X, flat
 * cut ends, rounded shoulders, standing on y = 0.
 *
 * NOT `distantHedgeRun`, and the difference is the whole point. That one is a
 * boundary hedge built from a few wide overlapping blobs, which reads as
 * continuous at its own height — at half that height the blobs shrink, the
 * gaps between them open, and an avenue fence came back as a STRING OF BEADS.
 * A clipped hedge is one mass: a rounded-top section EXTRUDED along the run,
 * then gently undulated so the top is foliage rather than a machined plank.
 * The undulation depends only on POSITION, so the extrusion's duplicated
 * vertices move together and no seam can open.
 */
export function distantClippedHedge(
  m: SurroundMaterials,
  o: { length: number; height?: number; depth?: number; seed?: number },
): THREE.Group {
  const g = new THREE.Group();
  g.name = "clipped-hedge";
  const L = o.length;
  const h = o.height ?? 0.5;
  const d = o.depth ?? 0.46;
  const seed = o.seed ?? 0;
  const rr = Math.min(h, d) * 0.32;
  // The section in (z, y): square at the foot, rounded shoulders on top.
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(d / 2, h - rr);
  s.quadraticCurveTo(d / 2, h, d / 2 - rr, h);
  s.lineTo(-d / 2 + rr, h);
  s.quadraticCurveTo(-d / 2, h, -d / 2, h - rr);
  s.closePath();
  const steps = Math.max(4, Math.round(L / 0.25));
  const geo = new THREE.ExtrudeGeometry(s, { depth: L, steps, bevelEnabled: false, curveSegments: 3 });
  // ExtrudeGeometry runs along +Z from 0 to L; centre it and turn it onto X.
  geo.translate(0, 0, -L / 2);
  geo.rotateY(Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const p = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Two incommensurate waves along the run, so the lumps never read as a
    // pattern; stronger toward the top, where clipping leaves the most growth.
    const wave = Math.sin(x * 4.1 + p) * 0.6 + Math.sin(x * 9.3 + p * 2.1) * 0.4;
    const up = y / h;
    pos.setXYZ(i, x, y + wave * 0.035 * up, z * (1 + wave * 0.06 * up));
  }
  geo.computeVertexNormals();
  part(g, geo, m.hedgeLit, "hedge");
  return g;
}
