// OWNER: render-artist
// IDEA-065: draw-call collapse for hand-assembled props.
//
// WHY THIS EXISTS, with the numbers that produced it. A prop in this project
// is a `THREE.Group` of small named primitives, which is the right way to
// AUTHOR one — IDEA-033's part editor addresses them by index path and every
// sculpt module since IDEA-047 is built that way. It is not the right way to
// SHIP one when a theme stands thirty-nine of it.
//
// Measured on the board, per theme (`scripts/tmp/meshcount.ts`):
//
//     garden   220 prop meshes /  22,488 triangles
//     park     120            /  15,532
//     city     314            /   5,368      <- the heaviest before this
//     forest   393            / 140,820      <- the pines alone
//
// The forest's first build was six times the heaviest board this project had
// ever shipped, and the cause was arithmetic rather than extravagance: a pine
// is ten meshes and there are thirty-nine of them. Draw calls are what hurt a
// phone here, not triangles — these are flat-shaded toon materials with no
// maps — so the fix is to merge, and the two functions below are the two
// shapes that merge takes.
//
// **WHERE IT IS CALLED IS THE WHOLE DESIGN, AND GETTING IT WRONG COST A
// REAL EDIT.** `collapseByMaterial` is called by `buildProps` and
// `buildWallDecor` — the BOARD — and by NOTHING ELSE. It must never live
// inside a prop factory.
//
// The first version put it at the end of each factory, so `makePropFromDef`
// itself returned a collapsed prop. That is the same object the EDITOR builds
// its part tree from, so every named primitive — `ring`, `pupil`, `earL`,
// `whorl3` — was replaced by an opaque `merged0`..`mergedN`, one per material.
// Nuno went looking for the perched bird's EYE, found nothing but `merged3`,
// and recoloured it: `merged3` is the gold eye-ring MATERIAL shared by both
// eyes, so the whole thing went white and saved into props.ts as
// `{ path: "3", color: 0xffffff }` — a path that means a different part in
// every future build. A prop that cannot be authored is not cheaper, it is
// broken.
//
// So: the FACTORY hands back the full named tree, which is what the editor
// authors and what `applyPropParts` addresses; the BOARD collapses the
// instance it is about to place, which is what a player sees. Nothing that
// authors a prop ever sees a merged mesh, and nothing the board draws ever
// pays for a part tree.
import * as THREE from "three";

/**
 * Concatenates geometries that each carry the SAME material groups into one
 * geometry that still does.
 *
 * For a prop whose parts are already a few big multi-group meshes — the
 * pine's whorls, which are all lit-top over shaded-underside — this keeps the
 * two-tone split intact where a plain merge would throw the groups away.
 *
 * `transforms[i]` is baked into `geos[i]`'s vertices, so the result sits in
 * the parent's frame and every input is disposed.
 */
export function mergeGrouped(
  geos: readonly THREE.BufferGeometry[],
  mats: readonly THREE.Material[],
  transforms: readonly THREE.Matrix4[],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const buckets: number[][] = mats.map(() => []);
  let base = 0;
  const v = new THREE.Vector3();
  geos.forEach((geo, gi) => {
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const m = transforms[gi];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
    const idx = geo.getIndex();
    if (!idx) return;
    // A geometry with no groups is all material 0 — the pine spire's case.
    const groups = geo.groups.length
      ? geo.groups
      : [{ start: 0, count: idx.count, materialIndex: 0 }];
    for (const grp of groups) {
      const bucket = buckets[grp.materialIndex ?? 0];
      for (let i = grp.start; i < grp.start + grp.count; i++) bucket.push(idx.getX(i) + base);
    }
    base += p.count;
  });
  for (const geo of geos) geo.dispose();

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const all: number[] = [];
  let at = 0;
  buckets.forEach((b, mi) => {
    if (!b.length) return;
    all.push(...b);
    out.addGroup(at, b.length, mi);
    at += b.length;
  });
  out.setIndex(all);
  out.computeVertexNormals();
  return out;
}

/**
 * Collapse a finished prop into ONE MESH PER MATERIAL, in place.
 *
 * Walks the group, buckets every mesh's geometry by the material object it
 * uses (by identity — a factory builds its own materials, so two props never
 * share one and two parts of one prop share exactly when they are meant to),
 * bakes each part's world transform into its vertices, and replaces the whole
 * subtree with one mesh per bucket.
 *
 * Three things it deliberately does:
 *   - It keeps NORMALS as authored rather than recomputing them. A rabbit is
 *     a pile of overlapping spheres and recomputing normals across the union
 *     would weld shading across seams that are supposed to be separate
 *     surfaces.
 *   - It preserves `castShadow`, which every `part()` in these modules sets.
 *   - It leaves a mesh with a material ARRAY alone rather than trying to
 *     split it, and folds it in as its own mesh. Multi-group geometry is
 *     already merged (see `mergeGrouped`); re-splitting it here would undo
 *     that for no gain.
 *
 * The resulting meshes are named `merged0`, `merged1`… — deliberately not the
 * names of the parts they came from, because they are no longer those parts
 * and an outliner that says "ear" over a mesh containing the whole animal is
 * worse than one that says nothing.
 */
export function collapseByMaterial(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  // RELATIVE to the root, not to the world. The root's own transform is left
  // ALONE and must be: `buildProps` multiplies the placement scale onto it and
  // then applies the height-safety caps to the PRODUCT, which is the whole
  // point of IDEA-062's `multiplyScalar` fix — baking the root's transform in
  // and resetting it to identity would let a def with a root scale walk
  // straight through a cap whose job is bounding how big the thing ends up in
  // front of the camera.
  const toLocal = root.matrixWorld.clone().invert();
  const order: THREE.Material[] = [];
  const byMat = new Map<THREE.Material, { geo: THREE.BufferGeometry; xf: THREE.Matrix4 }[]>();
  const arrayMeshes: THREE.Mesh[] = [];

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) {
      arrayMeshes.push(m);
      return;
    }
    const entry = { geo: m.geometry, xf: toLocal.clone().multiply(m.matrixWorld) };
    const list = byMat.get(m.material);
    if (list) list.push(entry);
    else {
      order.push(m.material);
      byMat.set(m.material, [entry]);
    }
  });
  if (!order.length && !arrayMeshes.length) return root;

  // Detach the array-material meshes before clearing, so they survive with
  // their own transform baked into the root's frame.
  const keep: THREE.Mesh[] = arrayMeshes.map((m) => {
    const g = m.geometry.clone();
    g.applyMatrix4(toLocal.clone().multiply(m.matrixWorld));
    const out = new THREE.Mesh(g, m.material);
    out.name = m.name;
    out.castShadow = m.castShadow;
    return out;
  });
  for (const m of arrayMeshes) m.geometry.dispose();

  const merged: THREE.Mesh[] = order.map((mat, i) => {
    const parts = byMat.get(mat) ?? [];
    const geos = parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.applyMatrix4(p.xf);
      return g;
    });
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      const gn = g.attributes.normal;
      if (gn) nor.set(gn.array as Float32Array, o * 3);
      o += g.attributes.position.count;
      g.dispose();
    }
    for (const p of parts) p.geo.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    const mesh = new THREE.Mesh(out, mat);
    mesh.name = "merged" + i;
    mesh.castShadow = true;
    return mesh;
  });

  root.clear();
  for (const m of merged) root.add(m);
  for (const m of keep) root.add(m);
  return root;
}
