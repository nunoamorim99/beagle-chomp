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
// REAL EDIT.** The merges here are called by the BOARD and by NOTHING ELSE —
// `collapseByMaterial` from `buildProps` and `buildWallDecor`,
// `mergeBySignature` from `ensureSurround` (IDEA-066). They must never live
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
//
// IDEA-066 ADDED A SECOND MERGE WITH A NARROWER CONTRACT. `mergeBySignature`
// buckets by what a material LOOKS LIKE rather than by which object it is, so
// it can weld across props — which is what collapses a four-hundred-prop
// surround to about sixteen draw calls instead of fourteen hundred. Welding
// means one object now paints another, so it is allowed ONLY where nothing is
// recoloured, animated, team-tinted or part-edited: the surround and the
// verge, and never a character. Its own doc comment carries the full rule,
// including why an unstamped material can cost a draw call but never
// correctness.
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
  // Identity keying: a factory builds its own materials, so two props never
  // share one and two parts of one prop share exactly when they are meant to.
  return collapseBy(root, (m) => m, true);
}

/**
 * Collapse a whole GROUP OF PROPS into one mesh per VISUAL SIGNATURE.
 *
 * IDEA-066. Same machinery as collapseByMaterial above -- transforms baked
 * relative to the root, normals kept as authored, material-ARRAY meshes left
 * alone -- with one difference: the bucket key is the material's `toonKey`
 * stamp (see toon.ts) rather than the material object itself.
 *
 * WHY IT EXISTS. collapseByMaterial gets a prop from ~3.5 meshes down to ~3,
 * which is the right trade for thirty apron props and hopeless for four
 * hundred surround ones: the surround would cost ~1,400 draw calls and draw
 * calls are this project's prop budget. Keying on appearance instead collapses
 * the ENTIRE surround to one mesh per distinct material -- about sixteen --
 * and that number does not grow with how much you put out there.
 *
 * WHERE IT MAY BE USED, and this is a narrower contract than
 * collapseByMaterial's:
 *   - The SURROUND and the VERGE, from the board layer, and nothing else.
 *   - NEVER on anything recoloured or animated at runtime. Welding two
 *     materials means one object now paints the other; that is safe out there
 *     because nothing in the surround is team-coloured, frightened, part-
 *     edited or tweened, and it would be a disaster on a character.
 *   - NEVER inside a prop factory, for the reason the header above gives.
 *
 * A material with no `toonKey` (built with `new THREE.MeshToonMaterial`
 * directly, or any non-toon material) falls back to its own uuid, so it never
 * welds -- it just costs its own draw call. Unknown input can cost
 * performance, never correctness.
 */
export function mergeBySignature(
  root: THREE.Object3D,
  opts?: { castShadow?: boolean },
): THREE.Object3D {
  return collapseBy(
    root,
    (m) => (typeof m.userData.toonKey === "string" ? m.userData.toonKey : "uuid:" + m.uuid),
    opts?.castShadow ?? false,
  );
}

/**
 * The shared engine. `keyOf` decides what counts as "the same material";
 * `castShadow` is what every produced mesh gets.
 */
