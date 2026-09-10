// Scratch: dumps makeCrab()'s real part tree as the manifest
// forge/stage4_review/check_part_coverage.py reads.
//
// The manifest has to come from the SHIPPED builder, not from the generated
// factory in src/render/rework/ — that one never ships, so checking its parts
// would prove coverage of the wrong mesh.
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("crab", 0xe8615f);
g.updateMatrixWorld(true);

/**
 * SPEC ID -> SHIPPED MESH NAME.
 *
 * The spec names components anatomically and hyphenated (`chela-dactyl-l`);
 * characters.ts names meshes the way every other enemy in the file does
 * (`chelaDactylTipL`), and the editor registry, the source rewriter and
 * test-runtime-owned all key off THAT convention. Renaming the meshes to
 * satisfy a review script would break three consumers to please one.
 *
 * So the correspondence is declared here instead, which also makes it reviewable:
 * a spec component with no entry below and no same-named mesh is genuinely
 * unbuilt, and the coverage gate will say so.
 */
const SPEC_ID: Record<string, string> = {
  facePanel: "face-panel",
  carapaceLip: "carapace-lip",
  chinApron: "chin-apron",
  tubercle0: "tubercle-field",
};
for (const side of ["L", "R"] as const) {
  const s = side.toLowerCase();
  SPEC_ID[`eyestalkColumn${side}`] = `eyestalk-${s}`;
  SPEC_ID[`eyeCollar${side}`] = `collar-${s}`;
  SPEC_ID[`eye${side}`] = `eyeball-${s}`;
  SPEC_ID[`iris${side}`] = `iris-ring-${s}`;
  SPEC_ID[`pupil${side}`] = `pupil-${s}`;
  SPEC_ID[`glint${side}`] = `glint-${s}`;
  SPEC_ID[`brow${side}`] = `brow-${s}`;
  SPEC_ID[`chelipedMerus${side}`] = `cheliped-merus-${s}`;
  SPEC_ID[`chelipedCarpus${side}`] = `cheliped-carpus-${s}`;
  SPEC_ID[`chelaPalm${side}`] = `chela-palm-${s}`;
  SPEC_ID[`chelaPollex${side}`] = `chela-pollex-${s}`;
  SPEC_ID[`chelaDactylTip${side}`] = `chela-dactyl-${s}`;
  for (let n = 1; n <= 4; n++) {
    SPEC_ID[`legMerus${n}${side}`] = `leg${n}-merus-${s}`;
    SPEC_ID[`legPropodus${n}${side}`] = `leg${n}-propodus-${s}`;
    SPEC_ID[`legDactyl${n}${side}`] = `leg${n}-dactyl-${s}`;
  }
}

const parts: { name: string; kind: string; module: string; triangles: number }[] = [];
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const geo = o.geometry;
  const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  const built = o.name || "(unnamed)";
  parts.push({
    // `name` is what the coverage gate matches against the spec; `module` keeps
    // the real mesh name, so the manifest reads as the correspondence it is.
    name: SPEC_ID[built] ?? built,
    kind: "part",
    module: built,
    triangles: Math.round(tris),
  });
});

writeFileSync(
  ".img2threejs/crab/parts.json",
  JSON.stringify(
    { model: "cartoon-crab", source: "src/render/characters.ts makeCrab()", parts },
    null,
    1,
  ),
);
console.log(`${parts.length} parts -> .img2threejs/crab/parts.json`);
