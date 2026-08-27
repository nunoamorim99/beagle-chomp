// OWNER: render-artist
// The game's cel-shading: one 3-step ramp, shared by every lit surface.
//
// Why one module: a DataTexture is a GPU upload, and three.js keys shader
// programs partly on the gradient map, so handing every material the SAME
// texture instance keeps the whole scene on one program variant instead of one
// per material. It also means the look is retuned in exactly one place.
import * as THREE from "three";

/**
 * The 3-step toon ramp, built in code — this project ships no texture files.
 *
 * Three bands is the classic cel look: two read as a hard mask, four start to
 * look like a bad gradient. The values are deep shadow / mid / lit.
 *
 * NearestFilter and no mipmaps are what make the steps HARD. Without them the
 * GPU interpolates between the three texels and you get a smooth ramp — i.e.
 * exactly the falloff toon shading was chosen to escape.
 */
let gradient: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = new Uint8Array([70, 160, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradient = tex;
  return tex;
}

/**
 * A toon material on the shared ramp.
 *
 * Accepts the same parameter bag as any material, minus the PBR-only keys:
 * `roughness` and `metalness` do not exist on MeshToonMaterial, so a converted
 * call site must drop them rather than pass them through (TypeScript catches
 * this, which is the point of routing every construction through here).
 */
export function toon(
  params: THREE.MeshToonMaterialParameters | number,
): THREE.MeshToonMaterial {
  const opts = typeof params === "number" ? { color: params } : params;
  return new THREE.MeshToonMaterial({ ...opts, gradientMap: toonGradient() });
}

/** Any material the editor can show controls for — i.e. one with a colour. */
export type EditableMaterial =
  | THREE.MeshToonMaterial
  | THREE.MeshStandardMaterial
  | THREE.MeshPhongMaterial
  | THREE.MeshLambertMaterial
  | THREE.MeshBasicMaterial;

/**
 * True for the material types the editor can drive.
 *
 * It must cover EVERY model the shading dropdown can produce, not just the two
 * the game ships. A narrower gate (toon + standard only) meant that switching a
 * part to phong dropped it out of the material registry — so the material panel
 * vanished and there was no dropdown left to switch back with.
 */
export function isEditableMaterial(m: THREE.Material): m is EditableMaterial {
  return (
    m instanceof THREE.MeshToonMaterial ||
    m instanceof THREE.MeshStandardMaterial ||
    m instanceof THREE.MeshPhongMaterial ||
    m instanceof THREE.MeshLambertMaterial ||
    m instanceof THREE.MeshBasicMaterial
  );
}

/** Materials with an emissive channel — everything editable except Basic. */
export type EmissiveMaterial =
  | THREE.MeshToonMaterial
  | THREE.MeshStandardMaterial
  | THREE.MeshPhongMaterial
  | THREE.MeshLambertMaterial;

/**
 * True when the material has an `emissive` channel.
 *
 * MeshBasicMaterial is unlit and has none, so the prop editor's glow controls
 * have to ask before reaching for it — the same shape as `roughnessOf` for the
 * PBR-only channel.
 */
export function hasEmissive(m: THREE.Material): m is EmissiveMaterial {
  return !(m instanceof THREE.MeshBasicMaterial) && "emissive" in m;
}

/**
 * Reads a material's roughness, or null when it has none.
 *
 * MeshToonMaterial has no roughness — it is not a PBR model — so every editor
 * surface that offers a roughness control has to ask rather than assume. This
 * is the one place that knows the answer.
 */
export function roughnessOf(m: THREE.Material): number | null {
  return m instanceof THREE.MeshStandardMaterial ? m.roughness : null;
}

/**
 * The shading models the character editor lets you audition on a part.
 *
 * The game ships `toon`; the rest are here because seeing the SAME form under
 * a different lighting model is the fastest way to understand what the shading
 * is doing to it — which is the whole reason the editor exists. Switching is a
 * live preview, not a saved property: the shading model is a scene-wide art
 * direction decision (see this module's ramp), not a per-part one.
 */
export const SHADING_KINDS = ["toon", "standard", "phong", "lambert", "basic"] as const;
export type ShadingKind = (typeof SHADING_KINDS)[number];

/** Which model a material is currently using. */
export function shadingKindOf(m: THREE.Material): ShadingKind {
  if (m instanceof THREE.MeshToonMaterial) return "toon";
  if (m instanceof THREE.MeshStandardMaterial) return "standard";
  if (m instanceof THREE.MeshPhongMaterial) return "phong";
  if (m instanceof THREE.MeshLambertMaterial) return "lambert";
  return "basic";
}

/** Builds `kind` carrying over whatever the source material can hand across. */
function buildShaded(kind: ShadingKind, from: THREE.Material): THREE.Material {
  const src = from as THREE.MeshStandardMaterial;
  const color = src.color?.getHex() ?? 0xffffff;
  // Emissive is the one extra channel worth carrying: the board leans on it
  // heavily, and dropping it makes a converted surface go visibly flat.
  const emissive = src.emissive?.getHex() ?? 0x000000;
  const intensity = src.emissiveIntensity ?? 1;
  switch (kind) {
    case "toon":
      return toon({ color, emissive, emissiveIntensity: intensity });
    case "standard":
      return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.6 });
    case "phong":
      return new THREE.MeshPhongMaterial({ color, emissive, shininess: 40 });
    case "lambert":
      return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });
    case "basic":
      return new THREE.MeshBasicMaterial({ color });
  }
}

/**
 * Re-shades every mesh under `root` that uses `from`, and returns the
 * replacement.
 *
 * It swaps by IDENTITY rather than by name, so a material shared across a
 * dozen parts (which is how this project builds characters — one `tan` for the
 * whole coat) changes everywhere at once, exactly as editing its colour does.
 * The old material is disposed only after the last reference is gone.
 */
export function reshade(
  root: THREE.Object3D,
  from: THREE.Material,
  kind: ShadingKind,
): THREE.Material {
  if (shadingKindOf(from) === kind) return from;
  const next = buildShaded(kind, from);
  next.name = from.name;
  let swapped = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => (m === from ? ((swapped++, next)) : m));
    } else if (o.material === from) {
      o.material = next;
      swapped++;
    }
  });
  // Re-point the model's own handles. `userData.coatMats` / `userData.bodyMat`
  // ARE the live references the skin system recolours through
  // (`applyBeagleSkin`) and the editor names materials by — leaving them on a
  // disposed material means the next skin change silently does nothing and the
  // part loses its friendly name.
  const coat = root.userData.coatMats as Record<string, THREE.Material> | undefined;
  if (coat) {
    for (const key of Object.keys(coat)) {
      if (coat[key] === from) coat[key] = next;
    }
  }
  if (root.userData.bodyMat === from) root.userData.bodyMat = next;

  if (swapped > 0) from.dispose();
  return next;
}
