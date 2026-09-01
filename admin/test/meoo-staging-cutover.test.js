const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CATALOG_PARITY_UNSTABLE, CUTOVER_PHASES, CORE_MIGRATIONS, PROVIDER_MIGRATIONS, SOURCE_EXPECTED, EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT, TARGET_FOREIGN_KEY_FINALIZATION_FILE, applyTargetMigrations, assertExecutionBarrier, assertProviderNormalizedSchemaParity, assertSchemaCutoverCompatibility, loadControlledSourceConnection,
  parseArgs, parseDotEnv, readCanonicalSourceIdentity, readProviderNormalizedSchemaParityDiagnostic, reconstructCutoverPhase, resolveCutoverPhase, snapshotMetadata, verifyMigrationFidelity, verifyPhaseAwareTargetState, verifyPostAuthoritativeState, verifyPostT2DataState, verifyPostT2Fidelity, verifyPublicDataPlaneLockdown, verifyTargetBaseline, verifyTargetCoreMigrations, verifyTargetForeignKeyValidation, writeCutoverPhaseState
} = require("../meoo-staging-cutover");

const root = path.resolve(__dirname, "../..");

function sourceClient({ database = SOURCE_EXPECTED.database, version = SOURCE_EXPECTED.postgresVersion, migration = SOURCE_EXPECTED.latestMigration, digest = SOURCE_EXPECTED.schemaDigest, unvalidatedForeignKeyCount = 0 } = {}) {
  return {
    async connect() {},
    async end() {},
    async query(sql) {
      if (/current_database\(\)/.test(sql)) return { rows: [{ database, postgres_version: version }] };
      if (/schema_migrations/.test(sql)) return { rows: [{ version: migration }] };
      if (/unvalidated_foreign_key_count/.test(sql)) return { rows: [{ unvalidated_foreign_key_count: unvalidatedForeignKeyCount }] };
      if (/core_schema_digest/.test(sql)) return { rows: [{ core_schema_digest: digest }] };
      return { rows: [] };
    }
  };
}

test("controlled source connection accepts only the dedicated staging variable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-cutover-"));
  const envPath = path.join(directory, "staging-postgres.env");
  fs.writeFileSync(envPath, "# controlled\nATELIER_REAL_POSTGRES_URL=postgresql://user:password@localhost:5432/atelier_os_staging\n");
  assert.equal(parseDotEnv(fs.readFileSync(envPath, "utf8")).ATELIER_REAL_POSTGRES_URL.includes("atelier_os_staging"), true);
  assert.equal(loadControlledSourceConnection(envPath).includes("atelier_os_staging"), true);
  assert.throws(() => loadControlledSourceConnection(path.join(directory, "runtime-secrets.json")), error => error.code === "CUTOVER_SOURCE_SECRET_REJECTED");
});

test("canonical source identity requires the verified staging database contract", async () => {
  const identity = await readCanonicalSourceIdentity({ connectionString: "postgresql://example", root, clientFactory: () => sourceClient() });
  assert.equal(identity.database, SOURCE_EXPECTED.database);
  await assert.rejects(() => readCanonicalSourceIdentity({ connectionString: "postgresql://example", root, clientFactory: () => sourceClient({ database: "atelier_os" }) }), error => error.code === "CUTOVER_SOURCE_DATABASE_IDENTITY_MISMATCH");
  await assert.rejects(() => readCanonicalSourceIdentity({ connectionString: "postgresql://example", root, clientFactory: () => sourceClient({ migration: "011_ai_template_studio" }) }), error => error.code === "CUTOVER_SOURCE_MIGRATION_STATE_MISMATCH");
  await assert.rejects(() => readCanonicalSourceIdentity({ connectionString: "postgresql://example", root, clientFactory: () => sourceClient({ unvalidatedForeignKeyCount: 1 }) }), error => error.code === "CUTOVER_SOURCE_FOREIGN_KEY_VALIDATION_MISMATCH");
});

