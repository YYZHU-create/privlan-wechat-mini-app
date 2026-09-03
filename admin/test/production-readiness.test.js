const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { respondUnexpectedError } = require("../error-response");
const { buildMigrationManifest, checkManifest, normalizeMigrationSql } = require("../migration-manifest");
const { checkSchemaCompatibility } = require("../check-schema-compatibility");
const { createPortableTestDatabase } = require("../database");
const { validateRollbackPlan } = require("../../scripts/validate-rollback-plan");

const ROOT = path.resolve(__dirname, "../..");

function fakeResponse() {
  return { statusCode: null, payload: null, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; return this; } };
}

test("unexpected server errors have stable responses and controlled request-id logging", () => {
  const response = fakeResponse();
  const logged = [];
  const marker = "fake database password; C:\\sensitive\\internal\\path; SELECT * FROM secret_table; stack trace marker";
  respondUnexpectedError(response, new Error(marker), { requestId: "sync_test_request", code: "SYNC_FAILED", message: "同步失败，请稍后重试", logger: { error(value) { logged.push(value); } } });
  const serialized = JSON.stringify(response.payload);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, { ok: false, code: "SYNC_FAILED", message: "同步失败，请稍后重试", error: "同步失败，请稍后重试", data: null, requestId: "sync_test_request" });
  assert.doesNotMatch(serialized, /fake database password|sensitive\\internal|SELECT \* FROM secret_table|stack trace marker/i);
  assert.deepEqual(logged, ['{"level":"error","requestId":"sync_test_request","code":"SYNC_FAILED","status":500,"event":"request_failed"}']);
});

test("migration manifest is deterministic across line endings and matches the committed baseline", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-manifest-"));
  try {
    fs.writeFileSync(path.join(temp, "001_example.sql"), "select 1;\r\n");
    const first = buildMigrationManifest(temp);
    fs.writeFileSync(path.join(temp, "001_example.sql"), "select 1;\n");
    const second = buildMigrationManifest(temp);
    assert.deepEqual(first, second);
    assert.equal(normalizeMigrationSql("a\r\nb\rc\n"), "a\nb\nc\n");
    const result = checkManifest(path.join(ROOT, "docs/architecture/migration-manifest.json"));
    assert.equal(result.ok, true);
    assert.equal(result.expected.migrations.at(-1).file, "012_launch_v1_domains.sql");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("portable isolated database has the committed migration versions", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    const manifest = buildMigrationManifest();
    const observed = await db.query("select version from schema_migrations order by version asc");
    assert.deepEqual(observed.rows.map(row => row.version), manifest.migrations.map(item => item.version));
  } finally { await db.close(); }
});

test("schema compatibility checker issues only a read-only transaction and migration metadata query", async () => {
  const calls = [];
  class Client {
    constructor(options) { this.options = options; }
    async connect() { calls.push("connect"); }
    async query(sql) { calls.push(sql); if (/SELECT version/.test(sql)) return { rows: buildMigrationManifest().migrations.map(item => ({ version: item.version })) }; return { rows: [] }; }
    async end() { calls.push("end"); }
  }
  const result = await checkSchemaCompatibility({ connectionString: "postgresql://redacted", createClient: Client });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["connect", "BEGIN READ ONLY", "SET LOCAL statement_timeout = '5000ms'", "SELECT version FROM schema_migrations ORDER BY version ASC", "ROLLBACK", "end"]);
  assert.ok(calls.every(sql => !/insert|update|delete|create|alter|drop/i.test(sql)));
});

test("rollback plan validation fails closed and accepts only matching explicit targets", () => {
  const complete = { CURRENT_RELEASE_SHA: "a".repeat(40), CURRENT_IMAGE_DIGEST: "sha256:abc", TARGET_RELEASE_SHA: "b".repeat(40), TARGET_IMAGE_DIGEST: "sha256:def", CURRENT_ROUTE_OWNER: "service/current", ROLLBACK_ROUTE_OWNER: "service/rollback", EXPECTED_PRODUCTION_PROJECT: "project-prod", EXPECTED_PRODUCTION_SERVICE: "service-prod", ACTUAL_PRODUCTION_PROJECT: "project-prod", ACTUAL_PRODUCTION_SERVICE: "service-prod" };
  assert.equal(validateRollbackPlan(complete).ok, true);
  assert.equal(validateRollbackPlan({ ...complete, ACTUAL_PRODUCTION_PROJECT: "project-staging" }).ok, false);
  assert.equal(validateRollbackPlan({ ...complete, TARGET_IMAGE_DIGEST: "" }).ok, false);
});

test("runtime, Docker, CI, and Meoo contracts stay aligned", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "admin/package.json"), "utf8"));
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const setup = fs.readFileSync(path.join(ROOT, "scripts/setup.sh"), "utf8");
  const dockerignore = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8");
  assert.equal(fs.readFileSync(path.join(ROOT, ".node-version"), "utf8").trim(), "22");
  assert.equal(packageJson.engines.node, "22.x");
  assert.equal(packageJson.engines.pnpm, "11.7.0");
  assert.equal(packageJson.packageManager, "pnpm@11.7.0");
  assert.match(dockerfile, /^FROM node:22-bookworm-slim/m);
  assert.match(dockerfile, /corepack prepare pnpm@11\.7\.0 --activate/);
  assert.match(ci, /NODE_VERSION: 22/);
  assert.match(ci, /Docker build and isolated smoke/);
  assert.match(ci, /Set up Node\.js for smoke assertions/);
  for (const name of ["DATABASE_URL", "ATELIER_LICENSE_PEPPER", "ATELIER_MASTER_KEY", "ATELIER_APPOINTMENT_GATEWAY_TOKEN", "ATELIER_OPENID_HASH_KEY"]) assert.match(ci, new RegExp(`-e ${name}=`));
  assert.match(setup, /EXPECTED_NODE_MAJOR=22/);
  assert.match(setup, /EXPECTED_PNPM_VERSION=11\.7\.0/);
  for (const pattern of [/\.git\//, /runtime-secrets\.json/, /\*\*\/\*\.pem/, /\*\*\/\*\.key/, /verification\//]) assert.match(dockerignore, pattern);
  assert.doesNotMatch(dockerignore, /!\.env/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "scripts/start.sh"), "utf8"), /release-sha|release-branch/);
  const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  for (const name of [".release-environment", ".release-build-time", "release-environment", "release-build-time"]) assert.match(gitignore, new RegExp(name.replace(".", "\\.")));
});

test("current runbooks distinguish liveness, authenticated readiness, and deployment phases", () => {
  const deployment = fs.readFileSync(path.join(ROOT, "docs/runbooks/production-deployment.md"), "utf8");
  const rollback = fs.readFileSync(path.join(ROOT, "docs/runbooks/production-rollback.md"), "utf8");
  const inputs = fs.readFileSync(path.join(ROOT, "docs/runbooks/production-inputs.md"), "utf8");
  assert.match(deployment, /B1 — image deployment/);
  assert.match(deployment, /B2 — public `\/ops\/` cutover/);
  assert.match(deployment, /authenticated `GET \/ops\/v1\/health`/);
  assert.match(deployment, /Node\.js 22/);
  assert.match(rollback, /validate-rollback-plan\.js/);
  for (const name of ["DEDICATED_PRODUCTION_MEOO_PROJECT_ID", "CURRENT_PRODUCTION_IMAGE_DIGEST", "ROLLBACK_ROUTE_TARGET"]) assert.match(inputs, new RegExp(name));
});
