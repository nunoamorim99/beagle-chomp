// Loads a /preview-rework/ URL and prints the page title plus every console
// message, page error and failed request. The turntable script waits for the
// title to say "ready", so when a capture times out this says WHY instead of
// leaving a bare Playwright timeout.
//
//   npx tsx scripts/_scratch-preview-probe.ts "<url>"
import { chromium } from "playwright";

const url =
  process.argv[2] ?? "http://localhost:5178/preview-rework/?model=mosquito-gen&grid=0";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

const msgs: string[] = [];
page.on("pageerror", (e) => msgs.push("PAGEERROR: " + (e.stack ?? String(e))));
page.on("console", (m) => msgs.push(`${m.type()}: ${m.text()}`));
page.on("requestfailed", (r) => msgs.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: "networkidle" }).catch((e) => msgs.push("GOTO: " + e.message));
await page.waitForTimeout(2500);

console.log("title:", await page.title());
for (const m of msgs.slice(0, 30)) console.log(m.slice(0, 700));
await browser.close();
