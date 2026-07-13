// OWNER: board & themes editor (IDEA-027/030/031, dev-only).
// The left tree pane in board mode: a flat list of the logical palette
// SLOTS (Atmosphere / Walls / Floor / Biscuits / Blooms / Specks) PLUS two
// PLACEMENT rows ("Props (apron)" / "Wall components") — instead of
// character.ts's per-mesh part tree, since the board is generated per-tile
// from instanced meshes (render/board.ts), so there is no per-mesh picking
// story for the palette slots (per the original IDEA-027 brief: "no per-mesh
// picking needed").
//
// v4.1 "Set Dressing" (IDEA-030/031) addition: the two placement rows behave
// DIFFERENTLY from every palette-slot row above them — clicking "Atmosphere"
// just opens/scrolls to a lil-gui folder that already exists; clicking
// "Props (apron)" or "Wall components" instead SWITCHES boardPlacement.ts's
// active sub-mode (which candidate tiles show slot markers and are
// clickable in the 3D view — see main.ts's onTreeSelect), since there is no
// single static folder to open here — the actual editing controls live in
// the "Placement" folder that appears once you click a 3D slot, per
// selection (see boardInspector.ts). Both rows ARE still selectable/
// highlightable exactly like every other row (so the tree visually shows
// which sub-mode is active), just with a different click EFFECT.
export type BoardSlotId = "atmosphere" | "walls" | "floor" | "biscuits" | "blooms" | "specks";
/** The two placement sub-mode rows — kept as their own id type (not folded
 *  into BoardSlotId) since they don't correspond to a lil-gui folder at all
 *  (see this module's header) — boardInspector.ts's `folders` map is keyed
 *  by BoardSlotId alone, so a placement row id would be meaningless there. */
export type PlacementRowId = "placementApron" | "placementWall";
export type BoardTreeRowId = BoardSlotId | PlacementRowId;

export interface BoardSlotRow {
  id: BoardTreeRowId;
  label: string;
}

export const BOARD_SLOTS: readonly BoardSlotRow[] = [
  { id: "atmosphere", label: "Atmosphere" },
  { id: "walls", label: "Walls" },
  { id: "floor", label: "Floor" },
  { id: "biscuits", label: "Biscuits" },
  { id: "blooms", label: "Blooms" },
  { id: "specks", label: "Specks" },
  { id: "placementApron", label: "Props (apron)" },
  { id: "placementWall", label: "Wall components" },
];

export function isPlacementRow(id: BoardTreeRowId): id is PlacementRowId {
  return id === "placementApron" || id === "placementWall";
}

export interface BoardTreeView {
  render(): void;
  setSelected(id: BoardTreeRowId | null): void;
  destroy(): void;
}

/** Renders the flat slot list into `container` — same one #partTree element
 *  the character tree uses; main.ts swaps which view currently owns it by
 *  calling destroy() on the outgoing view before building the incoming one. */
export function createBoardTreeView(
  container: HTMLElement,
  onSelect: (id: BoardTreeRowId) => void,
): BoardTreeView {
  const rows = new Map<BoardTreeRowId, HTMLElement>();
  let selectedId: BoardTreeRowId | null = null;

  return {
    render(): void {
      container.textContent = "";
      rows.clear();
      for (const slot of BOARD_SLOTS) {
        const row = document.createElement("div");
        row.className = "tree-row";
        row.style.paddingLeft = "10px";

        const icon = document.createElement("span");
        icon.className = "tree-icon";
        icon.textContent = "◆";
        const name = document.createElement("span");
        name.className = "tree-name";
        name.textContent = slot.label;

        row.append(icon, name);
        row.addEventListener("click", () => onSelect(slot.id));
        container.appendChild(row);
        rows.set(slot.id, row);
      }
      if (selectedId !== null) rows.get(selectedId)?.classList.add("selected");
    },
    setSelected(id: BoardTreeRowId | null): void {
      if (selectedId !== null) rows.get(selectedId)?.classList.remove("selected");
      selectedId = id;
      if (id !== null) {
        const row = rows.get(id);
        row?.classList.add("selected");
        row?.scrollIntoView({ block: "nearest" });
      }
    },
    destroy(): void {
      container.textContent = "";
      rows.clear();
    },
  };
}
