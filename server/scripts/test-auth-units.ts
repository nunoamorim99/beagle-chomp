// OWNER: backend
//
// Headless unit tests for the auth primitives that need NO database:
// recovery-code generation/normalisation, token handling, and hashing.
//
// Run: npm run test:units   (in server/)
//
// The database-backed flows (single-use consumption, token revocation on
// password reset, delete-cascade) live in scripts/test-auth.ts, which needs a
// running Postgres. These two are split so this half can run anywhere, fast.
//
// Style follows the game's existing tsx test scripts (scripts/test-cosmetics.ts
// etc.): a tiny hand-rolled assert plus a failure counter, no test runner —
// CLAUDE.md and STACK.md §0 both say don't add tooling we don't need.

import { Hono } from "hono";
import { requireAdmin, type AdminVars } from "../src/http/admin-middleware.js";
import { ApiError } from "../src/http/errors.js";
import type { UserRow } from "../src/repo/types.js";
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "../src/auth/recoveryCode.js";
import {
  generateToken,
  hashToken,
  parseBearerHeader,
  expiryFromNow,
} from "../src/auth/tokens.js";
import { hashSecret, verifySecret, verifyDummy } from "../src/auth/hash.js";

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

async function main(): Promise<void> {
  // --- recovery code format -------------------------------------------------
  section("Recovery code — format");

  const code = generateRecoveryCode();
  console.log(`  (sample: ${code})`);

  ok(
    "matches BEAGLE-XXXX-XXXX-XXXX",
    /^BEAGLE-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(code),
    code,
  );
  ok("no ambiguous I/L/O/U anywhere", !/[ILOU]/.test(code.replace(/^BEAGLE/, "")), code);

  // --- uniqueness / entropy -------------------------------------------------
  section("Recovery code — entropy");

  const seen = new Set<string>();
  const N = 20_000;
  for (let i = 0; i < N; i++) seen.add(generateRecoveryCode());
  ok(`${N} generated codes are all distinct`, seen.size === N, `got ${seen.size}`);

  // Every alphabet symbol should show up across a large sample; a generator
  // stuck on a subset would still look random at a glance.
  const chars = new Set([...seen].join("").replace(/BEAGLE|-/g, ""));
  ok("uses the full 32-symbol alphabet", chars.size === 32, `saw ${chars.size} symbols`);

  // --- normalisation: accept what a human would actually type ---------------
  section("Recovery code — normalisation accepts real-world input");

  const variants: Array<[string, string]> = [
    ["exact", code],
    ["lowercase", code.toLowerCase()],
    ["spaces instead of dashes", code.replace(/-/g, " ")],
    ["no separators at all", code.replace(/-/g, "")],
    ["prefix omitted", code.replace(/^BEAGLE-/, "")],
    ["surrounding whitespace", `  ${code}  `],
    ["mixed case + messy spacing", `  bEaGlE ${code.replace(/^BEAGLE-/, "").replace(/-/g, "  ")} `],
  ];
  for (const [label, input] of variants) {
    ok(label, normalizeRecoveryCode(input) === code, `${JSON.stringify(input)} → ${normalizeRecoveryCode(input)}`);
  }

  // O/I/L never appear in a generated code, so mapping them is unambiguous.
  ok(
    "maps lookalikes O→0, I→1, L→1",
    normalizeRecoveryCode("BEAGLE-OOOO-IIII-LLLL") === "BEAGLE-0000-1111-1111",
    normalizeRecoveryCode("BEAGLE-OOOO-IIII-LLLL"),
  );

  // --- normalisation: reject junk without a DB round-trip -------------------
  section("Recovery code — normalisation rejects invalid input");

  const rejects: Array<[string, string]> = [
    ["empty string", ""],
    ["too short", "BEAGLE-7K2M-9QX4-P3R"],
    ["too long", "BEAGLE-7K2M-9QX4-P3RTX"],
    ["free text", "please let me in"],
    ["prefix only", "BEAGLE-"],
  ];
  for (const [label, input] of rejects) {
    ok(label, normalizeRecoveryCode(input) === null, `${JSON.stringify(input)} → ${normalizeRecoveryCode(input)}`);
  }

  // --- tokens ---------------------------------------------------------------
  section("Bearer tokens");

  const t1 = generateToken();
  const t2 = generateToken();

  ok("plaintext is URL-safe base64", /^[A-Za-z0-9_-]+$/.test(t1.plaintext), t1.plaintext);
  ok("carries >=256 bits of entropy", t1.plaintext.length >= 43, `len ${t1.plaintext.length}`);
  ok("two tokens differ", t1.plaintext !== t2.plaintext);
  ok("hash is 32 bytes (sha256)", t1.hash.length === 32, `${t1.hash.length} bytes`);
  ok("hashing is deterministic", hashToken(t1.plaintext).equals(t1.hash));
  ok("different tokens hash differently", !hashToken(t2.plaintext).equals(t1.hash));

  section("Authorization header parsing");

  ok("standard header", parseBearerHeader(`Bearer ${t1.plaintext}`) === t1.plaintext);
  ok("case-insensitive scheme", parseBearerHeader(`bearer ${t1.plaintext}`) === t1.plaintext);
  ok("extra whitespace tolerated", parseBearerHeader(`  Bearer   ${t1.plaintext}  `) === t1.plaintext);
  ok("missing header → null", parseBearerHeader(undefined) === null);
  ok("empty header → null", parseBearerHeader("") === null);
  ok("wrong scheme → null", parseBearerHeader(`Basic ${t1.plaintext}`) === null);
  ok("scheme with no token → null", parseBearerHeader("Bearer") === null);
  ok("raw token without scheme → null", parseBearerHeader(t1.plaintext) === null);

  section("Token expiry");

  const ttlDays = 90;
  const expiry = expiryFromNow(ttlDays);
  const expectedMs = ttlDays * 24 * 60 * 60 * 1000;
  const driftMs = Math.abs(expiry.getTime() - Date.now() - expectedMs);
  ok(`expiry is ~${ttlDays} days out`, driftMs < 2_000, `drift ${driftMs}ms`);
  ok("expiry is in the future", expiry.getTime() > Date.now());

  // --- hashing --------------------------------------------------------------
  section("Password hashing (argon2id)");

  const pw = "correct horse battery staple";
  const h = await hashSecret(pw);

  ok("produces an argon2id hash", h.startsWith("$argon2id$"), h.slice(0, 20));
  ok("correct password verifies", await verifySecret(h, pw));
  ok("wrong password rejected", !(await verifySecret(h, "wrong")));
  ok("empty password rejected", !(await verifySecret(h, "")));

  // Salted: the same input hashed twice must differ, or identical passwords
  // would be identifiable across accounts from a database dump alone.
  const h2 = await hashSecret(pw);
  ok("same input hashes differently (salted)", h !== h2);
  ok("both salted hashes still verify", await verifySecret(h2, pw));

  // A corrupt or hand-edited row must read as "wrong password", not blow up —
  // a 500 here would tell an attacker something unusual about the account.
  ok("garbage stored hash → false, no throw", !(await verifySecret("not-a-hash", pw)));
  ok("empty stored hash → false, no throw", !(await verifySecret("", pw)));

  // Guards the timing-attack defence on the unknown-user login branch.
  ok("verifyDummy always returns false", (await verifyDummy("anything")) === false);

  const dummyStart = Date.now();
  await verifyDummy("anything");
  const dummyMs = Date.now() - dummyStart;
  ok(
    "verifyDummy actually burns CPU (>5ms, so unknown-user isn't instant)",
    dummyMs > 5,
    `${dummyMs}ms`,
  );

  // --- requireAdmin (IDEA-051) ----------------------------------------------
  section("requireAdmin hides the portal rather than refusing it");

  // Driven through a real Hono app so the middleware is exercised the way a
  // request exercises it — and so this stays DB-free, requireAuth is skipped and
  // the user is set directly, which is exactly the state requireAuth leaves.
  {
    const app = new Hono<{ Variables: AdminVars }>();
    app.use("/secret", async (c, next) => {
      const flag = c.req.header("x-test-admin");
      if (flag !== "absent") {
        c.set("user", { is_admin: flag === "yes" } as unknown as UserRow);
      }
      await next();
    });
    app.use("/secret", requireAdmin);
    app.get("/secret", (c) => c.json({ ok: true }));
    app.onError((err, c) =>
      err instanceof ApiError ? c.json(err.toBody(), err.status) : c.json({ e: 1 }, 500),
    );

    const asAdmin = await app.request("/secret", { headers: { "x-test-admin": "yes" } });
    ok("an admin passes through", asAdmin.status === 200, asAdmin.status);

    const asPlayer = await app.request("/secret", { headers: { "x-test-admin": "no" } });
    // 404, NOT 403. A 403 confirms the endpoint is real and worth attacking,
    // which hands a map of the admin surface to anyone with a game account.
    ok("a normal player gets 404, not 403", asPlayer.status === 404, asPlayer.status);
    const body = (await asPlayer.json()) as { error?: { code?: string } };
    ok("…with the ordinary not-found code", body.error?.code === "NOT_FOUND", JSON.stringify(body));

    // The failure that actually shipped: is_admin absent from the row because a
    // SELECT forgot it. `undefined` must read as "not an admin", never as
    // "unknown, allow".
    const missingFlag = await app.request("/secret", { headers: { "x-test-admin": "missing" } });
    ok("an absent is_admin is refused", missingFlag.status === 404, missingFlag.status);

    const noUser = await app.request("/secret", { headers: { "x-test-admin": "absent" } });
    ok("no user on the context is refused", noUser.status === 404, noUser.status);
  }

  // --- summary --------------------------------------------------------------
  console.log(`\n${"-".repeat(60)}`);
  console.log(`AUTH UNITS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("test-auth-units crashed:", err);
  process.exit(1);
});
