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
import { lobedFoliageGeometry } from "./foliage";
import { hexOf, lit, mix, rgbOf } from "./paint";


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
    wallLight: toon({ color: hexOf(mix([0.9, 0.86, 0.78], ground, 0.14)) }),
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
  o: { height?: number; seed?: number } = {},
): THREE.Group {
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
    m.foliageLit,
    "crownA",
    [0, trunkH + rad * 0.78, 0],
  );
  if (r() < 0.65) {
    const r2 = rad * 0.66;
    part(
      g,
      lobedFoliageGeometry(r2, { detail: 0, lobes: 7, sharpness: 6, amplitude: 0.26, seed: 13 }),
      m.foliageDark,
      "crownB",
      [(r() - 0.5) * rad, trunkH + rad * 1.24, (r() - 0.5) * rad],
    );
  }
  return g;
}

/** A conifer: one trunk, three stacked skirts. The forest's workhorse.
 *
 *  Tiers rather than one smooth cone, for foliage.ts's own reason: every plant
 *  in this game used to be a primitive, and a cone measures zero outline
 *  roughness. Three is enough at this size — eight is what a hero pine needs. */
export function distantConifer(
  m: SurroundMaterials,
  o: { height?: number; seed?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const r = seeded(o.seed ?? 4);
  const h = o.height ?? 2.2 + r() * 1.4;
  const trunkH = h * 0.2;
  part(g, new THREE.CylinderGeometry(h * 0.035, h * 0.06, trunkH, 6), m.trunk, "trunk", [
    0,
    trunkH / 2,
    0,
  ]);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = trunkH + h * (0.12 + t * 0.6);
    const rad = h * (0.3 - t * 0.14);
    part(
      g,
      new THREE.ConeGeometry(rad, h * 0.42, 7),
      i % 2 === 0 ? m.foliageLit : m.foliageDark,
      "tier" + i,
      [0, y, 0],
    );
  }
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
