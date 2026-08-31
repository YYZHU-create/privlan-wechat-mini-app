const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { createTargetClient, dataFingerprint, migrateSnapshot, readSourceSnapshot, readTargetSnapshot } = require("./meoo-data-rehearsal");

const SOURCE_EXPECTED = Object.freeze({
  database: "atelier_os_staging",
  postgresVersion: "16.15",
  latestMigration: "010_workflow_event_contract_immutability",
  schemaDigest: "d724ac5f0e4e7e67229a27ee7aa9b8d5"
});
const CORE_MIGRATIONS = Object.freeze([
  "001_saas_mvp.sql", "002_workspace_resources.sql", "003_appointments.sql", "004_appointment_rule_controls.sql", "005_customer_identity_membership.sql",
  "006_product_completeness_uat.sql", "007_operation_engine_foundation.sql", "008_workflow_runtime.sql", "009_workflow_integration.sql", "010_workflow_event_contract_immutability.sql"
]);
const PROVIDER_MIGRATIONS = Object.freeze([
  "001_appointment_transaction_rpc.sql", "002_lock_down_core_data_access.sql", "003_visible_write_paths.sql"
]);

function cutoverError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseDotEnv(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) throw cutoverError("CUTOVER_SOURCE_SECRET_SYNTAX_INVALID");
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function loadControlledSourceConnection(sourceEnvPath) {
  const file = path.resolve(String(sourceEnvPath || ""));
  if (!file || path.basename(file).toLowerCase() === "runtime-secrets.json") throw cutoverError("CUTOVER_SOURCE_SECRET_REJECTED");
  if (!fs.existsSync(file)) throw cutoverError("CUTOVER_SOURCE_SECRET_MISSING");
  const values = parseDotEnv(fs.readFileSync(file, "utf8"));
  const connectionString = String(values.ATELIER_REAL_POSTGRES_URL || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw cutoverError("CUTOVER_SOURCE_SECRET_VALUE_INVALID");
  return connectionString;
}

function loadImportPolicy(policyPath) {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(policyPath), "utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.policies || typeof parsed.policies !== "object") throw cutoverError("CUTOVER_IMPORT_POLICY_INVALID");
  return parsed;
}

function sourceDigestSql(root) {
  return fs.readFileSync(path.join(root, "core-digest.sql"), "utf8");
}

async function readCanonicalSourceIdentity({ connectionString, root = path.resolve(__dirname, ".."), clientFactory = options => new Client(options) } = {}) {
  if (!/^postgres(?:ql)?:\/\//i.test(String(connectionString || ""))) throw cutoverError("CUTOVER_SOURCE_CONNECTION_REQUIRED");
  const client = clientFactory({ connectionString, application_name: "atelier-meoo-staging-cutover-preflight", options: "-c default_transaction_read_only=on" });
  try {
    await client.connect();
    await client.query("begin isolation level repeatable read read only");
    const identity = (await client.query("select current_database() database,current_setting('server_version') postgres_version")).rows[0] || {};
    const migrations = (await client.query("select version from schema_migrations order by version")).rows.map(row => String(row.version));
    const digest = (await client.query(sourceDigestSql(root))).rows[0] || {};
    await client.query("rollback");
    const actual = {
      database: String(identity.database || ""),
      postgresVersion: String(identity.postgres_version || ""),
      latestMigration: migrations.at(-1) || "",
      schemaDigest: String(digest.core_schema_digest || ""),
      migration011Applied: migrations.some(value => /^011(?:_|$)/.test(value))
    };
    if (actual.database !== SOURCE_EXPECTED.database) throw cutoverError("CUTOVER_SOURCE_DATABASE_IDENTITY_MISMATCH");
    if (actual.postgresVersion !== SOURCE_EXPECTED.postgresVersion) throw cutoverError("CUTOVER_SOURCE_POSTGRES_VERSION_MISMATCH");
    if (actual.latestMigration !== SOURCE_EXPECTED.latestMigration) throw cutoverError("CUTOVER_SOURCE_MIGRATION_STATE_MISMATCH");
    if (actual.schemaDigest !== SOURCE_EXPECTED.schemaDigest) throw cutoverError("CUTOVER_SOURCE_SCHEMA_DIGEST_MISMATCH");
    if (actual.migration011Applied) throw cutoverError("CUTOVER_SOURCE_MIGRATION_011_PRESENT");
    return actual;
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyTargetBaseline({ target, policy }) {
  if (!target || typeof target.request !== "function") throw cutoverError("CUTOVER_TARGET_CLIENT_REQUIRED");
  const mismatches = [];
  for (const [table, rule] of Object.entries(policy.policies)) {
    const expected = Number(rule.targetPreexistingRows || 0);
    const rows = await target.request(table, { query: "?select=*&limit=101" });
    if (!Array.isArray(rows) || rows.length !== expected) mismatches.push(table);
  }
  if (mismatches.length) throw cutoverError("CUTOVER_TARGET_BASELINE_MISMATCH");
  return { tablesChecked: Object.keys(policy.policies).length };
}

async function verifyTargetCoreMigrations({ target }) {
  const rows = await target.request("schema_migrations", { query: "?select=version&order=version.asc" });
  const versions = new Set(rows.map(row => String(row.version)));
  const expected = CORE_MIGRATIONS.map(file => file.replace(/\.sql$/, ""));
  if (expected.some(version => !versions.has(version))) throw cutoverError("CUTOVER_TARGET_CORE_MIGRATION_MISMATCH");
  if ([...versions].some(version => /^011(?:_|$)/.test(version))) throw cutoverError("CUTOVER_TARGET_MIGRATION_011_PRESENT");
  return { coreMigrations: expected.length };
}

async function verifyPublicDataPlaneLockdown({ fetchImpl = globalThis.fetch, url, anonKey, serviceTarget }) {
  const baseUrl = String(url || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl) || !String(anonKey || "").trim() || typeof fetchImpl !== "function") throw cutoverError("CUTOVER_PUBLIC_LOCKDOWN_CONFIG_REQUIRED");
  const denied = async (pathname, options = {}) => {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      method: options.method || "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: options.body
    });
    if (![401, 403].includes(response.status)) throw cutoverError("CUTOVER_PUBLIC_DATA_PLANE_EXPOSED");
  };
  await denied("/rest/v1/customers?select=id&limit=1");
  await denied("/rest/v1/rpc/atelier_customer_add_note", { method: "POST", body: "{}" });
  if (!serviceTarget || typeof serviceTarget.request !== "function") throw cutoverError("CUTOVER_SERVICE_ROLE_REQUIRED");
  await serviceTarget.request("schema_migrations", { query: "?select=version&limit=1" });
  return { anonCoreRead: "DENIED", anonProviderRpcExecute: "DENIED", serviceRoleAccess: "ALLOWED" };
}

function verifyMigrationFidelity({ sourceSnapshot, targetSnapshot }) {
  const source = dataFingerprint(sourceSnapshot);
  const target = dataFingerprint(targetSnapshot);
  for (const key of ["criticalDigest", "stableIdDigest", "passwordHashDigest", "relationshipDigest"]) {
    if (source[key] !== target[key]) throw cutoverError("CUTOVER_DATA_FIDELITY_MISMATCH");
  }
  const sourceTables = Object.keys(source.tableDigests).sort();
  const targetTables = Object.keys(target.tableDigests).sort();
  if (JSON.stringify(sourceTables) !== JSON.stringify(targetTables)) throw cutoverError("CUTOVER_DATA_FIDELITY_MISMATCH");
  for (const table of sourceTables) if (source.tableDigests[table] !== target.tableDigests[table]) throw cutoverError("CUTOVER_DATA_FIDELITY_MISMATCH");
  return { criticalDigest: source.criticalDigest, stableIdDigest: source.stableIdDigest, passwordHashDigest: source.passwordHashDigest, relationshipDigest: source.relationshipDigest };
}

function assertExecutionBarrier(env = process.env) {
  if (env.ATELIER_CUTOVER_WRITE_FREEZE_CONFIRMED !== "1") throw cutoverError("CUTOVER_WRITE_FREEZE_NOT_CONFIRMED");
  if (env.ATELIER_CUTOVER_AUTHORITATIVE_WRITES !== "blocked") throw cutoverError("CUTOVER_AUTHORITATIVE_WRITE_BARRIER_REQUIRED");
  if (env.ATELIER_CUTOVER_REAL_DATA_MIGRATION_APPROVED !== "1") throw cutoverError("CUTOVER_REAL_DATA_MIGRATION_NOT_APPROVED");
}

function targetMigrationFiles(root) {
  return [
    ...CORE_MIGRATIONS.map(file => path.join(root, "platform", "migrations", file)),
    ...PROVIDER_MIGRATIONS.map(file => path.join(root, "platform", "provider-migrations", "meoo", file))
  ];
}

function applyTargetMigrations({ root = path.resolve(__dirname, ".."), targetProjectId, env = process.env, run = spawnSync } = {}) {
  if (env.ATELIER_CUTOVER_TARGET_BUILD_APPROVED !== "1") throw cutoverError("CUTOVER_TARGET_BUILD_NOT_APPROVED");
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(String(targetProjectId || ""))) throw cutoverError("CUTOVER_TARGET_PROJECT_INVALID");
  const applied = [];
  for (const file of targetMigrationFiles(root)) {
    if (!fs.existsSync(file)) throw cutoverError("CUTOVER_MIGRATION_FILE_MISSING");
    const result = run("meoo", ["db", "query", "--project", targetProjectId, "--file", file], { cwd: root, encoding: "utf8", windowsHide: true });
    if (!result || result.status !== 0) throw cutoverError("CUTOVER_TARGET_MIGRATION_APPLY_FAILED");
    applied.push(path.basename(file));
  }
  return { applied };
}

