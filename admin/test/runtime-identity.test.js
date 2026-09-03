const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readBuildMetadata, resolveRuntimeIdentity } = require("../runtime-identity");

const SHA_A = "0123456789abcdef0123456789abcdef01234567";
const SHA_B = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";

test("development runtime identity uses valid git fallback and excludes connection secrets", () => {
  const calls = [];
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "development", PORT: "40003", DATABASE_URL: "postgresql://db-user:super-password@127.0.0.1:5432/atelier_os_development?token=hidden" },
    now: () => new Date("2026-09-03T08:30:00.000Z"),
    readGit(args) { calls.push(args.join(" ")); return args.includes("--abbrev-ref") ? "codex/runtime-identity\n" : `${SHA_A}\n`; }
  });
  assert.deepEqual(result, {
    visible: true, environment: "development", application: "Feeldao OS Merchant Console", branch: "codex/runtime-identity", commitSha: SHA_A,
    buildTime: "unknown", identityStatus: "unknown/unverified", server: "40003", database: "atelier_os_development", generatedAt: "2026-09-03T08:30:00.000Z"
  });
  assert.deepEqual(calls, ["rev-parse HEAD", "rev-parse --abbrev-ref HEAD"]);
  assert.doesNotMatch(JSON.stringify(result), /super-password|token=|postgresql:\/\//i);
});

test("deployment environment values override valid build metadata", () => {
  let gitCalled = false;
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "development", ATELIER_ENVIRONMENT: "staging", PORT: "41000", ATELIER_DATABASE_LABEL: "feeldao_staging", ATELIER_BUILD_TIME: "2026-09-03T16:30:00+08:00", ATELIER_GIT_BRANCH: "codex/staging", ATELIER_GIT_SHA: SHA_A },
    buildMetadata: { environment: "production", branch: "main", commitSha: SHA_B, buildTime: "2026-09-01T00:00:00.000Z" },
    readGit() { gitCalled = true; return SHA_B; }
  });
  assert.deepEqual(result, { visible: true, environment: "staging", application: "Feeldao OS Merchant Console", branch: "codex/staging", commitSha: SHA_A, buildTime: "2026-09-03T08:30:00.000Z", identityStatus: "verified", server: "41000", database: "feeldao_staging" });
  assert.equal(gitCalled, false);
});

test("valid generated build metadata supplies identity when environment values are absent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-runtime-identity-"));
  const metadataPath = path.join(temp, "runtime-build.json");
  fs.writeFileSync(metadataPath, JSON.stringify({ environment: "production", branch: "main", commitSha: SHA_B, buildTime: "2026-09-03T08:30:00.000Z", ignored: "secret-value" }));
  try {
    assert.deepEqual(readBuildMetadata(metadataPath), { environment: "production", branch: "main", commitSha: SHA_B, buildTime: "2026-09-03T08:30:00.000Z" });
    const result = resolveRuntimeIdentity({ env: { NODE_ENV: "production", ATELIER_RELEASE_METADATA_PATH: metadataPath, DATABASE_URL: "postgresql://user:password@db/feeldao" }, readGit() { throw new Error("production must not read git"); } });
    assert.equal(result.commitSha, SHA_B);
    assert.equal(result.identityStatus, "verified");
    assert.equal(result.database, "protected");
    assert.doesNotMatch(JSON.stringify(result), /password|postgresql|secret-value/i);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("invalid identity values never masquerade as a production release", () => {
  let called = false;
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "production", ATELIER_GIT_SHA: "short-sha", ATELIER_GIT_BRANCH: "unsafe value with spaces", ATELIER_BUILD_TIME: "not-a-time" },
    readGit() { called = true; return SHA_A; }
  });
  assert.deepEqual(result, { visible: true, environment: "production", application: "Feeldao OS Merchant Console", branch: "unknown", commitSha: "unknown", buildTime: "unknown", identityStatus: "unknown/unverified", server: "unknown", database: "protected" });
  assert.equal(called, false);
});

test("runtime identity only accepts allowed environment values and safe ports", () => {
  assert.deepEqual(resolveRuntimeIdentity({ env: { NODE_ENV: "qa" } }), { visible: false });
  const result = resolveRuntimeIdentity({ env: { NODE_ENV: "development", PORT: "40003?token=secret", ATELIER_DATABASE_LABEL: "postgresql://user:password@host/database", ATELIER_GIT_SHA: SHA_A, ATELIER_GIT_BRANCH: "codex/safe", ATELIER_BUILD_TIME: "2026-09-03T08:30:00.000Z" }, readGit() { throw new Error("not needed"); } });
  assert.equal(result.server, "unknown");
  assert.equal(result.database, "development");
  assert.doesNotMatch(JSON.stringify(result), /password|token|postgresql:\/\//i);
});

test("merchant diagnostics render runtime identity only when the backend marks it visible", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8");
  assert.match(source, /v-if="platform\.runtimeIdentity\?\.visible"/);
  assert.match(source, /platform\.runtimeIdentity\.branch/);
  assert.match(source, /platform\.runtimeIdentity\.commitSha/);
  assert.match(source, /platform\.runtimeIdentity\.application/);
  assert.match(source, /platform\.runtimeIdentity\.server/);
  assert.match(source, /platform\.runtimeIdentity\.database/);
  assert.match(source, /platform\.runtimeIdentity\.buildTime/);
});
