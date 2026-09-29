const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildMetadata, writeRuntimeBuildMetadata } = require("../../scripts/write-runtime-build-metadata");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const DIGEST = `sha256:${"a".repeat(64)}`;

test("build metadata uses supplied immutable build values and preserves config binding", () => {
  const metadata = buildMetadata({
    env: { ATELIER_GIT_SHA: SHA, ATELIER_GIT_BRANCH: "codex/canary-hardening", ATELIER_BUILD_TIME: "2026-09-23T01:02:03Z", ATELIER_ENVIRONMENT: "staging", ATELIER_ARTIFACT_DIGEST: DIGEST },
    existing: { declaredTargetProjectId: "asmhysidbg5g", runtimeConfigDigest: "b".repeat(64), configSchemaVersion: "v1" }
  });
  assert.deepEqual(metadata, {
    schemaVersion: "feeldao-build-identity-v1", commitSha: SHA, sourceCommit: SHA,
    branch: "codex/canary-hardening", buildTime: "2026-09-23T01:02:03.000Z", artifactDigest: DIGEST,
    declaredTargetProjectId: "asmhysidbg5g", environment: "staging",
    runtimeConfigDigest: "b".repeat(64), configSchemaVersion: "v1"
  });
});

test("missing or malformed pipeline identity remains UNKNOWN", () => {
  const metadata = buildMetadata({ env: { ATELIER_GIT_SHA: "bad", ATELIER_GIT_BRANCH: "bad branch", ATELIER_BUILD_TIME: "invalid", ATELIER_ENVIRONMENT: "unknown", ATELIER_ARTIFACT_DIGEST: "bad" } });
  assert.equal(metadata.commitSha, "unknown");
  assert.equal(metadata.sourceCommit, "unknown");
  assert.equal(metadata.branch, "unknown");
  assert.equal(metadata.buildTime, "unknown");
  assert.equal(metadata.artifactDigest, "unknown");
  assert.equal(metadata.environment, "unknown");
  assert.doesNotMatch(JSON.stringify(metadata), /secret|password|token|cookie/i);
});

test("Docker build metadata writer readbacks immutable values without credentials", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-build-writer-"));
  const filePath = path.join(temp, "runtime-build.json");
  fs.writeFileSync(filePath, JSON.stringify({ declaredTargetProjectId: "asmhysidbg5g", runtimeConfigDigest: "c".repeat(64), configSchemaVersion: "v1" }));
  const metadata = writeRuntimeBuildMetadata({ filePath, env: { ATELIER_GIT_SHA: SHA, ATELIER_GIT_BRANCH: "main", ATELIER_BUILD_TIME: "2026-09-23T00:00:00Z", ATELIER_ENVIRONMENT: "staging" } });
  const reopened = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.deepEqual(reopened, metadata);
  assert.equal(reopened.commitSha, SHA);
  assert.equal(reopened.artifactDigest, "unknown");
  assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /secret|password|token|cookie/i);
  fs.rmSync(temp, { recursive: true, force: true });
});
