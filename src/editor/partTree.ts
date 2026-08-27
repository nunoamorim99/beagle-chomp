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
  /** Every selected path. Pass [] to clear; the FIRST is the primary and is
   *  the one scrolled into view. */
  setSelected(paths: string[]): void;
}

/** Modifier state a row click carried, so the caller can tell "replace the
 *  selection" from "add to it". */
export interface SelectIntent {
  /** Ctrl/Cmd or Shift was held — toggle rather than replace. */
  toggle: boolean;
}

/** Optional behaviours the CHARACTER tree opts into. The props-mode instance
 *  passes none of these, so it keeps exactly the tree it always had. */
export interface PartTreeOptions {
  /** Double-click a row. */
  onFocus?(node: PartNode): void;
  /** Drag an editor-ADDED part onto a group row. Only added parts are
   *  draggable — see the note on the drop handler below for why. */
  onReparent?(node: PartNode, newParent: PartNode): void;
}

/** True when `candidate` is `ancestor` or sits underneath it. Paths are
 *  slash-joined child indices, so this is a prefix test — but it has to be a
 *  SEGMENT-aware one: "1/0" is not a child of "1/0extra", and a plain
 *  startsWith would say it was. */
function isSelfOrDescendant(candidatePath: string, ancestorPath: string): boolean {
  if (ancestorPath === "") return true; // everything descends from the root
  return candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}/`);
}

/** Renders the clickable part tree into `container`. */
export function createPartTreeView(
  container: HTMLElement,
  onSelect: (node: PartNode, intent: SelectIntent) => void,
  options: PartTreeOptions = {},
): PartTreeView {
  let rows = new Map<string, HTMLElement>();
  let selectedPaths: string[] = [];
  let lastNodes: PartNode[] = [];
  // Collapsed groups, by path. Survives re-renders (a nudge re-renders the
  // tree) — otherwise every edit would spring the whole tree back open.
  //
  // Default is EXPANDED, deliberately unlike the three.js editor's
  // collapsed-by-default outliner: this tree is ~30 rows for a whole
  // character, and collapsing it by default would hide the parts the tool
  // exists to edit behind a click each.
  const collapsed = new Set<string>();

  // The tree takes focus so its arrow-key navigation can be scoped to "the
  // tree is focused". It CANNOT be global: main.ts binds the arrow keys to
  // nudging the selected part's transform, which is the editor's primary
  // gesture. The parity spec's global ArrowUp/Down outliner navigation would
  // have taken that away.
  container.tabIndex = 0;

  function visibleNodes(): PartNode[] {
    return lastNodes.filter((n) => {
      for (const path of collapsed) {
        if (path !== n.path && isSelfOrDescendant(n.path, path)) return false;
      }
      return true;
    });
  }

  function hasChildren(node: PartNode): boolean {
    return lastNodes.some((n) => n !== node && isSelfOrDescendant(n.path, node.path));
  }

  /** Re-opens every collapsed ancestor of `path`, so selecting a part from
   *  the viewport can never leave its row hidden. */
  function revealAncestors(path: string): boolean {
    let changed = false;
    for (const p of [...collapsed]) {
      if (p !== path && isSelfOrDescendant(path, p)) {
        collapsed.delete(p);
        changed = true;
      }
    }
    return changed;
  }

  function draw(): void {
    container.textContent = "";
    rows = new Map();
    for (const node of visibleNodes()) {
      const row = document.createElement("div");
      row.className = "tree-row";
      if (node.isMesh) row.classList.add("is-mesh");
      if (node.isAdded) row.classList.add("is-added");
      if (node.isAutoNamed) row.classList.add("is-auto");
      row.style.paddingLeft = `${10 + node.depth * 14}px`;

      const icon = document.createElement("span");
      icon.className = "tree-icon";
      const parent = hasChildren(node);
      if (parent) {
        icon.classList.add("tree-opener");
        icon.textContent = collapsed.has(node.path) ? "▸" : "▾";
        icon.addEventListener("click", (e) => {
          // Not a selection: clicking the twisty should only fold the row.
          e.stopPropagation();
          if (collapsed.has(node.path)) collapsed.delete(node.path);
          else collapsed.add(node.path);
          draw();
        });
      } else {
        icon.textContent = node.isMesh ? "▪" : "▸";
      }

      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.displayName;
      row.append(icon, name);

      // Geometry badge — the reference editor's outliner shows the geometry
      // and material names on mesh rows, and it is the fastest way to see
      // that "blaze" is a sphere without selecting it.
      if (node.object instanceof THREE.Mesh) {
        const badge = document.createElement("span");
        badge.className = "tree-type-badge";
        badge.textContent = geometryLabel(node.object);
        row.appendChild(badge);
      }

      row.addEventListener("click", (e) => {
        onSelect(node, { toggle: e.ctrlKey || e.metaKey || e.shiftKey });
      });
      if (options.onFocus) {
        row.addEventListener("dblclick", () => options.onFocus?.(node));
      }

      if (options.onReparent) {
        // Only editor-ADDED parts drag. An original part's parent is written
        // into characters.ts by the builder itself, and codegen has no line
        // it could emit to re-attach it elsewhere — so dragging one would
        // move it in the viewport and then silently lose the move on save.
        // Added parts codegen as `<parentVar>.add(<name>)`, which is exactly
        // a reparent, so those are safe.
        if (node.isAdded) {
          row.draggable = true;
          row.addEventListener("dragstart", (e) => {
            e.dataTransfer?.setData("text/plain", node.path);
            row.classList.add("dragging");
          });
          row.addEventListener("dragend", () => row.classList.remove("dragging"));
        }
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          row.classList.add("drop-target");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          row.classList.remove("drop-target");
          const draggedPath = e.dataTransfer?.getData("text/plain");
          if (draggedPath === undefined || draggedPath === "") return;
          const dragged = lastNodes.find((n) => n.path === draggedPath);
          if (!dragged || dragged === node) return;
          // Cycle guard: dropping a part into its own subtree would detach
          // the whole branch from the scene graph.
          if (isSelfOrDescendant(node.path, dragged.path)) return;
          options.onReparent?.(dragged, node);
        });
        // The reference editor models three drop zones (before / into /
        // after) because its outliner can reorder siblings. Ours cannot:
        // added parts codegen as `parent.add(x)`, which always APPENDS, so a
        // sibling order has nothing to persist into. One zone — "into" — is
        // the whole of what we can honestly offer.
      }

      container.appendChild(row);
      rows.set(node.path, row);
    }
    selectedPaths.forEach((path, i) => {
      const row = rows.get(path);
      row?.classList.add("selected");
      // Only the primary gets the strong treatment — see Highlighter's own
      // primary/secondary split, which this mirrors in the tree.
      if (i > 0) row?.classList.add("secondary");
    });
  }

  container.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const list = visibleNodes();
    if (list.length === 0) return;
    e.preventDefault(); // kill the native scroll
    const i = list.findIndex((n) => n.path === selectedPaths[0]);
    const next = e.key === "ArrowDown" ? Math.min(i + 1, list.length - 1) : Math.max(i - 1, 0);
    onSelect(list[i === -1 ? 0 : next], { toggle: false });
  });

  return {
    render(nodes: PartNode[]): void {
      lastNodes = nodes;
      // Drop collapse state for paths that no longer exist, so a deleted
      // group cannot keep a stale path folded forever.
      for (const path of [...collapsed]) {
        if (!nodes.some((n) => n.path === path)) collapsed.delete(path);
      }
      draw();
    },
    setSelected(paths: string[]): void {
      for (const path of selectedPaths) {
        rows.get(path)?.classList.remove("selected", "secondary");
      }
      selectedPaths = paths;
      if (paths.length === 0) return;
      // Selecting from the viewport must not leave a row folded away.
      let redrew = false;
      for (const path of paths) redrew = revealAncestors(path) || redrew;
      if (redrew) draw();
      paths.forEach((path, i) => {
        const row = rows.get(path);
        row?.classList.add("selected");
        if (i > 0) row?.classList.add("secondary");
      });
      rows.get(paths[0])?.scrollIntoView({ block: "nearest" });
    },
  };
}
