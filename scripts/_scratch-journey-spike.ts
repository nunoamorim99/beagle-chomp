// IDEA-079 phase 0 — THE SPIKE'S INSTRUMENT.
//
// Forty dressed islands is the expensive half of the archipelago idea, and
// draw calls are this project's prop budget rather than triangles (IDEA-065
// rule 3). The garden board already sits near 350 calls. So this measures the
// real thing before the rest is built: real props from PROP_LIBRARY, real
// theme palettes, the real merges.
//
// It answers four questions and refuses to guess at any of them:
//   1. What does ONE island cost, per theme? (they carry different props)
//   2. What do all FORTY cost together?
//   3. How much does the merge actually buy — none vs material vs signature?
//   4. Does the whole archipelago fit a frame budget on a phone?
//
// Headless: three.js runs in Node here with no renderer, so "draw calls" is
// COUNTED as the renderable meshes a frame would submit (a material-array mesh
// counts once per GROUP — IDEA-067 rule 7, which is the trap that made two
// arches cost 24 calls). That is a model of the renderer, not the renderer, so
// the browser check at the end of the spike is what confirms it.
//
//   npx tsx scripts/_scratch-journey-spike.ts
import * as THREE from "three";
import { JOURNEY_LEVELS, JOURNEY_CHAPTERS } from "../src/game/journey";
import {
  makeJourneyIsland,
  ISLAND_LANDMARKS,
  type IslandMerge,
} from "../src/render/journeyIsland";

interface Cost {
  calls: number;
  tris: number;
  meshes: number;
}

/**
 * What a frame would submit for this subtree.
 *
 * A mesh with a material ARRAY costs one call PER GROUP, not one per mesh:
 * that is how two archways came to cost 24 draw calls when they looked like 2
 * (IDEA-067 rule 7). Counting it any other way would make the island body —
 * which deliberately carries a two-material array — look free.
 */
function cost(root: THREE.Object3D): Cost {
  let calls = 0;
  let tris = 0;
  let meshes = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    meshes++;
    const geo = mesh.geometry;
    const groups = geo.groups?.length ?? 0;
    calls += Array.isArray(mesh.material) ? Math.max(1, groups) : 1;
    const idx = geo.getIndex();
    const pos = geo.getAttribute("position");
    tris += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
  });
  return { calls, tris: Math.round(tris), meshes };
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

console.log("IDEA-079 spike — what an island costs\n");

// ---------------------------------------------------------------------------
console.log("ONE ISLAND, PER THEME (merge: signature)");
console.log("  theme      props  meshes  calls     tris");
{
  const seen = new Set<string>();
  for (let i = 0; i < JOURNEY_LEVELS.length; i++) {
    const level = JOURNEY_LEVELS[i];
    if (seen.has(level.themeId)) continue;
    seen.add(level.themeId);
    const island = makeJourneyIsland(level, i);
    const c = cost(island.group);
    const props = (ISLAND_LANDMARKS[level.themeId] ?? []).length;
    console.log(
      `  ${level.themeId.padEnd(9)} ${pad(props, 5)}  ${pad(c.meshes, 6)}  ${pad(c.calls, 5)}  ${pad(c.tris.toLocaleString(), 7)}`,
    );
    island.dispose();
  }
}

// ---------------------------------------------------------------------------
console.log("\nWHAT THE MERGE BUYS (one garden island — the heaviest theme)");
console.log("  merge        meshes  calls     tris");
{
  const gardenIdx = JOURNEY_LEVELS.findIndex((l) => l.themeId === "garden");
  for (const merge of ["none", "material", "signature"] as IslandMerge[]) {
    const island = makeJourneyIsland(JOURNEY_LEVELS[gardenIdx], gardenIdx, undefined, merge);
    const c = cost(island.group);
    console.log(
      `  ${merge.padEnd(11)}  ${pad(c.meshes, 6)}  ${pad(c.calls, 5)}  ${pad(c.tris.toLocaleString(), 7)}`,
    );
    island.dispose();
  }
}

// ---------------------------------------------------------------------------
console.log("\nTHE WHOLE ARCHIPELAGO — all 40 levels");
console.log("  merge        islands  meshes  calls      tris");
{
  for (const merge of ["none", "material", "signature"] as IslandMerge[]) {
    const world = new THREE.Group();
    const built = JOURNEY_LEVELS.map((level, i) =>
      makeJourneyIsland(level, i, undefined, merge),
    );
    for (const b of built) world.add(b.group);
    const c = cost(world);
    console.log(
      `  ${merge.padEnd(11)}  ${pad(built.length, 7)}  ${pad(c.meshes, 6)}  ${pad(c.calls, 5)}  ${pad(c.tris.toLocaleString(), 8)}`,
    );
    for (const b of built) b.dispose();
  }
}

// ---------------------------------------------------------------------------
// The number that actually decides the design. A player never sees forty
// islands at once — the chain is panned, so only a slice is ever in frame.
// Culling is what makes this affordable if the full total does not fit, so the
// per-chapter figure is the one to design against.
console.log("\nONE CHAPTER IN FRAME (the realistic worst case while panning)");
console.log("  chapter        levels  calls      tris");
{
  for (const ch of JOURNEY_CHAPTERS) {
    const world = new THREE.Group();
    const built: ReturnType<typeof makeJourneyIsland>[] = [];
    for (let i = ch.from; i < ch.from + ch.count; i++) {
      const b = makeJourneyIsland(JOURNEY_LEVELS[i], i);
      built.push(b);
      world.add(b.group);
    }
    const c = cost(world);
    console.log(
      `  ${ch.title.padEnd(13)}  ${pad(ch.count, 6)}  ${pad(c.calls, 5)}  ${pad(c.tris.toLocaleString(), 8)}`,
    );
    for (const b of built) b.dispose();
  }
}

console.log(
  "\nFor scale: the garden BOARD measures ~350 draw calls / ~250k triangles at\n" +
    "390x844 (CLAUDE.md, IDEA-067). A map screen has no board on it, so its\n" +
    "whole budget is its own — but it shares the phone.",
);
