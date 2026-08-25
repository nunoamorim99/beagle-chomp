// OWNER: backend
//
// Tests for the request-metrics recorder (IDEA-039 P1). Pure — no database, no
// network, no server socket — so it runs in `npm test` alongside the other fast
// suites. `npm run test:metrics`.
//
// Two of these sections exist because the assumption they pin was WRONG when
// first written, and only a probe caught it:
//
//   "route keys"  — `routePath(c, -1)` already returns the FULL mounted path.
//                   The first draft concatenated `baseRoutePath` in front of it
//                   and produced `/api/v1/api/v1/sessions/:id/finish`. Every
//                   route key in the log would have been doubled.
//   "status"      — Hono runs app-level onError INSIDE the middleware chain, so
//                   `next()` never rethrows and `c.res.status` is the true final
//                   status. Deriving status from a caught error would have
//                   filed every ApiError 404/409 as a 5xx.
//
// Both are exactly the kind of framework behaviour that changes quietly on a
// minor upgrade, which is why they are asserted here rather than trusted.

import { Hono } from "hono";
import {
  recordRequest,
  countSlowRequest,
  percentile,
  snapshot,
  resetWindow,
  formatSnapshotLines,
  __resetMetrics,
  OVERFLOW_KEY,
  UNMATCHED_KEY,
} from "../src/http/metrics.js";
import { metricsMiddleware } from "../src/http/metrics-middleware.js";

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

function section(title: string): void {
  console.log(`\n${title}`);
}

const routeNamed = (name: string) =>
  snapshot().routes.find((r) => r.route === name);

function floats(values: number[]): Float64Array {
  return Float64Array.from(values);
}

// --- percentile maths --------------------------------------------------------

section("Percentile (nearest-rank)");
{
  // 1..100: nearest-rank p95 is the 95th value, p50 the 50th. An INTERPOLATED
  // p95 would give 95.05 here — the point of nearest-rank is that every number
  // reported is a duration some request actually took.
  const hundred = floats(Array.from({ length: 100 }, (_, i) => i + 1));
  ok("p95 of 1..100 is 95", percentile(hundred.slice(), 100, 0.95) === 95);
  ok("p50 of 1..100 is 50", percentile(hundred.slice(), 100, 0.5) === 50);
  ok("p100 of 1..100 is 100", percentile(hundred.slice(), 100, 1) === 100);

  ok("empty sample set is 0, not NaN", percentile(floats([]), 0, 0.95) === 0);
  ok("single sample is itself", percentile(floats([7]), 1, 0.95) === 7);

  // Unsorted input must be sorted internally — durations arrive in arrival
  // order, never in size order.
  ok(
    "sorts before ranking",
    percentile(floats([90, 1, 50, 3, 12]), 5, 0.95) === 90,
    percentile(floats([90, 1, 50, 3, 12]), 5, 0.95),
  );

  // Float64Array.sort() is numeric; Array.prototype.sort() would be LEXICAL and
  // rank 9 above 100. Pinning it because the array type is what prevents that.
  ok(
    "orders numerically, not lexically",
    percentile(floats([9, 100, 20]), 3, 0.5) === 20,
    percentile(floats([9, 100, 20]), 3, 0.5),
  );

  // n smaller than the buffer must only consider the first n slots — this is
  // how a partially-filled ring is read.
  ok(
    "respects n over buffer length",
    percentile(floats([5, 5, 5, 9999]), 3, 1) === 5,
  );
}

// --- recording ---------------------------------------------------------------

