// OWNER: character editor (IDEA-025, dev-only).
// The "Real source" tab: shows the actual text of the selected character's
// builder function straight out of src/render/characters.ts (via Vite's ?raw
// import — the string is the file, so it can never drift from what ships).
// Line numbers match the real file; selecting a part scrolls to and marks the
// line where that part is created. This panel is the learning half of the
// editor: tweak on the left, read the code that produces it here.
import charactersSource from "../render/characters.ts?raw";
import { findFunctionRange } from "./sourceParse";

interface Extracted {
  text: string;
  /** 1-based line number of the first extracted line in the real file. */
  firstLine: number;
}

/** Extracts one builder (plus its preceding jsdoc — the beagle's doc comment
 *  is half the lesson). Fails soft to the whole file so the panel always
 *  shows SOMETHING readable. */
function extractFunction(src: string, name: string): Extracted {
  const range = findFunctionRange(src, name);
  if (!range) return { text: src, firstLine: 1 };
  return {
    text: src.slice(range.start, range.end + 1),
    firstLine: src.slice(0, range.start).split("\n").length,
  };
}

export interface SourceViewPanel {
  showBuilder(builderName: string): void;
  /** Scrolls to + marks the line creating `varName` (null clears the mark). */
  markVar(varName: string | null): void;
}

export function createSourceView(pre: HTMLPreElement): SourceViewPanel {
  const code = pre.querySelector("code") ?? pre;
  let lineEls: HTMLElement[] = [];
  let lines: string[] = [];
  let markedEl: HTMLElement | null = null;

  function render(extracted: Extracted): void {
    code.textContent = "";
    lineEls = [];
    lines = extracted.text.split("\n");
    lines.forEach((line, i) => {
      const el = document.createElement("span");
      el.className = "code-line";
      const ln = document.createElement("span");
      ln.className = "ln";
      ln.textContent = String(extracted.firstLine + i);
      el.appendChild(ln);
      el.appendChild(document.createTextNode(line));
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) {
        el.classList.add("code-comment");
      }
      code.appendChild(el);
      lineEls.push(el);
    });
  }

  return {
    showBuilder(builderName: string): void {
      render(extractFunction(charactersSource, builderName));
      pre.scrollTop = 0;
    },
    markVar(varName: string | null): void {
      markedEl?.classList.remove("marked");
      markedEl = null;
      if (!varName) return;
      // Where is this part born in the source? Try, in order: its const
      // declaration, the string used in a .name assignment, then any bare use.
      const patterns = [
        new RegExp(`\\bconst ${varName}\\b`),
        new RegExp(`"${varName}"`),
        new RegExp(`\\b${varName}\\b`),
      ];
      for (const pattern of patterns) {
        const idx = lines.findIndex((l) => pattern.test(l));
        if (idx !== -1) {
          markedEl = lineEls[idx];
          markedEl.classList.add("marked");
          markedEl.scrollIntoView({ block: "center" });
          return;
        }
      }
    },
  };
}
