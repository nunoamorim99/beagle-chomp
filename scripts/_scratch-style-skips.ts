// WHAT DOES THE RESTYLE SKIP, AND DOES IT STILL LOOK LIKE THE NEW STYLE?
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })).newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto("http://localhost:5173/editor/", { waitUntil: "domcontentloaded", timeout: 120_000 });
await p.waitForFunction("!!window.__styleTestHook", null, { timeout: 60_000 });
await p.click("#modeBoardBtn");
await p.waitForTimeout(6000);
console.log("SKIPPED ON THE BOARD:\n    " + (await p.evaluate(`window.__styleTestHook.skips("board")`)));
await b.close();