test("target preflight requires core migrations and an empty business baseline", async () => {
  const versions = CORE_MIGRATIONS.map(file => ({ version: file.replace(/\.sql$/, "") }));
  const policy = { policies: { users: { targetPreexistingRows: 0 }, plan_catalog: { targetPreexistingRows: 3 } } };
  const target = { request: async (table, options) => {
    if (table === "schema_migrations") return versions;
    if (table === "users") return [];
    if (table === "plan_catalog") return [{}, {}, {}];
    throw new Error(`unexpected ${table}:${options.query}`);
  } };
  assert.deepEqual(await verifyTargetCoreMigrations({ target }), { coreMigrations: 10 });
  assert.deepEqual(await verifyTargetBaseline({ target, policy }), { tablesChecked: 2 });
  await assert.rejects(() => verifyTargetBaseline({ target: { request: async () => [{}] }, policy }), error => error.code === "CUTOVER_TARGET_BASELINE_MISMATCH");
});

test("public lockdown requires anonymous denial and service-role access", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { status: 403 };
  };
  const result = await verifyPublicDataPlaneLockdown({ fetchImpl, url: "https://target.example", anonKey: "anon", serviceTarget: { request: async () => [] } });
  assert.equal(result.anonCoreRead, "DENIED");
  assert.equal(requests.length, 3);
  assert.equal(requests[1].options.method, "POST");
  assert.match(requests[2].options.body, /p_tenant_id/);
  await assert.rejects(() => verifyPublicDataPlaneLockdown({ fetchImpl: async () => ({ status: 200 }), url: "https://target.example", anonKey: "anon", serviceTarget: { request: async () => [] } }), error => error.code === "CUTOVER_PUBLIC_DATA_PLANE_EXPOSED");
});

function concreteChecks(overrides = {}) {
  return {
    targetProjectIdentity: "PASS", dbDataPlane: "PASS", coreMigrations: "PASS", providerMigrations: "PASS", target011NotApplied: "PASS",
    expectedCoreTableCount: "PASS", unvalidatedForeignKeyCount: "PASS", ordersCustomerScopeFkValidated: "PASS", fkIntegrity: "PASS",
    orphanCount: "PASS", publicDataPlaneLockdown: "PASS", anonCoreRead: "PASS", anonCoreWrite: "PASS",
    anonProviderRpcExecute: "PASS", serviceRoleRequiredAccess: "PASS", ...overrides
  };
}

test("catalog diagnostic is a warning only when every concrete compatibility check passes", async () => {
  const warning = await readProviderNormalizedSchemaParityDiagnostic({
    verify: async () => { const error = new Error("catalog unavailable"); error.code = "SCHEMA_PARITY_TARGET_CATEGORY_QUERY_FAILED"; error.category = "tables"; error.attempts = 3; throw error; }
  });
  assert.equal(warning.status, CATALOG_PARITY_UNSTABLE);
  assert.deepEqual(assertSchemaCutoverCompatibility({ schemaParity: warning, concreteChecks: concreteChecks() }), {
    targetSchemaProviderNormalizedParity: CATALOG_PARITY_UNSTABLE,
    schemaCutoverCompatibilityGate: "PASS",
    preflight: "PASS_WITH_CATALOG_DIAGNOSTIC_WARNING"
  });
});

test("successful catalog diagnostic preserves a normal preflight pass", async () => {
  const normal = await readProviderNormalizedSchemaParityDiagnostic({ verify: async () => ({ targetSchemaProviderNormalizedParity: true }) });
  assert.equal(normal.status, "PASS");
  assert.equal(assertSchemaCutoverCompatibility({ schemaParity: normal, concreteChecks: concreteChecks() }).preflight, "PASS");
});

async function catalogWarning() {
  return readProviderNormalizedSchemaParityDiagnostic({
    verify: async () => { const error = new Error("catalog unavailable"); error.code = "SCHEMA_PARITY_TARGET_CATEGORY_QUERY_FAILED"; throw error; }
  });
}

test("catalog warning cannot hide an FK integrity failure", async () => {
  const warning = await catalogWarning();
  assert.throws(() => assertSchemaCutoverCompatibility({ schemaParity: warning, concreteChecks: concreteChecks({ fkIntegrity: "FAIL" }) }), error => error.code === "CUTOVER_SCHEMA_CUTOVER_COMPATIBILITY_GATE_FAILED" && error.failedChecks.includes("fkIntegrity"));
});

