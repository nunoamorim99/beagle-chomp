// OWNER: render-artist (IDEA-085 — Pirate Island, the world around the maze)
//
// Nuno: *"my idea is to have a island, so the ground should be sand but we can
// have a little bit of green too. Then the trees should be like palm beach. On
// the north side we can have like a shipwreck on the north left side... the
// ship should be on the water. On the south side we can have like a treasure
// chest and some decoration like swords and guns, like pirate symbols. Then on
// the sides more close to the maze not the props but the environment can have
// like parts of the ship, cannon, flags, wheel."*
//
// The DISTANT builders for that brief, in surroundProps.ts's idiom: every one
// returns a Group standing on y = 0, names every mesh, and draws only from the
// shared `SurroundMaterials` set, so `mergeBySignature` welds the whole island
// into one mesh per material however much is standing on it.
//
// FOUR THINGS ARE LOAD-BEARING.
//
//  1. THE WOOD IS FOUR RUNGS, NOT ONE BROWN. A ship, a cannon carriage, a
//     barrel and a palm are all "brown" in a reference, and under the shipped
//     style four browns of one hue snap onto one palette entry and become one
//     matcap (IDEA-065 rule 9 — the log cabin's nine browns that landed on
//     four). So the set carries them on four different rungs: tarred HULL and
//     IRON are declared ink, deck PLANK is `wood`, PALM BARK is `sand`. The
//     wreck reads as a dark hull around a pale deck because of it — which is
//     also what a listing ship shows a camera that looks down.
//
//  2. NOTHING THIN IS ASKED TO BE DARK. Under a matcap a thin rod returns the
//     bounce colour, not its own (IDEA-065 rule 27), so a dark rope or a dark
//     sword blade renders near-white. Masts and spokes are chunky; the sword
//     blade is PALE on purpose (it is steel catching the sun); the black flag
//     is a slab, not a ribbon.
//
//  3. SIZED FOR WHERE IT STANDS. The fringe is the band nearest the board and
//     the largest anything in the surround ever draws, and the south band is
//     unfogged and under the HUD (IDEA-066 rule 6). So the south's things are
//     LOW — a chest, swords in the sand, a pistol pair, a skull — and the only
//     tall thing in the whole island that is meant to be tall is the wreck's
//     mast, out on the water to the north, where nothing can occlude the maze.
//
//  4. THE BUDGET IS PER BUILDER. `test-surround.ts` holds every one of these to
//     the surround's own 600 triangles, except the wreck, which is a landmark
//     built ONCE and gets its own ceiling there.
import * as THREE from "three";
import { lobedFoliageGeometry } from "./foliage";
import { type SurroundMaterials, part, seeded } from "./surroundProps";

// ---------------------------------------------------------------------------
// The palm

/**
 * One frond: a FOLDED leaf — a raised midrib with the two halves falling away
 * either side — arching out and drooping, with its width zig-zagging along the
 * length so the edge reads as a palm's leaflets rather than a paddle.
 *
 * Closed underneath (a second, lower skin), because the play camera sees the
 * far fronds' undersides as they droop away from it and an open strip culls to
 * nothing there.
 *
 * Built along local +X from the crown, so a caller only has to spin it about Y.
 */
