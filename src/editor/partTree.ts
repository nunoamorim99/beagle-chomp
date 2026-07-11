// OWNER: character editor (IDEA-025, dev-only).
// Turns a built character THREE.Group into a flat, ordered list of selectable
// PartNodes, and renders it as the clickable tree in the left pane. The
// `path` (slash-joined child indices) is the stable identity the edit log
// keys on; `varName` is what generated code snippets reference, so it should
// match the local variable name in characters.ts whenever the mesh was named
// there (`object.name`), with a readable auto-name as the fallback.
import * as THREE from "three";

export interface PartNode {
  /** Slash-joined child indices from the character root ("" = the root). */
  path: string;
  /** Name used in generated code — object.name when the source named it,
   *  otherwise an auto-name like "sphere3". The character ROOT is "g" (the
   *  builders' own local name for the returned group). */
  varName: string;
  /** What the tree shows — same as varName except the root, which reads
   *  "Beagle (g)" so the codegen name stays visible but labeled. */
  displayName: string;
  object: THREE.Object3D;
  isMesh: boolean;
  depth: number;
  /** True when varName was auto-generated (no .name in the source) — codegen
   *  attaches a locator comment for these. */
  isAutoNamed: boolean;
  /** True for parts added in the editor (deletable; codegen emits their
   *  whole construction block). */
  isAdded: boolean;
}

function geometryLabel(object: THREE.Object3D): string {
  if (object instanceof THREE.Mesh) {
    // "SphereGeometry" -> "sphere", "LatheGeometry" -> "lathe", …
    const t = (object.geometry as THREE.BufferGeometry).type;
    return t.replace(/Geometry$/, "").toLowerCase() || "mesh";
  }
  return "group";
}

/**
 * Flattens a character group into tree order (DFS). Skips editor-internal
 * overlay objects (`userData.editorOverlay`). The root itself is the first
 * node — its codegen name is "g" (every builder's local name for the group it
 * returns), displayed as "<label> (g)"; it's selectable for whole-model tweaks.
 */
export function buildPartList(root: THREE.Object3D, rootLabel: string): PartNode[] {
  const nodes: PartNode[] = [];
  const autoCounters = new Map<string, number>();

  function autoName(object: THREE.Object3D): string {
    const label = geometryLabel(object);
    const n = autoCounters.get(label) ?? 0;
    autoCounters.set(label, n + 1);
    return `${label}${n}`;
  }

  function visit(object: THREE.Object3D, path: string, depth: number): void {
    if (object.userData.editorOverlay) return;
    const named = object.name.length > 0;
    const isRoot = depth === 0;
    const varName = isRoot ? "g" : named ? object.name : autoName(object);
    nodes.push({
      path,
      varName,
      displayName: isRoot ? `${rootLabel} (g)` : varName,
      object,
      isMesh: object instanceof THREE.Mesh,
      depth,
      isAutoNamed: !named && !isRoot,
      isAdded: object.userData.editorAdded === true,
    });
    object.children.forEach((child, i) => {
      visit(child, path === "" ? String(i) : `${path}/${i}`, depth + 1);
    });
  }

  visit(root, "", 0);
  return nodes;
}

export interface PartTreeView {
  render(nodes: PartNode[]): void;
  setSelected(path: string | null): void;
}

/** Renders the clickable part tree into `container`. */
export function createPartTreeView(
  container: HTMLElement,
  onSelect: (node: PartNode) => void,
): PartTreeView {
  let rows = new Map<string, HTMLElement>();
  let selectedPath: string | null = null;

  return {
    render(nodes: PartNode[]): void {
      container.textContent = "";
      rows = new Map();
      for (const node of nodes) {
        const row = document.createElement("div");
        row.className = "tree-row";
        if (node.isMesh) row.classList.add("is-mesh");
        if (node.isAdded) row.classList.add("is-added");
        if (node.isAutoNamed) row.classList.add("is-auto");
        row.style.paddingLeft = `${10 + node.depth * 14}px`;

        const icon = document.createElement("span");
        icon.className = "tree-icon";
        icon.textContent = node.isMesh ? "▪" : "▸";
        const name = document.createElement("span");
        name.className = "tree-name";
        name.textContent = node.displayName;

        row.append(icon, name);
        row.addEventListener("click", () => onSelect(node));
        container.appendChild(row);
        rows.set(node.path, row);
      }
      // Re-apply selection styling if the selected part survived a re-render.
      if (selectedPath !== null) rows.get(selectedPath)?.classList.add("selected");
    },
    setSelected(path: string | null): void {
      if (selectedPath !== null) rows.get(selectedPath)?.classList.remove("selected");
      selectedPath = path;
      if (path !== null) {
        const row = rows.get(path);
        row?.classList.add("selected");
        row?.scrollIntoView({ block: "nearest" });
      }
    },
  };
}