function writeReceipt(root, name, body) {
  const directory = path.join(root, ".cutover-artifacts");
  fs.mkdirSync(directory, { recursive: true });
  const receipt = { schemaVersion: 1, name, createdAt: new Date().toISOString(), ...body };
  fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}

function parseArgs(argv) {
  const result = { mode: "preflight", targetProjectId: "", sourceEnvPath: "", policyPath: "" };
  for (const value of argv) {
    if (value === "--preflight") result.mode = "preflight";
    else if (value === "--dry-run") result.mode = "dry-run";
    else if (value === "--apply-target-schema") result.mode = "apply-target-schema";
    else if (value === "--migrate") result.mode = "migrate";
    else if (value.startsWith("--target-project=")) result.targetProjectId = value.slice("--target-project=".length);
    else if (value.startsWith("--source-env=")) result.sourceEnvPath = value.slice("--source-env=".length);
    else if (value.startsWith("--policy=")) result.policyPath = value.slice("--policy=".length);
    else throw cutoverError("CUTOVER_ARGUMENT_INVALID");
  }
  return result;
}

async function runCli({ argv = process.argv.slice(2), env = process.env, root = path.resolve(__dirname, "..") } = {}) {
  const args = parseArgs(argv);
  const sourceConnection = args.sourceEnvPath ? loadControlledSourceConnection(args.sourceEnvPath) : String(env.ATELIER_REAL_POSTGRES_URL || "");
  if (args.mode === "apply-target-schema") {
    const result = applyTargetMigrations({ root, targetProjectId: args.targetProjectId, env });
    writeReceipt(root, "target-migrations", { targetProjectId: args.targetProjectId, applied: result.applied });
    console.log(`TARGET_MIGRATIONS_APPLIED=${result.applied.length}`);
    return result;
  }
  const source = await readCanonicalSourceIdentity({ connectionString: sourceConnection, root });
  const policyPath = args.policyPath || path.join(root, "verification", "meoo-b1-real-staging-data-rehearsal", "import-policy.json");
  const policy = loadImportPolicy(policyPath);
  const serviceTarget = createTargetClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const core = await verifyTargetCoreMigrations({ target: serviceTarget });
  const baseline = await verifyTargetBaseline({ target: serviceTarget, policy });
  const lockdown = await verifyPublicDataPlaneLockdown({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, serviceTarget });
  if (args.mode === "migrate") {
    assertExecutionBarrier(env);
    const extracted = await readSourceSnapshot({ connectionString: sourceConnection });
    await migrateSnapshot(extracted.snapshot, serviceTarget, { policy: policy.policies });
    const targetSnapshot = await readTargetSnapshot(extracted.snapshot, serviceTarget);
    const fidelity = verifyMigrationFidelity({ sourceSnapshot: extracted.snapshot, targetSnapshot });
    writeReceipt(root, "migration", { source, core, baseline, lockdown, fidelity });
    console.log("CUTOVER_MIGRATION=PASS");
    return { source, core, baseline, lockdown, fidelity };
  }
  writeReceipt(root, args.mode, { source, core, baseline, lockdown });
  console.log(`CUTOVER_${args.mode.toUpperCase()}=PASS`);
  return { source, core, baseline, lockdown };
}

if (require.main === module) {
  runCli().catch(error => {
    console.error(`CUTOVER_RESULT=FAIL code=${error.code || "CUTOVER_UNEXPECTED_ERROR"}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CORE_MIGRATIONS, PROVIDER_MIGRATIONS, SOURCE_EXPECTED, applyTargetMigrations, assertExecutionBarrier, loadControlledSourceConnection,
  loadImportPolicy, parseArgs, parseDotEnv, readCanonicalSourceIdentity, runCli, targetMigrationFiles, verifyMigrationFidelity,
  verifyPublicDataPlaneLockdown, verifyTargetBaseline, verifyTargetCoreMigrations, writeReceipt
};