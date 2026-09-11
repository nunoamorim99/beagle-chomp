// OWNER: backend
//
// The migration runner. Applies every numbered .sql file in server/migrations/
// that hasn't been applied yet, in filename order, each in its own transaction.
//
// Runs automatically on container start (see the Dockerfile CMD) BEFORE the
// HTTP server binds, so a deploy can never serve traffic against a schema it
// doesn't expect. Also runnable by hand: `npm run migrate`.
//
// Deliberately tiny and dependency-free (no Prisma, no node-pg-migrate) —
// STACK.md §0: "Do not introduce tools, abstractions, or infrastructure beyond
// what is listed here." A folder of .sql files and a ledger table is enough.
//
// Rules for writing migrations:
//   - Never edit a migration that has already been applied anywhere. Add a new
//     one. The checksum guard below will refuse to run if you forget.
//   - Filenames are `NNN_description.sql`, zero-padded, applied in sort order.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

/** Locate migrations/ relative to this file, which sits in a different place
 *  depending on how it was started:
 *    dev  (tsx)      server/scripts/migrate.ts   → ../migrations
 *    prod (compiled) /app/dist/scripts/migrate.js → ../../migrations
 *  Migrations are .sql, so tsc doesn't copy them into dist/ — in the image they
 *  live at /app/migrations. Resolving both candidates keeps the same command
 *  working in either mode instead of hardcoding one and breaking the other. */
function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "migrations"), join(here, "..", "..", "migrations")];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  console.error(
    `[migrate] migrations directory not found. Looked in:\n` +
      candidates.map((c) => `  - ${c}`).join("\n"),
  );
  process.exit(1);
}

const MIGRATIONS_DIR = resolveMigrationsDir();

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
  /** The pre-2026-09-09 checksum: sha256 over the file's RAW bytes. Kept only
   *  so an existing ledger row can be recognised and healed — see below. */
  legacyChecksum: string;
}

/**
 * Checksum a migration by its CONTENT, not its encoding.
 *
 * Line endings are normalised first, and that is a fix rather than a nicety.
 * The checksum used to hash the raw file, so the SAME migration hashed
 * differently on a Windows checkout (CRLF, via core.autocrlf) than in the Docker
 * build (LF) — and the guard would then refuse to run with "contents have
 * changed" on a file nobody had touched. That is the worst kind of false alarm:
 * it fires on the honest case, teaches you to distrust the guard, and the guard
 * is the only thing standing between an edited migration and silent drift.
 *
 * Measured: 006 and 007 were applied from LF files, then a branch checkout
 * rewrote them as CRLF and the runner refused to start.
 */
function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n?/g, "\n")).digest("hex");
}

function loadMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
      return {
        name,
        sql,
        checksum: checksumOf(sql),
        legacyChecksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }

  const migrations = loadMigrations();
  if (migrations.length === 0) {
    console.log("[migrate] no migration files found — nothing to do");
    return;
  }

  const pool = new Pool({ connectionString, max: 1 });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await pool.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    let ran = 0;

    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.name);

      if (previousChecksum !== undefined) {
        // Already applied. Guard against someone editing a shipped migration:
        // the DB would silently no longer match the file, which is the kind of
        // drift that only surfaces months later on a fresh environment.
        // A ledger row written before checksums were normalised holds the raw
        // hash. If THAT matches, the file is unchanged and only the hashing
        // rule moved — heal the row rather than crying wolf. This is what keeps
        // the fix from turning every existing environment into a false alarm.
        if (
          previousChecksum !== migration.checksum &&
          previousChecksum === migration.legacyChecksum
        ) {
          await pool.query("UPDATE schema_migrations SET checksum = $2 WHERE name = $1", [
            migration.name,
            migration.checksum,
          ]);
          console.log(`[migrate] ${migration.name} checksum normalised (content unchanged)`);
          continue;
        }

        if (previousChecksum !== migration.checksum) {
          console.error(
            `[migrate] ${migration.name} has already been applied but its ` +
              `contents have changed.\n` +
              `          Applied migrations are immutable — add a new migration ` +
              `instead of editing this one.`,
          );
          process.exit(1);
        }
        continue;
      }

      // Each migration is its own transaction: a failure rolls back cleanly and
      // leaves the ledger untouched, so a fixed migration can simply re-run.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        console.log(`[migrate] applied ${migration.name}`);
        ran++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[migrate] FAILED on ${migration.name}:`, err);
        process.exit(1);
      } finally {
        client.release();
      }
    }

    console.log(
      ran === 0
        ? `[migrate] up to date (${migrations.length} migration(s) already applied)`
        : `[migrate] done — ${ran} migration(s) applied`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[migrate] unexpected error:", err);
  process.exit(1);
});
