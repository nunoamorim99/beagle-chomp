// OWNER: props library editor (IDEA-029, dev-only).
// The left list pane in Props mode: one row per working-library PropDef
// (id est name), clicking selects it — same #partTree DOM node and
// `.tree-row`/`.tree-icon`/`.tree-name`/`.selected` CSS classes board mode's
// slot tree (boardTree.ts) reuses, so Props mode's list reads as the same
// visual language as every other mode with no new CSS. One structural
// difference from boardTree.ts's fixed 7-row list: this list's ROW COUNT
// changes (add/duplicate/remove), so `render(defs)` takes the current
// working array every call (mirrors partTree.ts's own `render(nodes)`
// shape, which already re-renders a variable-length list on every
// structural scene change) rather than boardTree's parameterless render().
import type { WorkingPropDef } from "./propsWorking";

export interface PropsTreeView {
  /** Re-renders the whole list from `defs` (current working-library order) —
   *  called on Props-mode entry and after every add/duplicate/remove.
   *  `usedByCount(id)` returns how many theme placements/wallDecor reference
   *  that id, shown as a small badge so a def a theme depends on is visibly
   *  flagged right in the list, not just deep in the inspector. */
  render(defs: readonly WorkingPropDef[], usedByCount: (id: string) => number): void;
  setSelected(id: string | null): void;
  destroy(): void;
}

/** Renders the prop list into `container` — the SAME #partTree element the
 *  character tree and board slot tree use; main.ts's mode switch calls
 *  destroy() on whichever view currently owns it before building the
 *  incoming one (same "one view owns the shared DOM node at a time" contract
 *  boardTree.ts already documents). */
export function createPropsTreeView(
  container: HTMLElement,
  onSelect: (id: string) => void,
): PropsTreeView {
  const rows = new Map<string, HTMLElement>();
  let selectedId: string | null = null;

  return {
    render(defs: readonly WorkingPropDef[], usedByCount: (id: string) => number): void {
      container.textContent = "";
      rows.clear();
      for (const def of defs) {
        const row = document.createElement("div");
        row.className = "tree-row";
        row.style.paddingLeft = "10px";

        const icon = document.createElement("span");
        icon.className = "tree-icon";
        icon.textContent = "◆";
        const name = document.createElement("span");
        name.className = "tree-name";
        name.textContent = def.name;

        row.append(icon, name);

        const count = usedByCount(def.id);
        if (count > 0) {
          const badge = document.createElement("span");
          badge.className = "tree-used-badge";
          badge.textContent = `${count}`;
          badge.title = `used by ${count} placement${count === 1 ? "" : "s"}`;
          row.append(badge);
        }

        row.addEventListener("click", () => onSelect(def.id));
        container.appendChild(row);
        rows.set(def.id, row);
      }
      if (selectedId !== null) rows.get(selectedId)?.classList.add("selected");
    },
    setSelected(id: string | null): void {
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
