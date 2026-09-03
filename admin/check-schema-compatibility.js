const path = require("node:path");
const { readManifest } = require("./migration-manifest");

const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, "../docs/architecture/migration-manifest.json");

function compareVersions(expectedVersions, observedVersions) {
  const expected = new Set(expectedVersions);
  const observed = new Set(observedVersions);
  return {
    missing: expectedVersions.filter(version => !observed.has(version)),
    unexpected: observedVersions.filter(version => !expected.has(version)),
    ok: expectedVersions.length === observedVersions.length && expectedVersions.every((version, index) => observedVersions[index] === version)
  };
}

async function checkSchemaCompatibility({ connectionString, manifestPath = DEFAULT_MANIFEST_PATH, createClient } = {}) {
  if (!String(connectionString || "").trim()) throw new Error("DATABASE_URL is required for a read-only schema compatibility check");
  const manifest = readManifest(manifestPath);
  const expectedVersions = manifest.migrations.map(item => item.version);
  const Client = createClient || require("pg").Client;
  const client = new Client({ connectionString, application_name: "feeldao-schema-compatibility-read-only", connectionTimeoutMillis: 10000 });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await client.query("SELECT version FROM schema_migrations ORDER BY version ASC");
    const observedVersions = (result.rows || []).map(row => String(row.version));
    const comparison = compareVersions(expectedVersions, observedVersions);
    await client.query("ROLLBACK");
    return { ...comparison, expectedDigest: manifest.digest, expectedCount: expectedVersions.length, observedCount: observedVersions.length };
  } catch (error) {
    if (connected) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

async function main() {
  try {
    const result = await checkSchemaCompatibility({ connectionString: process.env.DATABASE_URL });
    process.stdout.write(`SCHEMA_COMPATIBILITY=${result.ok ? "PASS" : "FAIL"}\n`);
    process.stdout.write(`EXPECTED_MIGRATION_DIGEST=${result.expectedDigest}\n`);
    process.stdout.write(`MISSING_MIGRATIONS=${result.missing.length}\n`);
    process.stdout.write(`UNEXPECTED_MIGRATIONS=${result.unexpected.length}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    process.stderr.write("SCHEMA_COMPATIBILITY=ERROR\n");
    process.exitCode = 2;
  }
}

if (require.main === module) void main();

module.exports = { DEFAULT_MANIFEST_PATH, checkSchemaCompatibility, compareVersions };
