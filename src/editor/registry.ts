// OWNER: character editor (IDEA-025, dev-only).
// The five editable characters, each wrapping the REAL builder from
// src/render/characters.ts — the editor always shows exactly what the game
// ships, animation included: every preview mode below runs the real
// syncToEntity / applyGhostState rather than a copy of their formulas.
import * as THREE from "three";
import { makeBeagle, makeEnemy, syncToEntity, applyGhostState } from "../render/characters";
import { makeEntity, type Entity } from "../game/movement";
import { OX, OZ } from "../game/grid";
import { type GhostState } from "../game/ghostAI";
import { getBeagleSkin } from "../game/cosmetics";
import { COLORS } from "../game/config";

/**
 * What the viewport is showing. "off" holds the authored pose so parts can be
 * edited without chasing a moving target.
 *
 * These run the REAL game animation code (syncToEntity / applyGhostState), not
 * a copy of it. That distinction is the whole point: the beagle's old editor
 * idle was a local re-implementation of menuScene's, free to drift from what
 * actually ships — and the reason a shipped bug went unseen for so long was
 * that enemies had no animation preview here AT ALL. The bee's stripes and the
 * ladybug's spots were falling onto the floor every game, and the editor showed
 * them sitting perfectly on the body, because the editor never ran the
 * animation that broke them.
 */
export type AnimMode = "off" | "idle" | "walk" | "frightened" | "eaten";

export const BEAGLE_MODES: readonly AnimMode[] = ["off", "idle", "walk"];
export const ENEMY_MODES: readonly AnimMode[] = ["off", "idle", "walk", "frightened", "eaten"];

/** One synthetic entity per previewed group — syncToEntity keys its own walk
 *  state off the object, so the entity just has to be stable across frames. */
const previewEntities = new WeakMap<THREE.Object3D, Entity>();

function previewEntity(group: THREE.Group): Entity {
  let e = previewEntities.get(group);
  if (!e) {
    // Parked on the grid origin, so entityWorld() puts it at (0, y, 0) — the
    // middle of the editor stage. `progress` is never advanced, so "walk" is
    // walking on the spot rather than sliding off the turntable.
    e = makeEntity(OX, OZ, 4);
    previewEntities.set(group, e);
  }
  return e;
}

function drive(group: THREE.Group, mode: AnimMode, dt: number, isEnemy: boolean): void {
  if (mode === "off") return;
  const e = previewEntity(group);
  const walking = mode === "walk";
  // Heading +Z = yaw 0, so the character faces the camera instead of spinning
  // to some arbitrary compass direction the moment the preview starts.
  e.dir = walking ? { x: 0, y: 1 } : { x: 0, y: 0 };
  e.facing = { x: 0, y: 1 };
  e.progress = 0;
  syncToEntity(group, e, dt);
  if (isEnemy) {
    // applyGhostState's "normal" look is its else-branch — any state that is
    // neither frightened nor eaten. "chase" is the one the game spends most of
    // its time in, so that is what the preview shows.
    const ghostState: GhostState =
      mode === "frightened" ? "frightened" : mode === "eaten" ? "eaten" : "chase";
    // The GAME passes the ghost's `dir` (see game.ts), which is {0,0} while it
    // is standing still — so an idle enemy looks straight ahead. Passing
    // `facing` here instead would have held the pupils permanently off-centre
    // and made the preview lie about the resting pose.
    applyGhostState(group, ghostState, e.dir);
  }
}

export type EnemyColorKey = "rose" | "teal" | "amber";

export const ENEMY_COLORS: Record<EnemyColorKey, number> = {
  rose: COLORS.ghostRose,
  teal: COLORS.ghostTeal,
  amber: COLORS.ghostAmber,
};

export interface BuildOptions {
  beagleSkinId: string;
  enemyColor: EnemyColorKey;
}

export interface CharacterDef {
  id: string;
  label: string;
  /** Builder function name in characters.ts — drives the source view. */
  builderName: string;
  isBeagle: boolean;
  build(opts: BuildOptions): THREE.Group;
  /** Drives one frame of the REAL game animation for `mode`. */
  animate(group: THREE.Group, mode: AnimMode, dt: number): void;
  /** Which preview modes this character offers. */
  modes: readonly AnimMode[];
  /** True for everything applyGhostState applies to. */
  isEnemy: boolean;
}

function enemyDef(id: string, label: string, builderName: string): CharacterDef {
  return {
    id,
    label,
    builderName,
    isBeagle: false,
    isEnemy: true,
    modes: ENEMY_MODES,
    build: (opts) => makeEnemy(id, ENEMY_COLORS[opts.enemyColor]),
    animate: (group, mode, dt) => drive(group, mode, dt, true),
  };
}

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: "beagle",
    label: "Beagle",
    builderName: "makeBeagle",
    isBeagle: true,
    isEnemy: false,
    modes: BEAGLE_MODES,
    build: (opts) => makeBeagle(getBeagleSkin(opts.beagleSkinId)),
    animate: (group, mode, dt) => drive(group, mode, dt, false),
  },
  enemyDef("ghost", "Ghost", "makeGhost"),
  enemyDef("beetle", "Beetle", "makeBeetle"),
  enemyDef("bee", "Bee", "makeBee"),
  enemyDef("ladybug", "Ladybug", "makeLadybug"),
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** menuScene.ts's dispose pattern: release geometries + materials of a group
 *  being discarded on character switch. Editor overlays share the selected
 *  mesh's geometry, but by the time this runs the highlight has been cleared,
 *  so everything left is owned by this group. */
export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
  group.removeFromParent();
}
