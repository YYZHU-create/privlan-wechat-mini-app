const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRuntimeIdentity } = require("../runtime-identity");

test("development runtime identity exposes branch, commit SHA, and environment", () => {
  const calls = [];
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "development", PORT: "40003", DATABASE_URL: "postgresql://db-user:super-password@127.0.0.1:5432/atelier_os_development?token=hidden" },
    now: () => new Date("2026-08-20T08:30:00.000Z"),
    readGit(args) {
      calls.push(args.join(" "));
      return args.includes("--abbrev-ref") ? "codex/runtime-identity\n" : "0123456789abcdef0123456789abcdef01234567\n";
    }
  });
  assert.deepEqual(result, {
    visible: true,
    environment: "development",
    application: "ATELIER OS Merchant Console",
    branch: "codex/runtime-identity",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    server: "40003",
    database: "atelier_os_development",
    buildTime: "2026-08-20T08:30:00.000Z"
  });
  assert.deepEqual(calls, ["rev-parse --abbrev-ref HEAD", "rev-parse HEAD"]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /super-password|token=|postgresql:\/\/|DATABASE_URL/i);
});

test("staging takes precedence over development and supports deployment-provided git values", () => {
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "development", DATABASE_ENV: "staging", PORT: "41000", ATELIER_DATABASE_LABEL: "atelier_os_staging", ATELIER_BUILD_TIME: "2026-08-20T16:30:00+08:00", ATELIER_GIT_BRANCH: "codex/staging", ATELIER_GIT_SHA: "abcdef1234567" },
    readGit() { throw new Error("git should not be called"); }
  });
  assert.deepEqual(result, { visible: true, environment: "staging", application: "ATELIER OS Merchant Console", branch: "codex/staging", commitSha: "abcdef1234567", server: "41000", database: "atelier_os_staging", buildTime: "2026-08-20T08:30:00.000Z" });
});

test("production hides runtime identity and never reads git metadata", () => {
  let called = false;
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "production", DATABASE_ENV: "staging" },
    readGit() { called = true; return "should-not-be-read"; }
  });
  assert.deepEqual(result, { visible: false });
  assert.equal(called, false);
});

test("runtime identity rejects unsafe database labels and invalid ports", () => {
  const result = resolveRuntimeIdentity({
    env: { NODE_ENV: "development", PORT: "40003?token=secret", ATELIER_DATABASE_LABEL: "postgresql://user:password@host/database" },
    now: () => new Date("2026-08-20T08:30:00.000Z"),
    readGit(args) { return args.includes("--abbrev-ref") ? "codex/safe" : "abcdef1234567"; }
  });
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
