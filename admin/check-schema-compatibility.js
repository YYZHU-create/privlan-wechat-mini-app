// Deprecated compatibility entry point. This checker validates migration history only.
const checker = require("./check-migration-compatibility");
if (require.main === module) void (async () => {
  try {
    const result = await checker.checkMigrationHistoryCompatibility({ connectionString: process.env.DATABASE_URL });
    process.stdout.write(`MIGRATION_HISTORY_COMPATIBILITY=${result.ok ? "PASS" : "FAIL"}\nEXPECTED_MIGRATION_DIGEST=${result.expectedDigest}\nMISSING_MIGRATIONS=${result.missing.length}\nUNEXPECTED_MIGRATIONS=${result.unexpected.length}\nFULL_SCHEMA_COMPATIBILITY=NOT_VERIFIED\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch { process.stderr.write("MIGRATION_HISTORY_COMPATIBILITY=ERROR\nFULL_SCHEMA_COMPATIBILITY=NOT_VERIFIED\n"); process.exitCode = 2; }
})();
module.exports = { ...checker, checkSchemaCompatibility: checker.checkMigrationHistoryCompatibility };
