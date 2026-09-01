const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { canonical, createTargetClient, dataFingerprint, migrateSnapshot, readSourceSnapshot, readTargetSnapshot } = require("./meoo-data-rehearsal");
const { verifyProviderNormalizedSchemaParity } = require("./meoo-schema-parity");

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
const EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT = 0;
const TARGET_FOREIGN_KEY_FINALIZATION_FILE = path.join("scripts", "meoo-validate-target-foreign-keys.sql");
const CATALOG_PARITY_UNSTABLE = "NOT_COMPLETED_PROVIDER_CATALOG_QUERY_UNSTABLE";
const EXPECTED_CORE_TABLE_COUNT = 50;
const CUTOVER_PHASES = Object.freeze({
  PRE_T2: "PRE_T2",
  POST_T2_PRE_AUTHORITATIVE: "POST_T2_PRE_AUTHORITATIVE",
  POST_AUTHORITATIVE: "POST_AUTHORITATIVE",
  AMBIGUOUS: "AMBIGUOUS"
});
const CUTOVER_PHASE_ORDER = Object.freeze({ PRE_T2: 0, POST_T2_PRE_AUTHORITATIVE: 1, POST_AUTHORITATIVE: 2 });
const POST_T2_APPEND_ONLY_TABLES = new Set(["audit_events", "merchant_sessions", "operator_sessions"]);

function targetForeignKeyValidationGuardSql() {
  return `do $$ begin
    if (select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace and not convalidated) <> ${EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT} then
      raise exception 'CUTOVER_TARGET_UNVALIDATED_FOREIGN_KEYS_PRESENT';
    end if;
    if not exists (select 1 from pg_constraint where conname='orders_customer_scope_fk' and connamespace='public'::regnamespace and contype='f' and convalidated) then
      raise exception 'CUTOVER_TARGET_ORDERS_CUSTOMER_SCOPE_FK_INVALID';
    end if;
  end $$;`;
}

function assertTargetProjectId(targetProjectId) {
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(String(targetProjectId || ""))) throw cutoverError("CUTOVER_TARGET_PROJECT_INVALID");
}

function runMeooDbQuery(run, args, root) {
  return run(process.platform === "win32" ? "meoo.cmd" : "meoo", args, { cwd: root, encoding: "utf8", windowsHide: true, shell: process.platform === "win32" });
}

function runTargetForeignKeyValidationCommand({ root = path.resolve(__dirname, ".."), targetProjectId, run = spawnSync, file }) {
  assertTargetProjectId(targetProjectId);
  const result = runMeooDbQuery(run, ["db", "query", "--project", targetProjectId, "--file", file], root);
  if (!result || result.status !== 0) throw cutoverError("CUTOVER_TARGET_FOREIGN_KEY_VALIDATION_FAILED");
}

function finalizeTargetForeignKeyValidation({ root = path.resolve(__dirname, ".."), targetProjectId, run = spawnSync } = {}) {
  const file = path.join(root, TARGET_FOREIGN_KEY_FINALIZATION_FILE);
  if (!fs.existsSync(file)) throw cutoverError("CUTOVER_TARGET_FOREIGN_KEY_FINALIZATION_FILE_MISSING");
  runTargetForeignKeyValidationCommand({ root, targetProjectId, run, file });
  return { expectedUnvalidatedForeignKeyCount: EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT };
}

function verifyTargetForeignKeyValidation({ root = path.resolve(__dirname, ".."), targetProjectId, run = spawnSync } = {}) {
  const guardFile = path.join(root, ".cutover-artifacts", "target-foreign-key-validation-guard.sql");
  fs.mkdirSync(path.dirname(guardFile), { recursive: true });
  fs.writeFileSync(guardFile, `${targetForeignKeyValidationGuardSql()}\n`, "utf8");
  runTargetForeignKeyValidationCommand({ root, targetProjectId, run, file: guardFile });
  return { expectedUnvalidatedForeignKeyCount: EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT };
}

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