section("Recording");
{
  __resetMetrics();
  recordRequest("GET /a", 200, 10);
  recordRequest("GET /a", 204, 30);
  recordRequest("GET /a", 404, 20);
  recordRequest("POST /b", 500, 5);

  const a = routeNamed("GET /a");
  const b = routeNamed("POST /b");

  ok("counts requests per route", a?.count === 3, a?.count);
  ok("keeps routes separate", b?.count === 1, b?.count);
  ok("max is the worst single request", a?.maxMs === 30, a?.maxMs);
  ok("mean is the average", a?.meanMs === 20, a?.meanMs);
  ok("2xx counted", a?.status2xx === 2, a?.status2xx);
  ok("4xx counted", a?.status4xx === 1, a?.status4xx);
  ok("5xx counted separately from 4xx", b?.status5xx === 1 && b?.status4xx === 0);
  ok("lifetime total counts every route", snapshot().lifetimeRequests === 4);

  // 3xx must not be silently filed as success — a redirect loop should be
  // visible as itself.
  __resetMetrics();
  recordRequest("GET /r", 302, 1);
  ok("3xx counted in its own class", routeNamed("GET /r")?.status3xx === 1);

  // Boundary statuses, since the classing is a chain of >=.
  __resetMetrics();
  for (const s of [199, 200, 299, 300, 399, 400, 499, 500, 599]) {
    recordRequest("GET /s", s, 1);
  }
  const s = routeNamed("GET /s");
  ok(
    "status boundaries class correctly",
    s?.status2xx === 3 && s?.status3xx === 2 && s?.status4xx === 2 && s?.status5xx === 2,
    JSON.stringify(s),
  );
}

// --- the ring ----------------------------------------------------------------

section("Ring buffer");
{
  __resetMetrics();
  // 600 samples into a 512-slot ring: the first 88 are overwritten. The COUNT
  // must still be 600 — losing samples for the percentile is by design, losing
  // the request tally would be a bug.
  for (let i = 0; i < 600; i++) recordRequest("GET /ring", 200, 1);
  const r = routeNamed("GET /ring");
  ok("count survives the wrap", r?.count === 600, r?.count);

  // An early outlier is evicted from the ring but must survive in maxMs —
  // otherwise the one request that took 9 seconds vanishes before anyone sees
  // it, which is the exact event metrics exist to catch.
  __resetMetrics();
  recordRequest("GET /outlier", 200, 9000);
  for (let i = 0; i < 512; i++) recordRequest("GET /outlier", 200, 1);
  const o = routeNamed("GET /outlier");
  ok("outlier evicted from the ring survives in max", o?.maxMs === 9000, o?.maxMs);
  ok("p95 reflects the recent window, not the evicted spike", o?.p95 === 1, o?.p95);
}

// --- cardinality guard -------------------------------------------------------

section("Cardinality guard");
{
  __resetMetrics();
  // Seed the overflow bucket first so it exists, then flood past the cap.
  recordRequest(OVERFLOW_KEY, 200, 1);
  for (let i = 0; i < 500; i++) recordRequest(`GET /route-${i}`, 200, 1);

  const routes = snapshot().routes;
  ok("distinct keys stay capped", routes.length <= 64, routes.length);
  ok(
    "overflow lands in the (other) bucket",
    (routes.find((r) => r.route === OVERFLOW_KEY)?.count ?? 0) > 1,
  );
  ok(
    "every request is still counted somewhere",
    snapshot().lifetimeRequests === 501,
    snapshot().lifetimeRequests,
  );
}

// --- window reset ------------------------------------------------------------

section("Window reset");
{
  __resetMetrics();
  recordRequest("GET /w", 200, 1);
  countSlowRequest();
  resetWindow();

  ok("routes clear on reset", snapshot().routes.length === 0);
  ok("lifetime request total survives a reset", snapshot().lifetimeRequests === 1);
  ok("lifetime slow total survives a reset", snapshot().lifetimeSlowRequests === 1);

  // An idle window must produce NO log lines. A table printed every ten
  // minutes forever is how a log stops being read.
  ok("idle window formats to nothing", formatSnapshotLines(snapshot()).length === 0);

  recordRequest("GET /w", 200, 1);
  ok("a busy window does format", formatSnapshotLines(snapshot()).length > 0);
}

// --- route keys (the regression that started this file) ----------------------