function frondGeometry(len: number, width: number, droop: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  // Per station: left edge, midrib top, right edge, midrib underside.
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = t * len;
    // Rises a little out of the crown, then falls: a palm frond's arch.
    const y = Math.sin(t * Math.PI * 0.55) * len * 0.18 - droop * t * t * len;
    // Widest a third of the way out, a point at the tip, and ZIG-ZAGGED every
    // other station — the leaflets, at a resolution the camera can hold.
    const env = Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.5) * (1 - t * t);
    const w = width * env * (i % 2 === 0 ? 1 : 0.62);
    const fold = width * 0.22 * env;
    pos.push(x, y - fold, -w); // left
    pos.push(x, y + fold * 0.6, 0); // midrib top
    pos.push(x, y - fold, w); // right
    pos.push(x, y - fold * 0.9 - 0.012, 0); // midrib underside
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 4;
    const b = a + 4;
    // Top skin (faces up): left half and right half.
    idx.push(a, b + 1, b, a, a + 1, b + 1);
    idx.push(a + 1, b + 2, b + 1, a + 1, a + 2, b + 2);
    // Under skin (faces down).
    idx.push(a, b, b + 3, a, b + 3, a + 3);
    idx.push(a + 3, b + 3, b + 2, a + 3, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A palm: a CURVED, RINGED trunk and a crown of drooping fronds.
 *
 * Both halves are the identity. Every other tree in this game stands straight
 * under a round crown; a palm LEANS and its crown is a STAR. The trunk is
 * stacked frusta, each slightly wider at its base than the one above ends, so
 * the silhouette steps at every joint — the ringed bark, drawn by geometry
 * rather than paint, because a stripe at this size is one pixel.
 *
 * The fronds alternate the two foliage greens, upper ones lit and the lower,
 * drooping ones dark: one green would be a flat star, and the alternation is
 * what puts layers in it from above.
 */
export function distantPalm(
  m: SurroundMaterials,
  o: { height?: number; seed?: number } = {},
): THREE.Group {
  const r = seeded(o.seed ?? 7);
  const g = new THREE.Group();
  g.name = "palm";
  const h = o.height ?? 2.2 + r() * 0.9;
  const lean = 0.18 + r() * 0.22;
  const segs = 5;
  // The trunk curves: the lean grows with height, so the base is planted
  // upright and the top swings out — a straight tilted pole reads as fallen.
  const at = (t: number): [number, number] => [Math.pow(t, 1.6) * h * lean, t * h];
  const baseR = h * 0.05;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const [x0, y0] = at(t0);
    const [x1, y1] = at(t1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const rTop = baseR * (1 - t1 * 0.4);
    const rBot = baseR * (1 - t0 * 0.4) * 1.18;
    const seg = part(g, new THREE.CylinderGeometry(rTop, rBot, len * 1.04, 6, 1, true), m.palmBark, "trunk" + i);
    seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    seg.rotation.z = -Math.atan2(x1 - x0, y1 - y0);
  }
  const [cx, cy] = at(1);
  // A knot that caps the open top ring and seats the fronds.
  part(g, new THREE.SphereGeometry(baseR * 1.05, 6, 4), m.palmBark, "crownKnot", [cx, cy, 0]);

  const n = 7;
  const flen = h * (0.42 + r() * 0.08);
  for (let i = 0; i < n; i++) {
    const upper = i % 2 === 0;
    const fr = part(
      g,
      frondGeometry(flen * (upper ? 1 : 0.92), h * 0.085, upper ? 0.45 : 0.85, 6),
      upper ? m.foliageLit : m.foliageDark,
      "frond" + i,
      [cx, cy + (upper ? baseR * 0.3 : 0), 0],
    );
    fr.rotation.y = (i / n) * Math.PI * 2 + r() * 0.35;
    // A little lift so the star does not lie flat on the knot.
    fr.rotation.z = upper ? 0.18 : -0.05;
  }
  // Coconuts under the crown — three dark balls, the last thing that says
  // "palm" rather than "fern on a stick".
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    part(g, new THREE.SphereGeometry(baseR * 0.95, 5, 4), m.hull, "coconut" + i, [
      cx + Math.cos(a) * baseR * 1.3,
      cy - baseR * 1.2,
      Math.sin(a) * baseR * 1.3,
    ]);
  }
  return g;
}

/** A low tropical bush — the jungle green at the foot of the palms. */
export function distantJungleBush(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 5);
  const g = new THREE.Group();
  g.name = "jungle-bush";
  const rad = 0.32 + r() * 0.14;
  part(
    g,
    lobedFoliageGeometry(rad, { detail: 2, lobes: 7, sharpness: 5, amplitude: 0.22, scale: [1.3, 0.75, 1.1], seed: 3 }),
    m.hedgeLit,
    "bushA",
    [0, rad * 0.55, 0],
  );
  // ONE smooth blob, not two faceted ones: at detail 1 a lobed blob is a
  // handful of facets, and two of them side by side came back as a pair of cut
  // EMERALDS (IDEA-072's pale-hexagon finding, at a smaller size). The darker
  // value is carried by a low skirt instead.
  part(
    g,
    lobedFoliageGeometry(rad * 0.9, { detail: 1, lobes: 6, sharpness: 4, amplitude: 0.18, scale: [1.5, 0.35, 1.3], seed: 5 }),
    m.hedgeDark,
    "skirt",
    [rad * 0.15, rad * 0.12, 0],
  );
  // A hibiscus or two: one saturated speck on the green is what makes it
  // tropical rather than an English shrub.
  if (r() < 0.6) {
    part(g, new THREE.SphereGeometry(0.07, 5, 4), m.bloomB, "hibiscus", [-rad * 0.3, rad * 1.05, rad * 0.4]);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ship parts — the sides

/** A spoked wheel lying in one plane (local XY), centred on the origin. */
function wheel(
  g: THREE.Group,
  name: string,
  radius: number,
  spokes: number,
  rim: THREE.Material,
  hub: THREE.Material,
  handles: boolean,
): THREE.Group {
  const w = new THREE.Group();
  w.name = name;
  g.add(w);
  part(w, new THREE.TorusGeometry(radius, radius * 0.11, 4, 14), rim, "rim");
  part(w, new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, radius * 0.24, 8), hub, "hub").rotation.x =
    Math.PI / 2;
  const reach = handles ? radius * 1.32 : radius;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const s = part(w, new THREE.BoxGeometry(radius * 0.11, reach, radius * 0.11), rim, "spoke" + i);
    s.position.set(Math.sin(a) * reach * 0.5, Math.cos(a) * reach * 0.5, 0);
    s.rotation.z = -a;
    if (handles) {
      // The knobs past the rim are what say SHIP'S WHEEL rather than cartwheel.
      part(w, new THREE.SphereGeometry(radius * 0.1, 5, 3), rim, "handle" + i, [
        Math.sin(a) * reach,
        Math.cos(a) * reach,
        0,
      ]);
    }
  }
  return w;
}

