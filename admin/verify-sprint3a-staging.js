const fs = require("node:fs");
const path = require("node:path");
const { createPostgresDatabase, applyMigration } = require("./database");

const migrationName = "008_workflow_runtime";
const migrationPath = path.resolve(__dirname, "../platform/migrations/008_workflow_runtime.sql");
const protectedTables = ["users", "memberships", "tenants", "workspaces", "merchant_sessions", "customers", "appointments", "staff_members"];

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

(async () => {
  const connectionString = required("ATELIER_REAL_POSTGRES_URL");
  const expectedDatabase = required("ATELIER_DATABASE_LABEL");
  const db = await createPostgresDatabase(connectionString, { max: 1 });
  try {
    const identity = (await db.query("select current_database() database,current_user current_user")).rows[0];
    if (identity.database !== expectedDatabase) throw new Error(`DATABASE_IDENTITY_MISMATCH:${identity.database}`);
    console.log(`DATABASE_IDENTITY_MATCH=PASS database=${identity.database} current_user=${identity.current_user}`);

    const before = {};
    for (const table of protectedTables) before[table] = Number((await db.query(`select count(*)::bigint count from ${table}`)).rows[0].count);
    const migration = await db.query("select version from schema_migrations where version=$1", [migrationName]);
    let appliedNow = false;
    if (!migration.rows[0]) {
      await applyMigration(db, migrationName, fs.readFileSync(migrationPath, "utf8"));
      appliedNow = true;
    }
    const applied = await db.query("select version from schema_migrations where version=$1", [migrationName]);
    if (!applied.rows[0]) throw new Error("MIGRATION_NOT_APPLIED");
    console.log(`MIGRATION_APPLIED=PASS version=008_workflow_runtime state=${appliedNow ? "applied_now" : "already_applied"}`);
    const structure = (await db.query(`select
      to_regclass('public.workflow_instances_idempotency_idx') is not null idempotency_index,
      exists(select 1 from pg_trigger where tgname='workflow_versions_immutable_trigger' and not tgisinternal) immutable_trigger,
      (select count(*)::int from pg_constraint where conrelid='workflow_instances'::regclass and contype='f') >= 2 instance_scope_constraints,
      (select count(*)::int from pg_constraint where conrelid='workflow_events'::regclass and contype='f') >= 3 event_scope_constraints`)).rows[0];
    if (!structure.idempotency_index || !structure.immutable_trigger || !structure.instance_scope_constraints || !structure.event_scope_constraints) throw new Error(`MIGRATION_STRUCTURE_INVALID:${JSON.stringify(structure)}`);
    console.log("MIGRATION_STRUCTURE=PASS");

    const after = {};
    for (const table of protectedTables) after[table] = Number((await db.query(`select count(*)::bigint count from ${table}`)).rows[0].count);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`DATA_COUNTS_CHANGED:${JSON.stringify({ before, after })}`);
    console.log(`DATA_COUNTS_STABLE=PASS counts=${JSON.stringify(after)}`);
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
