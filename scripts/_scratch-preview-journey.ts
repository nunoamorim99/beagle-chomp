// The journey harness must still boot, and must default to the shipped style.
import { chromium } from "playwright";
const OUT = "C:/Users/nunom/AppData/Local/Temp/claude/c--Users-nunom-Documents-Projetos-beagle-chomp/34037cce-d641-461d-906e-e643d781db4e/scratchpad/";
const b = await chromium.launch();
for (const q of ["", "?style=classic", "?style=one"]) {
  const p = await (await b.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: "reduce" })).newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:5173/preview-journey/" + q, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await p.waitForTimeout(8000);
  await p.screenshot({ path: OUT + "pj" + (q.replace(/[?=]/g, "_") || "_default") + ".png" });
  console.log((q || "(default)").padEnd(16), errs.length ? "ERRORS: " + errs.join("; ") : "clean");
  await p.close();
}
await b.close();
