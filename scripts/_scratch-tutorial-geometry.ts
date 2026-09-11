// Measures the tutorial card at both framings WITHOUT the API.
//
// The full suite (scripts/test-tutorial-ui.ts) needs a signed-in account, and
// the question IDEA-064 raised is purely geometric: does a five-row coat list
// still fit, and is anything it pushes off the screen reachable? So this drives
// the REAL carousel module and the REAL stylesheet on the app's own page, and
// stubs only the 3D stage and the device input.
//
//   npm run dev && npx tsx scripts/_scratch-tutorial-geometry.ts
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:5173";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    deviceScaleFactor: 3,
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tutorial", { state: "attached", timeout: 30_000 });
  // Fonts matter: Baloo 2 sets the title and the coat names, and a fallback
  // stack measures differently.
  // Every page.evaluate here is passed as a STRING, not a function: tsx builds
  // with esbuild's keepNames, which injects a __name() helper into any function
  // it compiles — and that helper does not exist inside the browser, so a
  // function-form evaluate dies with "__name is not defined".
  await page.evaluate("document.fonts.ready");

  await page.evaluate(`(async () => {
    const mod = await import("/src/ui/tutorialCarousel.ts");
    window.__tut = mod.attachTutorialCarousel({
      onStage: function () {},
      readInput: function () { return { coarsePointer: true, scheme: "swipe" }; },
    });
    window.__tut.open();
  })()`);

  for (const vp of [
    { width: 390, height: 844, label: "phone 390x844" },
    { width: 360, height: 740, label: "small 360x740" },
    { width: 844, height: 390, label: "landscape 844x390" },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    // Jump to the last slide (the coat list) via its dot.
    const n = Number(await page.evaluate('document.querySelectorAll(".tut-dot").length'));
    await page.evaluate(`document.querySelector(".tut-dot[data-idx='${n - 1}']").click()`);
    await page.waitForTimeout(250);

    const m = (await page.evaluate(`(function () {
      var overlay = document.querySelector("#tutorial");
      var card = document.querySelector(".tut-card").getBoundingClientRect();
      var rows = Array.prototype.slice.call(document.querySelectorAll(".tut-perk"));
      var scrolls = overlay.scrollHeight > overlay.clientHeight + 1;
      if (scrolls) overlay.scrollTop = overlay.scrollHeight;
      var next = document.querySelector(".tut-next").getBoundingClientRect();
      var last = rows[rows.length - 1].getBoundingClientRect();
      var out = {
        title: document.querySelector(".tut-title").textContent.trim(),
        rows: rows.length,
        cardTop: Math.round(card.top),
        cardBottom: Math.round(card.bottom),
        cardH: Math.round(card.height),
        scrolls,
        overflowTop: Math.round(overlay.getBoundingClientRect().top - card.top),
        nextVisible: next.top >= 0 && next.bottom <= window.innerHeight,
        lastRowVisible: last.top >= 0 && last.bottom <= window.innerHeight,
        pawSizes: Array.prototype.slice.call(document.querySelectorAll(".tut-perk .paw-swatch")).map(function (p) {
          var b = p.getBoundingClientRect();
          return Math.round(b.width) + "x" + Math.round(b.height);
        }).join(" "),
        leftEdges: new Set(rows.map(function (r) { return Math.round(r.getBoundingClientRect().left); })).size,
        vh: window.innerHeight,
      };
      overlay.scrollTop = 0;
      return out;
    })()`)) as {
      title: string; rows: number; cardTop: number; cardBottom: number; cardH: number;
      scrolls: boolean; overflowTop: number; nextVisible: boolean; lastRowVisible: boolean;
      pawSizes: string; leftEdges: number; vh: number;
    };
    console.log(`\n${vp.label}  "${m.title}"`);
    console.log(`  rows ${m.rows}  paws ${m.pawSizes}  shared left edge: ${m.leftEdges === 1}`);
    console.log(`  card ${m.cardTop}..${m.cardBottom} (h ${m.cardH}) of ${m.vh}`);
    console.log(`  scrolls: ${m.scrolls}   cut off above the fold: ${Math.max(0, m.overflowTop)}px`);
    console.log(`  after scrolling to the end — last coat visible: ${m.lastRowVisible}, "Got it" visible: ${m.nextVisible}`);
  }

  // Every slide in landscape — the coat list is the tallest, but it is worth
  // knowing whether it is the ONLY one that needs the scroll.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(250);
  const count = Number(await page.evaluate('document.querySelectorAll(".tut-dot").length'));
  console.log("");
  console.log("landscape 844x390 — card height per slide (viewport 390):");
  for (let i = 0; i < count; i++) {
    await page.evaluate(`document.querySelector(".tut-dot[data-idx='${i}']").click()`);
    await page.waitForTimeout(150);
    const r = (await page.evaluate(`(function () {
      var o = document.querySelector("#tutorial");
      var c = document.querySelector(".tut-card").getBoundingClientRect();
      return {
        t: document.querySelector(".tut-title").textContent.trim(),
        h: Math.round(c.height),
        scrolls: o.scrollHeight > o.clientHeight + 1,
        top: Math.round(c.top),
      };
    })()`)) as { t: string; h: number; scrolls: boolean; top: number };
    console.log(`  ${String(i + 1).padStart(2)}. ${r.t.padEnd(28)} h=${String(r.h).padStart(3)}  top=${String(r.top).padStart(4)}  scrolls=${r.scrolls}`);
  }

  // A look, after the measuring. The auth gate sits above #tutorial (this page
  // never signs in), so hide it — it does not affect the boxes measured above,
  // only what a screenshot shows.
  await page.evaluate('document.getElementById("authGate").style.display = "none"');
  // Both framings, on the coat slide.
  for (const vp of [
    { width: 390, height: 844, name: "tutorial-coats-390.png" },
    { width: 844, height: 390, name: "tutorial-coats-landscape.png" },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    await page.evaluate(`document.querySelector(".tut-dot[data-idx='${count - 1}']").click()`);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${process.env.TEMP}/${vp.name}` });
    console.log(`  wrote ${process.env.TEMP}/${vp.name}`);
  }

  // The coat list on its own, at 3x — 22px paws have to be judged at the size
  // an eye sees them, not at the size a 390px screenshot prints them.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.evaluate(`document.querySelector(".tut-dot[data-idx='${count - 1}']").click()`);
  await page.waitForTimeout(300);
  const zoom = await page.locator(".tut-perks").boundingBox();
  if (zoom) {
    await page.screenshot({
      path: `${process.env.TEMP}/tutorial-coats-zoom.png`,
      clip: { x: zoom.x - 8, y: zoom.y - 8, width: zoom.width + 16, height: zoom.height + 16 },
      scale: "css",
    });
    console.log(`  wrote ${process.env.TEMP}/tutorial-coats-zoom.png`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
