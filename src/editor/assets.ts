// OWNER: character editor (IDEA-025, dev-only).
// glTF in and out of the workbench: export the character you are editing as
// a .glb, and load a .glb/.gltf as a REFERENCE model to build against.
//
// Adapted from the three.js editor's Menubar.File.js / Loader.js (MIT —
// mrdoob/three.js), reduced hard on purpose. Three of the reference
// pipeline's parts are deliberately absent:
//
//   * No DRACO / KTX2 / meshopt decoders. Those exist to open COMPRESSED
//     assets; this project ships no assets at all, so vendoring three
//     decoder blobs would be pure cost. If a compressed reference model ever
//     needs opening, decompress it outside the editor.
//   * No OBJ/STL/FBX/… importers. One interchange format is enough for a
//     reference overlay.
//   * No "open a scene" / "save a scene". Our persistence is codegen into
//     real TypeScript (editLog.ts → sourceRewrite.ts); a scene file would be
//     a second, competing source of truth.
//
// THE HARD BOUNDARY, and the reason import is "reference" and not "import":
// a loaded mesh CANNOT be saved. The editor writes characters back out as
// three.js constructor calls (`new THREE.SphereGeometry(...)`) into
// characters.ts — there is no such expression for an arbitrary triangle soup
// off a glTF. So a reference model is scaffolding you model against and then
// throw away: it is tagged `editorOverlay`, which keeps it out of the part
// tree (partTree.ts skips those), out of picking (picking.ts skips those),
// out of the scene readout, and out of every codegen path. Nothing about it
// can leak into src/render/characters.ts.
//
// None of this reaches players: the editor is not a rollup input, and both
// three addons below are dynamically imported so they are only ever fetched
// when someone actually clicks the button.
import * as THREE from "three";

/** What a loaded reference model exposes to the editor. */
export interface ReferenceModel {
  root: THREE.Group;
  name: string;
  /** Longest bounding-box side, for the "match my scale" readout. */
  size: number;
  dispose(): void;
}

/** Downloads a Blob under `filename`. One reused anchor, and the previous
 *  object URL is revoked before a new one replaces it — the reference
 *  editor's own download primitive, which is the bit worth copying. */
let downloadAnchor: HTMLAnchorElement | null = null;
let lastObjectUrl: string | null = null;

function download(blob: Blob, filename: string): void {
  if (!downloadAnchor) {
    downloadAnchor = document.createElement("a");
    downloadAnchor.style.display = "none";
    document.body.appendChild(downloadAnchor);
  }
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(blob);
  downloadAnchor.href = lastObjectUrl;
  downloadAnchor.download = filename;
  downloadAnchor.dispatchEvent(new MouseEvent("click"));
}

/**
 * Exports `root` as a binary .glb and hands it to the browser.
 *
 * `onlyVisible: false` on purpose: a part hidden with the inspector's
 * visible checkbox is still part of the model being authored, and silently
 * dropping it would make the export disagree with the code the editor
 * generates for the same character.
 *
 * The character is exported in ISOLATION — cloned out of the stage so the
 * turntable's wrapper rotation, the ground disc and the backdrop cannot ride
 * along. Editor overlays (the selection wireframe, a reference model) are
 * stripped from the clone for the same reason.
 */
export async function exportGLB(root: THREE.Object3D, filename: string): Promise<void> {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const clone = root.clone(true);
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.updateMatrixWorld(true);
  const doomed: THREE.Object3D[] = [];
  clone.traverse((o) => {
    if (o.userData.editorOverlay) doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(clone, { binary: true, onlyVisible: false });
  const blob =
    result instanceof ArrayBuffer
      ? new Blob([result], { type: "model/gltf-binary" })
      : new Blob([JSON.stringify(result)], { type: "model/gltf+json" });
  download(blob, filename);
}

/** True for a file this loader will even attempt. */
export function isGltfFile(file: File): boolean {
  return /\.(glb|gltf)$/i.test(file.name);
}

/**
 * Parses a .glb/.gltf File into a reference overlay.
 *
 * Everything under the returned root is tagged `editorOverlay` — see this
 * module's header for why that tag is the whole safety story — and rendered
 * translucent so the real character stays readable in front of it.
 */
export async function loadReference(file: File): Promise<ReferenceModel> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  const buffer = await file.arrayBuffer();
  const gltf = await loader.parseAsync(buffer, "");

  const root = new THREE.Group();
  root.name = `reference:${file.name}`;
  root.userData.editorOverlay = true;
  root.add(gltf.scene);

  const owned: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  root.traverse((o) => {
    o.userData.editorOverlay = true;
    if (!(o instanceof THREE.Mesh)) return;
    owned.push(o.geometry as THREE.BufferGeometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      owned.push(m as THREE.Material);
      // Ghost it back so it reads as scaffolding, not as content. Depth
      // write off keeps it from punching holes in the character in front.
      const mat = m as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 0.35;
      mat.depthWrite = false;
      const map = mat.map;
      if (map) owned.push(map);
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  const span = new THREE.Vector3();
  if (!box.isEmpty()) box.getSize(span);

  return {
    root,
    name: file.name,
    size: Math.max(span.x, span.y, span.z),
    dispose(): void {
      root.removeFromParent();
      for (const r of owned) r.dispose();
    },
  };
}
