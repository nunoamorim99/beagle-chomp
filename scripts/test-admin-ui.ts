// OWNER: backend / tooling (IDEA-075)
//
// The admin portal's LAYOUT suite.  `npm run test:admin-ui`
//   SHOT=1 npm run test:admin-ui     also writes screenshots to .tmp-screens/admin
//   ONLY=phone-390,desktop-1920 …    a subset of framings, while iterating
//
// It drives the REAL app (`npm run dev:admin`, port 5180) with every API call
// stubbed, so what is measured is main.ts's own markup under admin.css rather
// than a hand-copied lookalike. No database and no API container are needed.
//
// It exists because the three defects it pins are all INVISIBLE to the person
// who introduces them, and two of them shipped:
//
//   1. `main` carried `max-width: 1200px` with no auto margin. On the 1200px
//      laptop it was written on that is the whole screen; on a 1920px monitor
//      it is 63% of it pinned to the left edge, and on a 2560px one 47%. You
//      only see it on a screen you do not have.
//   2. A grid item takes `min-width: auto`, i.e. its MIN-CONTENT size, and a
//      panel holding a nowrap eight-column table has a min-content of ~865px.
//      Seven of the eight tabs therefore overflowed a 390px phone sideways,
//      dragging their own headings out of frame. Invisible on a desktop.
//   3. Every chart is a fixed-viewBox SVG at width:100%, so the browser scales
//      its type with its box: rendered = declared x (box / viewBox). One
//      stylesheet value of 11px was rendering between 6.2px and 28px depending
//      on which column the chart landed in. A render cannot tell you a 7px
//      axis label from an 11px one at a glance, and this can.
//
// The assertions are BOUNDED AT BOTH ENDS on purpose — a "nothing is too
// small" check passes happily on a chart that is far too big, and on a hidden
// element measuring zero.

import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import * as fx from "./_admin-ui-fixtures.js";

const BASE = process.env.BASE ?? "http://localhost:5180";
const OUT = process.env.OUT ?? ".tmp-screens/admin";
const SHOT = process.env.SHOT === "1";
const ONLY = process.env.ONLY;

/** Rendered px a chart's smallest type must land inside, at every framing. */
const TYPE_MIN = 10;
const TYPE_MAX = 17;
/** A tab or a toolbar button has to be hittable with a thumb. */
const TOUCH_MIN = 34;

// `sticky` is what admin.css's own breakpoints say the header should be at
// this framing, pinned here so the decision cannot drift silently: sticky is
// worth its cost on a desk and not on a phone, where the header plus two rows
// of tabs is a fifth of the viewport. Note phone-land is 844px WIDE and still
// expects a static header — it clears the width breakpoint and fails the
// height one, which is the whole reason that query has two clauses.
const FRAMINGS = [
  { name: "phone-360", width: 360, height: 780, sticky: false },
  { name: "phone-390", width: 390, height: 844, sticky: false },
  { name: "phone-land", width: 844, height: 390, sticky: false },
  { name: "tablet-768", width: 768, height: 1024, sticky: true },
  { name: "laptop-1280", width: 1280, height: 800, sticky: true },
  { name: "desktop-1920", width: 1920, height: 1080, sticky: true },
  { name: "wide-2560", width: 2560, height: 1440, sticky: true },
].filter((f) => !ONLY || ONLY.split(",").includes(f.name));

const TABS = [
  "overview",
  "retention",
  "difficulty",
  "content",
  "health",
  "players",
  "reach",
  "news",
];

const ROUTES: Record<string, unknown> = {
  "/api/v1/auth/me": { user: { username: "ChorizoBoss" } },
  "/api/v1/admin/overview": fx.overview,
  "/api/v1/admin/retention": fx.retention,
  "/api/v1/admin/challenges": fx.challenges,
  "/api/v1/admin/gameplay": fx.gameplay,
  "/api/v1/admin/content": fx.content,
  "/api/v1/admin/health": fx.health,
  "/api/v1/admin/players": fx.players,
  "/api/v1/admin/notifications": fx.notifications,
  "/api/v1/admin/announcements": fx.announcements,
};

// --- the harness ------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface ChartMeasure {
  panel: string;
  kind: string;
  boxW: number;
  viewW: number;
  scale: number;
  minType: number;
  maxType: number;
}

