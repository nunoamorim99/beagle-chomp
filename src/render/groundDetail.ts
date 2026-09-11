// OWNER: render-artist
// IDEA-060 v2: the things lying ON the ground, as real meshes.
//
// The garden's stepping stones were PAINTED — irregular flagstones drawn into
// the floor texture, following the corridors (floorTexture.ts's `gardenPath`,
// now removed). They worked, in the sense that they read as stones, and they
// cost a long comment explaining the three separate concessions needed to stop
// them fighting the biscuit trail: they had to be the lawn's own value,
// because the floor's `emissiveMap` is the same texture and a pale mark blooms
// into fog; they had to be a different HUE from the biscuit, because at 25px a
// tile brightness is not a signal the eye can use; and they had to carry a
// heavy keyline, because without the value step the outline was all that was
// left.
//
// Every one of those is a constraint of PAINTING a floor, and none of them
// applies to a mesh. A rock with real geometry has a silhouette, catches the
// key light on its top and shades on its side, and drops a contact shadow —
// so it separates from a flat green lawn on form, and the floor is free to go
// back to being plain grass.
//
// Nuno: "instead of have a floor that is a draw can we make it with three js?
// Like make the rock and put then on the floor? and the floor be all green?"
//
// FOUR RULES.
//
//  1. NOTHING SITS AT A TILE'S CENTRE. Biscuits do. A rock on the centre would
//     sit under the pellet the player is tracking and, once eaten, leave
//     something that still looks like a pickup. Every rock is pushed to
//     `minOffset`-`maxOffset` of a tile from the centre, which also reads
//     better: scattered stones in grass rather than a paved line.
//
//  2. ONE InstancedMesh, ONE DRAW CALL. Same construction as fence.ts. Tone
//     variation comes from `setColorAt` (per-instance colour, still one draw)
//     rather than from a second mesh.
//
//  3. LOW. `MAX_HEIGHT` is a fraction of a tile, so a rock never reads as an
//     obstacle in a corridor the beagle has to run down. This is a maze first.
//
//  4. DETERMINISTIC, from the tile coordinate. A board that reshuffles its
//     stones between levels would be its own kind of wrong, and it would make
//     every screenshot untestable.
import * as THREE from "three";
import { COLS, ROWS, worldX, worldZ, type Grid } from "../game/grid";
import { toon } from "./toon";
import { lobedFoliageGeometry } from "./foliage";

/** Which loose ground dressing a theme scatters. */
export type GroundDetailKind = "none" | "rocks";

/**
 * IDEA-062 v5: the ground dressing's tunables as a NAMED, MUTABLE table —
 * same contract as fence.ts's FENCE_PARAMS, and for the same reason (the
 * editor's World tab needs to move one and see the board rebuild). Production
 * never writes it; the editor does, and then writes the values back to THIS
 * literal so the file stays the source of truth.
 */
export interface GroundDetailParams {
  /** Fraction of eligible corridor tiles that get a rock. Sparse on purpose —
   *  the corridor belongs to the biscuits. */
  chance: number;
  /** …and rather more on the apron ring, which has no gameplay to protect. */
  apronChance: number;
  /** How far from a tile's centre a rock is pushed, in tiles. Rule 1: NOTHING
   *  sits at a tile CENTRE — biscuits do, and a rock there reads as a pickup
   *  that will not go away. */
  minOffset: number;
  maxOffset: number;
  /** Base radius, before the per-instance scale. Rule 2: stay under a fifth of
   *  a tile tall or a corridor starts to look blocked. */
  radius: number;
  /** Vertical squash — a rock is a slab, not a ball. */
  flatten: number;
}

export const GROUND_DETAIL_PARAMS: GroundDetailParams = {
  chance: 0.9,
  apronChance: 0.3,
  minOffset: 0.26,
  maxOffset: 0.4,
  radius: 0.2,
  flatten: 0.2,
};

/**
 * One rock, as a coarsely lobed and flattened solid.
 *
 * `detail: 1` (80 faces) and only six lobes on purpose: a rock wants FEWER,
 * BIGGER facets than foliage does. The same generator tuned the other way —
 * many small lobes and a smooth surface — is what makes a bush, and the
 * shrub's own first build came back reading as a boulder precisely because it
 * used these settings by accident (CLAUDE.md IDEA-060 rule 4). Here that read
 * is the goal.
 */