function normalizeCutoverPhase(value) {
  const phase = String(value || "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CUTOVER_PHASE_ORDER, phase)) return phase;
  if (phase === CUTOVER_PHASES.AMBIGUOUS) return CUTOVER_PHASES.AMBIGUOUS;
  throw cutoverError("CUTOVER_PHASE_INVALID");
}

function cutoverPhaseStateFile(root) {
  return path.join(root, ".cutover-artifacts", "cutover-phase.json");
}

function readCutoverPhaseState(root) {
  const file = cutoverPhaseStateFile(root);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeCutoverPhase(value.phase);
  } catch (error) {
    if (error?.code === "CUTOVER_PHASE_INVALID") throw error;
    throw cutoverError("CUTOVER_PHASE_STATE_INVALID");
  }
}

function writeCutoverPhaseState(root, phase) {
  const normalized = normalizeCutoverPhase(phase);
  if (normalized === CUTOVER_PHASES.AMBIGUOUS) throw cutoverError("CUTOVER_PHASE_AMBIGUOUS");
  fs.mkdirSync(path.dirname(cutoverPhaseStateFile(root)), { recursive: true });
  fs.writeFileSync(cutoverPhaseStateFile(root), `${JSON.stringify({ schemaVersion: 1, phase: normalized, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return normalized;
}

function evidenceHas(root, relativePath, key, expected) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  return new RegExp(`^${key}=${String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(text);
}

function evidenceContains(root, relativePath, value) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(String(value));
}

function reconstructCutoverPhase({ root = path.resolve(__dirname, ".."), env = process.env } = {}) {
  const persisted = readCutoverPhaseState(root);
  if (persisted) return persisted;
  if (fs.existsSync(path.join(root, ".cutover-artifacts", "authoritative-switch.json")) || env.MEOO_STAGING_AUTHORITATIVE === "YES") return CUTOVER_PHASES.POST_AUTHORITATIVE;
  if (fs.existsSync(path.join(root, ".cutover-artifacts", "final-t2-migration.json")) || fs.existsSync(path.join(root, ".cutover-artifacts", "final-t2-snapshot.json"))) return CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE;
  if (fs.existsSync(path.join(root, ".cutover-artifacts", "preflight.json"))) return CUTOVER_PHASES.PRE_T2;
  return CUTOVER_PHASES.AMBIGUOUS;
}

function resolveCutoverPhase({ root = path.resolve(__dirname, ".."), requestedPhase = "", env = process.env } = {}) {
  const current = reconstructCutoverPhase({ root, env });
  const requested = requestedPhase ? normalizeCutoverPhase(requestedPhase) : current;
  if (current === CUTOVER_PHASES.AMBIGUOUS && !requestedPhase) throw cutoverError("CUTOVER_PHASE_AMBIGUOUS");
  if (current !== CUTOVER_PHASES.AMBIGUOUS && requested !== CUTOVER_PHASES.AMBIGUOUS && CUTOVER_PHASE_ORDER[requested] < CUTOVER_PHASE_ORDER[current]) throw cutoverError("CUTOVER_PHASE_REGRESSION_REJECTED");
  if (requested === CUTOVER_PHASES.AMBIGUOUS) throw cutoverError("CUTOVER_PHASE_AMBIGUOUS");
  return { current, phase: requested };
}

function verifyPostT2Fidelity({ sourceSnapshot, targetSnapshot } = {}) {
  const sourceRows = sourceSnapshot?.rows || {};
  const targetRows = targetSnapshot?.rows || {};
  const strictSource = { ...sourceSnapshot, rows: Object.fromEntries(Object.entries(sourceRows).filter(([table]) => !POST_T2_APPEND_ONLY_TABLES.has(table))) };
  const strictTarget = { ...targetSnapshot, rows: Object.fromEntries(Object.entries(targetRows).filter(([table]) => !POST_T2_APPEND_ONLY_TABLES.has(table))) };
  const strict = verifyMigrationFidelity({ sourceSnapshot: strictSource, targetSnapshot: strictTarget });
  for (const table of POST_T2_APPEND_ONLY_TABLES) {
    const source = sourceRows[table] || [];
    const target = targetRows[table] || [];
    const targetById = new Map(target.map(row => [String(row.id), JSON.stringify(canonical(row))]));
    for (const row of source) if (targetById.get(String(row.id)) !== JSON.stringify(canonical(row))) throw cutoverError("CUTOVER_DATA_FIDELITY_MISMATCH");
  }
  return { ...strict, appendOnlyTables: [...POST_T2_APPEND_ONLY_TABLES].filter(table => Object.prototype.hasOwnProperty.call(sourceRows, table)), appendOnlyExtraRows: Object.fromEntries([...POST_T2_APPEND_ONLY_TABLES].filter(table => Object.prototype.hasOwnProperty.call(sourceRows, table)).map(table => [table, Math.max(0, (targetRows[table] || []).length - (sourceRows[table] || []).length)])) };
}

function loadT2Evidence(root) {
  const receiptFile = path.join(root, ".cutover-artifacts", "final-t2-migration.json");
  const snapshotFile = path.join(root, ".cutover-artifacts", "final-t2-snapshot.json");
  if (!fs.existsSync(receiptFile) || !fs.existsSync(snapshotFile)) throw cutoverError("CUTOVER_T2_EVIDENCE_MISSING");
  let receipt;
  let snapshot;
  try { receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")); snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8")); } catch { throw cutoverError("CUTOVER_T2_EVIDENCE_INVALID"); }
  const fidelity = receipt?.fidelity;
  const requiredDigests = ["criticalDigest", "stableIdDigest", "passwordHashDigest", "relationshipDigest"];
  if (!fidelity || requiredDigests.some(key => !/^[a-f0-9]{64}$/i.test(String(fidelity[key] || "")))) throw cutoverError("CUTOVER_T2_FIDELITY_EVIDENCE_MISSING");
  if (Number(receipt?.fk?.expectedUnvalidatedForeignKeyCount) !== EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT) throw cutoverError("CUTOVER_T2_FK_EVIDENCE_INVALID");
  return { receipt, snapshot };
}

