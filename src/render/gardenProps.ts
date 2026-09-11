// OWNER: render-artist
// IDEA-060: the garden theme's props, rebuilt from references.
//
// Lives outside board.ts for the reason every sculpt module before it does
// (beagleSculpt, sushiSculpt, pizzaSculpt, burgerSculpt): board.ts is already
// 3,400 lines and it owns the BOARD — walls, floor, pellets, pickups and the
// placement machinery. What a treehouse is made of is not that file's
// business. board.ts's `makePropFromDef` switch delegates here, exactly as it
// does to its own makeShrub/makeTree for the older shapes.
//
// WHY THERE ARE NEW SHAPES RATHER THAN BETTER OLD ONES. `shrub` and `tree`
// are referenced 38 and 23 times across the garden, the forest and the park.
// Rewriting them in place would silently re-dress two themes this session is
// not reviewing, and a theme is tuned as a whole. So the garden gets
// `leafShrub` and `broadleafTree` and its own placements are repointed; the
// forest and the park keep what they have until their own turn.
//
// FIVE RULES CARRIED OVER FROM THE ENEMY REBUILDS, all of which cost
// something to learn the first time:
//
//  1. THE SILHOUETTE IS THE IDENTITY, AND IT IS MEASURED. See foliage.ts —
//     the shrub reference's outline has a measured roughness of 0.135 where a
//     sphere has 0.0, and every plant this project shipped before was
//     spheres. Colour cannot fix that.
//
//  2. A HOLE IS ONLY A HOLE IF THERE IS DARK BEHIND IT (IDEA-058 rule 4).
//     The birdhouse's entrance is a real aperture cut out of its front
//     `Shape`, with a dark interior plate BEHIND it at a z that is genuinely
//     further back. Get the z wrong and the front face shows through the hole
//     and the entrance renders as a painted disc.
//
//  3. EVERY FACTORY OWNS ITS MATERIALS. Never a module-level shared one — a
//     prop group is disposed as a self-contained unit on a re-theme, so a
//     shared singleton would be freed out from under every prop still
//     standing. board.ts's makeTrunkMat note records the same trap.
//
//  4. STABLE CHILD ORDER, AND EVERY PART NAMED. IDEA-033 addresses prop parts
//     by depth-first index path, so re-ordering a factory's `add` calls
//     silently repoints every saved edit.
//
//  5. A PROP IS SEEN AT ~25px PER TILE. Anything under a couple of pixels is
//     grain, not detail (floorTexture.ts's cartoon rule). That is why the
//     sunflower ships 16 petals against a measured 20 and the daisy 10
//     against 14 — and why none of them tries to draw a leaf vein.
import * as THREE from "three";
import type { PropParams } from "../game/props";
import { toon } from "./toon";
import { flaredTrunkProfile, lobedFoliageGeometry, trunkGeometry } from "./foliage";

/** Which of the five flowers a `flower` prop is. */
export type GardenFlowerKind = "daisy" | "sunflower" | "rose" | "tulip" | "blossom";

/** Deterministic per-instance variation, seeded from the placement hash so a
 *  given prop looks the same on every device and every rebuild. */
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

/** A named mesh, so IDEA-033's part editor and the outliner have something to
 *  address — see rule 4. */
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

/**
 * The wall that closes the triangle between a box's top and a gable roof's
 * underside — the pediment.
 *
 * Both buildings here shipped with a hole there, and it is worth being precise
 * about WHY, because "lower the roof" does not fix it. A gable roof that
 * OVERHANGS spans wider than the box it covers: the two slabs meet at the
 * ridge directly above the box's centre, but at the box's own edge the roof
 * is still `rise * (1 - boxW/roofSpan)` above the wall top. That leftover
 * wedge is open on the front and the back, and you look straight through the
 * building.
 *
 * So the fill is not a triangle. Its top follows the ROOF's slope and its
 * sides stop at the BOX's width, which makes it a pentagon:
 *
 *      (0, rise)            <- the ridge
 *      /        \
 *   (-w, e)    (w, e)       <- e = rise * (1 - boxW / roofSpan)
 *     |          |
 *   (-w, 0) -- (w, 0)       <- the wall top
 *
 * Extruded through the box's depth, so one mesh closes both ends and the
 * volume between them.
 */
function gableFillGeometry(
  boxW: number,
  roofSpan: number,
  rise: number,
  depth: number,
): THREE.BufferGeometry {
  const w = boxW / 2;
  const edgeY = rise * (1 - boxW / roofSpan);
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, edgeY);
  s.lineTo(0, rise);
  s.lineTo(-w, edgeY);
  s.closePath();
  // bevelEnabled false, as everywhere here: the bevel grows OUTWARD and would
  // push the fill proud of the very walls it is flush with.
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// ---------------------------------------------------------------------------
// 1. THE SHRUB — .img2threejs/reference/props/shrub/shrub.png
//
// Measured: 1.193 wide over tall, widest at 0.469 of its height, outline
// roughness 0.135. It is a dense ball of individual leaves with a few sprigs
// escaping the mass and a pale woody stem cluster underneath.
//
// The build is ONE lobed mass carrying that roughness, plus a smaller LIGHTER
// mass riding on its upper shoulder. The second mass is not decoration: the
// wall hedge is built the same way in 2D (wallTexture.ts's drawHedge stacks
// progressively lighter clusters on a dark ground) because foliage reads as
// foliage largely through lit leaves sitting on a shadowed interior, and a
// single flat green ball reads as a ball however knobbly its outline is.
// ---------------------------------------------------------------------------

const SHRUB_GREENS = [0x4e9a3e, 0x3f8f3a, 0x5fae4d] as const;

