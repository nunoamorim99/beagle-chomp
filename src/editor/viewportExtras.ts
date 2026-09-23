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
import { applyMadboxStyle, makeMadboxCaches, boardBounce, type MadboxCaches } from "../render/madboxStyle";
import { getMazeTheme } from "../game/themes";

/** The bounce a character actually gets on a board — the garden's, since that
 *  is the default theme and a preview should not invent a light of its own. */
const EDITOR_BOUNCE = boardBounce(getMazeTheme("garden").palette);

let styleCaches: MadboxCaches | null = null;

/**
 * `styled` previews [[IDEA-079]]'s material system — what the model will
 * actually look like in a run with the new art style on.
 *
 * A SHADING MODE rather than a material option, and that distinction is the
 * whole safety of it: this file's existing contract is that shading is "a way
 * of LOOKING, never a saved property". The characters' SOURCE stays `toon()`
 * — the style is applied at runtime by `madboxStyle.ts`, never authored — so
 * an editor that let you save a matcap into `characters.ts` would be writing
 * a material the game does not build and codegen cannot honestly emit.
 *
 * It rides the same stash/restore path as `normals` for exactly that reason,
 * which also means `withRealMaterials` already protects every reader: codegen,
 * the material registry and the inspector all see the real toon materials
 * whatever the viewport is drawing.
 */
export const SHADING_MODES = ["solid", "wireframe", "normals", "styled"] as const;
export type ShadingMode = (typeof SHADING_MODES)[number];

/** Where a mesh's real material is parked while an override is in force.
 *  Stored on the mesh rather than in a Map so a character rebuild (which
 *  throws every mesh away) cannot leave us holding dead references. */
const STASH = "__editorShadingStash";
/** Where a root's StyleOpts live — see that interface for why on the root. */
const STYLE_OPTS = "__editorStyleOpts";

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

/**
 * How a given root wants to be styled.
 *
 * THE EDITOR HAS THREE STAGES AND THEY DO NOT WANT THE SAME TREATMENT, for
 * exactly the reasons the shipped game does not give them the same treatment:
 * a CHARACTER is tinted (its colour is driven at runtime and must stay on the
 * material), a BOARD is baked (its scenery is snapped to the palette, which is
 * the half of the style that makes a place look like one place). Passing the
 * wrong one is not a cosmetic slip — baking a character would hold its coat at
 * white and `applyBeagleSkin` would silently stop working.
 *
 * Stored ON THE ROOT rather than kept in a variable here, so that every later
 * restore/re-apply of that root — including the one inside
 * `withRealMaterials`' `finally` — uses the same options the caller chose.
 * A module-level "last options" field would be read by whichever root happened
 * to be styled most recently, which is the kind of cross-talk this file's
 * stash-on-the-mesh rule already exists to avoid.
 */
export interface StyleOpts {
  /** Tint keeps the colour on the material; bake moves it into the matcap. */
  tint?: boolean;
  /** The environment colour the matcap's fill comes from. */
  bounce?: number;
  /** False leaves the root alone. A NIGHT THEME IS THE REAL CASE: the shipped
   *  board skips it (`shouldStyleBoard`), so drawing it styled here would make
   *  the editor the thing that lies. */
  enabled?: boolean;
}

export interface ViewportExtras {
  setShading(mode: ShadingMode): void;
  getShading(): ShadingMode;
  /** Re-applies the current override to a freshly built root. Call after
   *  every rebuild — the old meshes are gone and the new ones have never seen
   *  the override. */
  reapply(root: THREE.Object3D | null, opts?: StyleOpts): void;
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
  // STYLED BY DEFAULT, because an editor that draws a different art direction
// from the one that ships is a tool you have to correct for in your head on
// every edit. `solid` is still one item away for the two channels a matcap
// does not carry (emissive, roughness).
let shading: ShadingMode = "styled";
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
    if (shading === "styled" && root) {
      const o = (root.userData[STYLE_OPTS] as StyleOpts | undefined) ?? {};
      // A root the shipped game does not style must not be styled here either
      // — see StyleOpts.enabled. Restoring above already put it back.
      if (o.enabled === false) return;
      // Stashed BEFORE the swap, because applyMadboxStyle writes
      // `mesh.material` straight away and the original would be gone.
      eachMesh(root, (mesh) => {
        mesh.userData[STASH] = mesh.material;
      });
      // DEFAULTS ARE THE CHARACTER'S, because this file was written for the
      // character stage and that is still its commonest caller: tint mode, so
      // the colour stays on the material and what the editor shows is what
      // `game.ts` produces rather than a lookalike. Baking a coat would snap
      // it through the palette, which is precisely what the shipped path does
      // not do to anything whose colour carries meaning.
      styleCaches ??= makeMadboxCaches();
      applyMadboxStyle(root, o.bounce ?? EDITOR_BOUNCE, styleCaches, undefined, {
        tint: o.tint ?? true,
      });
      return;
    }
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
    reapply(root: THREE.Object3D | null, opts?: StyleOpts): void {
      if (root && opts) root.userData[STYLE_OPTS] = opts;
      apply(root);
    },
    withRealMaterials<T>(root: THREE.Object3D | null, fn: () => T): T {
      // `styled` swaps materials just as `normals` does, so every reader —
      // codegen, the material registry, the inspector — has to see the real
      // ones. Missing this is how the registry ends up rebuilt around a shared
      // preview material, which is the trap this function was written for.
      if (shading !== "normals" && shading !== "styled") return fn();
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