/**
 * A ship's wheel, half-buried and leaning in the sand — washed up rather than
 * mounted, which is what lets it stand on a beach without a ship around it.
 */
export function distantShipWheel(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 11);
  const g = new THREE.Group();
  g.name = "ship-wheel";
  const rad = 0.36;
  const w = wheel(g, "wheel", rad, 8, m.plank, m.hull, true);
  // Sunk by a fifth of its reach, leaning back toward the sky so the camera
  // sees the spokes as a star rather than edge-on.
  w.position.y = rad * 1.05;
  w.rotation.x = -0.55 - r() * 0.2;
  w.rotation.z = (r() - 0.5) * 0.4;
  // A heap of sand at its foot so it is planted, not balanced.
  part(
    g,
    lobedFoliageGeometry(0.22, { detail: 0, lobes: 4, sharpness: 3, amplitude: 0.2, scale: [1.5, 0.4, 1.2], seed: 9 }),
    m.palmBark,
    "drift",
    [0, 0, 0.05],
  );
  return g;
}

/**
 * A cannon on its wooden carriage, with a stack of shot beside it.
 *
 * Built pointing along local +Z. The barrel is the identity: a long iron taper
 * with a swollen muzzle and a knob at the breech, chunky enough to keep its
 * own colour under a matcap (rule 2).
 */
export function distantCannon(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 13);
  const g = new THREE.Group();
  g.name = "cannon";
  // Carriage: a plank bed on two wheel pairs.
  part(g, new THREE.BoxGeometry(0.38, 0.14, 0.62), m.plank, "carriage", [0, 0.2, -0.04]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wh = part(g, new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), m.hull, "wheel", [
        sx * 0.22,
        0.12,
        sz * 0.2 - 0.04,
      ]);
      wh.rotation.z = Math.PI / 2;
    }
  }
  const barrel = new THREE.Group();
  barrel.name = "barrel";
  barrel.position.set(0, 0.36, 0);
  barrel.rotation.x = -0.12 - r() * 0.1; // cocked up a little, as if aimed
  g.add(barrel);
  const L = 0.82;
  part(barrel, new THREE.CylinderGeometry(0.075, 0.11, L, 8), m.iron, "tube", [0, 0, 0]).rotation.x = Math.PI / 2;
  part(barrel, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), m.iron, "muzzle", [0, 0, L / 2]).rotation.x =
    Math.PI / 2;
  part(barrel, new THREE.SphereGeometry(0.07, 6, 4), m.iron, "cascabel", [0, 0, -L / 2 - 0.04]);
  // Shot: a little pyramid of iron balls.
  const shot: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.11, 0, 0],
    [0.055, 0, 0.095],
    [0.055, 0.085, 0.032],
  ];
  shot.forEach(([x, y, z], i) => {
    part(g, new THREE.SphereGeometry(0.06, 6, 4), m.iron, "shot" + i, [0.36 + x, 0.06 + y, -0.2 + z]);
  });
  return g;
}

/**
 * A pirate flag on a pole — the black slab with a pale skull and crossbones.
 *
 * The flag is a SLAB with a kink in it (two panels), not a plane: a plane is
 * invisible edge-on and half the yaws would lose it. The skull is a pale ball
 * and a jaw, the bones two pale bars crossed behind — at twelve pixels that is
 * all a Jolly Roger is, and all it needs to be.
 */
