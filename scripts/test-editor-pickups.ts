// Automated browser checks for the editor's PICKUPS tab — the maze items
// (power bone, bonus-life bone, the five fruits, coin) built in
// src/render/board.ts.
//
//   npx tsx scripts/test-editor-pickups.ts     (npm run test:editor:pickups)
//
// Why this suite exists: the tab reuses Character mode's whole machinery over a
// different registry and a different source file. That sharing is the point —
// it inherits every future improvement — but it also means a change made for
// characters can silently break pickups, in ways that look fine until you try
// to save. The first run of the tab did exactly that twice: the props library
// rendered into the part tree (the mode fell through to the props branch), and
// the arrow-key nudge did nothing because the keyboard handler was gated on
// `mode === "character"`, so Save reported "No edits yet".
//
// The save test WRITES src/render/board.ts and restores it in a finally block.
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/render/board.ts";
const PORT = 5613;

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

function treeRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".tree-row")].map(
      (r) => r.querySelector(".tree-name")?.textContent ?? "?",
    ),
  );
}

/** The pickup dropdown is the select offering "Power bone". */
function pickupSelect(page: Page, label: string): Promise<boolean> {
  return page.evaluate((l) => {
    const sel = [...document.querySelectorAll("select")].find((x) =>
      [...(x as HTMLSelectElement).options].some((o) => o.textContent === "Power bone"),
    ) as HTMLSelectElement | undefined;
    if (!sel) return false;
    const opt = [...sel.options].find((o) => o.textContent === l);
    if (!opt) return false;
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, label);
}

function selectPart(page: Page, name: string): Promise<boolean> {
  return page.evaluate((n) => {
    const row = [...document.querySelectorAll(".tree-row")].find(
      (r) => r.querySelector(".tree-name")?.textContent === n,
    );
    if (!row) return false;
    (row as HTMLElement).click();
    return true;
  }, name);
}

async function run(): Promise<void> {
  const original = readFileSync(FILE, "utf-8");
  const server: ViteDevServer = await createServer({ server: { port: PORT }, logLevel: "error" });
  await server.listen();
  const browser: Browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  try {
    await page.goto(`http://localhost:${PORT}/editor/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".tree-row");
    await page.waitForTimeout(900);

    console.log("\n=== the tab opens onto the pickups ===");
    await page.click("#modePickupsBtn");
    await page.waitForTimeout(900);
    check("no page errors on switching tab", errors.length === 0);

    const options = await page.evaluate(() => {
      const sel = [...document.querySelectorAll("select")].find((x) =>
        [...(x as HTMLSelectElement).options].some((o) => o.textContent === "Power bone"),
      ) as HTMLSelectElement | undefined;
      return sel ? [...sel.options].map((o) => o.textContent ?? "") : [];
    });
    check(
      "the dropdown lists all thirteen pickups",
      [
        "Power bone", "Bonus-life bone",
        "Apple", "Banana", "Carrot", "Strawberry", "Mango", "Coin",
        // IDEA-046
        "x2 Biscuits", "x2 Enemies", "Anchor", "Star", "Shield",
      ].every((l) => options.includes(l)),
    );
    check("…and nothing else", options.length === 13);

    const title = await page.evaluate(() => document.getElementById("codeTitle")?.textContent ?? "");
    check("the code panel points at board.ts, not characters.ts", /src\/render\/board\.ts/.test(title));
    check("…and names the real builder", /makeBone\(\)/.test(title));

    console.log("\n=== each pickup shows its OWN named parts ===");
    // The part tree, the source panel and Save all render into the same DOM as
    // the other tabs. Leaking rows from a sibling tab is the failure this
    // catches — it happened on the first run, with the prop library appearing
    // under the bone.
    const expected: Record<string, string[]> = {
      "Power bone": ["shaft", "knuckleLF", "knuckleRB"],
      "Bonus-life bone": ["shaft", "knuckleLF", "knuckleRB"],
      // IDEA-045: one fruit became five, and each one's parts are named for
      // what it IS — the part tree is how the editor tells them apart, so a
      // shared generic "body"/"leaf" set across all five would make four of
      // them indistinguishable in the outliner.
      // Rebuilt from a reference: the body is a lathe with a stem WELL and a
      // calyx dimple where it was a plain sphere, and it finally has the stem
      // that well exists for. "leaf" is pinned because it is this fruit's tell —
      // the mango carries none and the carrot's tuft is six stalks rather than
      // one mass, both to stay clear of it.
      Apple: ["apple", "stem", "leaf"],
      Banana: ["banana", "tipStem", "tipEnd"],
      // Rebuilt from a reference. The root is a lathe now (domed shoulder, eased
      // taper) and the three-cone tuft became six thinner stalks plus a green
      // collar. Six still beats one: the reason for a tuft rather than a single
      // green mass was that a lump on top reads as the APPLE's leaf, and that
      // has not changed.
      Carrot: ["carrot", "collar", "frond1", "frond6"],
      // Rebuilt from a reference. The body is one LatheGeometry now, so the
      // cone-plus-sphere pair is gone and with it "shoulder" — the silhouette
      // is the lathe's input rather than the seam between two primitives. In
      // its place "seeds": fourteen pips merged into ONE geometry, so the
      // outliner gains a part rather than fourteen.
      Strawberry: ["berry", "seeds", "calyx", "stem"],
      // No leaf: the mango dropped it deliberately (a gold ball with a green
      // leaf read as an orange APPLE at game size), so its absence is part of
      // what keeps the 100 and the 500 apart and is worth pinning. The
      // reference it was later rebuilt from HAS one; it is still not built.
      // "greenBand" is not that leaf and is pinned here so the two do not get
      // confused later: it is a band of colour across the body, inside the
      // fruit's own silhouette, where the apple's tell is a leaf sticking OUT
      // of a round body.
      Mango: ["mango", "blush", "greenBand", "stem"],
      // IDEA-046. The two doublers share a token and now differ ONLY by colour —
      // both are a hexagonal plate with "x2" struck on each face. That makes
      // their part names the only thing separating them in the outliner, so the
      // glyph meshes are named for their doubler rather than generically. A
      // shared "x2Front" would make the two indistinguishable there, which is
      // exactly what this block exists to catch.
      "x2 Biscuits": ["plate", "biscuitX2Front", "biscuitX2Back"],
      "x2 Enemies": ["plate", "enemyX2Front", "enemyX2Back"],
      // Rebuilt from a reference as ONE traced outline — shank, stock, arms,
      // flukes and keel are a single closed profile now, so there is no
      // "shank"/"stock"/"arms" to name separately. "glyph", not "body": the
      // coin already owns "body", and generic names are what this block exists
      // to prevent.
      Anchor: ["glyph", "ring"],
      // One mesh: a five-pointed star is a polygon, so it is a real
      // THREE.Shape rather than a pile of primitives to be named individually.
      Star: ["star"],
      // No "boss": a central dot on a rounded shape rendered as a MAP PIN, so
      // it was replaced by the heraldic cross. Its absence is load-bearing.
      // Rebuilt from a reference as traced profiles, so the dome-plus-cone
      // "top"/"point" pair is gone and the cross is one mesh rather than two
      // crossed bars. Heraldic names, deliberately: "field"/"border" rather
      // than "body"/"rim", which the coin already owns.
      Shield: ["field", "border", "cross"],
      Coin: ["body", "rim", "embossFront", "embossBack"],
    };
    for (const [label, parts] of Object.entries(expected)) {
      check(`switched to "${label}"`, await pickupSelect(page, label));
      await page.waitForTimeout(700);
      const rows = await treeRows(page);
      for (const part of parts) check(`  ${label} has "${part}"`, rows.includes(part));
      check(
        `  ${label} shows no prop-library rows`,
        !rows.some((r) => ["Shrub", "Oak Tree", "Pine", "Palm"].includes(r)),
      );
    }

    console.log("\n=== Save rewrites the REAL line in board.ts ===");
    check("back on the power bone", await pickupSelect(page, "Power bone"));
    await page.waitForTimeout(700);
    check("the shaft is selectable", await selectPart(page, "shaft"));

    // The shaft has no authored position.set, so this exercises sourceRewrite's
    // INSERT path rather than a plain value replacement.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(60);
    }

    // Fire and forget: writing board.ts triggers Vite HMR, which tears the page
    // down. Reading the button's flash afterwards races that reload and throws
    // "execution context destroyed" — the file is the honest signal anyway.
    await page.evaluate(() => {
      (document.getElementById("saveFileBtn") as HTMLButtonElement).click();
    });
    let after = original;
    for (let i = 0; i < 40 && after === original; i++) {
      await new Promise((r) => setTimeout(r, 150));
      after = readFileSync(FILE, "utf-8");
    }

    check("board.ts changed on disk", after !== original);
    check("the shaft gained its own position statement", /shaft\.position\.set\(/.test(after));
    check(
      "no generated edit block was appended (v3 writes real source)",
      !/Character Editor edits/.test(after),
    );
    check(
      "the edit is line-for-line — at most one inserted line",
      after.split("\n").length - original.split("\n").length <= 1,
    );
    check(
      "no OTHER builder was touched — makeCoin is byte-identical",
      after.slice(after.indexOf("export function makeCoin")) ===
        original.slice(original.indexOf("export function makeCoin")),
    );
  } finally {
    writeFileSync(FILE, original, "utf-8");
    await browser.close();
    await server.close();
  }

  if (errors.length) {
    console.log("\nPAGE ERRORS:");
    for (const e of [...new Set(errors)].slice(0, 8)) console.log("  " + e);
    failures += errors.length;
  }
  console.log(
    failures === 0 ? "\nALL PICKUPS EDITOR CHECKS PASSED" : `\n${failures} PICKUPS EDITOR CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void run();
