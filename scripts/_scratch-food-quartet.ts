// Scratch: the four FOOD skins side by side, at the SAME team colour and the
// SAME play-camera angle, packed into ONE sheet so the comparison is a look
// rather than four looks and a memory.
//
// IDEA-059's recorded risks R1 and R2 are that the burger joins the pizza (both
// rubber-hose mascots in white gloves and boots) or the maki (both round, both
// ~0.8 tall, both food that stands up). All four take the team colour and all
// four are recoloured again when frightened, so colour cannot separate any of
// them and the check has to be a RENDER, not an assertion.
//
// STATE=frightened is the harder half of the test: that is when the models are
// most alike, because three of the four go blue in most of the same places.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
// Shots are inlined as data: URIs. Chromium refuses file:// SUBRESOURCES on a
// setContent() page (opaque origin) and does it SILENTLY - every cell renders
// as an empty frame with its caption under it, which reads as a finished sheet
// of blank models rather than as a broken sheet.

const out = process.env.OUT ?? ".img2threejs/burger/evidence";
const el = process.env.EL ?? "59";
const state = process.env.STATE ? `&state=${process.env.STATE}` : "";
const tag = process.env.STATE ? `-${process.env.STATE}` : "";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 520 } });
const shots: string[] = [];
for (const model of ["maki", "nigiri", "pizza", "burger"]) {
  await page.goto(
    `${process.env.HOST ?? "http://localhost:5173"}/preview-rework/?model=${model}&az=18&el=${el}` +
      `&grid=0&hud=0&bg=none&shadow=0&color=15229279${state}`,
    { waitUntil: "domcontentloaded", timeout: 90_000 },
  );
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const p = `${out}/quartet-${model}${tag}.png`;
  await page.screenshot({ path: p, omitBackground: true });
  shots.push(p);
}

// One sheet, four cells. A four-up on a neutral ground is the only framing that
// answers the question actually being asked — "could a player mistake one of
// these for another at 25 px" — and four separate PNGs cannot answer it.
const html = `<body style="margin:0;background:#efe9e2;display:grid;
  grid-template-columns:repeat(4,520px);width:2080px;height:560px">
  ${shots.map((p, i) => `<div style="position:relative">
    <img src="data:image/png;base64,${readFileSync(p).toString("base64")}"
         style="width:520px;height:520px">
    <div style="position:absolute;bottom:4px;width:100%;text-align:center;
      font:600 20px system-ui;color:#3a2a20">${["maki", "nigiri", "pizza", "burger"][i]}</div>
  </div>`).join("")}
</body>`;
await page.setViewportSize({ width: 2080, height: 560 });
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/quartet${tag}.png` });
await browser.close();
console.log(`wrote ${out}/quartet${tag}.png`);