function rockGeometry(): THREE.BufferGeometry {
  return lobedFoliageGeometry(GROUND_DETAIL_PARAMS.radius, {
    detail: 1,
    lobes: 6,
    sharpness: 6,
    amplitude: 0.26,
    scale: [1, GROUND_DETAIL_PARAMS.flatten, 0.86],
    seed: 31,
  });
}

/** Deterministic hash of a tile coordinate to 0..1 — its own seed band, well
 *  clear of buildProps' (200), buildWallDecor's (300) and buildHedgeDecor's
 *  (1-7), so a tile carrying two kinds of decoration never gets the same
 *  number twice. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 4001, 73856093) ^ Math.imul(y + 4001, 19349663) ^ Math.imul(salt + 400, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Scatters `kind` over the board and adds it to `scene`, or returns null for
 * "none" — the same null-for-nothing contract buildProps, buildWallDecor and
 * buildFence use, and for the same reason: a theme without ground dressing
 * should cost no mesh at all, not an empty one.
 *
 * Covers the maze's walkable tiles AND the one-tile apron ring around it. The
 * apron is not walkable and has no biscuits, so it takes a denser scatter.
 */
export function buildGroundDetail(
  scene: THREE.Object3D,
  grid: Grid,
  kind: GroundDetailKind,
  color: number,
): THREE.InstancedMesh | null {
  if (kind === "none") return null;

  // Two passes over the same tiles: count, then fill. An InstancedMesh needs
  // its count at construction.
  const spots: Array<{ x: number; z: number; h: number }> = [];
  for (let ty = -1; ty <= ROWS; ty++) {
    for (let tx = -1; tx <= COLS; tx++) {
      const onApron = ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS;
      // Inside the maze, only corridors: a rock on a wall tile would be buried
      // in the hedge.
      if (!onApron && grid.cells[ty][tx] === "#") continue;
      const roll = hash(tx, ty, 1);
      if (roll > (onApron ? GROUND_DETAIL_PARAMS.apronChance : GROUND_DETAIL_PARAMS.chance)) continue;
      // Rule 1: never the centre. Polar placement, so the exclusion is a real
      // disc rather than a square with a hole cut in it.
      const a = hash(tx, ty, 2) * Math.PI * 2;
      const d =
        GROUND_DETAIL_PARAMS.minOffset +
        hash(tx, ty, 3) * (GROUND_DETAIL_PARAMS.maxOffset - GROUND_DETAIL_PARAMS.minOffset);
      spots.push({
        x: worldX(tx) + Math.cos(a) * d,
        z: worldZ(ty) + Math.sin(a) * d,
        h: hash(tx, ty, 4),
      });
    }
  }
  if (spots.length === 0) return null;

  const geo = rockGeometry();
  const mesh = new THREE.InstancedMesh(geo, toon({ color }), spots.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  // A GREY per-instance tint, so it MULTIPLIES the material's own stone
  // colour rather than replacing it — the palette still owns what colour the
  // rocks are, and this only says which of them are lighter or darker. Same
  // arrangement as fence.ts's vertex colours, and for the same reason.
  //
  // The first build wrote the full colour into `setColorAt` while the material
  // ALSO carried it, so every rock rendered at colour-squared — 0.61 x 0.53 —
  // and the board came back scattered with what looked like flecks of dirt.
  const tint = new THREE.Color();
  spots.forEach((s, i) => {
    const scale = 0.72 + s.h * 0.66;
    dummy.position.set(s.x, GROUND_DETAIL_PARAMS.radius * GROUND_DETAIL_PARAMS.flatten * scale * 0.72, s.z);
    dummy.rotation.set((s.h - 0.5) * 0.3, s.h * Math.PI * 4, (hash(i, i, 5) - 0.5) * 0.3);
    dummy.scale.set(scale, scale * (0.8 + s.h * 0.5), scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // Three stone tones rather than a continuous ramp — the cartoon rule this
    // project follows everywhere (paint.ts's callers, floorTexture's header):
    // a handful of named shades reads as stone, a thousand reads as dirt.
    const step = [0.82, 1, 1.16][Math.floor(hash(i, i, 6) * 3) % 3];
    tint.setScalar(step);
    mesh.setColorAt(i, tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

/** Frees a mesh from `buildGroundDetail` — geometry AND material, both of
 *  which it owns outright (see fence.ts's disposeFence for the same note). */
export function disposeGroundDetail(mesh: THREE.InstancedMesh): void {
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}
