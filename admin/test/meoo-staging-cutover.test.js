const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CORE_MIGRATIONS, PROVIDER_MIGRATIONS, SOURCE_EXPECTED, applyTargetMigrations, assertExecutionBarrier, loadControlledSourceConnection,
  parseArgs, parseDotEnv, readCanonicalSourceIdentity, verifyMigrationFidelity, verifyPublicDataPlaneLockdown, verifyTargetBaseline, verifyTargetCoreMigrations
} = require("../meoo-staging-cutover");

const root = path.resolve(__dirname, "../..");

function sourceClient({ database = SOURCE_EXPECTED.database, version = SOURCE_EXPECTED.postgresVersion, migration = SOURCE_EXPECTED.latestMigration, digest = SOURCE_EXPECTED.schemaDigest } = {}) {
  return {
    async connect() {},
    async end() {},
    async query(sql) {
      if (/current_database\(\)/.test(sql)) return { rows: [{ database, postgres_version: version }] };
      if (/schema_migrations/.test(sql)) return { rows: [{ version: migration }] };
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
  assert.equal(requests.length, 2);
  await assert.rejects(() => verifyPublicDataPlaneLockdown({ fetchImpl: async () => ({ status: 200 }), url: "https://target.example", anonKey: "anon", serviceTarget: { request: async () => [] } }), error => error.code === "CUTOVER_PUBLIC_DATA_PLANE_EXPOSED");
});

test("fidelity gate compares exact semantic digests and execution barrier requires explicit approvals", () => {
  const snapshot = { rows: { users: [{ id: "u1", password_hash: "hash", tenant_id: "t1" }], plan_catalog: [{ id: "plan", display_name: "Plan", price_fen: 1, duration_hours: null, public: true, entitlements: {} }] } };
  assert.equal(verifyMigrationFidelity({ sourceSnapshot: snapshot, targetSnapshot: JSON.parse(JSON.stringify(snapshot)) }).criticalDigest.length, 64);
  assert.throws(() => verifyMigrationFidelity({ sourceSnapshot: snapshot, targetSnapshot: { rows: { users: [{ id: "u2", password_hash: "hash", tenant_id: "t1" }], plan_catalog: snapshot.rows.plan_catalog } } }), error => error.code === "CUTOVER_DATA_FIDELITY_MISMATCH");
  assert.throws(() => assertExecutionBarrier({}), error => error.code === "CUTOVER_WRITE_FREEZE_NOT_CONFIRMED");
  assert.doesNotThrow(() => assertExecutionBarrier({ ATELIER_CUTOVER_WRITE_FREEZE_CONFIRMED: "1", ATELIER_CUTOVER_AUTHORITATIVE_WRITES: "blocked", ATELIER_CUTOVER_REAL_DATA_MIGRATION_APPROVED: "1" }));
});

test("target migration command order uses supported Meoo CLI syntax only after approval", () => {
  const calls = [];
  const result = applyTargetMigrations({ root, targetProjectId: "target_123", env: { ATELIER_CUTOVER_TARGET_BUILD_APPROVED: "1" }, run: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(result.applied.length, 13);
  assert.equal(calls.length, 13);
  assert.deepEqual(calls[0][1].slice(0, 5), ["db", "query", "--project", "target_123", "--file"]);
  assert.equal(result.applied.at(-1), PROVIDER_MIGRATIONS.at(-1));
  assert.throws(() => applyTargetMigrations({ root, targetProjectId: "target_123", env: {}, run: () => ({ status: 0 }) }), error => error.code === "CUTOVER_TARGET_BUILD_NOT_APPROVED");
  assert.equal(parseArgs(["--preflight", "--target-project=target_123"]).mode, "preflight");
  assert.equal(parseArgs(["--dry-run", "--target-project=target_123"]).mode, "dry-run");
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