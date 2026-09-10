// End-to-end check that the mosquito reaches the GAME path, not just the
// preview: makeEnemy dispatch, the GhostUserData contract, and the one rule
// this skin was most at risk of breaking (creaseMat must NOT be in accentMats).
//
//   npx tsx scripts/_scratch-mosquito-verify.ts
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";
import { ENEMY_SKINS, getEnemySkin } from "../src/game/cosmetics";

const g = makeEnemy("mosquito", 0x54c9c1);
let tris = 0;
let meshes = 0;
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  meshes++;
  const geo = o.geometry;
  tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
});

const ud = g.userData as {
  bodyMat?: THREE.Material;
  eyes: THREE.Object3D[];
  pupPivots: THREE.Object3D[];
  accentMats?: THREE.MeshToonMaterial[];
  spiritMats: THREE.MeshToonMaterial[];
  eyeMats: THREE.MeshToonMaterial[];
  behaviour?: unknown;
};

console.log(`makeEnemy("mosquito") -> ${meshes} meshes, ${tris} tris`);
console.log(
  `GhostUserData: bodyMat=${!!ud.bodyMat} eyes=${ud.eyes.length} pupPivots=${ud.pupPivots.length}` +
    ` accentMats=${ud.accentMats?.length} eyeMats=${ud.eyeMats.length}` +
    ` spiritMats=${ud.spiritMats.length} behaviour=${!!ud.behaviour}`,
);

const CREASE = 0x241408;
const creaseInAccents = (ud.accentMats ?? []).some(
  (m) => (m.userData as { baseColor?: number }).baseColor === CREASE,
);
console.log(`creaseMat in accentMats? ${creaseInAccents}  (MUST be false — IDEA-053 rule 2)`);

console.log("cosmetics entry:", JSON.stringify(getEnemySkin("mosquito")));
console.log("enemy skin count:", ENEMY_SKINS.length);

const problems: string[] = [];
if (meshes < 40) problems.push("too few meshes — dispatch may have fallen back to the ghost");
if (!ud.bodyMat) problems.push("no bodyMat");
if (ud.pupPivots.length !== 2) problems.push("expected 2 pupil pivots");
if (!ud.behaviour) problems.push("no behaviour");
if (creaseInAccents) problems.push("creaseMat is in accentMats — frightened will erase the banding");
if (getEnemySkin("mosquito").id !== "mosquito") problems.push("cosmetics lookup fell back");

if (problems.length) {
  for (const p of problems) console.log("  FAIL " + p);
  process.exit(1);
}
console.log("PASS: the mosquito reaches the game path and satisfies GhostUserData");