export function makeLeafShrub(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.foliageColors ?? SHRUB_GREENS;
  const width = params.width ?? 1;
  const height = params.height ?? 1;
  const r = rand(h);

  const base = pick(colors, h);
  const massMat = toon({ color: base });
  // The lit mass is a real hue shift toward yellow-green, not just a lift.
  // Sunlit foliage warms as well as brightens, and a pure value change reads
  // as the same plastic under a stronger lamp.
  const litMat = toon({ color: new THREE.Color(base).lerp(new THREE.Color(0xa8d24a), 0.42).getHex() });
  const woodMat = toon({ color: params.trunkColor ?? 0x7a6250 });

  // 0.26 radius against a 0.84 vertical squash gives 0.52 x 0.44 — 1.19 wide
  // over tall, the reference's own ratio.
  const R = 0.26 * width;
  const mass = part(
    lobedFoliageGeometry(R, {
      // detail 3 and 22 lobes, and both were bought by a render rather than
      // guessed. At detail 2 with the module's default 16 lobes this came out
      // a BOULDER: facets the size of the clumps and clumps the size of the
      // bush. The roughness figure was right and the SCALE of it was wrong —
      // 0.135 of deviation says how far the outline wanders, not how often,
      // and "often" is the half of leafiness a number does not carry.
      detail: 3,
      lobes: 22,
      sharpness: 16,
      scale: [1, 0.78, 1],
      seed: 1 + Math.floor(h * 97),
    }),
    massMat,
    "mass",
    g,
  );
  mass.position.y = R * 0.78 + 0.02;
  mass.rotation.y = r() * Math.PI * 2;
  mass.scale.y = height;

  // The lit shoulder: smaller, up and toward the light, and DEEP inside the
  // main mass so only its top breaks the surface. Set proud of the mass it
  // sits on and it reads as a second bush growing out of the first.
  const lit = part(
    lobedFoliageGeometry(R * 0.55, {
      detail: 3,
      lobes: 16,
      sharpness: 16,
      scale: [1.25, 0.62, 1.25],
      amplitude: 0.3,
      seed: 40 + Math.floor(h * 53),
    }),
    litMat,
    "litMass",
    g,
  );
  // Broad and FLAT, riding the top of the mass rather than sitting on its
  // shoulder like a second bush. The first build made it a small ball offset
  // to one side, which read as a patch of moss growing on a rock.
  lit.position.set(-R * 0.1, (R * 0.78 + 0.02) * height + R * 0.24, -R * 0.1);

  // The woody base. Three short stems fanning out of one point, which is what
  // the reference shows under the leaf mass — and they give the shrub
  // somewhere to meet the ground other than a tangent circle.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r() * 0.8;
    const stem = part(
      new THREE.CylinderGeometry(0.012 * width, 0.022 * width, R * 0.6, 5),
      woodMat,
      `stem${i}`,
      g,
    );
    stem.position.set(Math.cos(a) * R * 0.16, R * 0.28, Math.sin(a) * R * 0.16);
    stem.rotation.z = Math.cos(a) * 0.3;
    stem.rotation.x = -Math.sin(a) * 0.3;
  }
  return g;
}

// ---------------------------------------------------------------------------
// 2. THE TREE — .img2threejs/reference/props/tree/image.png
//
// Measured: essentially square (0.993 wide over tall), canopy 70% of the
// height and trunk 30%, canopy WIDEST LOW at 0.525, and the one number that
// carries the whole character — the trunk is 0.117 of the tree's width at the
// shoulder and 0.473 at the ground, a FOUR-FOLD root flare.
//
// The shipped `tree` shape is a plain cylinder with two spheres on it, which
// throws away both of those. Here the trunk is a lathe of a concave flare
// profile (foliage.ts's `flaredTrunkProfile`) and the canopy is a broad lobed
// dome — wider than tall, so its widest point sits low the way the
// measurement says.
// ---------------------------------------------------------------------------

export function makeBroadleafTree(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.foliageColors ?? [0x4e9a3e, 0x5fae4d, 0x46963c];
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const r = rand(h);

  const H = 1.0 * height;
  const W = 0.88 * width;
  const barkMat = toon({ color: params.trunkColor ?? 0x7d5535 });

  // Trunk. It runs to 0.46H rather than the measured 0.30 so its top is
  // safely buried inside the canopy — a trunk that stops exactly where the
  // foliage starts leaves a visible seam from any angle below the horizon,
  // and the canopy's own lobed underside is not a flat lid.
  const shoulderR = (0.117 * W) / 2;
  const trunk = part(
    trunkGeometry(flaredTrunkProfile(shoulderR, 0.46 * H, 4.04, 6), 9),
    barkMat,
    "trunk",
    g,
  );
  trunk.rotation.y = r() * Math.PI * 2;

  // Two branch stubs lifting into the canopy. They are mostly hidden, and
  // they are here for the one place they are not: the gap between the canopy's
  // lobes, where a bare trunk with foliage floating beside it looks like two
  // props that failed to meet.
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2;
    const br = part(
      new THREE.CylinderGeometry(shoulderR * 0.45, shoulderR * 0.8, 0.3 * H, 5),
      barkMat,
      `branch${i}`,
      g,
    );
    br.position.set(Math.cos(a) * 0.09 * W, 0.5 * H, Math.sin(a) * 0.09 * W);
    br.rotation.z = -Math.cos(a) * 0.55;
    br.rotation.x = Math.sin(a) * 0.55;
  }

  // Canopy: a broad dome, 0.30H to just past H. Squashed to 0.78 so the
  // widest point falls low in its own height, per the measurement.
  const crownR = W / 2;
  const crown = part(
    lobedFoliageGeometry(crownR, {
      detail: 3,
      lobes: 14,
      scale: [1, 0.78, 1],
      seed: 5 + Math.floor(h * 61),
    }),
    toon({ color: pick(colors, h) }),
    "crown",
    g,
  );
  crown.position.y = 0.72 * H;
  crown.rotation.y = r() * Math.PI * 2;

  // The lit cap, same reasoning as the shrub's.
  const capColor = new THREE.Color(pick(colors, h)).lerp(new THREE.Color(0xa8d24a), 0.38).getHex();
  const cap = part(
    lobedFoliageGeometry(crownR * 0.66, {
      detail: 2,
      lobes: 12,
      amplitude: 0.26,
      scale: [1, 0.74, 1],
      seed: 90 + Math.floor(h * 37),
    }),
    toon({ color: capColor }),
    "crownLit",
    g,
  );
  cap.position.set(-crownR * 0.16, 0.92 * H, -crownR * 0.18);
  return g;
}

// ---------------------------------------------------------------------------
// 3. THE TREEHOUSE — .img2threejs/reference/props/treehouse/image.png
//
// The board's one LANDMARK: it goes in a single named place (the maze's
// top-left corner) rather than being scattered, so unlike every other prop
// here it is allowed to be complicated and it is allowed to be big.
//
// Measured: 0.846 wide over tall; canopy 30% / house 36% / trunk 34%; widest
// at 0.625 of the height, where the balcony deck is; roof eaves 0.926 of the
// width. The canopy's centre of mass sits at 0.37-0.39 across against the
// house's 0.50, so the foliage is deliberately OFF-AXIS over the roof rather
// than a hat centred on it — that asymmetry is most of why the reference
// reads as a house built in a tree rather than a house with a tree behind it.
// ---------------------------------------------------------------------------