function collapseBy(
  root: THREE.Object3D,
  keyOf: (m: THREE.Material) => unknown,
  castShadow: boolean,
): THREE.Object3D {
  root.updateMatrixWorld(true);
  // RELATIVE to the root, not to the world. The root's own transform is left
  // ALONE and must be: `buildProps` multiplies the placement scale onto it and
  // then applies the height-safety caps to the PRODUCT, which is the whole
  // point of IDEA-062's `multiplyScalar` fix — baking the root's transform in
  // and resetting it to identity would let a def with a root scale walk
  // straight through a cap whose job is bounding how big the thing ends up in
  // front of the camera.
  const toLocal = root.matrixWorld.clone().invert();
  // `order` keeps a representative material per bucket AND fixes the output
  // order, so merged0..N are stable across runs rather than Map-insertion
  // dependent in some future refactor.
  const order: { key: unknown; mat: THREE.Material }[] = [];
  const byMat = new Map<unknown, { geo: THREE.BufferGeometry; xf: THREE.Matrix4 }[]>();
  // Materials that lost their bucket to an equivalent one. Only a SIGNATURE
  // merge can produce any: `collapseByMaterial` keys by identity, so every
  // bucket has exactly one material object and this stays empty. When two
  // DISTINCT objects do weld — which is the whole point of mergeBySignature,
  // and the verge is where it happens, since every prop factory builds its
  // own materials — the loser ends up referenced by nothing and would leak a
  // GPU program for the life of the page. Disposing it is safe precisely
  // because it is unreachable: the merged mesh holds the representative.
  const orphaned = new Set<THREE.Material>();
  const arrayMeshes: THREE.Mesh[] = [];

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) {
      arrayMeshes.push(m);
      return;
    }
    const entry = { geo: m.geometry, xf: toLocal.clone().multiply(m.matrixWorld) };
    const key = keyOf(m.material);
    const list = byMat.get(key);
    if (list) {
      list.push(entry);
      const rep = order.find((o) => o.key === key);
      if (rep && rep.mat !== m.material) orphaned.add(m.material);
    } else {
      order.push({ key, mat: m.material });
      byMat.set(key, [entry]);
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
    out.castShadow = castShadow && m.castShadow;
    return out;
  });
  for (const m of arrayMeshes) m.geometry.dispose();

  const merged: THREE.Mesh[] = order.map(({ key, mat }, i) => {
    const parts = byMat.get(key) ?? [];
    const geos = parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.applyMatrix4(p.xf);
      return g;
    });
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    // IDEA-067: VERTEX COLOURS HAVE TO SURVIVE THE MERGE, and until this run
    // they did not. Only `position` and `normal` were carried, so any geometry
    // with a `color` attribute lost it — and a material with
    // `vertexColors: true` and no colour attribute renders **pure black**, not
    // untinted. The tunnel arch is what found it: fence.ts paints its dark
    // rails with a grey vertex colour (so the palette still owns the timber
    // hue and the fence stays one draw call), and the arch's footing came back
    // as six black slabs at the feet of an otherwise correct model.
    //
    // Allocated only when SOMETHING in the bucket has one, and geometries that
    // do not are filled with WHITE — the identity for a multiply, so mixing a
    // plain prop into a vertex-coloured bucket cannot darken it.
    const wantsColor = geos.some((g) => g.attributes.color !== undefined);
    const col = wantsColor ? new Float32Array(n * 3).fill(1) : null;
    // IDEA-072: AND `uv`, ONE ATTRIBUTE ALONG, for exactly the same reason.
    // A merged geometry with no UVs samples texel (0, 0) for every vertex, so
    // a TEXTURED material comes back as one flat colour — the corner of its
    // own canvas. It stayed latent through the whole surround because nothing
    // out there carries a map (`makeSurroundMaterials` builds plain `toon`
    // colours), and it surfaced the moment a showcase stood the REAL maze wall
    // behind the beagle: eleven hedge blocks rendered as plain green boxes.
    // A bucket holds ONE material, so either everything in it is mapped or
    // nothing is, and the zero-fill can never reach a sampler.
    const wantsUv = geos.some((g) => g.attributes.uv !== undefined);
    const uvs = wantsUv ? new Float32Array(n * 2) : null;
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      const gn = g.attributes.normal;
      if (gn) nor.set(gn.array as Float32Array, o * 3);
      const gc = g.attributes.color;
      if (col && gc) col.set(gc.array as Float32Array, o * 3);
      const gu = g.attributes.uv;
      if (uvs && gu) uvs.set(gu.array as Float32Array, o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    for (const p of parts) p.geo.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (uvs) out.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    out.computeBoundingSphere();
    const mesh = new THREE.Mesh(out, mat);
    mesh.name = "merged" + i;
    mesh.castShadow = castShadow;
    return mesh;
  });

  root.clear();
  for (const m of merged) root.add(m);
  for (const m of keep) root.add(m);
  // Never dispose a material still standing as a bucket's representative — a
  // prop can carry the same object on two parts, so `orphaned` and the
  // representative list are not disjoint by construction.
  const kept = new Set(order.map((o) => o.mat));
  for (const m of orphaned) if (!kept.has(m)) m.dispose();
  return root;
}