section("Route keys");
{
  // Mirrors the real mounting shape in index.ts, and the part that matters is
  // easy to leave out: TWO sub-apps are mounted at the SAME "/" prefix under
  // /api/v1, and each declares its own `use("*")` middleware stack. That is
  // what puts a foreign `ALL:/api/v1/*` entry AFTER the real handler in
  // matchedRoutes — and an earlier draft of routeKey took the last entry and
  // filed /api/v1/profile, the leaderboard and every login as "(unmatched)".
  // A single-sub-app test app passes that broken code happily.
  const app = new Hono();
  app.use("*", metricsMiddleware({ slowRequestMs: 10_000 }));
  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono();
  v1.get("/", (c) => c.json({ api: "beagle-chomp" }));

  const auth = new Hono();
  auth.post("/login", (c) => c.json({ in: true }));

  const profile = new Hono();
  profile.use("*", async (_c, next) => next()); // stands in for requireAuth
  profile.get("/profile", (c) => c.json({ profile: {} }));
  profile.get("/leaderboard", (c) => c.json({ top: [] }));

  const sessions = new Hono();
  sessions.use("*", async (_c, next) => next()); // stands in for requireAuth
  sessions.post("/sessions", (c) => c.json({ made: true }));
  sessions.post("/sessions/:id/finish", (c) => c.json({ done: true }));

  v1.route("/auth", auth);
  v1.route("/", profile);
  v1.route("/", sessions);
  app.route("/api/v1", v1);
  app.notFound((c) => c.json({ error: "nf" }, 404));
  app.onError((_e, c) => c.json({ error: "boom" }, 500));

  app.get("/throws", () => {
    throw new Error("deliberate");
  });

  __resetMetrics();
  const call = (method: string, path: string) =>
    app.request(`http://test${path}`, { method });

  await call("GET", "/health");
  await call("GET", "/api/v1");
  await call("POST", "/api/v1/auth/login");
  await call("GET", "/api/v1/profile");
  await call("GET", "/api/v1/leaderboard");
  await call("POST", "/api/v1/sessions");
  await call("POST", "/api/v1/sessions/2b0f4c1e-dead-beef-0000-000000000001/finish");

  const keys = snapshot().routes.map((r) => r.route);

  ok("health keys as itself", keys.includes("GET /health"), keys);
  ok("mount root keys as /api/v1", keys.includes("GET /api/v1"), keys);
  ok("nested mount is not doubled", keys.includes("POST /api/v1/auth/login"), keys);
  ok("sub-app route keeps its mount prefix", keys.includes("POST /api/v1/sessions"), keys);

  // The four that a `.at(-1)` implementation gets wrong. Each sits BEFORE a
  // sibling sub-app's wildcard in matchedRoutes.
  ok("route behind an auth stack keys correctly", keys.includes("GET /api/v1/profile"), keys);
  ok("leaderboard keys correctly", keys.includes("GET /api/v1/leaderboard"), keys);
  ok(
    "no real route is filed as unmatched",
    !keys.includes(`GET ${UNMATCHED_KEY}`) && !keys.includes(`POST ${UNMATCHED_KEY}`),
    keys,
  );
  ok(
    "every request that hit a route got its own key",
    snapshot().routes.length === 7,
    keys,
  );

  // THE one that matters: the uuid must never reach the key, or the metrics
  // table grows one row per run played and the cardinality guard is all that
  // stands between us and a slow leak.
  ok(
    "path params collapse to the pattern",
    keys.includes("POST /api/v1/sessions/:id/finish"),
    keys,
  );
  ok(
    "no key contains a raw uuid",
    keys.every((k) => !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(k)),
    keys,
  );
  ok(
    "no key doubles the /api/v1 prefix",
    keys.every((k) => !k.includes("/api/v1/api/v1")),
    keys,
  );

  // 404s from scanners must share one bucket rather than minting a key each.
  __resetMetrics();
  await call("GET", "/wp-admin/setup-config.php");
  await call("GET", "/.env");
  await call("GET", "/api/v1/nope");
  const nf = snapshot().routes;
  ok("unmatched paths share one bucket", nf.length === 1, nf.map((r) => r.route));
  ok(
    "that bucket is the unmatched sentinel",
    nf[0]?.route === `GET ${UNMATCHED_KEY}`,
    nf[0]?.route,
  );
  ok("unmatched requests count as 4xx", nf[0]?.status4xx === 3, nf[0]?.status4xx);
}