export function distantPirateFlag(
  m: SurroundMaterials,
  o: { seed?: number; height?: number; pole?: boolean } = {},
): THREE.Group {
  const r = seeded(o.seed ?? 17);
  const g = new THREE.Group();
  g.name = "pirate-flag";
  // Without a pole (the wreck's masthead flies one) the flag's top edge sits
  // at y = 0 and the caller hangs it where it likes.
  const pole = o.pole ?? true;
  const h = pole ? o.height ?? 1.6 + r() * 0.3 : 0;
  if (pole) {
    part(g, new THREE.CylinderGeometry(0.03, 0.045, h, 6), m.plank, "pole", [0, h / 2, 0]);
    part(g, new THREE.SphereGeometry(0.05, 6, 4), m.gold, "finial", [0, h + 0.03, 0]);
  }
  const fw = 0.62;
  const fh = 0.42;
  const flag = new THREE.Group();
  flag.name = "flag";
  flag.position.set(0, pole ? h - fh / 2 - 0.04 : -fh / 2, 0);
  g.add(flag);
  // Two panels with a kink between them: the flag is flying, not hanging.
  const a = part(flag, new THREE.BoxGeometry(fw / 2, fh, 0.03), m.iron, "clothA", [fw / 4 + 0.02, 0, 0]);
  a.rotation.y = 0.18;
  const b = part(flag, new THREE.BoxGeometry(fw / 2, fh * 0.94, 0.03), m.iron, "clothB", [
    fw * 0.73,
    -0.02,
    -0.06,
  ]);
  b.rotation.y = -0.22;
  // The skull and bones, on BOTH faces of the near panel, a hair proud of it
  // (flush is z-fighting, and inside is this project's oldest defect).
  for (const side of [1, -1]) {
    const z = side * 0.022;
    const mark = new THREE.Group();
    mark.name = side > 0 ? "jollyFront" : "jollyBack";
    mark.position.set(fw * 0.28, 0.02, z);
    mark.rotation.y = 0.18;
    flag.add(mark);
    const skull = part(mark, new THREE.SphereGeometry(0.075, 7, 5), m.canvas, "skull", [0, 0.04, 0]);
    skull.scale.set(1, 0.95, 0.35);
    part(mark, new THREE.BoxGeometry(0.08, 0.04, 0.02), m.canvas, "jaw", [0, -0.03, 0]);
    for (const s of [-1, 1]) {
      const bone = part(mark, new THREE.BoxGeometry(0.26, 0.035, 0.015), m.canvas, "bone", [0, -0.04, -side * 0.006]);
      bone.rotation.z = s * 0.62;
    }
  }
  return g;
}

/** A barrel: staves and two iron hoops, upright or tipped on its side. */
export function distantBarrel(m: SurroundMaterials, o: { seed?: number; tipped?: boolean } = {}): THREE.Group {
  const r = seeded(o.seed ?? 19);
  const g = new THREE.Group();
  g.name = "barrel";
  const body = new THREE.Group();
  body.name = "body";
  g.add(body);
  const hgt = 0.42;
  const rad = 0.16;
  // Bellied: two frusta back to back.
  part(body, new THREE.CylinderGeometry(rad * 1.12, rad, hgt / 2, 8), m.plank, "upper", [0, hgt * 0.75, 0]);
  part(body, new THREE.CylinderGeometry(rad, rad * 1.12, hgt / 2, 8), m.plank, "lower", [0, hgt * 0.25, 0]);
  for (const y of [0.16, 0.84]) {
    part(body, new THREE.CylinderGeometry(rad * 1.08, rad * 1.08, 0.035, 8, 1, true), m.iron, "hoop", [0, hgt * y, 0]);
  }
  const tipped = o.tipped ?? r() < 0.3;
  if (tipped) {
    body.rotation.z = Math.PI / 2;
    body.position.set(hgt / 2, rad * 1.05, 0);
  }
  return g;
}

/** A wooden crate: a pale box with dark slats across every visible face. */
export function distantCrate(m: SurroundMaterials, o: { size?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = "crate";
  const s = o.size ?? 0.36;
  part(g, new THREE.BoxGeometry(s, s, s), m.plank, "box", [0, s / 2, 0]);
  // A diagonal brace on two faces and a lid band — the dark lines are the
  // whole difference between a crate and a cube.
  part(g, new THREE.BoxGeometry(s * 1.04, s * 0.14, s * 1.04), m.hull, "band", [0, s * 0.86, 0]);
  for (const side of [1, -1]) {
    const br = part(g, new THREE.BoxGeometry(s * 1.2, s * 0.12, 0.02), m.hull, "brace", [0, s / 2, side * (s / 2 + 0.008)]);
    br.rotation.z = side * 0.78;
  }
  return g;
}

/** An anchor lying in the sand, stock and flukes. */
export function distantAnchor(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 23);
  const g = new THREE.Group();
  g.name = "anchor";
  const a = new THREE.Group();
  a.name = "body";
  // Lying almost flat, propped a little on one fluke.
  a.rotation.set(-Math.PI / 2 + 0.35, r() * Math.PI, 0);
  a.position.y = 0.12;
  g.add(a);
  part(a, new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), m.iron, "shank", [0, 0.1, 0]);
  part(a, new THREE.BoxGeometry(0.5, 0.06, 0.06), m.iron, "stock", [0, 0.42, 0]);
  part(a, new THREE.TorusGeometry(0.08, 0.025, 4, 8), m.iron, "ring", [0, 0.56, 0]);
  // The flukes: a half-ring at the crown with a point at each end.
  const arms = part(a, new THREE.TorusGeometry(0.27, 0.045, 4, 10, Math.PI), m.iron, "arms", [0, -0.04, 0]);
  arms.rotation.z = Math.PI;
  for (const s of [-1, 1]) {
    const tip = part(a, new THREE.ConeGeometry(0.08, 0.16, 4), m.iron, "fluke", [s * 0.27, 0.02, 0]);
    tip.rotation.z = s * -0.5;
  }
  return g;
}