test("catalog warning cannot hide a provider migration failure", async () => {
  const warning = await catalogWarning();
  assert.throws(() => assertSchemaCutoverCompatibility({ schemaParity: warning, concreteChecks: concreteChecks({ providerMigrations: "FAIL" }) }), error => error.code === "CUTOVER_SCHEMA_CUTOVER_COMPATIBILITY_GATE_FAILED" && error.failedChecks.includes("providerMigrations"));
});

test("catalog warning cannot hide a public-lockdown failure", async () => {
  const warning = await catalogWarning();
  assert.throws(() => assertSchemaCutoverCompatibility({ schemaParity: warning, concreteChecks: concreteChecks({ publicDataPlaneLockdown: "FAIL" }) }), error => error.code === "CUTOVER_SCHEMA_CUTOVER_COMPATIBILITY_GATE_FAILED" && error.failedChecks.includes("publicDataPlaneLockdown"));
});

test("fidelity gate compares exact semantic digests and execution barrier requires explicit approvals", () => {
  assert.deepEqual(snapshotMetadata({ identity: { snapshot_at: "2026-09-01T01:00:00+08:00" }, rows: { users: [{}], memberships: [{}, {}] } }), { timestamp: "2026-09-01T01:00:00+08:00", rowCount: 3 });
  const snapshot = { rows: { users: [{ id: "u1", password_hash: "hash", tenant_id: "t1" }], plan_catalog: [{ id: "plan", display_name: "Plan", price_fen: 1, duration_hours: null, public: true, entitlements: {} }] } };
  assert.equal(verifyMigrationFidelity({ sourceSnapshot: snapshot, targetSnapshot: JSON.parse(JSON.stringify(snapshot)) }).criticalDigest.length, 64);
  assert.throws(() => verifyMigrationFidelity({ sourceSnapshot: snapshot, targetSnapshot: { rows: { users: [{ id: "u2", password_hash: "hash", tenant_id: "t1" }], plan_catalog: snapshot.rows.plan_catalog } } }), error => error.code === "CUTOVER_DATA_FIDELITY_MISMATCH");
  assert.throws(() => assertProviderNormalizedSchemaParity({ targetSchemaProviderNormalizedParity: false }), error => error.code === "CUTOVER_TARGET_PROVIDER_NORMALIZED_SCHEMA_PARITY_MISMATCH");
  assert.deepEqual(assertProviderNormalizedSchemaParity({ targetSchemaProviderNormalizedParity: true }), { targetSchemaProviderNormalizedParity: true });
  assert.throws(() => assertExecutionBarrier({}), error => error.code === "CUTOVER_WRITE_FREEZE_NOT_CONFIRMED");
  assert.doesNotThrow(() => assertExecutionBarrier({ ATELIER_CUTOVER_WRITE_FREEZE_CONFIRMED: "1", ATELIER_CUTOVER_AUTHORITATIVE_WRITES: "blocked", ATELIER_CUTOVER_REAL_DATA_MIGRATION_APPROVED: "1" }));
});