interface Measurement {
  docScrollW: number;
  viewportW: number;
  shellW: number;
  shellLeft: number;
  headSticky: boolean;
  headH: number;
  overflowing: { sel: string; right: number }[];
  charts: ChartMeasure[];
  unscrollable: string[];
  smallTargets: { sel: string; h: number }[];
}

// esbuild's keepNames wraps every named function in `__name(...)`, which does
// not exist in the page — so a tsx-run Playwright callback dies on one
// ReferenceError, every stub silently fails to apply and it looks exactly like
// the feature not working. IDEA-074 rule 8 records this for addInitScript; it
// applies to evaluate and waitForFunction just the same, which is why both of
// these are SOURCE STRINGS rather than functions.
const PROBE = `(() => {
  var vw = document.documentElement.clientWidth;
  var main = document.querySelector("main");
  var mr = main ? main.getBoundingClientRect() : null;

  function describe(el) {
    var cls = (el.className && typeof el.className === "string")
      ? el.className.split(" ").filter(Boolean).slice(0, 2).join(".")
      : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
  }

  var overflowing = [];
  var unscrollable = [];
  Array.prototype.forEach.call(document.querySelectorAll("body *"), function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // A descendant of a horizontal scroller is not overflowing the PAGE:
    // .scroll exists precisely so a wide table can be swiped instead.
    if (el.closest(".scroll") && !el.classList.contains(".scroll")) {
      if (el.closest(".scroll") !== el) return;
    }
    if (r.right > vw + 1) overflowing.push({ sel: describe(el), right: Math.round(r.right) });
  });
  // ...and that escape hatch has to actually be one.
  Array.prototype.forEach.call(document.querySelectorAll(".scroll"), function (el) {
    if (el.scrollWidth > el.clientWidth + 1) {
      if (getComputedStyle(el).overflowX !== "auto" && getComputedStyle(el).overflowX !== "scroll") {
        unscrollable.push(describe(el));
      }
    }
  });

  var charts = Array.prototype.map.call(document.querySelectorAll("svg.chart"), function (svg) {
    var r = svg.getBoundingClientRect();
    var vb = (svg.getAttribute("viewBox") || "0 0 1 1").trim().split(" ").map(Number);
    var scale = r.width / (vb[2] || 1);
    var sizes = Array.prototype.map.call(svg.querySelectorAll("text"), function (t) {
      return parseFloat(getComputedStyle(t).fontSize) || 0;
    }).filter(function (n) { return n > 0; });
    var sec = svg.closest("section");
    var h2 = sec ? sec.querySelector("h2") : null;
    var kind = svg.classList.contains("chart--line") ? "line"
             : svg.classList.contains("chart--bars") ? "bars"
             : svg.classList.contains("chart--cohort") ? "cohort" : "?";
    return {
      panel: (h2 ? h2.textContent : "?").slice(0, 30),
      kind: kind,
      boxW: Math.round(r.width),
      viewW: vb[2],
      scale: Number(scale.toFixed(2)),
      minType: sizes.length ? Number((Math.min.apply(null, sizes) * scale).toFixed(1)) : 0,
      maxType: sizes.length ? Number((Math.max.apply(null, sizes) * scale).toFixed(1)) : 0,
    };
  });

  var smallTargets = [];
  Array.prototype.forEach.call(document.querySelectorAll(".tab, .topbar button"), function (el) {
    var r = el.getBoundingClientRect();
    if (r.height > 0) smallTargets.push({ sel: describe(el), h: Math.round(r.height) });
  });

  var head = document.querySelector(".shell-head");
  return {
    docScrollW: document.documentElement.scrollWidth,
    viewportW: vw,
    shellW: mr ? Math.round(mr.width) : 0,
    shellLeft: mr ? Math.round(mr.left) : 0,
    headSticky: head ? getComputedStyle(head).position === "sticky" : false,
    headH: head ? Math.round(head.getBoundingClientRect().height) : 0,
    overflowing: overflowing,
    charts: charts,
    unscrollable: unscrollable,
    smallTargets: smallTargets,
  };
})()`;

const LOADED = `(() => {
  var e = document.querySelector("#view .empty");
  return !(e && (e.textContent || "").indexOf("Loading") === 0);
})()`;

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(PROBE) as Promise<Measurement>;
}

