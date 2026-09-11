// OWNER: render-artist
// IDEA-060: the picket fence that stands in front of a themed wall.
//
// The garden's wall reference (.img2threejs/reference/boardwalls/shrubfence.jpg)
// is a flowering shrub with a picket fence ACROSS THE FRONT OF IT. The flowers
// belong in the hedge texture — they are 7px marks on a 363px hedge and there
// is nothing three-dimensional about them. The fence does not: it is a row of
// separate uprights with daylight between them, and daylight between things is
// exactly what a texture cannot draw. Painted into the wall map it would also
// land on the wall's TOP face, where a fence makes no sense, because a wall is
// one unit box wearing one material on all six sides.
//
// So the fence is real geometry, and it is the first thing in this project to
// stand ON the maze rather than in the apron. Four rules:
//
//  1. ONE InstancedMesh FOR THE WHOLE MAZE. Walls are already a single
//     instanced draw for exactly this reason; a fence that cost a mesh per
//     panel would undo it. The panel geometry is built once — pickets, rails
//     and posts merged into one BufferGeometry — and every exposed wall face
//     is one instance of it.
//
//  2. A PANEL GOES ON A WALL FACE THAT SOMETHING CAN SEE. That means every
//     side of a wall tile whose neighbour is NOT a wall: corridor faces get
//     fenced, and so does the outer ring facing the apron. Faces buried
//     between two wall tiles get nothing, which is most of them in a blocky
//     maze — see `fencePanelCount`.
//
//  3. THE GAP IS THE IDENTITY, AND IT IS SIZED FROM READABILITY. Measured, the
//     reference runs a 36px pitch on a 110px fence — ten pickets per maze tile
//     once scaled, which at the game camera's ~25px tile puts a picket at 2.5px
//     and its GAP at 0.7px. That is under the cartoon rule's floor (see
//     wallTexture.ts) and reads as a smear, i.e. a plank, which is the one
//     thing a picket fence must not read as. Four pickets a tile is the
//     shipped pitch, and the duty cycle gives way rather than the pitch: 0.68
//     against the reference's 0.778, which buys a 2px gap. Same call as the
//     crab's pincer aperture (IDEA-054 rule 2).
//
//  4. THE PITCH DIVIDES THE TILE EXACTLY. Four pickets at 0.25 across a
//     1-unit tile puts them at ±0.125 and ±0.375, so the last picket of one
//     panel and the first of the next are one gap apart and a straight run of
//     wall reads as ONE continuous fence instead of a row of separate gates.
//     Any pitch that is not 1/n would show a seam at every tile boundary.
import * as THREE from "three";
import { COLS, ROWS, TILE, worldX, worldZ, type Grid } from "../game/grid";
import { toon } from "./toon";

/**
 * Which railing a theme's walls stand behind.
 *
 * Lives here rather than in themes.ts for the same reason WallTextureKind
 * lives in wallTexture.ts: the render layer owns what it can actually build,
 * and themes.ts imports the TYPE only (erased at compile, so the pure game
 * module still loads in Node with no `three` anywhere near it).
 */
export type FenceKind = "none" | "picket";

/** How tall the fence stands, as a fraction of WALL_H. Straight off the
 *  reference: 110px of fence on a 363px wall = 0.303. */
export const FENCE_H = 0.3;

/** Pickets per tile. See rule 3 — this is a readability number, not the
 *  reference's. */
const PICKETS = 4;
const PITCH = TILE / PICKETS;
const PICKET_W = 0.17;
const PICKET_T = 0.05;
/** How far the fence stands proud of the wall face. Enough that the pickets
 *  are unambiguously IN FRONT of the hedge and cast onto it, small enough that
 *  the fence never eats into a corridor the beagle has to fit down (a corridor
 *  is one tile and the beagle is ~0.6 across, so the two panels facing each
 *  other across it take 0.16 of the 0.4 clearance). */
const PROUD = 0.04;

