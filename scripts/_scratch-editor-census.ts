// WHICH EDITOR TABS DRAW WHAT SHIPS? Counts material classes per tab root.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })).newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto("http://localhost:5173/editor/", { waitUntil: "domcontentloaded", timeout: 120_000 });
await p.waitForFunction("!!window.__styleTestHook", null, { timeout: 60_000 });
await p.waitForTimeout(2500);

const show = async (label: string, which: string) => {
  console.log(label.padEnd(24), JSON.stringify(await p.evaluate(`window.__styleTestHook.census(${JSON.stringify(which)})`)));
  console.log("  still lit:", await p.evaluate(`window.__styleTestHook.unstyled(${JSON.stringify(which)})`));
};

await show("Character tab", "character");
for (const [id, label, sel] of [
  ["#modePickupsBtn", "Pickups", "character"],
  ["#modeBoardBtn", "Board & Themes", "board"],
  ["#modePropsBtn", "Props", "props"],
  ["#modeWorldBtn", "World", "board"],
] as const) {
  await p.click(id);
  await p.waitForTimeout(5000);
  await show(label + " tab", sel);
}
await b.close();