export function makeTreehouse(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const r = rand(h);

  const H = 1.8 * height;
  const W = 1.52 * width;

  const barkMat = toon({ color: params.trunkColor ?? 0x7a5230 });
  const plankMat = toon({ color: 0xc78f4e });
  const plankDark = toon({ color: 0x9a6535 });
  const roofMat = toon({ color: 0xd0503c });
  const leafMat = toon({ color: pick(params.foliageColors ?? [0x4e9a3e, 0x57a442], h) });
  const leafLit = toon({ color: 0x8cc242 });
  const doorMat = toon({ color: 0xf0e3c8 });
  const glassMat = toon({ color: 0x8fd8ee });
  const ropeMat = toon({ color: 0xe3d5b0 });
  const tyreMat = toon({ color: 0x2f3238 });

  // --- trunk: 0 to 0.80H, so it runs up BEHIND the house and into the canopy.
  // SLIMMER and less flared than the first build, which produced a smooth
  // brown cone as wide as the house — so the house read as a hat balanced on
  // a bollard rather than as a room built into a tree. A trunk you can see
  // PAST on both sides is what makes the house look supported.
  const trunkTopR = 0.055 * W;
  const trunk = part(
    trunkGeometry(flaredTrunkProfile(trunkTopR * 1.5, 0.82 * H, 2.6, 7), 9),
    barkMat,
    "trunk",
    g,
  );
  trunk.rotation.y = r() * Math.PI * 2;

  // --- the house body. Its floor is the deck at 0.34H; walls to 0.56H.
  const deckY = 0.34 * H;
  const wallH = 0.22 * H;
  const bodyW = 0.52 * W;
  const bodyD = 0.44 * W;
  const house = new THREE.Group();
  house.name = "house";
  house.position.set(0.03 * W, 0, 0.02 * W);
  g.add(house);

  const walls = part(new THREE.BoxGeometry(bodyW, wallH, bodyD), plankMat, "walls", house);
  walls.position.y = deckY + wallH / 2;

  // Plank grooves: three thin dark slabs standing a hair proud of the front
  // wall. Cheaper than modelling boards and it survives the distance, which a
  // texture line would not.
  for (let i = 0; i < 3; i++) {
    const groove = part(
      new THREE.BoxGeometry(0.012 * W, wallH * 0.92, 0.004 * W),
      plankDark,
      `groove${i}`,
      house,
    );
    groove.position.set((i - 1) * bodyW * 0.3, deckY + wallH / 2, bodyD / 2 + 0.003 * W);
  }

  // Door: a tall arched panel, pale against the wall.
  const doorW = 0.13 * W;
  const doorH = wallH * 0.72;
  const doorShape = new THREE.Shape();
  doorShape.moveTo(-doorW / 2, 0);
  doorShape.lineTo(-doorW / 2, doorH - doorW / 2);
  doorShape.absarc(0, doorH - doorW / 2, doorW / 2, Math.PI, 0, true);
  doorShape.lineTo(doorW / 2, 0);
  doorShape.closePath();
  const door = part(
    new THREE.ExtrudeGeometry(doorShape, { depth: 0.01 * W, bevelEnabled: false, curveSegments: 4 }),
    doorMat,
    "door",
    house,
  );
  door.position.set(-bodyW * 0.02, deckY + 0.01 * H, bodyD / 2);

  // Window: a round pane with a frame, on the door's right.
  const win = part(new THREE.CylinderGeometry(0.05 * W, 0.05 * W, 0.012 * W, 10), glassMat, "window", house);
  win.rotation.x = Math.PI / 2;
  win.position.set(bodyW * 0.3, deckY + wallH * 0.72, bodyD / 2 + 0.004 * W);
  const winFrame = part(
    new THREE.TorusGeometry(0.052 * W, 0.011 * W, 6, 12),
    plankDark,
    "windowFrame",
    house,
  );
  winFrame.position.copy(win.position);

  // --- gable roof: two slabs meeting at a ridge. Eaves at 0.926W, per the
  // measurement, so the roof visibly OVERHANGS the walls on every side —
  // which is what a cartoon roof is, and a roof flush with its walls reads as
  // a lid on a box.
  // 0.72W, NOT the 0.926 the band scan reported. That measurement is real and
  // it is not the roof: at the roof's height the reference's silhouette also
  // contains the foliage flanking it, and taking the whole span gave a roof
  // nearly twice the width of its own walls — a shallow pair of planks with
  // the house cowering under them. The roof's own overhang, read against the
  // wall line rather than against the frame, is about a third each side.
  const roofSpan = 0.72 * W;
  // And STEEP. 0.14H put the pitch at 20 degrees; the reference's is nearer
  // 40, and a shallow gable on a small cartoon building reads as a lean-to.
  const roofRise = 0.2 * H;
  const slabLen = Math.hypot(roofSpan / 2, roofRise);
  const pitch = Math.atan2(roofRise, roofSpan / 2);
  for (const side of [-1, 1]) {
    const slab = part(
      new THREE.BoxGeometry(slabLen, 0.022 * H, bodyD * 1.22),
      roofMat,
      side < 0 ? "roofLeft" : "roofRight",
      house,
    );
    slab.position.set((side * roofSpan) / 4, deckY + wallH + roofRise / 2, 0);
    slab.rotation.z = -side * pitch;
  }
  // The ridge cap has to be big enough to actually cover where the two slabs
  // meet — two boxes meeting at an angle leave an open wedge at the apex, and
  // a cap narrower than that wedge hides nothing.
  const ridge = part(
    new THREE.BoxGeometry(0.075 * W, 0.05 * H, bodyD * 1.3),
    plankDark,
    "ridge",
    house,
  );
  ridge.position.set(0, deckY + wallH + roofRise, 0);

  // The pediment. Without it the house is open between the wall top and the
  // roof on both the front and the back, and you can see the sky through it.
  const gable = part(
    gableFillGeometry(bodyW, roofSpan, roofRise, bodyD),
    plankMat,
    "gable",
    house,
  );
  gable.position.set(0, deckY + wallH, 0);

  // --- balcony: the widest thing on the model (0.974 measured), and the
  // reason the house reads as somewhere you could stand.
  const deckW = 0.72 * W;
  const deckD = 0.62 * W;
  const deck = part(new THREE.BoxGeometry(deckW, 0.02 * H, deckD), plankMat, "deck", house);
  deck.position.y = deckY - 0.01 * H;

  // Railing along the front and the two sides. Posts only on the FRONT: at
  // this size a full cage of posts closes the deck into a solid band and the
  // balcony stops reading as open.
  const railY = deckY + 0.055 * H;
  const railFront = part(
    new THREE.BoxGeometry(deckW, 0.014 * H, 0.016 * W),
    plankDark,
    "railFront",
    house,
  );
  railFront.position.set(0, railY, deckD / 2);
  for (let i = 0; i < 6; i++) {
    const post = part(
      new THREE.BoxGeometry(0.016 * W, 0.06 * H, 0.016 * W),
      plankMat,
      `railPost${i}`,
      house,
    );
    post.position.set((i / 5 - 0.5) * deckW * 0.92, deckY + 0.03 * H, deckD / 2);
  }
  for (const side of [-1, 1]) {
    const railSide = part(
      new THREE.BoxGeometry(0.016 * W, 0.014 * H, deckD),
      plankDark,
      side < 0 ? "railLeft" : "railRight",
      house,
    );
    railSide.position.set((side * deckW) / 2, railY, 0);
  }

  // --- ladder up to the deck, on the front face.
  const ladder = new THREE.Group();
  ladder.name = "ladder";
  ladder.position.set(0.06 * W, 0, deckD * 0.52 + 0.03 * W);
  g.add(ladder);
  const ladderH = deckY;
  for (const side of [-1, 1]) {
    const rail = part(
      new THREE.BoxGeometry(0.016 * W, ladderH, 0.016 * W),
      plankMat,
      side < 0 ? "ladderRailL" : "ladderRailR",
      ladder,
    );
    rail.position.set(side * 0.045 * W, ladderH / 2, 0);
  }
  const rungs = 7;
  for (let i = 0; i < rungs; i++) {
    const rung = part(
      new THREE.BoxGeometry(0.1 * W, 0.014 * H, 0.014 * W),
      plankDark,
      `rung${i}`,
      ladder,
    );
    rung.position.y = ((i + 0.6) / rungs) * ladderH;
  }

  // --- tyre swing, hung off a branch on the right. The single most
  // recognisable thing in the reference after the roof, and it costs one
  // torus and one cylinder.
  const swing = new THREE.Group();
  swing.name = "swing";
  swing.position.set(0.42 * W, 0, 0.16 * W);
  g.add(swing);
  // SHORTER than the first build's 0.2H. A torus hangs by its own outer
  // radius below wherever its centre is, and at 0.2H the tyre's bottom
  // finished 0.023 units UNDERGROUND — a prop sunk into the floor, from a
  // model that renders perfectly in a turntable because the turntable has no
  // floor at that point. Only measuring the vertices finds this.
  const ropeLen = 0.14 * H;
  const tyreR = 0.07 * W;
  const tyreT = 0.026 * W;
  const rope = part(
    new THREE.CylinderGeometry(0.008 * W, 0.008 * W, ropeLen, 4),
    ropeMat,
    "rope",
    swing,
  );
  rope.position.y = deckY - ropeLen / 2 - 0.02 * H;
  const tyre = part(
    new THREE.TorusGeometry(tyreR, tyreT, 6, 12),
    tyreMat,
    "tyre",
    swing,
  );
  tyre.position.y = deckY - 0.02 * H - ropeLen - tyreT * 1.4;
  tyre.rotation.x = 0.32;

  // The branch the swing hangs from, so the rope starts at something.
  const swingBranch = part(
    new THREE.CylinderGeometry(0.018 * W, 0.03 * W, 0.42 * W, 5),
    barkMat,
    "swingBranch",
    g,
  );
  swingBranch.position.set(0.24 * W, deckY + 0.01 * H, 0.1 * W);
  swingBranch.rotation.z = Math.PI / 2 - 0.18;

  // --- canopy: three lobed masses ABOVE and BEHIND the roof, their centre of
  // mass pushed to the model's left. The measured cx runs 0.37-0.39 through
  // the canopy against 0.50 for the house; centring it turns the tree into a
  // hat.
  const canopy = new THREE.Group();
  canopy.name = "canopy";
  g.add(canopy);
  const cy = deckY + wallH + roofRise;
  // RAISED, and this is the third position these have been in. The first build
  // floated them in a line high above the roof, which read as a cloud parked
  // over a house; the second dropped them onto the ridge, which fixed the
  // floating and then hid the roof — the red gable is the most recognisable
  // thing on the model and half of it was buried in leaves. They now clear the
  // ridge with daylight under them, held to the tree by the branches rather
  // than by overlapping it.
  //
  // The lesson is the useful part: a canopy that OVERLAPS the roof and a
  // canopy that is CONNECTED to the tree are not the same requirement, and
  // solving the second with the first costs the building.
  const masses: Array<[number, number, number, number, THREE.Material]> = [
    [-0.16 * W, cy + 0.3 * H, -0.06 * W, 0.38 * W, leafMat],
    [0.24 * W, cy + 0.22 * H, -0.16 * W, 0.27 * W, leafMat],
    [-0.04 * W, cy + 0.42 * H, 0.02 * W, 0.25 * W, leafLit],
    [-0.36 * W, cy + 0.14 * H, 0.12 * W, 0.23 * W, leafMat],
  ];
  masses.forEach(([x, y, z, rad, mat], i) => {
    const m = part(
      lobedFoliageGeometry(rad, {
        detail: 2,
        lobes: 13,
        scale: [1, 0.82, 1],
        seed: 200 + i * 17 + Math.floor(h * 29),
      }),
      mat,
      `canopy${i}`,
      canopy,
    );
    m.position.set(x, y, z);
    m.rotation.y = r() * Math.PI * 2;
  });

  // A skirt of foliage at deck height on the far side, which is what makes the
  // house look EMBEDDED in the tree rather than bolted to a pole. It is the
  // measured 0.974-wide band at 0.625 of the height.
  const skirt = part(
    lobedFoliageGeometry(0.22 * W, {
      detail: 2,
      lobes: 11,
      scale: [1.15, 0.6, 1],
      seed: 260 + Math.floor(h * 19),
    }),
    leafMat,
    "canopySkirt",
    canopy,
  );
  // BELOW the deck, not level with it. At deck height the skirt sits inside
  // the house's own footprint (the body spans -0.36W to 0.42W) — so the branch
  // holding it ran straight through the building and was invisible for its
  // whole length, which is the same "correctly built, entirely hidden" failure
  // as the birdhouse's dark plate. Dropped and pushed out, it reads as a lower
  // limb of the tree with the balcony above it.
  // Far enough OUT that a stretch of bark shows between the trunk's flare and
  // the leaves. At -0.46W it sat against the trunk and the branch was buried
  // for its whole length — the foliage read as a bush growing at the base
  // rather than as something the tree is holding up, which is the same defect
  // in a third place: built, correct, and behind another surface.
  const skirtPos = new THREE.Vector3(-0.56 * W, deckY - 0.1 * H, -0.06 * W);
  skirt.position.copy(skirtPos);

  // THE BRANCH THE SKIRT GROWS ON. Foliage floating beside a trunk with
  // nothing joining the two is the defect the two under-deck braces were
  // supposed to distract from, and they did not — they read as a pair of
  // sticks under the balcony doing no visible job, so they are gone and this
  // is here instead. It does the same structural work honestly: it is what
  // the leaves are attached to.
  //
  // Aimed with `setFromUnitVectors` off the actual endpoints rather than with
  // hand-written Euler angles (IDEA-055 rule 4) — the two ends are known
  // positions, so solving for the rotation is exact and stays right if either
  // end moves.
  // Starts OUTSIDE the trunk's own radius at that height (the flare is wide
  // low down) and ends short of the skirt's centre, so both ends are buried in
  // something solid and neither shows a cut face.
  const branchFrom = new THREE.Vector3(-0.05 * W, deckY - 0.16 * H, -0.03 * W);
  const branchTo = skirtPos.clone().add(new THREE.Vector3(0.1 * W, -0.01 * H, 0.01 * W));
  const branchVec = branchTo.clone().sub(branchFrom);
  const branch = part(
    new THREE.CylinderGeometry(0.017 * W, 0.032 * W, branchVec.length(), 6),
    barkMat,
    "skirtBranch",
    g,
  );
  branch.position.copy(branchFrom).addScaledVector(branchVec, 0.5);
  branch.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    branchVec.clone().normalize(),
  );

  return g;
}