/** The two horizontal rails, as a fraction of FENCE_H. */
const RAIL_YS = [0.3, 0.78] as const;
const RAIL_H = 0.055;
const RAIL_T = 0.035;
/** How much darker the rails are than the pickets — see buildPanelGeometry. */
const RAIL_SHADE = 0.5;

/**
 * One picket's front silhouette: a plank with a rounded head.
 *
 * The reference's picket is a rectangle whose top corners are taken off by a
 * shallow dome — not a spear point (that is a railing) and not a flat cut
 * (that is a board). The dome is the whole difference between "fence" and
 * "hoarding", and it survives being 4px wide because it changes the
 * SILHOUETTE rather than adding a mark inside it.
 *
 * Extruded with `bevelEnabled: false` on purpose: ExtrudeGeometry's bevel
 * grows OUTWARD, so a bevelled picket would be wider than PICKET_W and the
 * pitch arithmetic in rule 4 would quietly stop dividing the tile
 * (IDEA-057 rule 4, which cost the nigiri three systems at once).
 */
function picketShape(): THREE.Shape {
  const w = PICKET_W / 2;
  const h = FENCE_H;
  // The head is a dome `w` tall, so the straight flank runs to h - w.
  const shoulder = h - w;
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(-w, shoulder);
  s.absarc(0, shoulder, w, Math.PI, 0, true);
  s.lineTo(w, 0);
  s.closePath();
  return s;
}

/**
 * The panel geometry for ONE wall face, in the frame the instance matrix
 * expects: centred on x, sitting on y = 0, and facing +Z.
 *
 * Merged by hand (concatenating position/normal buffers via a small
 * BufferGeometry list) rather than with BufferGeometryUtils so this module
 * keeps to the plain `three` import the project uses everywhere.
 */
function buildPanelGeometry(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; shade: number }[] = [];

  const picket = new THREE.ExtrudeGeometry(picketShape(), {
    depth: PICKET_T,
    bevelEnabled: false,
    // THREE arc segments, and this is a budget decision with a number behind
    // it. A panel is instanced once per exposed wall face and a real maze has
    // ~440 of them, so every triangle in here is multiplied by 440: at the
    // first build's 5 segments the fence alone cost 95k triangles, which is
    // most of a second enemy cast on a phone. Three segments reads identically
    // at a 4px picket — the dome is a SILHOUETTE event, not a curve you can
    // count — and takes the whole maze's fence to under 50k.
    curveSegments: 3,
  });
  // ExtrudeGeometry builds along +Z from z = 0, so the plank's own front face
  // is at PICKET_T. Pull it back to straddle the origin.
  picket.translate(0, 0, -PICKET_T / 2);

  for (let i = 0; i < PICKETS; i++) {
    const x = (i - (PICKETS - 1) / 2) * PITCH;
    const g = picket.clone();
    g.translate(x, 0, 0);
    parts.push({ geo: g, shade: 1 });
  }
  picket.dispose();

  // The rails sit BEHIND the pickets — that is what you see through the gaps,
  // and without them a gap is a hole into the hedge's own dark interior, which
  // at 2px reads as a black speck rather than as daylight.
  //
  // They are painted DARKER than the pickets, and that is the whole reason
  // this geometry carries vertex colours at all. The first build made rail and
  // picket one flat brown, so a gap showed brown behind brown and the fence
  // rendered as a solid SKIRTING BOARD — every picket outline gone, the one
  // feature the thing exists for. A gap only reads as a gap if there is a
  // tonal step across it. (A second material would cost a second draw call per
  // maze; a vertex attribute costs nothing and keeps the fence at one.)
  for (const f of RAIL_YS) {
    const rail = new THREE.BoxGeometry(TILE, FENCE_H * RAIL_H * 2, RAIL_T);
    rail.translate(0, FENCE_H * f, -PICKET_T / 2 - RAIL_T / 2);
    parts.push({ geo: rail, shade: RAIL_SHADE });
  }

  return mergeGeometries(parts);
}

