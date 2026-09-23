// Reads the RENDERED water back out of a screenshot.
//
// A live WebGL canvas cannot be probed here — the renderer runs without
// `preserveDrawingBuffer`, so reading a pixel out of band returns a cleared
// buffer and every comparison is two blacks (IDEA-063's note). Going via the
// PNG is what makes the measurement real: it is the composited image.
import { chromium } from "playwright";
import { resolve } from "node:path";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/preview-journey/?progress=6&" + (process.env.Q ?? "style=madbox"), { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".jp-item", { timeout: 60000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById("hud")!.style.display = "none"; document.getElementById("card")!.style.display = "none"; (document.querySelector(".jp-list") as HTMLElement).style.display = "none"; });
await page.screenshot({ path: ".tmp-screens/sea-probe.png" });
await ctx.close();

// THE PROBE IS A CODE STRING, NOT A FUNCTION, and that is IDEA-074's trap:
// esbuild's keepNames wraps a named arrow in `__name(...)`, Playwright
// serialises the SOURCE into the page, `__name` is not defined there, and the
// whole evaluate dies on one ReferenceError that looks nothing like the cause.
const fileUrl = "file:///" + resolve(".tmp-screens/sea-probe.png").split('\\').join("/");
const p2 = await (await b.newContext()).newPage();
await p2.goto(fileUrl);
const code = `(async () => {
  const img = document.querySelector("img");
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  // A radial walk out from the Night City island's near shore, to see whether
  // the contact shadow is actually darkening the water or only looks like it
  // should be. Far water is the control.
  const pts = {
    "shore +2px":  [95, 660],
    "shore +10px": [95, 668],
    "shore +24px": [95, 682],
    "shore +45px": [95, 703],
    "far control": [320, 700]
  };
  const res = { size: [img.naturalWidth, img.naturalHeight] };
  for (const k in pts) {
    const d = g.getImageData(pts[k][0], pts[k][1], 1, 1).data;
    const mx = Math.max(d[0], d[1], d[2]), mn = Math.min(d[0], d[1], d[2]);
    res[k] = {
      hex: "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join(""),
      L: +((0.2126*d[0] + 0.7152*d[1] + 0.0722*d[2]) / 255).toFixed(3),
      S: +(mx === 0 ? 0 : (mx - mn) / mx).toFixed(3)
    };
  }
  return res;
})()`;
console.log(JSON.stringify(await p2.evaluate(code), null, 1));
await b.close();