async function serverUp(): Promise<boolean> {
  return fetch(BASE)
    .then(() => true)
    .catch(() => false);
}

async function run(browser: Browser, f: (typeof FRAMINGS)[number]): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: f.width, height: f.height },
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  await ctx.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rewind")) return route.fulfill({ json: fx.rewind });
    const key = Object.keys(ROUTES).find((k) => url.pathname.startsWith(k));
    if (!key) {
      return route.fulfill({ status: 404, json: { error: { code: "X", message: "no stub" } } });
    }
    return route.fulfill({ json: ROUTES[key] });
  });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // A token in storage is all the shell needs; /auth/me is stubbed above.
  await page.addInitScript({
    content: 'localStorage.setItem("beagle-chomp-admin:token", "stub-token");',
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tabs .tab", { timeout: 20_000 });

  console.log(`\n${f.name} (${f.width}x${f.height})`);

  for (const tab of TABS) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForFunction(LOADED, undefined, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(120);

    const m = await measure(page);
    const at = `${f.name}/${tab}`;

    check(
      `${at}: the page does not scroll sideways`,
      m.docScrollW <= m.viewportW + 1,
      `document is ${m.docScrollW}px in a ${m.viewportW}px viewport`,
    );
    check(
      `${at}: nothing sticks out past the viewport`,
      m.overflowing.length === 0,
      m.overflowing
        .slice(0, 4)
        .map((o) => `${o.sel} ends at ${o.right}`)
        .join("; "),
    );
    // The complaint that started IDEA-075. A tolerance of 1px, not a fraction:
    // the shell either uses the screen or it does not.
    check(
      `${at}: the shell uses the whole width`,
      Math.abs(m.shellW - m.viewportW) <= 1 && m.shellLeft === 0,
      `${m.shellW}px of ${m.viewportW}px, left edge at ${m.shellLeft}`,
    );
    check(
      `${at}: a table too wide to fit can be swiped`,
      m.unscrollable.length === 0,
      m.unscrollable.join("; "),
    );

    for (const c of m.charts) {
      check(
        `${at}: "${c.panel}" (${c.kind}) type is legible`,
        c.minType >= TYPE_MIN && c.maxType <= TYPE_MAX + 6,
        `${c.boxW}px box / ${c.viewW} viewBox = x${c.scale}, type ${c.minType}–${c.maxType}px`,
      );
    }

    if (SHOT) await page.screenshot({ path: `${OUT}/${f.name}-${tab}.png` });
  }

  // Header behaviour and hit targets are properties of the SHELL, so they are
  // checked once per framing rather than once per tab.
  const m = await measure(page);
  check(
    `${f.name}: the header is ${f.sticky ? "sticky" : "not sticky"}`,
    m.headSticky === f.sticky,
    `position is ${m.headSticky ? "sticky" : "static"}, header is ${m.headH}px of ${f.height}px`,
  );
  // A sticky header that has eaten a third of the screen is worse than none.
  if (f.sticky) {
    check(
      `${f.name}: the sticky header stays out of the way`,
      m.headH <= f.height * 0.2,
      `${m.headH}px of ${f.height}px`,
    );
  }
  const small = m.smallTargets.filter((t) => t.h < TOUCH_MIN);
  check(
    `${f.name}: every tab and toolbar button is hittable`,
    small.length === 0,
    small
      .slice(0, 3)
      .map((t) => `${t.sel} is ${t.h}px`)
      .join("; "),
  );
  check(`${f.name}: no script errors`, errors.length === 0, errors.slice(0, 2).join("; "));

  await ctx.close();
}

async function main(): Promise<void> {
  let server: ChildProcess | undefined;
  if (!(await serverUp())) {
    console.log("starting the admin dev server…");
    server = spawn("npm", ["run", "dev:admin"], { shell: true, stdio: "ignore" });
    for (let i = 0; i < 80 && !(await serverUp()); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await serverUp())) {
      console.error("could not start the dev server on " + BASE);
      process.exit(1);
    }
  }

  if (SHOT) mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const f of FRAMINGS) await run(browser, f);
  } finally {
    await browser.close();
    server?.kill();
  }

  console.log("\n" + "-".repeat(60));
  console.log(`ADMIN LAYOUT: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void main();
