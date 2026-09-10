import { chromium } from "playwright";
const HOST = process.env.HOST ?? "http://localhost:5173";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 740, height: 740 } });
// Reference framing: a flat vector drawing, so a LONG lens and a low elevation
// (IDEA-054's ?fov= finding — capturing at the viewer's comfortable 32 degrees
// inflates the near-camera parts and reports as a model defect).
await p.goto(`${HOST}/preview-rework/?model=burger&az=0&el=8&fov=14&dist=5.6&grid=0&hud=0&shadow=0&color=15374396`,
  { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 30000 });
await p.waitForTimeout(500);
await p.screenshot({ path: ".img2threejs/burger/renders/ref-match.png" });
await b.close();
console.log("wrote .img2threejs/burger/renders/ref-match.png");
