import * as THREE from "three";

/**
 * Two small geometry tools the kraken needs because of the SHIPPED STYLE.
 *
 * The reference this vignette was studied from colours its tentacles, hull and
 * sail with VERTEX COLOURS. Here that would silently opt them out of IDEA-079:
 * `applyMadboxStyle` skips any `vertexColors` material (the colour is in the
 * attribute, not in `material.color`, so a matcap generated from it would be a
 * matcap of the wrong colour). So every colour region is a MATERIAL GROUP
 * instead, on the shared `toon()` set, and the style snaps each like any other
 * part of the board.
 *
 * And the style's matcaps are single-sided — it does not carry `side` across —
 * so a cloth that must read from both sides gets real back faces rather than
 * `DoubleSide`, which would be lost the moment the swap ran.
 */

/**
 * Reorder an INDEXED geometry's triangles into groups, one per class.
 * `classOf(a, b, c)` gets the triangle's three vertex indices and returns its
 * group (0..groups-1). Groups are written in class order with
 * `materialIndex === class`, and empty classes are left out.
 */
export function regroupTriangles(
  geo: THREE.BufferGeometry,
  groups: number,
  classOf: (a: number, b: number, c: number) => number,
): void {
  const idx = geo.getIndex();
  if (!idx) throw new Error("regroupTriangles needs an indexed geometry");
  const buckets: number[][] = Array.from({ length: groups }, () => []);
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    const k = Math.max(0, Math.min(groups - 1, classOf(a, b, c)));
    buckets[k].push(a, b, c);
  }
  geo.clearGroups();
  const all: number[] = [];
  buckets.forEach((list, k) => {
    if (list.length === 0) return;
    geo.addGroup(all.length, list.length, k);
    for (const v of list) all.push(v);
  });
  geo.setIndex(all);
}

/**
 * Append a reversed-winding copy of every triangle on its OWN vertices, so the
 * surface has a real back face with its own (opposite) normals once
 * `computeVertexNormals` runs. Copies every attribute; the input must be
 * indexed and ungrouped (group afterwards).
 */
export function addBackFaces(geo: THREE.BufferGeometry): void {
  const idx = geo.getIndex();
  if (!idx) throw new Error("addBackFaces needs an indexed geometry");
  const pos = geo.getAttribute("position");
  const n = pos.count;
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.getAttribute(name) as THREE.BufferAttribute;
    const size = src.itemSize;
    const out = new Float32Array(n * 2 * size);
    out.set(src.array as ArrayLike<number>, 0);
    out.set(src.array as ArrayLike<number>, n * size);
    geo.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  const front: number[] = [];
  for (let i = 0; i < idx.count; i++) front.push(idx.getX(i));
  const back: number[] = [];
  for (let t = 0; t < front.length; t += 3) back.push(front[t] + n, front[t + 2] + n, front[t + 1] + n);
  geo.setIndex(front.concat(back));
}
