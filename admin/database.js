const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.resolve(__dirname, "../platform/migrations");

function normalizeResult(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return { rows, rowCount: Number.isInteger(result?.rowCount) ? result.rowCount : Number(result?.affectedRows ?? rows.length) };
}

async function applyMigrations(client) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  await client.exec("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  for (const file of files) {
    const version = path.basename(file, ".sql");
    const existing = await client.query("select version from schema_migrations where version = $1", [version]);
    if (existing.rows.length) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await applyMigration(client, version, sql);
  }
}

function assertNoTransactionControl(version, sql) {
  if (/^\s*(?:begin|start\s+transaction|commit|rollback)\s*;/im.test(String(sql || ""))) {
    throw new Error(`Migration ${version} must not contain transaction control statements`);
  }
}

async function applyMigration(client, version, sql) {
  assertNoTransactionControl(version, sql);
  await client.transaction(async tx => {
    await tx.exec(sql);
    await tx.query("insert into schema_migrations(version) values($1)", [version]);
  });
}

function wrapPgQueryClient(client) {
  return {
    async query(sql, params = []) { return normalizeResult(await client.query(sql, params)); },
    async exec(sql) { return normalizeResult(await client.query(sql)); }
  };
}

async function createPostgresDatabase(connectionString, options = {}) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString, max: options.max || 10, application_name: "atelier-os" });
  const db = {
    kind: "postgres",
    async query(sql, params = []) { return normalizeResult(await pool.query(sql, params)); },
    async exec(sql) { return normalizeResult(await pool.query(sql)); },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrapPgQueryClient(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
    async health() { await pool.query("select 1"); return true; }
  };
  if (options.migrate) await applyMigrations(db);
  return db;
}

async function createPortableTestDatabase(options = {}) {
  if (process.env.NODE_ENV !== "test") throw new Error("Portable PostgreSQL is restricted to NODE_ENV=test");
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite(options.loadDataDir ? { loadDataDir: options.loadDataDir } : undefined);
  const wrap = current => ({
    async query(sql, params = []) { return normalizeResult(await current.query(sql, params)); },
    async exec(sql) { return normalizeResult(await current.exec(sql)); }
  });
  const db = {
    kind: "pglite-test",
    ...wrap(client),
    async transaction(fn) { return client.transaction(async tx => fn(wrap(tx))); },
    async close() { await client.close(); },
    async health() { await client.query("select 1"); return true; },
    async dumpDataDir() { return client.dumpDataDir("gzip"); }
  };
  await applyMigrations(db);
  return db;
}

async function createDatabaseFromEnv() {
  if (process.env.DATABASE_URL) return createPostgresDatabase(process.env.DATABASE_URL, { migrate: process.env.ATELIER_AUTO_MIGRATE === "1" });
  if (process.env.NODE_ENV === "test" && process.env.ATELIER_TEST_DATABASE === "portable") return createPortableTestDatabase();
  return null;
}

module.exports = { applyMigration, applyMigrations, assertNoTransactionControl, createPostgresDatabase, createPortableTestDatabase, createDatabaseFromEnv };
