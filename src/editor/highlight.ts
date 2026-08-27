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

/** The PRIMARY part of a multi-selection is drawn in the usual pink; the
 *  rest are dimmer, so "which one is the inspector showing?" stays readable
 *  when four parts are lit at once. */
const SECONDARY_COLOR = 0x8f5f9e;

export class Highlighter {
  private overlays: THREE.Mesh[] = [];
  private helpers: THREE.BoxHelper[] = [];

  constructor(private scene: THREE.Scene) {}

  /** Lights every node in `nodes`; the first is treated as the primary. */
  set(nodes: PartNode[]): void {
    this.clear();
    nodes.forEach((node, i) => this.add(node, i === 0 ? HIGHLIGHT_COLOR : SECONDARY_COLOR));
  }

  private add(node: PartNode, color: number): void {
    if (node.object instanceof THREE.Mesh) {
      const mat = new THREE.MeshBasicMaterial({
        color,
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
      this.overlays.push(overlay);
    } else {
      const helper = new THREE.BoxHelper(node.object, color);
      helper.userData.editorOverlay = true;
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      helper.renderOrder = 999;
      this.scene.add(helper);
      this.helpers.push(helper);
    }
  }

  /** Call once per frame — the BoxHelper is world-space, so the turntable
   *  (and any live edits) move the box out from under it otherwise. */
  update(): void {
    for (const helper of this.helpers) helper.update();
  }

  clear(): void {
    for (const overlay of this.overlays) {
      overlay.removeFromParent();
      (overlay.material as THREE.Material).dispose(); // ours; geometry is shared — leave it
    }
    this.overlays = [];
    for (const helper of this.helpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.helpers = [];
  }
}
