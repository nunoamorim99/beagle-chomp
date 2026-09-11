// OWNER: qa-test-engineer (IDEA-052b)
//
// Does the service worker still precache, and does the app still run offline?
//
// THIS EXISTS BECAUSE OF A SILENT FAILURE MEASURED ON 2026-09-09.
//
// `public/push-sw.js` is pulled into the generated worker with
// `workbox.importScripts`. Workbox emits that call INSIDE its define() callback,
// immediately before `skipWaiting()` in the same comma expression:
//
//     importScripts("push-sw.js?v=1"), self.skipWaiting(), e.clients...
//
// So a syntax error in push-sw.js does NOT stop the worker registering, and it
// does not stop it reporting `state: "activated"`. What it stops is everything
// after it on that line — skipWaiting, clientsClaim, and precacheAndRoute.
// Measured with a deliberate syntax error:
//
//     active: "activated"     <- looks fine
//     cachedEntries: 0        <- nothing precached
//     offline reload: blank   <- the app is gone offline
//     errors: none            <- nothing surfaces anywhere
//
// And push-sw.js is the ONE file in this project with no safety net: plain JS,
// no bundler, no `tsc`, not typechecked, not linted. Every other line of client
// code is checked by something. This is that something.
//
// Run after ANY change to push-sw.js or the PWA config:
//   npm run build && npx vite preview --port 4173 &
//   npm run test:sw

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:4173";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ reducedMotion: "reduce" });
const page = await ctx.newPage();

const errors: string[] = [];
ctx.on("serviceworker", (w) => {
  w.on("console", (m) => {
    if (m.type() === "error") errors.push(`[sw] ${m.text()}`);
  });
});
page.on("pageerror", (e) => errors.push(`[page] ${String(e)}`));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);

console.log("\nInstall");

const state = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  let cached = 0;
  const urls: string[] = [];
  for (const k of keys) {
    const reqs = await (await caches.open(k)).keys();
    cached += reqs.length;
    urls.push(...reqs.map((r) => r.url));
  }
  return {
    active: reg?.active?.state ?? "none",
    hasPushManager: reg ? "pushManager" in reg : false,
    cachedEntries: cached,
    fonts: urls.filter((u) => u.endsWith(".woff2")).length,
  };
});

ok("the worker activates", state.active === "activated", state.active);
ok("…and exposes pushManager", state.hasPushManager);

// The counts are the real check. "activated" alone is worthless — a broken
// push-sw.js gives exactly that with an empty cache.
ok("…and actually PRECACHED something", state.cachedEntries > 15, `${state.cachedEntries} entries`);
// The fonts are the tell this project has already paid for: a blocked font once
// took the whole visual language down, which is why they are self-hosted.
ok("…including all five self-hosted fonts", state.fonts === 5, `${state.fonts} woff2`);

console.log("\nOffline");

await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(2500);

const offline = await page.evaluate(() => ({
  title: document.title,
  mounted: !!document.querySelector("canvas, #boot, #authGate, #mainMenu"),
  bodyLen: document.body.innerHTML.length,
}));
await ctx.setOffline(false);

ok("the app still loads with the network cut", offline.mounted, JSON.stringify(offline));
ok("…as the real page, not an error shell", offline.title === "Beagle Chomp", offline.title);

ok("no service-worker or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

console.log(`\n${"-".repeat(60)}`);
console.log(`SERVICE WORKER: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