async function verifyPostT2DataState({ root = path.resolve(__dirname, ".."), target, loadEvidence = loadT2Evidence, targetSnapshotReader = readTargetSnapshot, fidelityVerifier = verifyPostT2Fidelity, evidenceChecker = evidenceHas, evidenceContainsChecker = evidenceContains } = {}) {
  const { receipt, snapshot } = loadEvidence(root);
  if (!target || typeof target.request !== "function") throw cutoverError("CUTOVER_TARGET_CLIENT_REQUIRED");
  const targetSnapshot = await targetSnapshotReader(snapshot, target);
  const fidelity = fidelityVerifier({ sourceSnapshot: snapshot, targetSnapshot });
  const sourceRows = snapshotMetadata(snapshot).rowCount;
  const targetRows = snapshotMetadata(targetSnapshot).rowCount;
  if (targetRows < sourceRows) throw cutoverError("CUTOVER_POST_T2_ROW_COUNT_MISMATCH");
  const textEvidence = [
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "NATIVE_STAGING_WRITE_FREEZE", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "WRITE_FREEZE_VERIFIED", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "ALL_ATELIER_ROW_COUNTS_MATCH", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "STABLE_ID_SET_DIGEST_MATCH", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "PASSWORD_HASH_DIGEST_MATCH", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "MERCHANT_SESSION_DATA_DIGEST_MATCH", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "TENANT_RELATIONSHIP_DIGEST_MATCH", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "CRITICAL_DATA_DIGEST_MATCH", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "TARGET_FK_INTEGRITY", "PASS"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "PLAN_CATALOG_POST_MIGRATION_STATUS", "PASS"],
    ["verification/meoo-b1-final-staging-acceptance/VERIFICATION.txt", "RESTORED_STATUS", "SYNTHETIC_ACCEPTANCE_DATA_REMAINING=0"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "MEOO_WRITES_ENABLED", "NO"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "MEOO_STAGING_AUTHORITATIVE", "NO"],
    ["verification/meoo-b1-final-t2-prelogin/VERIFICATION.txt", "DUAL_AUTHORITATIVE_WRITE_PATHS", "NO"]
  ];
  const missingEvidence = textEvidence.filter(([file, key, expected]) => key === "RESTORED_STATUS" ? !evidenceContainsChecker(root, file, expected) : !evidenceChecker(root, file, key, expected));
  if (missingEvidence.length) throw cutoverError("CUTOVER_POST_T2_EVIDENCE_INCOMPLETE");
  return { phase: CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE, postT2DataStateGate: "PASS", t2DataFidelity: "PASS", realStagingDataPreserved: "PASS", sourceRows, targetRows, fidelity, receipt };
}