/** A coil of rope — a squat torus in sailcloth tone. */
export function distantRopeCoil(m: SurroundMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = "rope";
  for (let i = 0; i < 2; i++) {
    const c = part(g, new THREE.TorusGeometry(0.17 - i * 0.04, 0.045, 4, 12), m.canvas, "coil" + i, [0, 0.045 + i * 0.07, 0]);
    c.rotation.x = Math.PI / 2;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Treasure and arms — the south

/**
 * A sword stuck in the sand: pale blade, gold guard, dark grip.
 *
 * The blade is pale on purpose — steel catching the sun, and a thin dark rod
 * would render white anyway (rule 2). Point DOWN, buried a few centimetres, so
 * it is planted rather than balanced on its tip.
 */
export function distantSwordInSand(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 29);
  const g = new THREE.Group();
  g.name = "sword";
  const s = new THREE.Group();
  s.name = "blade";
  s.rotation.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5);
  g.add(s);
  const L = 0.56;
  // GREY steel, not sailcloth: a pale blade standing on pale sand is the one
  // pairing with nothing to separate it, and `stone` is a cool grey a hue
  // away from the sand's warm one.
  part(s, new THREE.BoxGeometry(0.06, L, 0.018), m.stone, "steel", [0, L / 2 - 0.05, 0]);
  part(s, new THREE.BoxGeometry(0.24, 0.045, 0.05), m.gold, "guard", [0, L - 0.04, 0]);
  part(s, new THREE.CylinderGeometry(0.025, 0.025, 0.15, 5), m.hull, "grip", [0, L + 0.06, 0]);
  part(s, new THREE.SphereGeometry(0.04, 6, 4), m.gold, "pommel", [0, L + 0.15, 0]);
  return g;
}

/**
 * A pair of flintlock pistols, crossed, lying on the sand — the brief's "guns".
 *
 * Each is a curved wooden stock dropping into a grip, an iron barrel along the
 * top and a gold butt cap. At this size the read is the CROSS: two long dark
 * shapes making an X on pale sand.
 */
export function distantPistols(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 31);
  const g = new THREE.Group();
  g.name = "pistols";
  for (const s of [-1, 1]) {
    const p = new THREE.Group();
    p.name = s < 0 ? "pistolL" : "pistolR";
    p.rotation.y = s * 0.55 + (r() - 0.5) * 0.15;
    p.position.y = s < 0 ? 0 : 0.045;
    g.add(p);
    part(p, new THREE.CylinderGeometry(0.03, 0.035, 0.44, 6), m.iron, "barrel", [0, 0.06, 0.08]).rotation.x =
      Math.PI / 2;
    part(p, new THREE.BoxGeometry(0.07, 0.06, 0.34), m.plank, "stock", [0, 0.035, -0.02]);
    const grip = part(p, new THREE.BoxGeometry(0.075, 0.06, 0.2), m.plank, "grip", [0, 0.035, -0.22]);
    grip.rotation.y = 0.35;
    part(p, new THREE.SphereGeometry(0.05, 6, 4), m.gold, "butt", [-0.03, 0.04, -0.32]);
  }
  return g;
}

/**
 * A skull and crossbones on a wooden stake — the pirate symbol at its plainest,
 * the warning post at the edge of somebody's treasure.
 *
 * On a STAKE rather than lying on the sand, because a pale skull on pale sand
 * is the one pairing with nothing to separate it; against the dark-banded
 * stake and seen from above it is a pale knob with two dark eyes, which is a
 * skull at any size.
 */
