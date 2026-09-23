// THE NUMBER THAT DECIDES THE WHOLE RESTYLE.
//
// The board palettes are dark because biscuits have to read against them at
// ~17 CSS px a tile. The island map never had that constraint. So before any
// of this ships, the question is not "is it prettier" but "can you still see
// the pellets" — and that is measurable rather than arguable.
//
// Sampled off the rendered frame, because a WebGL canvas cannot be probed in
// band (no preserveDrawingBuffer) and because what matters is the composited
// image, not the material values.
import { chromium } from "playwright";
import { resolve } from "node:path";

const b = await chromium.launch();

async function shoot(name: string, q: string): Promise<string> {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("ERR", name, e.message));
  await page.goto(`http://localhost:5173/preview-board/?theme=garden&view=close&${q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3500);
  await page.evaluate(`document.getElementById("hud").style.display = "none"`);
  const path = `.tmp-screens/pellet-${name}.png`;
  await page.screenshot({ path });
  await ctx.close();
  return path;
}

const probe = `(async () => {
  const img = document.querySelector("img");
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const L = (d) => (0.2126*d[0] + 0.7152*d[1] + 0.0722*d[2]) / 255;
  // Walk a vertical strip down the corridor the beagle stands in. The biscuits
  // are the local MAXIMA and the floor between them the minima, so the strip
  // gives both without hand-picking a pixel of each — hand-picking is how you
  // measure the shadow under a pellet and call it the floor.
  const x = 140, y0 = 150, y1 = 640;
  const col = [];
  for (let y = y0; y < y1; y++) col.push(L(g.getImageData(x, y, 1, 1).data));
  const sorted = [...col].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.25)];
  const pellet = sorted[Math.floor(sorted.length * 0.97)];
  return { floor: +floor.toFixed(3), pellet: +pellet.toFixed(3), delta: +(pellet - floor).toFixed(3),
           ratio: +((pellet + 0.05) / (floor + 0.05)).toFixed(2) };
})()`;

for (const [name, q] of [["current", ""], ["madbox", "style=madbox"]] as const) {
  const path = await shoot(name, q);
  const p2 = await (await b.newContext()).newPage();
  await p2.goto("file:///" + resolve(path).split("\\").join("/"));
  console.log(name.padEnd(8), JSON.stringify(await p2.evaluate(probe)));
}
await b.close();
