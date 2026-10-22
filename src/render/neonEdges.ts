// OWNER: render-artist
// IDEA-084: ARCADE NIGHT'S WALLS ARE OUTLINED IN NEON.
//
// Nuno: "on the arcade night maze I want to bring style but on the environment
// let it clean as it is... on the maze on the wall I was thinking to put some
// neon stripes, blue neon strips on the edges of the wall."
//
// The arcade game this board is a tribute to never drew its walls as blocks at
// all — it drew their OUTLINES, a thin blue line round every run. So the strip
// runs along the TOP EDGE of every wall face that something can see (the
// fence's rule: a side whose neighbour is not a wall), which traces exactly
// that outline round each wall island from the play camera. Four rules.
//
//  1. TWO LAYERS: A TUBE AND ITS LIGHT. The tube is a thin box capping the top
//     edge — over the corner, so it reads on the crown AND on the face from
//     59 degrees. The light is additive quads that fade from the strip's colour
//     to BLACK, inward across the crown and down the face. Max-blended, black adds
//     nothing, so the fade needs no transparency sorting, and this project has
//     no bloom pass to make a glow any other way. Two draw calls for the whole
//     maze, whatever its size: every strip is merged.
//
//  2. UNLIT, AND IT NEVER REACHES THE STYLE. MeshBasicMaterial, because a toon
//     ramp bands a light source into the same three steps as the wall under it
//     and it stops reading as light — the eye glint's exception (CLAUDE.md
//     cel-shading rule), and the shield bubble's. Arcade Night is a night
//     board so `shouldStyleBoard` already leaves it alone; `madboxSkip` makes
//     that true even if this is ever stood up in a showcase that restyles its
//     whole scene.
//
//  3. A CONCAVE CORNER EXTENDS THE STRIP; A CONVEX ONE DOES NOT. A strip spans
//     its own tile. At an outside corner the two sides' strips overlap in a
//     small square, which is free. At an INSIDE corner the strip ends at the
//     tile edge while the perpendicular one starts on the NEXT tile, and the
//     square between them belongs to a third tile that has no exposed side
//     there — a notch in the outline at every bend. So an end is pushed on by
//     the strip's own width wherever the tile along the edge is a wall and so
//     is the one in front of it.
//
//  4. DERIVED FROM `wallTexture: "flat"`, NOT A NEW PALETTE FIELD. Only Arcade
//     Night wears "flat", and a neon edge on a hedge is not a hedge — the
//     IDEA-068 reasoning: two fields that must relate are a chance to
//     disagree. If the colour should become an editor dial, NEON_EDGE_PARAMS is
//     its seed (tunnelPortal.ts's PORTAL_COLORS made the same call).

import * as THREE from "three";
import { Grid, COLS, ROWS, worldX, worldZ } from "../game/grid";
import type { WallTextureKind } from "./wallTexture";

/** Balance numbers for the neon outline. Mutable for the same reason
 *  FENCE_PARAMS is: a test or a dev pane may isolate one dial. */
export const NEON_EDGE_PARAMS = {
  /** The tube's hot centre. Pale so it reads as a light source, blue so it is
   *  not the portal's arcade CYAN (tunnelPortal.ts) standing at the tunnel. */
  core: 0xa8c8ff,
  /** The light the tube throws — the saturated blue the eye reads as "neon". */
  glow: 0x2f62ff,
  /** Tube width across the edge, and how far it caps down the face. At the
   *  game camera's ~17 px a tile, 0.07 is just over the cartoon floor of 2 px. */
  width: 0.07,
  height: 0.05,
  /** How far the tube's outer face stands proud of the wall face. */
  proud: 0.006,
  /** How far the light reaches across the crown and down the face. */
  glowIn: 0.24,
  glowDown: 0.32,
  /** Brightness of the light at the tube, 0..1 of `glow`. */
  glowStrength: 0.85,
};

/** The board's neon outline: the tube and its light, owned together. */
export interface NeonEdges {
  group: THREE.Group;
  dispose(): void;
}

/** Whether a theme's walls get the outline — see rule 4. */
export function hasNeonEdges(wallTexture: WallTextureKind): boolean {
  return wallTexture === "flat";
}

function isWall(grid: Grid, x: number, y: number): boolean {
  return y >= 0 && y < ROWS && x >= 0 && x < COLS && grid.cells[y][x] === "#";
}

const SIDES: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
];

/** One exposed side's edge in world terms: where the edge line is, which way
 *  is out, which way runs along it, and how far each end is pushed on. */
interface Edge {
  /** Point on the edge line at the tile's mid-span. */
  ex: number;
  ez: number;
  /** Outward normal and tangent, both unit and axis-aligned. */
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  /** Whether each end (-tangent, +tangent) meets an inside corner. */
  concaveA: boolean;
  concaveB: boolean;
}

/** Every exposed wall side on `grid`. Exported for the test. */
export function neonEdgeList(grid: Grid): Edge[] {
  const out: Edge[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid.cells[y][x] !== "#") continue;
      for (const s of SIDES) {
        if (isWall(grid, x + s.dx, y + s.dy)) continue;
        // Grid +y is world +z, so the tangent in grid steps is (-dy, dx).
        const gx = -s.dy;
        const gy = s.dx;
        const concave = (e: number): boolean =>
          isWall(grid, x + e * gx, y + e * gy) && isWall(grid, x + e * gx + s.dx, y + e * gy + s.dy);
        out.push({
          ex: worldX(x) + s.dx * 0.5,
          ez: worldZ(y) + s.dy * 0.5,
          nx: s.dx,
          nz: s.dy,
          tx: gx,
          tz: gy,
          concaveA: concave(-1),
          concaveB: concave(1),
        });
      }
    }
  }
  return out;
}