export function distantSkullPost(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 37);
  const g = new THREE.Group();
  g.name = "skull-post";
  const h = 0.62 + r() * 0.12;
  part(g, new THREE.CylinderGeometry(0.04, 0.05, h, 6), m.plank, "stake", [0, h / 2, 0]);
  part(g, new THREE.CylinderGeometry(0.052, 0.052, 0.05, 6), m.hull, "lashing", [0, h * 0.72, 0]);
  const k = new THREE.Group();
  k.name = "head";
  k.position.y = h + 0.06;
  k.rotation.y = (r() - 0.5) * 0.8;
  g.add(k);
  const dome = part(k, new THREE.SphereGeometry(0.12, 8, 6), m.canvas, "cranium", [0, 0.03, 0]);
  dome.scale.set(1, 0.92, 1.05);
  part(k, new THREE.BoxGeometry(0.13, 0.06, 0.09), m.canvas, "jaw", [0, -0.07, 0.05]);
  // Eye sockets: dark, and big — at twelve pixels that is a face.
  for (const s of [-1, 1]) {
    part(k, new THREE.SphereGeometry(0.034, 5, 4), m.iron, s < 0 ? "socketL" : "socketR", [s * 0.045, 0.04, 0.105]);
  }
  // The crossbones, lashed across the stake under the skull.
  for (const s of [-1, 1]) {
    const b = part(g, new THREE.CylinderGeometry(0.024, 0.024, 0.4, 5), m.canvas, s < 0 ? "boneL" : "boneR", [
      0,
      h * 0.72,
      0.05,
    ]);
    b.rotation.z = s * 0.8;
  }
  return g;
}

/** A loose pile of gold coins: stacked discs and a heap. */
export function distantCoinPile(m: SurroundMaterials, o: { seed?: number; size?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 41);
  const g = new THREE.Group();
  g.name = "coins";
  const s = o.size ?? 1;
  part(
    g,
    lobedFoliageGeometry(0.2 * s, { detail: 1, lobes: 6, sharpness: 3, amplitude: 0.18, scale: [1.3, 0.45, 1.2], seed: 4 }),
    m.gold,
    "heap",
    [0, 0.02 * s, 0],
  );
  for (let i = 0; i < 3; i++) {
    const n = 2 + Math.floor(r() * 3);
    const x = (r() - 0.5) * 0.6 * s;
    const z = (r() - 0.5) * 0.6 * s;
    part(g, new THREE.CylinderGeometry(0.055 * s, 0.055 * s, 0.025 * n * s, 8), m.gold, "stack" + i, [
      x,
      (0.0125 * n) * s,
      z,
    ]);
  }
  return g;
}

/**
 * An open treasure chest spilling gold — the south's centrepiece.
 *
 * Plank body, dark iron bands, a domed lid tipped back on its hinge, and a
 * mound of gold rising out of the open top with gems in it. Gold is the only
 * warm saturated yellow in the island, so it is the first thing the eye finds.
 */
export function distantTreasureChest(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 43);
  const g = new THREE.Group();
  g.name = "treasure-chest";
  const W = 0.78;
  const D = 0.5;
  const H = 0.4;
  part(g, new THREE.BoxGeometry(W, H, D), m.plank, "body", [0, H / 2, 0]);
  // Iron bands round the body — a hair proud.
  for (const x of [-W * 0.32, W * 0.32]) {
    part(g, new THREE.BoxGeometry(0.06, H * 1.02, D * 1.04), m.hull, "band", [x, H / 2, 0]);
  }
  part(g, new THREE.BoxGeometry(0.1, 0.12, 0.04), m.gold, "lock", [0, H * 0.8, D / 2 + 0.02]);
  // The lid: a half-cylinder hinged at the back edge and swung open.
  const lid = new THREE.Group();
  lid.name = "lid";
  lid.position.set(0, H, -D / 2);
  lid.rotation.x = -1.9 - r() * 0.2;
  g.add(lid);
  const dome = part(lid, new THREE.CylinderGeometry(D / 2, D / 2, W, 10, 1, false, 0, Math.PI), m.plank, "dome", [
    0,
    0,
    D / 2,
  ]);
  dome.rotation.z = Math.PI / 2;
  part(lid, new THREE.BoxGeometry(W * 1.01, 0.04, D * 1.02), m.hull, "rimband", [0, 0.01, D / 2]);
  // The gold, heaped above the rim, and gems in it.
  part(
    g,
    lobedFoliageGeometry(W * 0.42, { detail: 1, lobes: 7, sharpness: 3, amplitude: 0.2, scale: [1.1, 0.42, 0.7], seed: 8 }),
    m.gold,
    "hoard",
    [0, H * 0.98, 0],
  );
  part(g, new THREE.OctahedronGeometry(0.06), m.bloomB, "ruby", [-W * 0.18, H * 1.12, 0.05]);
  part(g, new THREE.OctahedronGeometry(0.055), m.bloomC, "topaz", [W * 0.2, H * 1.1, -0.04]);
  // A necklace of pearls over the front lip is too fine; a few coins spilled
  // on the sand in front say "overflowing" at any size.
  for (let i = 0; i < 4; i++) {
    const c = part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 7), m.gold, "spill" + i, [
      (r() - 0.5) * W * 0.9,
      0.012,
      D / 2 + 0.1 + r() * 0.2,
    ]);
    c.rotation.set((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
  }
  return g;
}