// ---------------------------------------------------------------------------
// 4. THE FIVE FLOWERS —
//    .img2threejs/reference/props/flowergarden/image.png
//
// One shape, five kinds. They stand on WALL TOPS, which puts them at roughly
// eight pixels at the game camera, so two things drive every decision here:
//
//  a. SHAPE SEPARATES THEM, NOT DETAIL. The rose and the tulip are both red
//     in the reference, so colour cannot tell them apart at any size — a
//     layered BALL against a closed CUP has to. Same problem the maki and the
//     nigiri had and the same answer (IDEA-056 rule 1): verified by rendering
//     all five together at play scale, never asserted.
//
//  b. PETAL COUNTS COME DOWN. Sunflower 16 against a measured 20, daisy 10
//     against 14. The reference is a poster; this is an eight-pixel object.
// ---------------------------------------------------------------------------

/** A flat petal: a rounded blade lying in XZ, pointing +X from the origin, so
 *  a caller places it by rotating about Y and tilting about Z. */
function petalGeometry(len: number, wide: number, thick: number, pointy: boolean): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const w = wide / 2;
  s.moveTo(0, 0);
  if (pointy) {
    // Teardrop: swells fast, then runs to a point. The sunflower's ray.
    s.quadraticCurveTo(len * 0.3, w, len * 0.62, w * 0.78);
    s.quadraticCurveTo(len * 0.9, w * 0.42, len, 0);
    s.quadraticCurveTo(len * 0.9, -w * 0.42, len * 0.62, -w * 0.78);
    s.quadraticCurveTo(len * 0.3, -w, 0, 0);
  } else {
    // Rounded blade with a domed tip. The daisy's ray and the blossom's petal.
    s.quadraticCurveTo(len * 0.22, w * 0.92, len * 0.68, w);
    s.quadraticCurveTo(len * 1.06, w * 0.9, len, 0);
    s.quadraticCurveTo(len * 1.06, -w * 0.9, len * 0.68, -w);
    s.quadraticCurveTo(len * 0.22, -w * 0.92, 0, 0);
  }
  // bevelEnabled false, always: the bevel grows OUTWARD and would make every
  // petal wider and longer than the number asked for (IDEA-057 rule 4).
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 3 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * A pivot for one shell at azimuth `a`: spin about Y, then place the shell at
 * +Z inside it and tilt about X.
 *
 * IDEA-055 rule 4 in a new place — aim a part with a frame, not with
 * hand-written Euler angles. Three.js applies an XYZ Euler as Rx*Ry*Rz, so a
 * `rotation.z` lean written on the same object as a `rotation.y` spin is
 * itself rotated by that spin, and the lean ends up pointing somewhere
 * between radial and tangential depending on the azimuth. The first build of
 * the rose and the tulip did exactly that: every shell faced TANGENTIALLY, so
 * the rose read as a pinwheel and the tulip's cup could not close.
 *
 * Inside the pivot the axes mean one thing each: +Z is outward, and
 * `rotation.x` tilts the shell's top OUT for positive and IN for negative.
 */
