// OWNER: render-artist
// Builds maze meshes for a level: instanced walls, floor, biscuits, bones.
// Reference: /prototype/beagle-chomp.html (buildBoard, makeBone).
// Contract: buildBoard(scene, grid) -> { pelletMeshes: Map<string, {...}>, ... }
// Keep walls as a single InstancedMesh (performance requirement).
import * as THREE from "three";
import { Grid, COLS, ROWS, TILE, worldX, worldZ } from "../game/grid";
import { COLORS } from "../game/config";

export const WALL_H = 1;

export type PelletKind = "biscuit" | "bone";
export interface PelletMesh {
  mesh: THREE.Object3D;
  kind: PelletKind;
}

export interface Board {
  /** Keyed by "tx,ty" — remove exactly one entry (and its mesh) when eaten. */
  pelletMeshes: Map<string, PelletMesh>;
  pelletsLeft: number;
  walls: THREE.InstancedMesh;
  floor: THREE.Mesh;
  /** The current bonus fruit, if any (see spawnFruit/clearFruit). Lifecycle
   *  is entirely render-side — gameplay only tells us when/where to spawn or
   *  clear one, keeping fruit placement logic out of src/game. */
  fruit: THREE.Object3D | null;
}

// Emissive nudged up a touch (0.6 -> 0.72) so the walls keep reading as
// glowing neon under the warmer/softer M6 lighting rig (scene.ts) instead of
// flattening out — roughness/metalness/base color untouched.
const matWall = new THREE.MeshStandardMaterial({
  color: COLORS.wall,
  roughness: 0.5,
  metalness: 0.1,
  emissive: COLORS.wallEmissive,
  emissiveIntensity: 0.72,
});
// A faint warm emissive added (floor had none) so the tile bed picks up a
// little ambient glow of its own instead of reading as pure flat matte
// under the atmosphere pass — still overwhelmingly a diffuse, roughness: 1
// surface, this is just a whisper of lift.
const matFloor = new THREE.MeshStandardMaterial({
  color: COLORS.floor,
  roughness: 1,
  emissive: 0x0a0a18,
  emissiveIntensity: 0.3,
});
const geoBiscuit = new THREE.SphereGeometry(0.13, 12, 12);
// Biscuit glow warmed and strengthened (0x3a2a10/0.4 -> 0x6a4a18/0.55) so
// pellets read as gently lit treats rather than flat spheres, without
// blowing out at the tuned exposure (see scene.ts toneMappingExposure note).
const matBiscuit = new THREE.MeshStandardMaterial({
  color: COLORS.biscuit,
  roughness: 0.7,
  emissive: 0x6a4a18,
  emissiveIntensity: 0.55,
});

/** A dog bone built from a cylinder shaft + four sphere "knuckles". */
function makeBone(): THREE.Group {
  const g = new THREE.Group();
  // Emissive warmed and strengthened (0x554a2a/0.25 -> 0x6a5730/0.4) to match
  // the biscuit's softly-lit-treat read at the new exposure/lighting.
  const white = new THREE.MeshStandardMaterial({
    color: 0xf6f1e6,
    roughness: 0.5,
    emissive: 0x6a5730,
    emissiveIntensity: 0.4,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), white);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const knuckles: Array<[number, number]> = [
    [-0.2, 0.09],
    [-0.2, -0.09],
    [0.2, 0.09],
    [0.2, -0.09],
  ];
  knuckles.forEach(([x, z]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), white);
    k.position.set(x, 0, z);
    g.add(k);
  });
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * A bonus fruit built from primitives (ported from prototype makeFruit,
 * line 201): an apple body plus a small leaf. Placement is the caller's job
 * (see spawnFruit) — this just builds the model at the origin.
 */
