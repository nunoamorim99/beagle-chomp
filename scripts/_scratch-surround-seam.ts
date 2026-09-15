// IDEA-066: what colour IS the board's floor, really?
//
// The surround plane has to match the board floor at the join or it draws a
// ring around the maze. The first build set `surroundGround = palette.floor`
// on the reasoning that floorTexture.ts "bakes palette.floor in as its ground"
// -- which is true and still gave the garden a BROWN surround around a GREEN
// lawn. palette.floor is the garden's SOIL; the `lawn` painter covers it in
// grass, so the texture's MEAN is nothing like its base colour. Correct
// reasoning, wrong answer, and only a measurement says so.
//
// This reads each theme's real floor canvas out of the running page and
// averages it, then prints the value `surroundGround` should carry. It also
// reports the mean's luminance, which is the second half of the same problem:
// board.ts drives the floor's emissive through that texture as an emissiveMap,
// so a flat plane at the same emissiveIntensity is lit at FULL strength where
// the board is lit at texel strength.
//
//   npm run dev
//   npx tsx scripts/_scratch-surround-seam.ts
import { chromium } from "playwright";

const themes = (process.env.THEMES ?? "garden,classic,forest,park,city,beach").split(",");
const base = process.env.BASE ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

console.log("  theme     palette.floor   TEXTURE MEAN   lum    surroundGround now   verdict");
let bad = 0;
for (const t of themes) {
  await page.goto(`${base}/preview-board/?theme=${t}&maze=0&view=game&hud=0`, {
    waitUntil: "load",
    timeout: 90000,
  });
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });

  const r = (await page.evaluate(() => {
    const w = window as unknown as {
      __board: { board: { floor: import("three").Mesh }; rig: unknown };
    };
    const mat = w.__board.board.floor.material as import("three").MeshToonMaterial;
    const img = mat.map?.image as HTMLCanvasElement | undefined;
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    return { r: r / n, g: g / n, b: b / n, w: c.width, h: c.height };
  })) as { r: number; g: number; b: number; w: number; h: number } | null;

  // WHAT THE PLAYER SEES ON THE SURROUND SIDE, which stopped being the
  // material's colour the moment the ground gained a map: a textured surface
  // bakes its colour in and holds the material at WHITE, so reading
  // `material.color` reports 0xffffff and this instrument confidently declared
  // four sound themes broken. Third false alarm from a harness in this feature
  // -- measure the same thing on both sides, which is the texture's MEAN.
  const pal = (await page.evaluate(() => {
    const w = window as unknown as { __board: { board: { surroundGround: import("three").Mesh } } };
    const m = w.__board.board.surroundGround.material as import("three").MeshToonMaterial;
    const img = m.map?.image as HTMLCanvasElement | undefined;
    if (!img) return m.color.getHex();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g2 = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g2 += d[i + 1];
      b += d[i + 2];
    }
    return (Math.round(r / n) << 16) | (Math.round(g2 / n) << 8) | Math.round(b / n);
  })) as number;

  const floorHex = (await page.evaluate(`(() => {
    return window.__board.board.floor.material.color.getHex();
  })()`)) as number;

  if (!r) {
    console.log(`  ${t.padEnd(8)}  (no floor map)`);
    continue;
  }
  const hex = (Math.round(r.r) << 16) | (Math.round(r.g) << 8) | Math.round(r.b);
  const lum = (0.2126 * r.r + 0.7152 * r.g + 0.0722 * r.b) / 255;
  // Perceptual distance between what the surround is painted and what the
  // board actually looks like. 24/255 per channel is roughly where a flat
  // plane starts reading as a different surface at the game camera.
  const dr = Math.abs(((pal >> 16) & 0xff) - r.r);
  const dg = Math.abs(((pal >> 8) & 0xff) - r.g);
  const db = Math.abs((pal & 0xff) - r.b);
  const worst = Math.max(dr, dg, db);
  const okk = worst <= 24;
  if (!okk) bad++;
  console.log(
    `  ${t.padEnd(8)}  0x${floorHex.toString(16).padStart(6, "0")}      ` +
      `0x${hex.toString(16).padStart(6, "0")}     ${lum.toFixed(3)}  ` +
      `0x${pal.toString(16).padStart(6, "0")}           ` +
      `${okk ? "ok" : `MISMATCH by ${Math.round(worst)}/255 -> use 0x${hex.toString(16).padStart(6, "0")}`}`,
  );
}
await browser.close();
console.log(`\n  ${bad} theme(s) whose surround does not match their board floor.`);
console.log(`  The texture mean is the value to use: it is what the player SEES,`);
console.log(`  which is not palette.floor once a painter has covered it.`);
if (bad) process.exitCode = 1;