function shellPivot(parent: THREE.Object3D, a: number, name: string): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.rotation.y = a;
  parent.add(pivot);
  return pivot;
}

const FLOWER_DEFAULTS: Record<GardenFlowerKind, { petal: number; centre: number; stem: number }> = {
  daisy: { petal: 0xfaf6ec, centre: 0xf2b632, stem: 0x4e8f3a },
  sunflower: { petal: 0xf5c518, centre: 0x6b4526, stem: 0x3f8f3a },
  rose: { petal: 0xd8384a, centre: 0x9c2333, stem: 0x4e8f3a },
  tulip: { petal: 0xd42f4c, centre: 0xf09aa8, stem: 0x5f9a45 },
  blossom: { petal: 0xb289de, centre: 0xf3e46a, stem: 0x4e8f3a },
};

export function makeGardenFlower(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const kind = (params.flowerKind ?? "daisy") as GardenFlowerKind;
  const width = params.width ?? 1;
  const height = params.height ?? 1;
  const def = FLOWER_DEFAULTS[kind];
  const petalCol = params.petalColor ?? def.petal;
  const centreCol = params.centerColor ?? def.centre;
  const r = rand(h);

  const petalMat = toon({ color: petalCol });
  const centreMat = toon({ color: centreCol });
  const stemMat = toon({ color: def.stem });

  // The sunflower stands taller than the rest, exactly as in the reference —
  // it is the one flower whose height is part of its identity.
  const stemH = (kind === "sunflower" ? 0.3 : kind === "rose" ? 0.21 : 0.24) * height;
  const stem = part(
    new THREE.CylinderGeometry(0.011 * width, 0.015 * width, stemH, 5),
    stemMat,
    "stem",
    g,
  );
  stem.position.y = stemH / 2;
  // A slight lean, so a bed of them is not a parade.
  const lean = (r() - 0.5) * 0.24;
  g.rotation.z = lean;
  g.rotation.y = r() * Math.PI * 2;

  // Leaves: two blades off the stem. The tulip gets STRAP leaves from the
  // base instead, which is one of its separators.
  const leafMat = toon({ color: def.stem });
  if (kind === "tulip") {
    for (const side of [-1, 1]) {
      const leaf = part(petalGeometry(0.17 * height, 0.05 * width, 0.008, true), leafMat, side < 0 ? "leafL" : "leafR", g);
      leaf.position.set(side * 0.015 * width, 0.02, 0);
      // The SIDE comes from rotation.y and the LIFT from rotation.z, and the
      // lift is positive on both. Signing the lift by side instead was the
      // first build's bug and it put the left leaf 0.14 units UNDER THE FLOOR
      // — invisible in every render, obvious the moment the prop was measured
      // from its vertices (scripts/_scratch-prop-measure.ts).
      leaf.rotation.y = side < 0 ? Math.PI : 0;
      leaf.rotation.z = 1.15;
    }
  } else {
    for (const side of [-1, 1]) {
      const leaf = part(petalGeometry(0.075 * width, 0.045 * width, 0.007, false), leafMat, side < 0 ? "leafL" : "leafR", g);
      leaf.position.set(0, stemH * (side < 0 ? 0.42 : 0.6), 0);
      leaf.rotation.y = side < 0 ? Math.PI * 0.85 : -0.1;
      leaf.rotation.z = 0.5;
    }
  }

  const head = new THREE.Group();
  head.name = "head";
  head.position.y = stemH;
  g.add(head);

  if (kind === "daisy" || kind === "sunflower") {
    // A flat disc of rays with an eye in the middle. The two differ on three
    // measured axes at once — ray count, ray shape, and how much of the head
    // the eye takes (0.24 against 0.43) — which is what keeps a white daisy
    // and a yellow sunflower from being the same object in two colours.
    const sun = kind === "sunflower";
    const rays = sun ? 16 : 10;
    const headR = (sun ? 0.115 : 0.085) * width;
    const eyeR = headR * (sun ? 0.43 : 0.24);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const p = part(
        petalGeometry(headR - eyeR * 0.4, headR * (sun ? 0.42 : 0.5), 0.014, sun),
        petalMat,
        `ray${i}`,
        head,
      );
      p.position.set(Math.cos(a) * eyeR * 0.72, 0, Math.sin(a) * eyeR * 0.72);
      p.rotation.y = -a;
      // Rays lift toward the sky rather than lying flat: at the game camera's
      // 59 degrees a perfectly flat disc is the one orientation that gives no
      // shading variation at all across the whole head.
      // POSITIVE is up. rotation.z is applied before rotation.y, so it stays
      // a clean lift at every azimuth — see shellPivot for the case where
      // that stops being true.
      p.rotation.z = 0.22;
    }
    const disc = part(new THREE.CylinderGeometry(eyeR, eyeR * 0.92, 0.03 * width, 12), centreMat, "eye", head);
    disc.position.y = 0.012 * width;
    if (sun) {
      // The reference's disc has a distinctly darker inner button, at 0.23 of
      // the head against the disc's 0.43. It is the sunflower's own two-tone
      // and it survives the shrink because it is a value step, not a detail.
      const inner = part(
        new THREE.CylinderGeometry(eyeR * 0.54, eyeR * 0.54, 0.034 * width, 10),
        toon({ color: 0x4a2c17 }),
        "eyeInner",
        head,
      );
      inner.position.y = 0.016 * width;
    }
  } else if (kind === "rose") {
    // A rose head is a CABBAGE: a solid core with petals wrapped around it in
    // rings, each ring standing more upright than the last. Every number here
    // is about closing gaps.
    //
    // The first build got the arrangement right and the CONSTRUCTION wrong —
    // open shells splaying off nothing, so between every pair of petals you
    // saw straight through the head, and the shells' own top rims read as
    // spikes. It rendered as a broken artichoke. Three fixes, all necessary:
    // a solid core so the centre is never empty, arcs wide enough that
    // neighbouring petals OVERLAP rather than abut, and the outer ring is the
    // only one that leans out.
    const R = 0.082 * width;
    const core = part(new THREE.SphereGeometry(R * 0.62, 9, 7), centreMat, "core", head);
    core.position.y = R * 0.72;
    const RINGS: Array<[number, number, number, number]> = [
      // count, radius scale, height, lean (positive = out)
      [5, 1.0, 0.42, 0.42],
      [4, 0.78, 0.72, 0.16],
      [3, 0.55, 0.95, -0.08],
    ];
    RINGS.forEach(([count, rs, hy, lean], ring) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + ring * 0.7;
        const pivot = shellPivot(head, a, `whorlPivot${ring}_${i}`);
        const p = part(
          // radiusTop > radiusBottom, so the petal is WIDER at its lip — a
          // rose petal opens outward, and a shell that tapers the other way
          // reads as a bud scale.
          new THREE.CylinderGeometry(R * rs * 0.86, R * rs * 0.6, R * 0.92, 7, 1, true, -Math.PI * 0.62, Math.PI * 1.24),
          ring === 2 ? centreMat : petalMat,
          `whorl${ring}_${i}`,
          pivot,
        );
        p.position.set(0, R * hy, R * rs * 0.3);
        p.rotation.x = lean;
      }
    });
    // The green sepal collar UNDER the head. Down and out — a sepal that
    // lifts pokes through the petals it is meant to cradle.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const sep = part(petalGeometry(R * 0.8, R * 0.4, 0.006, true), stemMat, `sepal${i}`, head);
      sep.position.set(Math.cos(a) * R * 0.3, R * 0.18, Math.sin(a) * R * 0.3);
      sep.rotation.y = -a;
      sep.rotation.z = -0.7;
    }
  } else if (kind === "tulip") {
    // A CLOSED egg-shaped cup. Closed is the whole separation from the rose,
    // the other red flower — and the shape has to be an EGG, taller than it
    // is wide, or a three-shell cup reads as a lampshade, which is what the
    // first build rendered as: flat-topped, hexagonal and flaring downward.
    //
    // Three changes bought the egg: it is taller than wide (0.155 against
    // 0.124), the shells carry more segments so the cup is round rather than
    // faceted, and there is a DOME closing the top. An open cup at the play
    // camera's 59 degrees is looked straight down into, so the one thing the
    // player sees is whether it is shut.
    const R = 0.062 * width;
    const cupH = 0.155 * height;
    const throat = part(new THREE.SphereGeometry(R * 0.66, 9, 7), centreMat, "throat", head);
    throat.position.y = cupH * 0.78;
    throat.scale.y = 1.2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pivot = shellPivot(head, a, `cupPivot${i}`);
      // A wide arc, so the three petals OVERLAP into a closed wall instead of
      // leaving three slots down the sides.
      const p = part(
        new THREE.CylinderGeometry(R * 0.5, R * 0.94, cupH, 10, 1, true, -Math.PI * 0.72, Math.PI * 1.44),
        petalMat,
        `cup${i}`,
        pivot,
      );
      p.position.set(0, cupH * 0.5, R * 0.22);
      // Leaning INWARD at the top, so the cup CLOSES. Inside a shellPivot
      // negative is in and positive is out, unambiguously. A tulip whose
      // petals splay open is a poppy.
      p.rotation.x = -0.1;
    }
    // The rounded base the petals sit in, and the tips closing over the top.
    const base = part(new THREE.SphereGeometry(R * 0.92, 10, 8), petalMat, "cupBase", head);
    base.position.y = cupH * 0.2;
    base.scale.y = 0.8;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      const pivot = shellPivot(head, a, `tipPivot${i}`);
      const tip = part(petalGeometry(R * 0.86, R * 0.8, 0.01, true), petalMat, `tip${i}`, pivot);
      tip.position.set(0, cupH * 0.86, R * 0.18);
      // Nearly vertical, curling over the throat: this is the pinch at the
      // top of a tulip and it is what stops the cup reading as a tube.
      tip.rotation.y = -Math.PI / 2;
      tip.rotation.z = 1.15;
    }
  } else {
    // Blossom: two rings of broad rounded petals, the back ring lower and
    // rotated half a step off the front so the outline reads as ten petals
    // rather than five thick ones — the reference's own arrangement.
    const R = 0.095 * width;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + ring * (Math.PI / 5);
        const p = part(
          petalGeometry(R * (ring === 0 ? 1 : 0.82), R * 0.86, 0.015, false),
          petalMat,
          `petal${ring}_${i}`,
          head,
        );
        p.position.set(Math.cos(a) * R * 0.22, ring === 0 ? 0 : R * 0.2, Math.sin(a) * R * 0.22);
        p.rotation.y = -a;
        // Ring 0 is the outer, lower one and droops very slightly; ring 1 is
        // the inner, upper one and LIFTS. That is what domes the head. Both
        // drooping (the first build) gives a flat plate with a bump on it.
        p.rotation.z = ring === 0 ? -0.1 : 0.45;
      }
    }
    const eye = part(new THREE.SphereGeometry(R * 0.24, 8, 6), centreMat, "eye", head);
    eye.position.y = R * 0.3;
    eye.scale.y = 0.7;
  }
  return g;
}

