const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, "../platform/migrations");

function normalizeMigrationSql(sql) {
  return String(sql).replace(/\r\n?/g, "\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  return fs.readdirSync(migrationsDir)
    .filter(name => /^\d+_[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function buildMigrationManifest(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const migrations = listMigrationFiles(migrationsDir).map(file => {
    const normalized = normalizeMigrationSql(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    return { version: path.basename(file, ".sql"), file, sha256: sha256(normalized) };
  });
  return {
    format: 1,
    migrations,
    digest: sha256(JSON.stringify(migrations))
  };
}

function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function manifestsMatch(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function checkManifest(manifestPath, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const expected = buildMigrationManifest(migrationsDir);
  const actual = readManifest(manifestPath);
  return { ok: manifestsMatch(expected, actual), expected, actual };
}

function main(argv = process.argv.slice(2)) {
  const manifestPath = path.resolve(__dirname, "../docs/architecture/migration-manifest.json");
  if (argv.includes("--write")) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(buildMigrationManifest(), null, 2)}\n`);
    process.stdout.write(`MIGRATION_MANIFEST=WRITTEN ${manifestPath}\n`);
    return 0;
  }
  const result = checkManifest(manifestPath);
  process.stdout.write(`MIGRATION_MANIFEST=${result.ok ? "PASS" : "FAIL"}\n`);
  process.stdout.write(`MIGRATION_MANIFEST_DIGEST=${result.expected.digest}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { DEFAULT_MIGRATIONS_DIR, buildMigrationManifest, checkManifest, listMigrationFiles, manifestsMatch, normalizeMigrationSql, readManifest, sha256 };
