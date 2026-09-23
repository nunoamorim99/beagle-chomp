// Every theme, both styles, at the play camera on a phone.
//
// The lift and the snap are theme-agnostic, so they WORK everywhere by
// construction — and "works" is not "looks right". Only the garden had been
// looked at, which is exactly how Night City's purple roads survived an audit
// of the code and died to an audit of the palettes.
import { chromium } from "playwright";

const THEMES = ["garden", "forest", "beach", "park", "city", "classic"] as const;
const b = await chromium.launch();
for (const theme of THEMES) {
  for (const style of ["", "style=madbox"] as const) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("ERR", theme, style, e.message));
    await page.goto(`http://localhost:5173/preview-board/?theme=${theme}&${style}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(3200);
    const calls = await page.evaluate(`(() => {
      const r = window.__rig && window.__rig.renderer;
      return r ? r.info.render.calls + "/" + r.info.render.triangles : "?";
    })()`);
    await page.evaluate(`document.getElementById("hud").style.display = "none"`);
    const tag = style ? "madbox" : "classic";
    await page.screenshot({ path: `.tmp-screens/theme-${theme}-${tag}.png` });
    console.log(`${theme.padEnd(8)} ${tag.padEnd(8)} ${calls}`);
    await ctx.close();
  }
}
await b.close();