// ---------------------------------------------------------------------------
// 5. THE BIRDHOUSE — .img2threejs/reference/props/birdhouse/image.png
//
// Measured: 0.617 wide over tall. Roof 25% of the height, box 20%, platform
// 10%, post 35%. The roof EAVES are the widest thing on it (0.98 of the
// width) and the platform under the box is wider than the box itself (0.755
// against 0.65) — so the silhouette steps wide / narrow / wide / thin on the
// way down. That stepping IS the identity; a box with a lid on a stick is not
// a birdhouse, it is a letterbox.
//
// It is built to work in BOTH places Nuno asked for — on a wall top and on
// the ground — which is why the post is part of the prop rather than the
// thing it stands on.
// ---------------------------------------------------------------------------

export function makeBirdhouse(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const r = rand(h);

  const H = 0.72 * height;
  const W = 0.44 * width;

  const woodMat = toon({ color: 0xe8c286 });
  const woodDark = toon({ color: 0xc59a5c });
  const roofMat = toon({ color: 0xdcb06e });
  const postMat = toon({ color: params.trunkColor ?? 0x6b4a2f });
  // The entrance's interior. Genuinely dark, not just darker — the whole read
  // of a hole is that no light comes out of it.
  const holeMat = toon({ color: 0x3b2a1c });

  // --- post: 0.55H to 0.90H measured from the top, i.e. the bottom 0.35 of
  // the model. Tapered and slightly leaning, because the reference's is a cut
  // branch rather than a turned dowel.
  const postH = 0.35 * H;
  const post = part(
    trunkGeometry(flaredTrunkProfile(0.09 * W, postH, 2.1, 5), 7),
    postMat,
    "post",
    g,
  );
  post.rotation.y = r() * Math.PI * 2;

  // --- platform: wider than the box above it (0.755 against 0.65).
  const platY = postH;
  const platform = part(
    new THREE.BoxGeometry(0.755 * W, 0.07 * H, 0.62 * W),
    woodDark,
    "platform",
    g,
  );
  platform.position.y = platY + 0.035 * H;

  // --- box: the front is an extruded Shape with the ENTRANCE CUT OUT of it,
  // not a disc painted on. See rule 2 at the top of this file: the dark plate
  // behind sits at a z that is genuinely further back than the front wall's
  // own inner face, or the wall shows through the hole and the entrance
  // renders as a brown coin.
  const boxW = 0.65 * W;
  const boxH = 0.2 * H;
  const boxD = 0.5 * W;
  const boxY = platY + 0.07 * H;

  const front = new THREE.Shape();
  front.moveTo(-boxW / 2, 0);
  front.lineTo(boxW / 2, 0);
  front.lineTo(boxW / 2, boxH);
  front.lineTo(-boxW / 2, boxH);
  front.closePath();
  // The entrance is BIG — the reference's arch is nearly half the box wide.
  // A realistic small round hole is four pixels of shadow at play size and
  // reads as dirt.
  const holeW = boxW * 0.46;
  const arch = new THREE.Path();
  arch.moveTo(-holeW / 2, 0);
  arch.lineTo(-holeW / 2, boxH * 0.42);
  arch.absarc(0, boxH * 0.42, holeW / 2, Math.PI, 0, true);
  arch.lineTo(holeW / 2, 0);
  arch.closePath();
  front.holes.push(arch);

  const wallT = 0.09 * W;
  const shell = part(
    new THREE.ExtrudeGeometry(front, { depth: wallT, bevelEnabled: false, curveSegments: 5 }),
    woodMat,
    "front",
    g,
  );
  shell.position.set(0, boxY, boxD / 2 - wallT);

  // The rest of the box, behind the pierced front — AND SET BACK FROM IT.
  //
  // This is IDEA-058's buried-mouth defect, hit again in the place its own
  // rule names. The first build made the body exactly `boxD - wallT` deep and
  // butted it against the pierced wall, so the surface visible through the
  // entrance was the BODY'S OWN FRONT FACE in the same tan wood, and the
  // aperture rendered as an arch drawn on a solid box. The dark plate was
  // built, correctly coloured, and sitting INSIDE the body where nothing
  // could see it.
  //
  // A hole needs a RECESS to look into. The body is pulled back by one, and
  // the dark plate stands in the gap.
  const recess = 0.06 * W;
  const body = part(
    new THREE.BoxGeometry(boxW, boxH, boxD - wallT - recess),
    woodMat,
    "body",
    g,
  );
  body.position.set(0, boxY + boxH / 2, -(wallT + recess) / 2);
  const cavity = part(
    new THREE.BoxGeometry(boxW * 0.94, boxH * 0.94, 0.02 * W),
    holeMat,
    "cavity",
    g,
  );
  cavity.position.set(0, boxY + boxH / 2, boxD / 2 - wallT - recess + 0.01 * W);

  // --- roof: a gable whose eaves reach 0.98 of the width, i.e. it overhangs
  // the box by nearly a third on each side. That overhang is the measurement
  // and it is what makes the top step of the silhouette.
  const roofSpan = 0.98 * W;
  const roofRise = 0.18 * H;
  const roofY = boxY + boxH;
  const slabLen = Math.hypot(roofSpan / 2, roofRise);
  const pitch = Math.atan2(roofRise, roofSpan / 2);
  for (const side of [-1, 1]) {
    const slab = part(
      new THREE.BoxGeometry(slabLen, 0.035 * H, boxD * 1.16),
      roofMat,
      side < 0 ? "roofLeft" : "roofRight",
      g,
    );
    slab.position.set((side * roofSpan) / 4, roofY + roofRise / 2, 0);
    slab.rotation.z = -side * pitch;
  }
  const ridge = part(new THREE.BoxGeometry(0.04 * W, 0.03 * H, boxD * 1.2), woodDark, "ridge", g);
  ridge.position.set(0, roofY + roofRise, 0);

  // The pediment, front and back. The roof overhangs the box by a third on
  // each side, so at the box's own edge the slabs are still well clear of the
  // wall top and the building was open to the sky through that wedge.
  const gable = part(
    gableFillGeometry(boxW, roofSpan, roofRise, boxD),
    woodMat,
    "gable",
    g,
  );
  gable.position.set(0, roofY, 0);

  // --- the bird. Optional, and on by default, because it is the thing that
  // makes the prop read as a birdhouse in one glance rather than as a
  // mailbox — the same job the tyre swing does for the treehouse. It perches
  // on the ridge.
  if (params.showBird !== false) {
    const bird = new THREE.Group();
    bird.name = "bird";
    bird.position.set(0.04 * W, roofY + roofRise + 0.015 * H, 0);
    bird.rotation.y = -0.5 + r() * 1.0;
    g.add(bird);
    const blue = toon({ color: params.birdColor ?? 0x3f9ede });
    const bluePale = toon({ color: 0x86cdf0 });
    const beakMat = toon({ color: 0xf2b134 });

    const body2 = part(new THREE.SphereGeometry(0.1 * W, 9, 7), blue, "body", bird);
    body2.position.y = 0.1 * W;
    body2.scale.set(1, 1.05, 1.15);
    const belly = part(new THREE.SphereGeometry(0.07 * W, 8, 6), bluePale, "belly", bird);
    belly.position.set(0, 0.085 * W, 0.055 * W);
    const head2 = part(new THREE.SphereGeometry(0.072 * W, 9, 7), blue, "head", bird);
    head2.position.set(0, 0.2 * W, 0.03 * W);
    const beak = part(new THREE.ConeGeometry(0.025 * W, 0.055 * W, 5), beakMat, "beak", bird);
    beak.position.set(0, 0.196 * W, 0.1 * W);
    beak.rotation.x = Math.PI / 2;
    const tail = part(new THREE.BoxGeometry(0.05 * W, 0.018 * W, 0.1 * W), blue, "tail", bird);
    tail.position.set(0, 0.1 * W, -0.13 * W);
    tail.rotation.x = -0.35;
    // The eye is the shared stack every enemy uses — sclera ball, dark cap,
    // catchlight (IDEA-057 rule 8). A single dark dot on a blue head loses the
    // eye entirely wherever the light falls off.
    for (const side of [-1, 1]) {
      const sclera = part(new THREE.SphereGeometry(0.022 * W, 7, 6), toon({ color: 0xf7f2e6 }), side < 0 ? "scleraL" : "scleraR", bird);
      sclera.position.set(side * 0.04 * W, 0.215 * W, 0.05 * W);
      const pupil = part(new THREE.SphereGeometry(0.013 * W, 6, 5), toon({ color: 0x241a14 }), side < 0 ? "pupilL" : "pupilR", bird);
      pupil.position.set(side * 0.048 * W, 0.215 * W, 0.062 * W);
    }
  }

  return g;
}
