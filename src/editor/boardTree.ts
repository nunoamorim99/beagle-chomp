// OWNER: board & themes editor (IDEA-027, dev-only).
// The left tree pane in board mode: a flat list of the logical palette
// SLOTS (Atmosphere / Walls / Floor / Biscuits / Blooms / Specks) instead of
// character.ts's per-mesh part tree — the board is generated per-tile from
// instanced meshes (render/board.ts), so there is no per-mesh picking story
// for v1 (per the brief: "no per-mesh picking needed"). Selecting a row
// opens/focuses the matching lil-gui folder in boardInspector.ts. Reuses
// partTree.ts's `.tree-row`/`.tree-icon`/`.tree-name`/`.selected` CSS classes
// so board mode's tree reads as the same visual language, with no new CSS.
export type BoardSlotId = "atmosphere" | "walls" | "floor" | "biscuits" | "blooms" | "specks";

export interface BoardSlotRow {
  id: BoardSlotId;
  label: string;
}

export const BOARD_SLOTS: readonly BoardSlotRow[] = [
  { id: "atmosphere", label: "Atmosphere" },
  { id: "walls", label: "Walls" },
  { id: "floor", label: "Floor" },
  { id: "biscuits", label: "Biscuits" },
  { id: "blooms", label: "Blooms" },
  { id: "specks", label: "Specks" },
];

export interface BoardTreeView {
  render(): void;
  setSelected(id: BoardSlotId | null): void;
  destroy(): void;
}

/** Renders the flat slot list into `container` — same one #partTree element
 *  the character tree uses; main.ts swaps which view currently owns it by
 *  calling destroy() on the outgoing view before building the incoming one. */
export function createBoardTreeView(
  container: HTMLElement,
  onSelect: (id: BoardSlotId) => void,
): BoardTreeView {
  const rows = new Map<BoardSlotId, HTMLElement>();
  let selectedId: BoardSlotId | null = null;

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
    setSelected(id: BoardSlotId | null): void {
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