// --- status through the middleware ------------------------------------------

section("Status via middleware");
{
  const app = new Hono();
  app.use("*", metricsMiddleware({ slowRequestMs: 10_000 }));
  app.get("/ok", (c) => c.json({}, 201));
  app.get("/conflict", (c) => c.json({}, 409));
  app.get("/throws", () => {
    throw new Error("deliberate");
  });
  app.onError((_e, c) => c.json({ error: "boom" }, 500));

  __resetMetrics();
  await app.request("http://test/ok");
  await app.request("http://test/conflict");
  await app.request("http://test/throws");

  ok("2xx recorded from the real response", routeNamed("GET /ok")?.status2xx === 1);
  ok("4xx recorded as 4xx", routeNamed("GET /conflict")?.status4xx === 1);
  // If this ever fails, onError stopped running inside the chain and the
  // middleware needs to derive the status from a caught error again.
  ok(
    "a thrown error is measured as a 5xx",
    routeNamed("GET /throws")?.status5xx === 1,
    JSON.stringify(routeNamed("GET /throws")),
  );
  ok("an erroring route is still timed", (routeNamed("GET /throws")?.count ?? 0) === 1);
}

// --- slow-request accounting -------------------------------------------------

section("Slow requests");
{
  const app = new Hono();
  app.use("*", metricsMiddleware({ slowRequestMs: 0 }));
  app.get("/slow", (c) => c.json({}));

  __resetMetrics();
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warns.push(args.join(" "));
  try {
    await app.request("http://test/slow");
  } finally {
    console.warn = realWarn;
  }

  ok("a slow request warns immediately", warns.length === 1, warns);
  ok("the warning names the route pattern", warns[0]?.includes("GET /slow"), warns[0]);
  ok("the slow tally increments", snapshot().lifetimeSlowRequests === 1);

  // A fast request must NOT warn — a threshold that fires on everything is the
  // same as no threshold.
  const quiet = new Hono();
  quiet.use("*", metricsMiddleware({ slowRequestMs: 60_000 }));
  quiet.get("/fast", (c) => c.json({}));
  __resetMetrics();
  const warns2: string[] = [];
  console.warn = (...args: unknown[]) => void warns2.push(args.join(" "));
  try {
    await quiet.request("http://test/fast");
  } finally {
    console.warn = realWarn;
  }
  ok("a fast request stays silent", warns2.length === 0, warns2);
}

// --- log formatting ----------------------------------------------------------

section("Log formatting");
{
  __resetMetrics();
  recordRequest("GET /api/v1/leaderboard", 200, 12);
  recordRequest("POST /api/v1/auth/login", 200, 340);
  recordRequest("POST /api/v1/auth/login", 401, 310);

  const lines = formatSnapshotLines(snapshot());
  ok("a header plus one line per route", lines.length === 4, lines.length);
  ok("every line is log-prefixed", lines.every((l) => l.startsWith("[metrics] ")));
  ok(
    "busiest route sorts first",
    lines[2]?.includes("/api/v1/auth/login"),
    lines[2],
  );
  ok("route names survive formatting", lines.join("\n").includes("/api/v1/leaderboard"));

  // A pathological route name must not blow the column layout apart.
  __resetMetrics();
  recordRequest(`GET /${"x".repeat(300)}`, 200, 1);
  const wide = formatSnapshotLines(snapshot());
  ok("absurd route names are truncated", wide.every((l) => l.length < 140), wide.map((l) => l.length));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`METRICS TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