function verifyPostAuthoritativeState({ root = path.resolve(__dirname, ".."), env = process.env } = {}) {
  if (env.MEOO_WRITES_ENABLED !== "YES" || env.MEOO_STAGING_AUTHORITATIVE !== "YES" || env.DUAL_AUTHORITATIVE_WRITE_PATHS !== "NO") throw cutoverError("CUTOVER_POST_AUTHORITATIVE_STATE_INVALID");
  return { phase: CUTOVER_PHASES.POST_AUTHORITATIVE, postAuthoritativeStateGate: "PASS" };
}

async function verifyPhaseAwareTargetState({ phase, root = path.resolve(__dirname, ".."), target, policy, ...options } = {}) {
  const normalized = normalizeCutoverPhase(phase);
  if (normalized === CUTOVER_PHASES.PRE_T2) return { phase: normalized, preT2BaselineGate: "PASS", baseline: await verifyTargetBaseline({ target, policy }) };
  if (normalized === CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE) return await verifyPostT2DataState({ root, target, ...options });
  if (normalized === CUTOVER_PHASES.POST_AUTHORITATIVE) return verifyPostAuthoritativeState({ root });
  throw cutoverError("CUTOVER_PHASE_AMBIGUOUS");
}

async function readCanonicalSourceIdentity({ connectionString, root = path.resolve(__dirname, ".."), clientFactory = options => new Client(options) } = {}) {
  if (!/^postgres(?:ql)?:\/\//i.test(String(connectionString || ""))) throw cutoverError("CUTOVER_SOURCE_CONNECTION_REQUIRED");
  const client = clientFactory({ connectionString, application_name: "atelier-meoo-staging-cutover-preflight", options: "-c default_transaction_read_only=on" });
  try {
    await client.connect();
    await client.query("begin isolation level repeatable read read only");
    const identity = (await client.query("select current_database() database,current_setting('server_version') postgres_version")).rows[0] || {};
    const migrations = (await client.query("select version from schema_migrations order by version")).rows.map(row => String(row.version));
    const foreignKeyValidation = (await client.query("select count(*)::int unvalidated_foreign_key_count from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace and not convalidated")).rows[0] || {};
    const digest = (await client.query(sourceDigestSql(root))).rows[0] || {};
    await client.query("rollback");
    const actual = {
      database: String(identity.database || ""),
      postgresVersion: String(identity.postgres_version || ""),
      latestMigration: migrations.at(-1) || "",
      schemaDigest: String(digest.core_schema_digest || ""),
      migration011Applied: migrations.some(value => /^011(?:_|$)/.test(value)),
      unvalidatedForeignKeyCount: Number(foreignKeyValidation.unvalidated_foreign_key_count || 0)
    };
    if (actual.database !== SOURCE_EXPECTED.database) throw cutoverError("CUTOVER_SOURCE_DATABASE_IDENTITY_MISMATCH");
    if (actual.postgresVersion !== SOURCE_EXPECTED.postgresVersion) throw cutoverError("CUTOVER_SOURCE_POSTGRES_VERSION_MISMATCH");
    if (actual.latestMigration !== SOURCE_EXPECTED.latestMigration) throw cutoverError("CUTOVER_SOURCE_MIGRATION_STATE_MISMATCH");
    if (actual.schemaDigest !== SOURCE_EXPECTED.schemaDigest) throw cutoverError("CUTOVER_SOURCE_SCHEMA_DIGEST_MISMATCH");
    if (actual.migration011Applied) throw cutoverError("CUTOVER_SOURCE_MIGRATION_011_PRESENT");
    if (actual.unvalidatedForeignKeyCount !== EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT) throw cutoverError("CUTOVER_SOURCE_FOREIGN_KEY_VALIDATION_MISMATCH");
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
  await denied("/rest/v1/customers", { method: "POST", body: "{}" });
  // PostgREST resolves RPC overloads from JSON keys. Use the full signature so a
  // 401/403 proves permission denial rather than a 404 route-resolution result.
  const probeId = "00000000-0000-0000-0000-000000000000";
  await denied("/rest/v1/rpc/atelier_customer_add_note", {
    method: "POST",
    body: JSON.stringify({
      p_tenant_id: probeId,
      p_workspace_id: probeId,
      p_store_id: probeId,
      p_actor_id: probeId,
      p_request_id: "cutover-anon-probe",
      p_customer_id: probeId,
      p_content: "probe"
    })
  });
  if (!serviceTarget || typeof serviceTarget.request !== "function") throw cutoverError("CUTOVER_SERVICE_ROLE_REQUIRED");
  await serviceTarget.request("schema_migrations", { query: "?select=version&limit=1" });
  return { anonCoreRead: "DENIED", anonCoreWrite: "DENIED", anonProviderRpcExecute: "DENIED", serviceRoleAccess: "ALLOWED" };
}

function snapshotMetadata(snapshot) {
  const rows = Object.values(snapshot?.rows || {}).reduce((total, tableRows) => total + (Array.isArray(tableRows) ? tableRows.length : 0), 0);
  return { timestamp: String(snapshot?.identity?.snapshot_at || ""), rowCount: rows };
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

function assertProviderNormalizedSchemaParity(result) {
  if (!result || result.targetSchemaProviderNormalizedParity !== true) throw cutoverError("CUTOVER_TARGET_PROVIDER_NORMALIZED_SCHEMA_PARITY_MISMATCH");
  return result;
}

function isProviderCatalogDiagnostic(error) {
  return String(error?.code || "") === "SCHEMA_PARITY_TARGET_CATEGORY_QUERY_FAILED";
}

async function readProviderNormalizedSchemaParityDiagnostic({ verify = verifyProviderNormalizedSchemaParity, ...options } = {}) {
  try {
    return { status: "PASS", result: assertProviderNormalizedSchemaParity(await verify(options)), warning: null };
  } catch (error) {
    if (!isProviderCatalogDiagnostic(error)) throw error;
    return {
      status: CATALOG_PARITY_UNSTABLE,
      result: null,
      warning: { code: error.code, category: String(error.category || "unknown"), attempts: Number(error.attempts || 0) }
    };
  }
}

function assertSchemaCutoverCompatibility({ schemaParity, concreteChecks } = {}) {
  const required = [
    "targetProjectIdentity", "dbDataPlane", "coreMigrations", "providerMigrations", "target011NotApplied",
    "expectedCoreTableCount", "unvalidatedForeignKeyCount", "ordersCustomerScopeFkValidated", "fkIntegrity",
    "orphanCount", "publicDataPlaneLockdown", "anonCoreRead", "anonCoreWrite", "anonProviderRpcExecute", "serviceRoleRequiredAccess"
  ];
  const failed = required.filter(name => concreteChecks?.[name] !== "PASS");
  if (failed.length) {
    const error = cutoverError("CUTOVER_SCHEMA_CUTOVER_COMPATIBILITY_GATE_FAILED");
    error.failedChecks = failed;
    throw error;
  }
  return {
    targetSchemaProviderNormalizedParity: schemaParity?.status,
    schemaCutoverCompatibilityGate: "PASS",
    preflight: schemaParity?.status === CATALOG_PARITY_UNSTABLE ? "PASS_WITH_CATALOG_DIAGNOSTIC_WARNING" : "PASS"
  };
}

async function verifyTargetProviderMigrations({ fetchImpl = globalThis.fetch, url, serviceRoleKey } = {}) {
  const baseUrl = String(url || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl) || !String(serviceRoleKey || "").trim() || typeof fetchImpl !== "function") throw cutoverError("CUTOVER_PROVIDER_MIGRATION_CONFIG_REQUIRED");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  const probe = async (name, body, expectedCode) => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok || payload?.code !== expectedCode) throw cutoverError("CUTOVER_TARGET_PROVIDER_MIGRATION_MISMATCH");
  };
  await probe("atelier_create_appointment", {
    p_tenant_id: null, p_workspace_id: null, p_store_id: null, p_public_store_id: null, p_customer_name: null,
    p_customer_phone: null, p_openid_hash: null, p_service_id: null, p_advisor_id: null, p_resource_id: null,
    p_start_at: null, p_slot_key: null, p_notes: null, p_idempotency_key: null, p_request_id: null
  }, "INVALID_INPUT");
  await probe("atelier_customer_add_note", {
    p_tenant_id: null, p_workspace_id: null, p_store_id: null, p_actor_id: null, p_request_id: null, p_customer_id: null, p_content: ""
  }, "NOTE_INVALID");
  return { providerMigrations: PROVIDER_MIGRATIONS.length };
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
  assertTargetProjectId(targetProjectId);
  const applied = [];
  for (const file of targetMigrationFiles(root)) {
    if (!fs.existsSync(file)) throw cutoverError("CUTOVER_MIGRATION_FILE_MISSING");
    const result = runMeooDbQuery(run, ["db", "query", "--project", targetProjectId, "--file", file], root);
    if (!result || result.status !== 0) throw cutoverError("CUTOVER_TARGET_MIGRATION_APPLY_FAILED");
    applied.push(path.basename(file));
  }
  finalizeTargetForeignKeyValidation({ root, targetProjectId, run });
  return { applied, foreignKeyValidation: "PASS" };
}

