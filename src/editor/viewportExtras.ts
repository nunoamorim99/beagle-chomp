// OWNER: character editor (IDEA-025, dev-only).
// Two pieces of viewport furniture ported from the three.js editor's
// Viewport.Info.js and Viewport.js shading modes (MIT — mrdoob/three.js):
//
//   * a live scene readout (objects / vertices / triangles / draw calls / ms)
//   * solid / wireframe / normals shading overrides
//
// Both are read-only views of the character: nothing here is persisted, and
// nothing here is visible to codegen. That is deliberate — shading mode is a
// way of LOOKING at the model, not a property of it. (Contrast the per-part
// shading dropdown in inspector.ts, which auditions a real material class
// the part could actually ship with — see toon.ts's SHADING_KINDS.)
import * as THREE from "three";

export const SHADING_MODES = ["solid", "wireframe", "normals"] as const;
export type ShadingMode = (typeof SHADING_MODES)[number];

/** Where a mesh's real material is parked while an override is in force.
 *  Stored on the mesh rather than in a Map so a character rebuild (which
 *  throws every mesh away) cannot leave us holding dead references. */
const STASH = "__editorShadingStash";

/** Counting is deliberately traverseVisible, not traverse: a part you hid
 *  with the visible checkbox should drop out of the totals, or the readout
 *  stops answering the question it exists to answer ("what does this cost?"). */
export interface SceneCounts {
  objects: number;
  vertices: number;
  triangles: number;
}

export function countScene(root: THREE.Object3D | null): SceneCounts {
  const counts: SceneCounts = { objects: 0, vertices: 0, triangles: 0 };
  if (!root) return counts;
  root.traverseVisible((o) => {
    if (o.userData.editorOverlay) return; // highlight/gizmo furniture isn't content
    counts.objects++;
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    const position = geo.getAttribute("position");
    if (!position) return;
    counts.vertices += position.count;
    // Indexed geometry is the common case for three's primitives; the
    // non-indexed fallback is the reference editor's own rule.
    counts.triangles += geo.index ? geo.index.count / 3 : position.count / 3;
  });
  return counts;
}

export interface ViewportExtras {
  setShading(mode: ShadingMode): void;
  getShading(): ShadingMode;
  /** Re-applies the current override to a freshly built character. Call
   *  after every rebuild — the old meshes are gone and the new ones have
   *  never seen the override. */
  reapply(root: THREE.Object3D | null): void;
  /**
   * Runs `fn` with the REAL materials temporarily back on the meshes.
   *
   * "normals" shading swaps `mesh.material` for a shared MeshNormalMaterial,
   * and anything that reads materials off the scene graph — collectMaterials()
   * above all — would otherwise see one fake material shared by every mesh and
   * rebuild the material registry around it. That would leave the inspector
   * editing a material the character does not own, and the edit would vanish
   * the moment shading went back to solid.
   *
   * ("wireframe" needs no such care: it flips a flag ON the real material
   * rather than replacing it, so identity never changes.)
   */
  withRealMaterials<T>(root: THREE.Object3D | null, fn: () => T): T;
  /** Per-frame; throttles its own DOM writes. */
  update(root: THREE.Object3D | null, dt: number): void;
  setInfoVisible(on: boolean): void;
  dispose(): void;
}

export interface ViewportExtrasOptions {
  info: HTMLElement;
  renderer: THREE.WebGLRenderer;
}

/** Four DOM writes a second is enough to read; sixty is just churn. */
const INFO_INTERVAL = 0.25;

export function createViewportExtras(opts: ViewportExtrasOptions): ViewportExtras {
  const normalMaterial = new THREE.MeshNormalMaterial();
  let shading: ShadingMode = "solid";
  let since = INFO_INTERVAL; // draw the first frame immediately
  let infoOn = true;

  function eachMesh(root: THREE.Object3D | null, fn: (m: THREE.Mesh) => void): void {
    if (!root) return;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.editorOverlay) fn(o);
    });
  }

  function restore(root: THREE.Object3D | null): void {
    eachMesh(root, (mesh) => {
      const stashed = mesh.userData[STASH] as THREE.Material | THREE.Material[] | undefined;
      if (stashed !== undefined) {
        mesh.material = stashed;
        delete mesh.userData[STASH];
      }
      // Wireframe is toggled on the REAL material (it is a flag every mesh
      // material has), so clearing it is a separate step from un-stashing.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if ("wireframe" in m) (m as THREE.MeshBasicMaterial).wireframe = false;
    });
  }

  function apply(root: THREE.Object3D | null): void {
    restore(root);
    if (shading === "solid") return;
    eachMesh(root, (mesh) => {
      if (shading === "normals") {
        mesh.userData[STASH] = mesh.material;
        mesh.material = normalMaterial;
      } else {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) if ("wireframe" in m) (m as THREE.MeshBasicMaterial).wireframe = true;
      }
    });
  }

  return {
    setShading(mode: ShadingMode): void {
      shading = mode;
    },
    getShading(): ShadingMode {
      return shading;
    },
    reapply(root: THREE.Object3D | null): void {
      apply(root);
    },
    withRealMaterials<T>(root: THREE.Object3D | null, fn: () => T): T {
      if (shading !== "normals") return fn();
      restore(root);
      try {
        return fn();
      } finally {
        apply(root);
      }
    },
    update(root: THREE.Object3D | null, dt: number): void {
      if (!infoOn) return;
      since += dt;
      if (since < INFO_INTERVAL) return;
      since = 0;
      const c = countScene(root);
      const info = opts.renderer.info;
      opts.info.textContent =
        `${c.objects} objects · ${c.vertices.toLocaleString()} verts · ` +
        `${Math.round(c.triangles).toLocaleString()} tris · ${info.render.calls} calls · ` +
        `${info.programs?.length ?? 0} programs`;
    },
    setInfoVisible(on: boolean): void {
      infoOn = on;
      opts.info.hidden = !on;
    },
    dispose(): void {
      normalMaterial.dispose();
    },
  };
}