/** Builds the tube geometry: one box per edge, merged by hand (positions and
 *  normals only — the material is unlit and untextured). */
function tubeGeometry(edges: Edge[], crownY: number): THREE.BufferGeometry {
  const P = NEON_EDGE_PARAMS;
  const pos: number[] = [];
  const idx: number[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const bp = box.attributes.position;
  const bi = box.index!;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const e of edges) {
    const a = -0.5 - (e.concaveA ? P.width : 0);
    const b = 0.5 + (e.concaveB ? P.width : 0);
    const len = b - a;
    const mid = (a + b) / 2;
    // Across the edge the tube spans from `width` inside the face to `proud`
    // outside it, so its outer side covers the wall's top corner.
    const across = P.width + P.proud;
    const acrossMid = P.proud - across / 2;
    const cx = e.ex + e.tx * mid + e.nx * acrossMid;
    const cz = e.ez + e.tz * mid + e.nz * acrossMid;
    const cy = crownY + 0.012 - P.height / 2;
    // Box local X runs along the tangent, Z across the edge.
    const sx = Math.abs(e.tx) * len + Math.abs(e.nx) * across;
    const sz = Math.abs(e.tz) * len + Math.abs(e.nz) * across;
    m.makeScale(sx, P.height, sz).setPosition(cx, cy, cz);
    const base = pos.length / 3;
    for (let i = 0; i < bp.count; i++) {
      v.fromBufferAttribute(bp, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < bi.count; i++) idx.push(base + bi.getX(i));
  }
  box.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Builds the light: two quads per edge, colour at the tube fading to black —
 *  one lying across the crown, one hanging down the face. Double-sided via the
 *  material, so winding is irrelevant. */
function glowGeometry(edges: Edge[], crownY: number): THREE.BufferGeometry {
  const P = NEON_EDGE_PARAMS;
  const c = new THREE.Color(P.glow).multiplyScalar(P.glowStrength);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const quad = (pts: number[][], hot: boolean[]): void => {
    const base = pos.length / 3;
    pts.forEach((p, i) => {
      pos.push(p[0], p[1], p[2]);
      if (hot[i]) col.push(c.r, c.g, c.b);
      else col.push(0, 0, 0);
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const yTop = crownY + 0.004;
  for (const e of edges) {
    const at = (t: number, inward: number, y: number, out = 0): number[] => [
      e.ex + e.tx * t - e.nx * inward + e.nx * out,
      y,
      e.ez + e.tz * t - e.nz * inward + e.nz * out,
    ];
    quad(
      [at(-0.5, 0, yTop), at(0.5, 0, yTop), at(0.5, P.glowIn, yTop), at(-0.5, P.glowIn, yTop)],
      [true, true, false, false],
    );
    // An inside corner leaves a square that neither edge's light covers. It is
    // lit from the CORNER POINT only, fading to black at the three far
    // vertices — which is exactly where the two neighbouring quads are black
    // too, so the corner reads as one bend in the light. Extending the strip
    // with its hot edge instead left a hard bright tab past the bend (v1).
    // Triangulated through the hot vertex so the fade is symmetric.
    for (const [concave, end, dir] of [
      [e.concaveA, -0.5, -1],
      [e.concaveB, 0.5, 1],
    ] as const) {
      if (!concave) continue;
      quad(
        [
          at(end, 0, yTop),
          at(end + dir * P.glowIn, 0, yTop),
          at(end + dir * P.glowIn, P.glowIn, yTop),
          at(end, P.glowIn, yTop),
        ],
        [true, false, false, false],
      );
    }
    // Down the face: just proud of it, from the crown to `glowDown` below.
    const o = P.proud + 0.002;
    quad(
      [
        at(-0.5, 0, crownY, o),
        at(0.5, 0, crownY, o),
        at(0.5, 0, crownY - P.glowDown, o),
        at(-0.5, 0, crownY - P.glowDown, o),
      ],
      [true, true, false, false],
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The neon outline for `grid`, or null when the theme's walls do not take one
 * (rule 4). `crownY` is the wall's height: a "flat" wall is a plain box, so
 * every tile's crown is the same and there is no per-tile height to follow.
 */
export function buildNeonEdges(
  scene: THREE.Object3D,
  grid: Grid,
  wallTexture: WallTextureKind,
  crownY: number,
): NeonEdges | null {
  if (!hasNeonEdges(wallTexture)) return null;
  const edges = neonEdgeList(grid);
  if (edges.length === 0) return null;

  const tubeMat = new THREE.MeshBasicMaterial({ color: NEON_EDGE_PARAMS.core });
  const tube = new THREE.Mesh(tubeGeometry(edges, crownY), tubeMat);
  tube.name = "neonTube";

  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // MAX, not additive: where two edges' light overlaps (every corner) an
    // additive sum doubles and leaves a hot square, while max is the brighter
    // of the two — one continuous outline. Black still contributes nothing.
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(glowGeometry(edges, crownY), glowMat);
  glow.name = "neonGlow";
  // After the tube and the walls, so the light lands on what is already drawn.
  glow.renderOrder = 1;

  const group = new THREE.Group();
  group.name = "neonEdges";
  group.userData.madboxSkip = true;
  group.add(tube, glow);
  scene.add(group);

  return {
    group,
    dispose(): void {
      scene.remove(group);
      tube.geometry.dispose();
      glow.geometry.dispose();
      tubeMat.dispose();
      glowMat.dispose();
    },
  };
}
