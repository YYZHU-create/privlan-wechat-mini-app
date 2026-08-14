const path = require("node:path");
const { createPostgresDatabase } = require("./database");
const { createLegacyBackup, importLegacyPrivlan } = require("./legacy-migration");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const root = path.resolve(process.env.PRIVLAN_ROOT || path.join(__dirname, ".."));
  const backupRoot = path.resolve(process.env.PRIVLAN_MIGRATION_BACKUP_ROOT || path.join(root, "..", "privlan-migration-backups"));
  const dataRoot = path.resolve(process.env.ATELIER_DATA_ROOT || path.join(__dirname, "data"));
  const backup = createLegacyBackup({ root, backupRoot });
  const db = await createPostgresDatabase(process.env.DATABASE_URL, { migrate: true });
  try {
    const result = await importLegacyPrivlan({ db, root, backup, dataRoot, ownerLogin: process.env.PRIVLAN_LEGACY_OWNER_LOGIN, ownerPassword: process.env.PRIVLAN_LEGACY_OWNER_PASSWORD });
    console.log(JSON.stringify({ ok: true, backupPath: backup.path, ...result }, null, 2));
  } finally { await db.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