test("target migration command order uses supported Meoo CLI syntax only after approval", () => {
  const calls = [];
  const result = applyTargetMigrations({ root, targetProjectId: "target_123", env: { ATELIER_CUTOVER_TARGET_BUILD_APPROVED: "1" }, run: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(result.applied.length, 13);
  assert.equal(result.foreignKeyValidation, "PASS");
  assert.equal(calls.length, 14);
  assert.deepEqual(calls[0][1].slice(0, 5), ["db", "query", "--project", "target_123", "--file"]);
  assert.equal(result.applied.at(-1), PROVIDER_MIGRATIONS.at(-1));
  assert.deepEqual(calls.at(-1)[1].slice(0, 5), ["db", "query", "--project", "target_123", "--file"]);
  assert.equal(calls.at(-1)[1].at(-1), path.join(root, TARGET_FOREIGN_KEY_FINALIZATION_FILE));
  assert.throws(() => applyTargetMigrations({ root, targetProjectId: "target_123", env: {}, run: () => ({ status: 0 }) }), error => error.code === "CUTOVER_TARGET_BUILD_NOT_APPROVED");
  assert.equal(parseArgs(["--preflight", "--target-project=target_123"]).mode, "preflight");
  assert.equal(parseArgs(["--dry-run", "--target-project=target_123"]).mode, "dry-run");
});

test("target foreign-key preflight rejects any noncanonical validation state", () => {
  const calls = [];
  assert.deepEqual(verifyTargetForeignKeyValidation({ root, targetProjectId: "target_123", run: (...args) => { calls.push(args); return { status: 0 }; } }), { expectedUnvalidatedForeignKeyCount: EXPECTED_UNVALIDATED_FOREIGN_KEY_COUNT });
  assert.match(fs.readFileSync(calls[0][1].at(-1), "utf8"), /CUTOVER_TARGET_UNVALIDATED_FOREIGN_KEYS_PRESENT/);
  assert.throws(() => verifyTargetForeignKeyValidation({ root, targetProjectId: "target_123", run: () => ({ status: 1 }) }), error => error.code === "CUTOVER_TARGET_FOREIGN_KEY_VALIDATION_FAILED");
});

test("Meoo Image Runtime scripts bind the application and exclude local secret context", () => {
  const setup = fs.readFileSync(path.join(root, "scripts", "setup.sh"), "utf8");
  const start = fs.readFileSync(path.join(root, "scripts", "start.sh"), "utf8");
  const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
  assert.match(setup, /pnpm install --prod --frozen-lockfile/);
  assert.match(start, /ATELIER_DB_BACKEND=.*meoo/);
  assert.match(start, /unset DATABASE_URL/);
  assert.match(start, /PRIVLAN_ADMIN_HOST=.*0\.0\.0\.0/);
  assert.match(start, /PORT=.*9000/);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.cutover-artifacts\/$/m);
  assert.match(dockerignore, /^admin\/\.platform-master-key$/m);
  assert.match(dockerignore, /^verification\/$/m);
  assert.match(dockerignore, /^admin\/test\/$/m);
  assert.match(dockerignore, /^docker-compose\.yml$/m);
});


test("phase-aware gate preserves the strict PRE_T2 empty-target baseline", async () => {
  const policy = { policies: { customers: { targetPreexistingRows: 0 } } };
  const empty = { request: async () => [] };
  assert.equal((await verifyPhaseAwareTargetState({ phase: CUTOVER_PHASES.PRE_T2, target: empty, policy })).preT2BaselineGate, "PASS");
  await assert.rejects(() => verifyPhaseAwareTargetState({ phase: CUTOVER_PHASES.PRE_T2, target: { request: async () => [{}] }, policy }), error => error.code === "CUTOVER_TARGET_BASELINE_MISMATCH");
});

test("POST_T2_PRE_AUTHORITATIVE accepts imported real rows when fidelity evidence passes", async () => {
  const snapshot = { rows: { customers: [{ id: "c1", tenant_id: "t1" }] } };
  const evidence = { receipt: { fidelity: Object.fromEntries(["criticalDigest", "stableIdDigest", "passwordHashDigest", "relationshipDigest"].map(key => [key, "a".repeat(64)])), fk: { expectedUnvalidatedForeignKeyCount: 0 } }, snapshot };
  const result = await verifyPhaseAwareTargetState({
    phase: CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE,
    root: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-post-t2-")),
    target: { request: async () => [] },
    policy: { policies: {} },
    loadEvidence: () => evidence,
    targetSnapshotReader: async () => snapshot,
    evidenceChecker: () => true,
    evidenceContainsChecker: () => true
  });
  assert.equal(result.postT2DataStateGate, "PASS");
  assert.equal(result.t2DataFidelity, "PASS");
  assert.equal(result.sourceRows, 1);
});

test("POST_T2_PRE_AUTHORITATIVE rejects fidelity failure without running the empty-target baseline", async () => {
  const snapshot = { rows: { customers: [{ id: "c1", tenant_id: "t1" }] } };
  const evidence = { receipt: { fidelity: Object.fromEntries(["criticalDigest", "stableIdDigest", "passwordHashDigest", "relationshipDigest"].map(key => [key, "a".repeat(64)])), fk: { expectedUnvalidatedForeignKeyCount: 0 } }, snapshot };
  await assert.rejects(() => verifyPhaseAwareTargetState({
    phase: CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE,
    root: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-post-t2-fail-")),
    target: { request: async () => [] },
    policy: { policies: { customers: { targetPreexistingRows: 0 } } },
    loadEvidence: () => evidence,
    targetSnapshotReader: async () => snapshot,
    fidelityVerifier: () => { const error = new Error("fidelity"); error.code = "CUTOVER_DATA_FIDELITY_MISMATCH"; throw error; },
    evidenceChecker: () => true,
    evidenceContainsChecker: () => true
  }), error => error.code === "CUTOVER_DATA_FIDELITY_MISMATCH");
});

test("phase reconstruction and transition protection reject backward PRE_T2 regression", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-phase-"));
  fs.mkdirSync(path.join(directory, ".cutover-artifacts"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".cutover-artifacts", "final-t2-migration.json"), "{}\n");
  assert.equal(reconstructCutoverPhase({ root: directory }), CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE);
  assert.throws(() => resolveCutoverPhase({ root: directory, requestedPhase: CUTOVER_PHASES.PRE_T2 }), error => error.code === "CUTOVER_PHASE_REGRESSION_REJECTED");
  assert.equal(parseArgs(["--phase=POST_T2_PRE_AUTHORITATIVE"]).phase, CUTOVER_PHASES.POST_T2_PRE_AUTHORITATIVE);
  assert.throws(() => resolveCutoverPhase({ root: fs.mkdtempSync(path.join(os.tmpdir(), "atelier-ambiguous-")) }), error => error.code === "CUTOVER_PHASE_AMBIGUOUS");
});

