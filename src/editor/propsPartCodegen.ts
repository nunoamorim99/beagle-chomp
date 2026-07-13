// OWNER: props part editor (IDEA-033, dev-only).
// The prop-part analogue of src/editor/codegen.ts's primitive-geometry
// table: the live constructor (for the preview) sits beside its starting
// params, kept as its OWN small module (not folded into codegen.ts, which is
// characters.ts-flavored — its GEOMETRY_CTORS table also emits three.js
// SOURCE STRINGS for the character snippet/full-file export, a concern props
// don't have: props.ts's PropPartLayer is DATA, not paste-ready code, so
// there is no string-constructor table to keep in sync here, only the live
// THREE.BufferGeometry builder + a defaults table). Mirrors
// src/render/board.ts's own buildPropPrimitiveGeometry (which applies a
// SAVED def.parts.added at real render time) closely enough that a future
// pass COULD unify them into one shared module — kept separate for now since
// board.ts must never import from src/editor/ (the dev-only boundary), so
// the two small switch statements living in their own files, one per side of
// that boundary, is the correct shape rather than an accident of copy-paste.
import * as THREE from "three";
import { type PropPrimKind } from "../game/props";

/** Starting geometry params per primitive kind — prop-scale (apron/wall-top
 *  sized, roughly 0.1-0.4 units), distinct from characters.ts editor's
 *  character-scale GEOMETRY_DEFAULTS (codegen.ts) which are tuned for a
 *  ~1-unit-tall beagle. */
export const PROP_PART_GEOMETRY_DEFAULTS: Record<PropPrimKind, Record<string, number>> = {
  box: { width: 0.2, height: 0.2, depth: 0.2 },
  sphere: { radius: 0.12 },
  cylinder: { radiusTop: 0.08, radiusBottom: 0.08, height: 0.2 },
  cone: { radius: 0.12, height: 0.24 },
};

/** The live counterpart of board.ts's buildPropPrimitiveGeometry — must
 *  construct exactly what that function would build from the same
 *  kind+params, so the editor's live preview never drifts from what the
 *  real board eventually renders once the def is saved. */
export function buildPropPartPrimitiveGeometry(kind: PropPrimKind, p: Record<string, number>): THREE.BufferGeometry {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(p.width, p.height, p.depth);
    case "sphere":
      return new THREE.SphereGeometry(p.radius, 16, 12);
    case "cylinder":
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 16);
    case "cone":
      return new THREE.ConeGeometry(p.radius, p.height, 16);
  }
}
