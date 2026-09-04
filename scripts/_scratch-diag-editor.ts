import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR:", (e as Error).stack ?? String(e)));
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(m.type().toUpperCase() + ":", m.text().slice(0, 400)); });
await p.goto("http://localhost:5173/editor/", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
const info = await p.evaluate(`(() => {
  const rows = document.querySelectorAll('.tree-row');
  const first = rows[0];
  const r = first ? first.getBoundingClientRect() : null;
  return { rowCount: rows.length, firstRect: r ? { w: r.width, h: r.height, x: r.x, y: r.y } : null,
           firstText: first ? first.textContent : null };
})()`);
console.log(JSON.stringify(info));
await p.screenshot({ path: ".img2threejs/renders/integrated/editor.png" });
await b.close();
