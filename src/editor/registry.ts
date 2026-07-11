// OWNER: character editor (IDEA-025, dev-only).
// The five editable characters, each wrapping the REAL builder from
// src/render/characters.ts — the editor always shows exactly what the game
// ships. The beagle carries the menu showcase's idle animation (same local
// re-implementation as menuScene.ts, since animateBeagleParts isn't exported
// from characters.ts); enemies are turntable-only in v1.
import * as THREE from "three";
import { makeBeagle, makeEnemy, type BeagleParts } from "../render/characters";
import { getBeagleSkin } from "../game/cosmetics";
import { COLORS } from "../game/config";

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
  /** Per-frame idle animation (only writes to idleTargets' transforms). */
  idle?(group: THREE.Group, t: number): void;
  /** The objects idle() writes to — restored to their authored pose (baseline
   *  + user edits) when the idle animation is paused. */
  idleTargets(group: THREE.Group): THREE.Object3D[];
}

// Same idle formulas as menuScene.ts's animateIdle (tail wag / ear sway /
// breathing), minus the turntable — the stage's wrapper group owns rotation.
function beagleIdle(group: THREE.Group, t: number): void {
  const parts = group.userData.parts as BeagleParts | undefined;
  if (!parts) return;
  parts.tail.rotation.y = Math.sin(t * 1.8) * 0.4;
  parts.earL.rotation.x = Math.sin(t * 0.9) * 0.08 + Math.sin(t * 0.31 * Math.PI * 2) * 0.05;
  parts.earR.rotation.x =
    Math.sin(t * 0.9 + 1.1) * 0.08 + Math.sin(t * 0.31 * Math.PI * 2 + 1.1) * 0.05;
  const breathe = Math.sin(t * 1.4 * Math.PI * 2) * 0.015;
  group.scale.y = group.scale.x * (1 + breathe);
}

function beagleIdleTargets(group: THREE.Group): THREE.Object3D[] {
  const parts = group.userData.parts as BeagleParts | undefined;
  if (!parts) return [group];
  return [group, parts.tail, parts.earL, parts.earR];
}

function enemyDef(id: string, label: string, builderName: string): CharacterDef {
  return {
    id,
    label,
    builderName,
    isBeagle: false,
    build: (opts) => makeEnemy(id, ENEMY_COLORS[opts.enemyColor]),
    idleTargets: () => [],
  };
}

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: "beagle",
    label: "Beagle",
    builderName: "makeBeagle",
    isBeagle: true,
    build: (opts) => makeBeagle(getBeagleSkin(opts.beagleSkinId)),
    idle: beagleIdle,
    idleTargets: beagleIdleTargets,
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