// ---------------------------------------------------------------------------
// The wreck — the north

/**
 * A shaped hull: a subdivided box pinched into a boat — pointed bow at +Z,
 * flat transom at -Z, a V keel, and a sheer that rises at both ends.
 */
function hullGeometry(L: number, B: number, Hh: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(B, Hh, L, 2, 2, 10);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = z / L + 0.5; // 0 stern .. 1 bow
    const bow = t > 0.6 ? 1 - Math.pow((t - 0.6) / 0.4, 1.6) : 1;
    const stern = t < 0.08 ? 0.82 + (t / 0.08) * 0.18 : 1;
    const yN = y / Hh + 0.5; // 0 keel .. 1 gunwale
    const keel = 0.35 + 0.65 * Math.pow(yN, 0.7);
    p.setX(i, x * Math.max(0.04, bow) * stern * keel);
    // Sheer: the gunwale climbs toward the bow and the stern.
    const sheer = (Math.pow(Math.abs(t - 0.45) * 2, 2) * 0.35) * Hh;
    if (yN > 0.5) p.setY(i, y + sheer * yN);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The shipwreck: a listing galleon run aground in the shallows, a snapped
 * foremast, a main mast still standing with a torn sail and a Jolly Roger.
 *
 * Built along local +Z (bow forward). The caller sinks it into the sea; the
 * hull is solid below the waterline so whatever depth it is set at, the sea
 * plane cuts it cleanly.
 *
 * AT THIS CAMERA A SHIP IS ITS DECK. Looking down 59 degrees at a vessel
 * listing toward the board, most of what shows is the deck and the inside of
 * the far bulwark, so the deck is the pale `plank` and the hull the dark tar —
 * the dark-hull-round-pale-deck read the house's roof taught (IDEA-066 rule 3),
 * turned the other way up.
 */
export function distantShipwreck(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 47);
  const g = new THREE.Group();
  g.name = "shipwreck";
  const L = 6.2;
  const B = 1.9;
  const Hh = 1.5;
  const ship = new THREE.Group();
  ship.name = "ship";
  g.add(ship);
  part(ship, hullGeometry(L, B, Hh), m.hull, "hull", [0, Hh / 2, 0]);
  // The deck: a plank slab just inside the gunwale, pinched to the bow.
  const deck = hullGeometry(L * 0.94, B * 0.9, 0.08);
  part(ship, deck, m.plank, "deck", [0, Hh * 0.86, -0.05]);
  // A wale: one pale strake along each side a third of the way down, which is
  // the single line that makes a dark mass read as a built ship.
  for (const s of [-1, 1]) {
    const w = part(ship, new THREE.BoxGeometry(0.06, 0.1, L * 0.62), m.plank, "wale", [s * B * 0.47, Hh * 0.68, -0.25]);
    w.rotation.y = s * -0.02;
  }
  // The stern castle: a raised box with a pale rail.
  part(ship, new THREE.BoxGeometry(B * 0.78, 0.55, 1.2), m.hull, "sterncastle", [0, Hh + 0.12, -L / 2 + 0.75]);
  part(ship, new THREE.BoxGeometry(B * 0.8, 0.06, 1.24), m.plank, "poopdeck", [0, Hh + 0.42, -L / 2 + 0.75]);
  // Gun ports: a row of small dark squares would be dark on dark; pale lids
  // propped open read instead.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      part(ship, new THREE.BoxGeometry(0.04, 0.16, 0.2), m.plank, "port", [s * B * 0.5, Hh * 0.52, -0.9 + i * 0.85]);
    }
  }
  // Main mast, standing, with its yard and a torn sail.
  const mastH = 3.4;
  const mast = part(ship, new THREE.CylinderGeometry(0.07, 0.1, mastH, 6), m.hull, "mainmast", [0, Hh + mastH / 2 - 0.2, -0.3]);
  mast.rotation.z = 0.05;
  const yardY = Hh + mastH * 0.62;
  part(ship, new THREE.CylinderGeometry(0.045, 0.045, B * 1.5, 5), m.hull, "yard", [0, yardY, -0.3]).rotation.z =
    Math.PI / 2;
  // The sail: two torn panels hanging from the yard, one ripped short — a
  // whole sail is a billboard, a torn one is a WRECK.
  const sailA = part(ship, new THREE.BoxGeometry(B * 0.68, 1.15, 0.04), m.canvas, "sailA", [-B * 0.35, yardY - 0.62, -0.26]);
  sailA.rotation.set(0.12, 0, 0.04);
  const sailB = part(ship, new THREE.BoxGeometry(B * 0.6, 0.62, 0.04), m.canvas, "sailB", [B * 0.36, yardY - 0.36, -0.24]);
  sailB.rotation.set(0.2, 0, -0.12);
  // The Jolly Roger at the masthead.
  const flag = distantPirateFlag(m, { seed: 3, pole: false });
  flag.position.set(0.05, Hh + mastH - 0.2, -0.3);
  flag.scale.setScalar(1.3);
  flag.rotation.y = -0.6;
  ship.add(flag);
  // The foremast: snapped, the broken top lying across the bow.
  part(ship, new THREE.CylinderGeometry(0.07, 0.08, 1.1, 6), m.hull, "forestump", [0, Hh + 0.45, L * 0.28]);
  const broken = part(ship, new THREE.CylinderGeometry(0.055, 0.065, 2.2, 6), m.hull, "foretop", [0.55, Hh + 0.35, L * 0.3]);
  broken.rotation.set(0.25, 0, 1.25);
  // The bowsprit, jutting.
  const sprit = part(ship, new THREE.CylinderGeometry(0.04, 0.06, 1.3, 5), m.hull, "bowsprit", [0, Hh * 1.05, L / 2 + 0.35]);
  sprit.rotation.x = 1.15;
  // Ribs showing through a hole stove in the near side: the WRECK half of the
  // name, and the one place the hull's planking is visibly gone.
  for (let i = 0; i < 4; i++) {
    const rib = part(ship, new THREE.TorusGeometry(0.42, 0.045, 4, 8, Math.PI * 0.9), m.plank, "rib" + i, [
      B * 0.36,
      Hh * 0.55,
      L * 0.12 + i * 0.32,
    ]);
    rib.rotation.set(0, Math.PI / 2, Math.PI * 0.55);
  }

  // Run aground and LISTING toward the board, bow up a little — the deck
  // turned toward the camera, which is the whole reason it reads.
  ship.rotation.set(-0.08, 0, 0.28 + r() * 0.05);

  // Rocks breaking the surface round the wreck, and a ring of surf where the
  // sea meets it. The foam is flattened sailcloth discs: white on turquoise is
  // the same mark the shore's foam line makes.
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const d = 2.2 + r() * 1.2;
    const rk = part(
      g,
      lobedFoliageGeometry(0.32 + r() * 0.2, { detail: 0, lobes: 4, sharpness: 4, amplitude: 0.25, scale: [1.2, 0.7, 1], seed: 50 + i }),
      m.stone,
      "rock" + i,
      [Math.cos(a) * d * 0.7, 0.05, Math.sin(a) * d],
    );
    rk.rotation.y = r() * Math.PI;
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.3;
    const f = part(g, new THREE.CylinderGeometry(0.42 + r() * 0.25, 0.42, 0.03, 7), m.canvas, "foam" + i, [
      Math.cos(a) * B * 0.75,
      0.02,
      Math.sin(a) * L * 0.5,
    ]);
    f.scale.z = 0.55;
    f.rotation.y = a;
  }
  return g;
}