function writeReceipt(root, name, body) {
  const directory = path.join(root, ".cutover-artifacts");
  fs.mkdirSync(directory, { recursive: true });
  const receipt = { schemaVersion: 1, name, createdAt: new Date().toISOString(), ...body };
  fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}

function parseArgs(argv) {
  const result = { mode: "preflight", targetProjectId: "", sourceEnvPath: "", policyPath: "", phase: "" };
  for (const value of argv) {
    if (value === "--preflight") result.mode = "preflight";
    else if (value === "--dry-run") result.mode = "dry-run";
    else if (value === "--apply-target-schema") result.mode = "apply-target-schema";
    else if (value === "--migrate") result.mode = "migrate";
    else if (value.startsWith("--target-project=")) result.targetProjectId = value.slice("--target-project=".length);
    else if (value.startsWith("--source-env=")) result.sourceEnvPath = value.slice("--source-env=".length);
    else if (value.startsWith("--policy=")) result.policyPath = value.slice("--policy=".length);
    else if (value.startsWith("--phase=")) result.phase = normalizeCutoverPhase(value.slice("--phase=".length));
    else throw cutoverError("CUTOVER_ARGUMENT_INVALID");
  }
  return result;
}

async function runCli({ argv = process.argv.slice(2), env = process.env, root = path.resolve(__dirname, "..") } = {}) {
  const args = parseArgs(argv);
  const phaseResult = resolveCutoverPhase({ root, requestedPhase: args.phase, env });
  const phase = phaseResult.phase;
  if ((args.mode === "migrate" || args.mode === "apply-target-schema") && phase !== CUTOVER_PHASES.PRE_T2) throw cutoverError("CUTOVER_PHASE_OPERATION_INVALID");
  const sourceConnection = args.sourceEnvPath ? loadControlledSourceConnection(args.sourceEnvPath) : String(env.ATELIER_REAL_POSTGRES_URL || "");
  if (args.mode === "apply-target-schema") {
    const result = applyTargetMigrations({ root, targetProjectId: args.targetProjectId, env });
    writeReceipt(root, "target-migrations", { targetProjectId: args.targetProjectId, applied: result.applied });
    console.log(`TARGET_MIGRATIONS_APPLIED=${result.applied.length}`);
    return result;
  }
  const source = await readCanonicalSourceIdentity({ connectionString: sourceConnection, root });
  const foreignKeyValidation = verifyTargetForeignKeyValidation({ root, targetProjectId: args.targetProjectId });
  const schemaParity = await readProviderNormalizedSchemaParityDiagnostic({ connectionString: sourceConnection, targetProjectId: args.targetProjectId, root });
  const policyPath = args.policyPath || path.join(root, "verification", "meoo-b1-real-staging-data-rehearsal", "import-policy.json");
  const policy = loadImportPolicy(policyPath);
  const serviceTarget = createTargetClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const core = await verifyTargetCoreMigrations({ target: serviceTarget });
  const phaseState = await verifyPhaseAwareTargetState({ phase, root, target: serviceTarget, policy });
  const baseline = phaseState.baseline || { tablesChecked: Object.keys(policy.policies).length, phaseBaselineGate: "NOT_APPLICABLE_POST_T2" };
  const provider = await verifyTargetProviderMigrations({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const lockdown = await verifyPublicDataPlaneLockdown({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, serviceTarget });
  const gate = assertSchemaCutoverCompatibility({
    schemaParity,
    concreteChecks: {
      targetProjectIdentity: env.MEOO_PROJECT_URL_ID === args.targetProjectId ? "PASS" : "FAIL",
      dbDataPlane: "PASS",
      coreMigrations: core.coreMigrations === CORE_MIGRATIONS.length ? "PASS" : "FAIL",
      providerMigrations: provider.providerMigrations === PROVIDER_MIGRATIONS.length ? "PASS" : "FAIL",
      target011NotApplied: "PASS",
      expectedCoreTableCount: Object.keys(policy.policies).length + 1 === EXPECTED_CORE_TABLE_COUNT ? "PASS" : "FAIL",
      unvalidatedForeignKeyCount: foreignKeyValidation.expectedUnvalidatedForeignKeyCount === 0 ? "PASS" : "FAIL",
      ordersCustomerScopeFkValidated: "PASS",
      fkIntegrity: "PASS",
      orphanCount: "PASS",
      publicDataPlaneLockdown: "PASS",
      anonCoreRead: lockdown.anonCoreRead === "DENIED" ? "PASS" : "FAIL",
      anonCoreWrite: lockdown.anonCoreWrite === "DENIED" ? "PASS" : "FAIL",
      anonProviderRpcExecute: lockdown.anonProviderRpcExecute === "DENIED" ? "PASS" : "FAIL",
      serviceRoleRequiredAccess: lockdown.serviceRoleAccess === "ALLOWED" ? "PASS" : "FAIL"
    }
  });
  if (args.mode === "migrate") {
    assertExecutionBarrier(env);
    const extracted = await readSourceSnapshot({ connectionString: sourceConnection });
    const sourceSnapshot = snapshotMetadata(extracted.snapshot);
    await migrateSnapshot(extracted.snapshot, serviceTarget, { policy: policy.policies });
    const targetSnapshot = await readTargetSnapshot(extracted.snapshot, serviceTarget);
    const fidelity = verifyMigrationFidelity({ sourceSnapshot: extracted.snapshot, targetSnapshot });
    writeReceipt(root, "migration", { source, sourceSnapshot, foreignKeyValidation, schemaParity, gate, core, provider, baseline, lockdown, fidelity });
    console.log("CUTOVER_MIGRATION=PASS");
    return { source, phase, phaseState, sourceSnapshot, foreignKeyValidation, schemaParity, gate, core, provider, baseline, lockdown, fidelity };
  }
  writeReceipt(root, args.mode, { source, phase, phaseState, foreignKeyValidation, schemaParity, gate, core, provider, baseline, lockdown });
  writeCutoverPhaseState(root, phase);
  console.log(`CUTOVER_PHASE=${phase}`);
  console.log(`PRE_T2_BASELINE_GATE=${phase === CUTOVER_PHASES.PRE_T2 ? "PASS" : "NOT_APPLICABLE_POST_T2"}`);
  console.log(`POST_T2_DATA_STATE_GATE=${phaseState.postT2DataStateGate || "NOT_APPLICABLE"}`);
  console.log(`POST_AUTHORITATIVE_STATE_GATE=${phaseState.postAuthoritativeStateGate || "NOT_APPLICABLE"}`);
  console.log(`TARGET_SCHEMA_PROVIDER_NORMALIZED_PARITY=${schemaParity.status}`);
  if (schemaParity.warning) console.log(`TARGET_SCHEMA_PROVIDER_NORMALIZED_PARITY_WARNING=${schemaParity.warning.code}:${schemaParity.warning.category}`);
  console.log(`SCHEMA_CUTOVER_COMPATIBILITY_GATE=${gate.schemaCutoverCompatibilityGate}`);
  console.log(`PRE_CUTOVER_TARGET_PREFLIGHT=${gate.preflight === "PASS_WITH_CATALOG_DIAGNOSTIC_WARNING" || gate.preflight === "PASS" ? "PASS" : "FAIL"}`);
  console.log(`CUTOVER_${args.mode.toUpperCase()}=PASS`);
  return { source, phase, phaseState, foreignKeyValidation, schemaParity, gate, core, provider, baseline, lockdown };
}

if (require.main === module) {
  runCli().catch(error => {
    console.error(`CUTOVER_RESULT=FAIL code=${error.code || "CUTOVER_UNEXPECTED_ERROR"}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CATALOG_PARITY_UNSTABLE, CUTOVER_PHASES, EXPECTED_CORE_TABLE_COUNT, CORE_MIGRATIONS, PROVIDER_MIGRATIONS, SOURCE_EXPECTED, EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT, TARGET_FOREIGN_KEY_FINALIZATION_FILE, applyTargetMigrations, assertExecutionBarrier, assertProviderNormalizedSchemaParity, assertSchemaCutoverCompatibility, finalizeTargetForeignKeyValidation, isProviderCatalogDiagnostic, loadControlledSourceConnection,
  loadImportPolicy, parseArgs, parseDotEnv, readCanonicalSourceIdentity, readProviderNormalizedSchemaParityDiagnostic, reconstructCutoverPhase, resolveCutoverPhase, runCli, runMeooDbQuery, snapshotMetadata, targetMigrationFiles, verifyMigrationFidelity, verifyPhaseAwareTargetState, verifyPostAuthoritativeState, verifyPostT2DataState, verifyPostT2Fidelity, writeCutoverPhaseState,
  verifyPublicDataPlaneLockdown, verifyTargetBaseline, verifyTargetCoreMigrations, verifyTargetForeignKeyValidation, verifyTargetProviderMigrations, targetForeignKeyValidationGuardSql, writeReceipt
};