test("POST_AUTHORITATIVE requires explicit authoritative state", () => {
  assert.throws(() => verifyPostAuthoritativeState({ env: { MEOO_WRITES_ENABLED: "NO", MEOO_STAGING_AUTHORITATIVE: "NO", DUAL_AUTHORITATIVE_WRITE_PATHS: "NO" } }), error => error.code === "CUTOVER_POST_AUTHORITATIVE_STATE_INVALID");
  assert.deepEqual(verifyPostAuthoritativeState({ env: { MEOO_WRITES_ENABLED: "YES", MEOO_STAGING_AUTHORITATIVE: "YES", DUAL_AUTHORITATIVE_WRITE_PATHS: "NO" } }), { phase: CUTOVER_PHASES.POST_AUTHORITATIVE, postAuthoritativeStateGate: "PASS" });
});


test("POST_T2 fidelity permits append-only audit/session activity while protecting imported business rows", () => {
  const sourceSnapshot = { rows: {
    customers: [{ id: "c1", tenant_id: "t1", name: "Real" }],
    audit_events: [{ id: "a1", event_type: "login" }],
    merchant_sessions: [{ id: "s1", user_id: "u1" }]
  } };
  const targetSnapshot = { rows: {
    customers: [{ id: "c1", tenant_id: "t1", name: "Real" }],
    audit_events: [{ id: "a1", event_type: "login" }, { id: "a2", event_type: "membership_read" }],
    merchant_sessions: [{ id: "s1", user_id: "u1" }, { id: "s2", user_id: "u1" }]
  } };
  const result = verifyPostT2Fidelity({ sourceSnapshot, targetSnapshot });
  assert.deepEqual(result.appendOnlyExtraRows, { audit_events: 1, merchant_sessions: 1 });
  assert.throws(() => verifyPostT2Fidelity({ sourceSnapshot, targetSnapshot: { rows: { ...targetSnapshot.rows, customers: [{ id: "c1", tenant_id: "t1", name: "Tampered" }] } } }), error => error.code === "CUTOVER_DATA_FIDELITY_MISMATCH");
});
