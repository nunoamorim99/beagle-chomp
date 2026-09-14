// IDEA-065: all six woodland critters in ONE frame, at the PLAY camera's
// elevation, plus a clay pass.
//
// It exists because of IDEA-056 rule 1, and here the risk is sharper than it
// was for the sushi pair: there are six of them and three are the same orange.
// A fox, a squirrel and a deer are all warm tan in their references and a
// rabbit is a paler version of the same, so colour separates nothing and the
// SILHOUETTE has to carry all of it. That is not a claim you can assert — the
// garden's flower sheet is what showed the rose reading as a broken artichoke
// while every unit check passed — so this renders them side by side and the
// answer is whether you can name each one.
//
// The CLAY pass (`?flat=1`) is the harder test and the one worth trusting: it
// strips every map and every colour to one neutral grey, so a separator that
// was really being carried by a fur tone fails here. It is the instrument that
// caught the flea's vanishing bands and the burger's missing ledge.
//
//   npm run dev
//   npx tsx scripts/_scratch-critter-sheet.ts [label]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const base = process.argv[3] ?? "http://localhost:5173";
const MODELS = ["prop-deer", "prop-fox", "prop-rabbit", "prop-raccoon", "prop-squirrel", "prop-explorer"];
// The play camera sits at 59 degrees of elevation (scene.ts's BASE_POS), and
// tuning a prop on a turntable's default 12 is how the mosquito's abdomen came
// to point straight down the view axis. `34` is the three-quarter review
// angle; `play` is the one a player actually has.
const VIEWS: Record<string, string> = { play: "az=25&el=59", "34": "az=42&el=12" };

const out = `.img2threejs/forest-critters/renders/${label}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 460 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

for (const flat of [false, true]) {
  for (const [vname, vq] of Object.entries(VIEWS)) {
    const shots: string[] = [];
    for (const model of MODELS) {
      const url = `${base}/preview-rework/?${vq}&model=${model}&grid=0&hud=0&toon=1${flat ? "&flat=1" : ""}`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 15000 });
      await page.waitForTimeout(150);
      const b = (await page.screenshot({ type: "png" })).toString("base64");
      shots.push(b);
    }
    // Stitch in the browser rather than pulling in an image library: this
    // project ships no texture assets and has no encoder dependency, and a
    // canvas is already sitting there.
    const sheet = await page.evaluate(async (list: string[]) => {
      const W = 460;
      const c = document.createElement("canvas");
      c.width = W * 3;
      c.height = W * 2;
      const g = c.getContext("2d")!;
      g.fillStyle = "#eae6df";
      g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < list.length; i++) {
        const im = new Image();
        im.src = "data:image/png;base64," + list[i];
        await im.decode();
        g.drawImage(im, (i % 3) * W, Math.floor(i / 3) * W);
      }
      return c.toDataURL("image/png").split(",")[1];
    }, shots);
    const path = `${out}/${vname}${flat ? "-clay" : ""}.png`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, Buffer.from(sheet, "base64"));
    console.log(path);
  }
}

if (errors.length) {
  console.log("\nPAGE ERRORS:");
  for (const e of new Set(errors)) console.log("  " + e);
}
await browser.close();
