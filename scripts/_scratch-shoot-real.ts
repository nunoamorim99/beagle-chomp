// Screenshots the REAL makeBeagle via /preview/ (the shipped builder + game
// idle animation) at several views.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = ".img2threejs/renders/integrated";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
let hud = "";
for (const view of (process.env.VIEWS ?? "34,front,side,back,face").split(",")) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await p.goto(`http://localhost:5173/preview/?view=${view}&grid=0&hud=0&anim=0`, { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    const buf = await p.screenshot({ path: `${OUT}/${view}.png` });
    if (buf.length > 20_000) break;
  }
  if (view === "34") hud = (await p.evaluate("document.getElementById('hud').textContent")) as string;
}
console.log(hud);
console.log(`→ ${OUT}`);
if (errors.length) {
  console.log("page errors:");
  for (const e of errors) console.log("  " + e);
  process.exit(1);
}
