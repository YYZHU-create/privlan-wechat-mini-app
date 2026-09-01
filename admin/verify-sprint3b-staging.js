const fs = require("node:fs");
const path = require("node:path");
const { createPostgresDatabase, applyMigration } = require("./database");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

(async () => {
  const connectionString = required("ATELIER_REAL_POSTGRES_URL");
  const expectedDatabase = required("ATELIER_DATABASE_LABEL");
  const db = await createPostgresDatabase(connectionString, { max: 4 });
  const tables = ["users", "memberships", "tenants", "workspaces", "merchant_sessions", "customers", "appointments", "staff_members", "audit_events", "customer_events", "workflow_definitions", "workflow_versions", "workflow_instances", "workflow_tasks", "workflow_events"];
  try {
    const identity = (await db.query("select current_database() database,current_user current_user")).rows[0];
    if (identity.database !== expectedDatabase) throw new Error(`DATABASE_IDENTITY_MISMATCH:${identity.database}`);
    const before = {};
    for (const table of tables) before[table] = Number((await db.query(`select count(*)::bigint count from ${table}`)).rows[0].count);
    const migrationName = "010_workflow_event_contract_immutability";
    if (!(await db.query("select version from schema_migrations where version=$1", [migrationName])).rows[0]) {
      await applyMigration(db, migrationName, fs.readFileSync(path.resolve(__dirname, "../platform/migrations/010_workflow_event_contract_immutability.sql"), "utf8"));
    }
    if (!(await db.query("select version from schema_migrations where version=$1", [migrationName])).rows[0]) throw new Error("MIGRATION_NOT_APPLIED");
    const structure = (await db.query("select exists(select 1 from pg_trigger where tgname='customer_events_integration_contract_immutable_trigger' and not tgisinternal) trigger_exists, exists(select 1 from pg_proc where proname='customer_events_reject_integration_contract_mutation') function_exists")).rows[0];
    if (!structure.trigger_exists || !structure.function_exists) throw new Error(`MIGRATION_STRUCTURE_INVALID:${JSON.stringify(structure)}`);
    const after = {};
    for (const table of tables) after[table] = Number((await db.query(`select count(*)::bigint count from ${table}`)).rows[0].count);
    if (tables.some(table => before[table] !== after[table])) throw new Error(`DATA_COUNTS_CHANGED:${JSON.stringify({ before, after })}`);
    console.log(`DATABASE_IDENTITY_MATCH=PASS database=${identity.database} current_user=${identity.current_user}`);
    console.log("MIGRATION_010_APPLIED=PASS");
    console.log("MIGRATION_010_STRUCTURE=PASS");
    console.log("DATA_COUNTS_STABLE=PASS");
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
