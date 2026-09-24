// Does the arch's fence footing still match the maze fence it butts against?
import { chromium } from "playwright";
const OUT = "C:/Users/nunom/AppData/Local/Temp/claude/c--Users-nunom-Documents-Projetos-beagle-chomp/34037cce-d641-461d-906e-e643d781db4e/scratchpad/";
const b = await chromium.launch();
for (const style of ["madbox", "classic"]) {
  const p = await (await b.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: "reduce" })).newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(`http://localhost:5173/preview-board/?theme=garden&view=arch&style=${style}`,
    { waitUntil: "domcontentloaded", timeout: 120_000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: OUT + "arch-" + style + ".png" });
  await p.close();
}
await b.close();
console.log("shot");
