const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { respondUnexpectedError } = require("../error-response");
const { markTrustedPublicMessage } = require("../public-error");
const { buildMigrationManifest, checkManifest, normalizeMigrationSql } = require("../migration-manifest");
const { checkMigrationHistoryCompatibility, compareVersions } = require("../check-migration-compatibility");
const { createPortableTestDatabase } = require("../database");
const { validateRollbackPlan } = require("../../scripts/validate-rollback-plan");

const ROOT = path.resolve(__dirname, "../..");

function fakeResponse() {
  return { statusCode: null, payload: null, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; return this; } };
}

test("unexpected errors never trust arbitrary status, code or message", () => {
  const marker = "postgresql://user:password@host/database; C:\\sensitive\\internal\\path; SELECT * FROM secret_table; Bearer secret-token; stack trace marker";
  for (const [status, code] of [[400, "BAD_INTERNAL_CODE"], [409, "CONFLICT_INTERNAL_CODE"], [500, "SERVER_INTERNAL_CODE"]]) {
    const response = fakeResponse();
    respondUnexpectedError(response, Object.assign(new Error(marker), { status, code }), { requestId: `security_${status}`, code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试", logger: { error() {} } });
    const serialized = JSON.stringify(response.payload);
    assert.equal(response.statusCode, status);
    assert.equal(response.payload.code, "INTERNAL_ERROR");
    assert.equal(response.payload.error, "服务暂时不可用，请稍后重试");
    assert.doesNotMatch(serialized, /postgresql:\/\/|sensitive\\internal|SELECT \* FROM secret_table|Bearer secret-token|stack trace marker/i);
  }
});

test("trusted domain public messages are bounded and control characters fall back", () => {
  const trusted = markTrustedPublicMessage(new Error("private internal text"), "输入格式错误");
  const response = fakeResponse();
  respondUnexpectedError(response, trusted, { status: 400, code: "INVALID_INPUT", message: "服务暂时不可用" });
  assert.equal(response.payload.error, "输入格式错误");
  for (const publicMessage of ["x".repeat(241), "包含\n控制字符"]) {
    const invalid = markTrustedPublicMessage(new Error("private"), publicMessage);
    const fallback = fakeResponse();
    respondUnexpectedError(fallback, invalid, { status: 400, code: "INVALID_INPUT", message: "请求格式无效" });
    assert.equal(fallback.payload.error, "请求格式无效");
  }
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

test("migration history checker issues only a read-only transaction and migration metadata query", async () => {
  const calls = [];
  class Client {
    constructor(options) { this.options = options; }
    async connect() { calls.push("connect"); }
    async query(sql) { calls.push(sql); if (/SELECT version/.test(sql)) return { rows: buildMigrationManifest().migrations.map(item => ({ version: item.version })) }; return { rows: [] }; }
    async end() { calls.push("end"); }
  }
  const result = await checkMigrationHistoryCompatibility({ connectionString: "postgresql://redacted", createClient: Client });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["connect", "BEGIN READ ONLY", "SET LOCAL statement_timeout = '5000ms'", "SELECT version FROM schema_migrations ORDER BY version ASC", "ROLLBACK", "end"]);
  assert.deepEqual(compareVersions(["001", "002"], ["001"]), { missing: ["002"], unexpected: [], ok: false });
  assert.deepEqual(compareVersions(["001"], ["001", "003"]), { missing: [], unexpected: ["003"], ok: false });
  assert.equal(compareVersions(["001", "002"], ["002", "001"]).ok, false);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "admin/check-migration-compatibility.js"), "utf8"), /\\bSCHEMA_COMPATIBILITY=(?:PASS|FAIL|ERROR)/);
  assert.ok(calls.every(sql => !/insert|update|delete|create|alter|drop/i.test(sql)));
});

test("rollback plan validation enforces field-specific strict formats and matching targets", () => {
  const complete = { CURRENT_RELEASE_SHA: "a".repeat(40), CURRENT_IMAGE_DIGEST: `sha256:${"c".repeat(64)}`, TARGET_RELEASE_SHA: "b".repeat(64), TARGET_IMAGE_DIGEST: `sha256:${"d".repeat(64)}`, ROLLBACK_ROUTE_OWNER: "service/rollback", CURRENT_ROUTE_OWNER: "service/current", EXPECTED_PRODUCTION_PROJECT: "project-prod", EXPECTED_PRODUCTION_SERVICE: "service-prod", ACTUAL_PRODUCTION_PROJECT: "project-prod", ACTUAL_PRODUCTION_SERVICE: "service-prod" };
  assert.equal(validateRollbackPlan(complete).ok, true);
  for (const field of ["CURRENT_RELEASE_SHA", "TARGET_RELEASE_SHA"]) for (const value of ["abc", "latest", "unknown", "a".repeat(40) + " ", "a".repeat(40) + "\n", "a".repeat(39), "a".repeat(40) + "$(x)"]) assert.equal(validateRollbackPlan({ ...complete, [field]: value }).ok, false);
  for (const field of ["CURRENT_IMAGE_DIGEST", "TARGET_IMAGE_DIGEST"]) for (const value of ["sha256:abc", "latest", "unknown", `sha256:${"A".repeat(64)}`, `sha256:${"e".repeat(63)}`, `sha256:${"e".repeat(64)} `, `sha256:${"e".repeat(64)};`]) assert.equal(validateRollbackPlan({ ...complete, [field]: value }).ok, false);
  assert.equal(validateRollbackPlan({ ...complete, ACTUAL_PRODUCTION_PROJECT: "project-staging" }).ok, false);
  assert.equal(validateRollbackPlan({ ...complete, ACTUAL_PRODUCTION_SERVICE: "" }).ok, false);
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
  assert.match(dockerfile, /mkdir -p \/app\/images \/app\/fonts \/app\/admin\/data \/app\/admin\/config-backups \/app\/admin\/media-trash/);
  assert.match(dockerfile, /chown -R node:node \/app\/images \/app\/fonts \/app\/admin \/app\/runtime-build\.json/);
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
  assert.match(deployment, /migration history checker/i);
  assert.match(deployment, /FULL_SCHEMA_COMPATIBILITY=NOT_VERIFIED/);
  assert.doesNotMatch(deployment, /SCHEMA_COMPATIBILITY=PASS/);
  for (const name of ["DEDICATED_PRODUCTION_MEOO_PROJECT_ID", "CURRENT_PRODUCTION_IMAGE_DIGEST", "ROLLBACK_ROUTE_TARGET"]) assert.match(inputs, new RegExp(name));
});
