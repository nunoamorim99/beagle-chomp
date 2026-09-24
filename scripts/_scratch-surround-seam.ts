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
import { shouldStyleBoard } from "../src/render/madboxStyle.js";
import { getMazeTheme } from "../src/game/themes.js";

const themes = (process.env.THEMES ?? "garden,classic,forest,park,city,beach").split(",");
const base = process.env.BASE ?? "http://127.0.0.1:5173";
/** IDEA-079's style is the game's default, so it is this probe's default too.
 *  STYLE=classic measures the other one. */
const madbox = (process.env.STYLE ?? "madbox") !== "classic";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

console.log("  theme     palette.floor   TEXTURE MEAN   lum    surroundGround now   verdict");
let bad = 0;
for (const t of themes) {
  await page.goto(
    `${base}/preview-board/?theme=${t}&maze=0&view=game&hud=0&style=${madbox ? "madbox" : "classic"}`,
    {
      waitUntil: "load",
      timeout: 90000,
    },
  );
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
  const dr = ((pal >> 16) & 0xff) - r.r;
  const dg = ((pal >> 8) & 0xff) - r.g;
  const db = (pal & 0xff) - r.b;
  const worst = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
  // THE RULE CHANGED UNDER IDEA-079, AND THIS HAD TO CHANGE WITH IT.
  //
  // In the classic style the two must MATCH: `surroundGround` is simply the
  // floor texture's mean, and any gap draws a ring around the maze.
  //
  // The high-key style lifts them to DIFFERENT targets on purpose —
  // `SURFACE_LIFT.floorL` 0.46 for the board, `outsideL` 0.6 for everything
  // beyond it, because the outside is atmosphere rather than something the
  // biscuits are read against. So the outside is deliberately LIGHTER, by 41
  // to 71 of 255 on the three lawn themes, and on screen that reads as brighter
  // meadow around a mown board rather than as a seam. Held to equality this
  // probe failed three sound themes — and an instrument that cries wolf about
  // the configuration it is calibrated against is one people stop reading
  // (`fenceReadability`'s 1.95px floor, same lesson).
  //
  // What still matters, and what is checked instead: the outside may never be
  // DARKER than the board (that IS the ring bug, and it is what a wrong base
  // colour produces), and it may not run away — past ~0.2 of lightness the
  // board stops looking like it is standing on the same ground.
  //
  // Sand is the case that still matches exactly, because `sandFloorL` and the
  // sand branch of `surroundGround` share one target.
  const signed = Math.max(dr, dg, db);     // + = outside lighter than the board
  const darker = Math.min(dr, dg, db) < -12;
  // A NIGHT THEME IS EXEMPT FROM THE STYLE (shouldStyleBoard), so it keeps the
  // classic relationship and has to be judged by the classic rule. Night City
  // sits 19/255 darker outside, which is within the old tolerance and was
  // being failed by the new one — the exemption has to reach the instrument
  // too, or the probe reports the one theme the style deliberately does not
  // touch as the only broken one.
  const styled = madbox && shouldStyleBoard(getMazeTheme(t).palette);
  const okk = styled ? !darker && worst <= 90 : worst <= 24;
  if (!okk) bad++;
  console.log(
    `  ${t.padEnd(8)}  0x${floorHex.toString(16).padStart(6, "0")}      ` +
      `0x${hex.toString(16).padStart(6, "0")}     ${lum.toFixed(3)}  ` +
      `0x${pal.toString(16).padStart(6, "0")}           ` +
      `${
        okk
          ? styled
            ? `ok (outside +${Math.round(signed)})`
            : "ok"
          : `MISMATCH by ${Math.round(worst)}/255${darker ? " (outside DARKER)" : ""}` +
            ` -> use 0x${hex.toString(16).padStart(6, "0")}`
      }`,
  );
}
await browser.close();
console.log(`\n  ${bad} theme(s) whose surround does not sit right against their board floor.`);
if (madbox) {
  console.log("  Under the style the outside is meant to be LIGHTER");
  console.log("  (SURFACE_LIFT.outsideL against floorL), so what is checked is that it");
  console.log("  is never DARKER and never runs away. A night theme is exempt from the");
  console.log("  style and is held to the classic match rule instead.");
} else {
  console.log("  The texture mean is the value to use: it is what the player SEES,");
  console.log("  which is not palette.floor once a painter has covered it.");
}
if (bad) process.exitCode = 1;
