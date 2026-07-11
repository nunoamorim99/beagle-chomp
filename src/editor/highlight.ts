// OWNER: character editor (IDEA-025, dev-only).
// Selection highlight that NEVER touches the character's own materials — the
// coat materials (beagle) and bodyMat (enemies) are shared across many
// meshes, so mutating emissive/color on them would light up half the model.
// Instead: a wireframe overlay Mesh sharing the selected mesh's geometry
// (identity local transform = perfectly co-located, zero geometry cost), or a
// BoxHelper for geometry-less pivot Groups (ears, tail, legs, the root).
import * as THREE from "three";
import { type PartNode } from "./partTree";

const HIGHLIGHT_COLOR = 0xff37a6;

export class Highlighter {
  private overlay: THREE.Mesh | null = null;
  private helper: THREE.BoxHelper | null = null;

  constructor(private scene: THREE.Scene) {}

  set(node: PartNode | null): void {
    this.clear();
    if (!node) return;

    if (node.object instanceof THREE.Mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color: HIGHLIGHT_COLOR,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
      });
      // Shares the selected mesh's geometry — do NOT dispose it on clear.
      const overlay = new THREE.Mesh(node.object.geometry, mat);
      overlay.renderOrder = 999;
      overlay.userData.editorOverlay = true;
      node.object.add(overlay);
      this.overlay = overlay;
    } else {
      const helper = new THREE.BoxHelper(node.object, HIGHLIGHT_COLOR);
      helper.userData.editorOverlay = true;
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      helper.renderOrder = 999;
      this.scene.add(helper);
      this.helper = helper;
    }
  }

  /** Call once per frame — the BoxHelper is world-space, so the turntable
   *  (and any live edits) move the box out from under it otherwise. */
  update(): void {
    this.helper?.update();
  }

  clear(): void {
    if (this.overlay) {
      this.overlay.removeFromParent();
      (this.overlay.material as THREE.Material).dispose(); // ours; geometry is shared — leave it
      this.overlay = null;
    }
    if (this.helper) {
      this.scene.remove(this.helper);
      this.helper.dispose();
      this.helper = null;
    }
  }
}