export function makeFruit(): THREE.Group {
  const g = new THREE.Group();
  // Emissive strengthened (0x3a0d0a/0.4 -> 0x5c130f/0.5) so the fruit reads
  // as a glowing bonus pickup, matching the biscuit/bone glow treatment.
  const apple = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd8483f,
      roughness: 0.4,
      emissive: 0x5c130f,
      emissiveIntensity: 0.5,
    }),
  );
  g.add(apple);
  // Leaf gets a faint green emissive too (was none) — subtle, just enough
  // that it doesn't look like a flat unlit cutout next to the glowing apple.
  const leaf = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x5fae4d,
      emissive: 0x1c3a18,
      emissiveIntensity: 0.3,
    }),
  );
  leaf.position.set(0.06, 0.22, 0);
  leaf.scale.set(1.4, 0.5, 0.8);
  g.add(leaf);
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** Builds the floor, instanced walls, and pellet meshes for one level. */
export function buildBoard(scene: THREE.Object3D, grid: Grid): Board {
  const pelletMeshes = new Map<string, PelletMesh>();
  let pelletsLeft = 0;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(COLS + 2, ROWS + 2), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  let wallCount = 0;
  grid.cells.forEach((row) => row.forEach((c) => { if (c === "#") wallCount++; }));

  const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const walls = new THREE.InstancedMesh(wallGeo, matWall, wallCount);
  walls.castShadow = true;
  walls.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let wi = 0;

  grid.cells.forEach((row, y) => row.forEach((c, x) => {
    if (c === "#") {
      dummy.position.set(worldX(x), WALL_H / 2, worldZ(y));
      dummy.updateMatrix();
      walls.setMatrixAt(wi++, dummy.matrix);
    } else if (c === "." || c === "o") {
      const mesh: THREE.Object3D = c === "o" ? makeBone() : new THREE.Mesh(geoBiscuit, matBiscuit);
      mesh.position.set(worldX(x), 0.45, worldZ(y));
      if (c !== "o") mesh.castShadow = true;
      scene.add(mesh);
      pelletMeshes.set(`${x},${y}`, { mesh, kind: c === "o" ? "bone" : "biscuit" });
      pelletsLeft++;
    }
  }));

  scene.add(walls);

  return { pelletMeshes, pelletsLeft, walls, floor, fruit: null };
}

/**
 * Removes and disposes the pellet mesh at `key` ("tx,ty"), if any, and
 * decrements board.pelletsLeft. Returns the eaten pellet's kind, or null if
 * there was no pellet there (e.g. already eaten).
 */
export function eatPellet(board: Board, key: string): PelletKind | null {
  const entry = board.pelletMeshes.get(key);
  if (!entry) return null;
  entry.mesh.removeFromParent();
  board.pelletMeshes.delete(key);
  board.pelletsLeft--;
  return entry.kind;
}

/**
 * Spawns a fruit mesh at tile (tx,ty), replacing any fruit already on the
 * board (prototype maybeSpawnFruit only ever keeps one at a time). Placement
 * (which tile, when) is entirely gameplay's call — this just builds the mesh
 * and tracks it on the board so clearFruit/spinDecor and eating can find it.
 */
export function spawnFruit(board: Board, scene: THREE.Object3D, tx: number, ty: number): void {
  if (board.fruit) clearFruit(board, scene);
  const fruit = makeFruit();
  fruit.position.set(worldX(tx), 0.35, worldZ(ty));
  scene.add(fruit);
  board.fruit = fruit;
}

/** Removes the current fruit mesh (if any) from the scene and the board. */
export function clearFruit(board: Board, scene: THREE.Object3D): void {
  if (!board.fruit) return;
  scene.remove(board.fruit);
  board.fruit = null;
}

/**
 * Gentle idle spin for decorative pickups (prototype syncMeshes, lines
 * 582-583): bones spin a bit faster than the fruit. Biscuits don't spin in
 * the prototype, so they're left untouched here.
 */
export function spinDecor(board: Board, dt: number): void {
  board.pelletMeshes.forEach((p) => {
    if (p.kind === "bone") p.mesh.rotation.y += dt * 2;
  });
  if (board.fruit) board.fruit.rotation.y += dt * 1.5;
}