/** A mast standing up out of the water alone — a second, sunken wreck, so the
 *  north is not a single object. A stump, a cross-tree and a rag of flag. */
export function distantSunkenMast(m: SurroundMaterials, o: { seed?: number } = {}): THREE.Group {
  const r = seeded(o.seed ?? 53);
  const g = new THREE.Group();
  g.name = "sunken-mast";
  const h = 2.3;
  const mast = part(g, new THREE.CylinderGeometry(0.06, 0.09, h, 6), m.hull, "mast", [0, h / 2 - 0.3, 0]);
  mast.rotation.z = 0.22 + r() * 0.1;
  const top = new THREE.Vector3(-Math.sin(mast.rotation.z) * (h / 2), h - 0.3, 0);
  const yard = part(g, new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5), m.hull, "yard", [top.x * 0.75, top.y * 0.78, 0]);
  yard.rotation.z = Math.PI / 2 + 0.25;
  const rag = part(g, new THREE.BoxGeometry(0.5, 0.4, 0.03), m.canvas, "rag", [top.x * 0.75 + 0.12, top.y * 0.78 - 0.26, 0]);
  rag.rotation.set(0.15, 0.3, 0.2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const f = part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 7), m.canvas, "foam" + i, [
      Math.cos(a) * 0.35,
      0.02,
      Math.sin(a) * 0.35,
    ]);
    f.scale.z = 0.5;
  }
  return g;
}