/**
 * Concatenates non-indexed triangle soup from a list of geometries.
 *
 * Every input here is a primitive with `position` and `normal`, and the merged
 * result needs nothing else: the fence carries no map, so there are no UVs to
 * keep, and de-indexing costs a few hundred vertices on a geometry that is
 * built once for the whole maze.
 */
function mergeGeometries(
  parts: readonly { geo: THREE.BufferGeometry; shade: number }[],
): THREE.BufferGeometry {
  const flat = parts.map((p) => ({
    geo: p.geo.index ? p.geo.toNonIndexed() : p.geo,
    shade: p.shade,
  }));
  let n = 0;
  for (const p of flat) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of flat) {
    pos.set(p.geo.attributes.position.array as Float32Array, o * 3);
    nor.set(p.geo.attributes.normal.array as Float32Array, o * 3);
    col.fill(p.shade, o * 3, (o + p.geo.attributes.position.count) * 3);
    o += p.geo.attributes.position.count;
  }
  for (const p of parts) p.geo.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  // A GREY vertex colour, so it multiplies the material's own timber hue
  // rather than replacing it — the palette still owns what colour the fence
  // is, and this only says which parts of it are in shadow.
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** Is (x, y) a wall? Anything off the grid is not — which is what puts a
 *  fence on the outward faces of the maze's own perimeter. */
function isWall(grid: Grid, x: number, y: number): boolean {
  return y >= 0 && y < ROWS && x >= 0 && x < COLS && grid.cells[y][x] === "#";
}

/** The four sides of a tile, as a neighbour step plus the rotation that turns
 *  a +Z-facing panel to look that way. */
const SIDES: readonly { dx: number; dy: number; rot: number }[] = [
  { dx: 0, dy: 1, rot: 0 }, // south face, looking +Z (toward the camera)
  { dx: 0, dy: -1, rot: Math.PI }, // north
  { dx: 1, dy: 0, rot: Math.PI / 2 }, // east
  { dx: -1, dy: 0, rot: -Math.PI / 2 }, // west
];

/** How many panels `grid` needs — every wall-tile side whose neighbour is not
 *  a wall. Exported so a test or a scratch measurement can size the fence
 *  without building it. */
export function fencePanelCount(grid: Grid): number {
  let n = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid.cells[y][x] !== "#") continue;
      for (const s of SIDES) if (!isWall(grid, x + s.dx, y + s.dy)) n++;
    }
  }
  return n;
}

/**
 * Builds the whole maze's fence as one InstancedMesh and adds it to `scene`.
 *
 * Returns null when the grid has no exposed wall face at all (impossible for a
 * real maze, but it keeps the caller's teardown branch honest) — the same
 * null-for-nothing contract buildProps and buildWallDecor already use.
 *
 * The material is created HERE and owned by the returned mesh, not shared at
 * module level: the fence is torn down and rebuilt on a re-theme exactly like
 * the props are, and a module-level singleton would be disposed out from under
 * the next board (the trap board.ts's makeTrunkMat note already records).
 */
export function buildFence(
  scene: THREE.Object3D,
  grid: Grid,
  color: number,
): THREE.InstancedMesh | null {
  const count = fencePanelCount(grid);
  if (count === 0) return null;

  const geo = buildPanelGeometry();
  // No emissive lift, unlike every other board surface. The wall and floor
  // palettes carry one because a dark theme would otherwise go to black; the
  // fence is a small bright object standing in front of the wall, so it has
  // the wall's own lift behind it already and a second one on top only makes
  // it read as plastic.
  const mat = toon({ color, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let i = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid.cells[y][x] !== "#") continue;
      for (const s of SIDES) {
        if (isWall(grid, x + s.dx, y + s.dy)) continue;
        dummy.position.set(
          worldX(x) + s.dx * (TILE / 2 + PROUD),
          0,
          worldZ(y) + s.dy * (TILE / 2 + PROUD),
        );
        dummy.rotation.set(0, s.rot, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

/** Frees an InstancedMesh from `buildFence` — geometry AND material, since
 *  both are owned by it (see buildFence's note). */
export function disposeFence(mesh: THREE.InstancedMesh): void {
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}
