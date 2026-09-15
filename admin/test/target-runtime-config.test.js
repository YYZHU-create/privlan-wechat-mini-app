const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  TARGETS, validateRuntimeConfig, canonicalizeRuntimeConfig, runtimeConfigDigest,
  loadRuntimeConfig, createBuildMetadata, createDeploymentArtifact
} = require("../target-runtime-config");

const SHA = "b4e12cd8ca82eaf27246b7f41df1c37fbd063388";
const staging = TARGETS.staging;
const production = TARGETS.production;
const expectThrow = (fn, pattern) => assert.throws(fn, pattern);

test("staging and production configs validate and exact target binding is enforced", () => {
  assert.deepEqual(validateRuntimeConfig(staging, { deploymentProjectId: staging.targetProjectId }), staging);
  assert.deepEqual(validateRuntimeConfig(production, { deploymentProjectId: production.targetProjectId }), production);
  expectThrow(() => validateRuntimeConfig(staging, { deploymentProjectId: production.targetProjectId }), /DEPLOYMENT_TARGET_CONFIG_MISMATCH/);
  expectThrow(() => validateRuntimeConfig(production, { deploymentProjectId: staging.targetProjectId }), /DEPLOYMENT_TARGET_CONFIG_MISMATCH/);
  expectThrow(() => validateRuntimeConfig(staging, { deploymentProjectId: "unknown-project" }), /UNKNOWN|MISMATCH/);
  expectThrow(() => validateRuntimeConfig({ ...staging, targetProjectId: undefined }), /TARGET_PROJECT_ID_INVALID/);
});

test("schema, JSON shape, secret-like and media invariants fail closed", () => {
  expectThrow(() => validateRuntimeConfig({ ...staging, schemaVersion: "v2" }), /SCHEMA_VERSION_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...staging, extra: true }), /CONFIG_FIELD_NOT_ALLOWED/);
  expectThrow(() => validateRuntimeConfig({ ...staging, password: "x" }), /CONFIG_FIELD_NOT_ALLOWED/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, storageProvider: "legacy" } }), /MEDIA_INVARIANT_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, storageBucket: "" } }), /MEDIA_INVARIANT_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, assetV1Enabled: "true" } }), /MEDIA_FLAG_INVALID/);
  assert.equal(validateRuntimeConfig(production).media.assetV1Enabled, false);
});

test("malformed or absent runtime config never enables media", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "g2c10n-config-"));
  const malformed = path.join(temp, "bad.json");
  fs.writeFileSync(malformed, "not-json");
  expectThrow(() => loadRuntimeConfig(malformed, { env: {} }), /Unexpected token/);
  expectThrow(() => loadRuntimeConfig(path.join(temp, "absent.json"), { env: {} }), /ENOENT/);
  assert.equal(process.env.MEDIA_ASSET_V1_ENABLED, undefined);
});

test("config is authoritative but conflicting process media values fail closed and unrelated secrets stay intact", () => {
  const env = { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "secret-value", MEDIA_STORAGE_PROVIDER: "legacy" };
  expectThrow(() => loadRuntimeConfig(path.resolve(__dirname, "../../runtime-config/staging.json"), { env }), /MEDIA_CONFIG_CONFLICT/);
  const cleanEnv = { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "secret-value" };
  const result = loadRuntimeConfig(path.resolve(__dirname, "../../runtime-config/staging.json"), { env: cleanEnv, deploymentProjectId: staging.targetProjectId });
  assert.equal(cleanEnv.SUPABASE_URL, "https://example.invalid");
  assert.equal(cleanEnv.SUPABASE_SERVICE_ROLE_KEY, "secret-value");
  assert.equal(cleanEnv.MEDIA_STORAGE_PROVIDER, "meoo");
  assert.equal(result.config.targetProjectId, staging.targetProjectId);
});

test("canonical serialization and digest are deterministic and metadata carries exact source", () => {
  const a = canonicalizeRuntimeConfig(staging);
  const b = canonicalizeRuntimeConfig({ media: { storageBucket: "merchant-assets", assetV1Enabled: true, storageProvider: "meoo" }, environment: "staging", targetProjectId: "asmhysidbg5g", schemaVersion: "v1" });
  assert.equal(a, b);
  assert.equal(runtimeConfigDigest(staging), runtimeConfigDigest(JSON.parse(b)));
  const metadata = createBuildMetadata({ sourceCommit: SHA, targetProjectId: staging.targetProjectId, environment: "staging", runtimeConfigDigest: runtimeConfigDigest(staging) });
  assert.equal(metadata.sourceCommit, SHA);
  assert.equal(metadata.runtimeConfigDigest, runtimeConfigDigest(staging));
  assert.doesNotMatch(JSON.stringify(metadata), /secret|password|token|cookie/i);
});

test("isolated artifact has external non-circular digest and excludes runtime env", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "g2c10n-source-"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "g2c10n-output-"));
  fs.writeFileSync(path.join(source, "app.js"), "module.exports=1;\n");
  fs.writeFileSync(path.join(source, ".runtime.env"), "SECRET=not-in-artifact\n");
  const result = createDeploymentArtifact({ sourceDir: source, outputDir: output, targetProjectId: staging.targetProjectId, sourceCommit: SHA, config: staging });
  assert.equal(fs.existsSync(path.join(output, ".runtime.env")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "runtime-build.json"))).sourceCommit, SHA);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "runtime-build.json"))).runtimeConfigDigest, result.runtimeConfigDigest);
  assert.equal(result.evidence.artifactDigestLocation, undefined);
  assert.equal(result.artifactDigest, require("../target-runtime-config").hashDirectory(output));
  assert.doesNotMatch(fs.readFileSync(path.join(output, "runtime-build.json"), "utf8"), /artifactDigest/);
});

test("target-bound loader rejects trusted runtime target mismatch", () => {
  const env = {};
  expectThrow(() => loadRuntimeConfig(path.resolve(__dirname, "../../runtime-config/staging.json"), { env, deploymentProjectId: production.targetProjectId }), /MISMATCH/);
  assert.equal(env.MEDIA_ASSET_V1_ENABLED, undefined);
});

test("actual start.sh bootstrap propagates staging config into the server process", { skip: process.platform === "win32" ? "POSIX sh is unavailable on the Windows runner" : false }, () => {
  const source = path.resolve(__dirname, "../..");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "g2c10n-e2e-"));
  const { createDeploymentArtifact } = require("../target-runtime-config");
  createDeploymentArtifact({ sourceDir: source, outputDir: output, targetProjectId: staging.targetProjectId, sourceCommit: SHA, config: staging });
  fs.writeFileSync(path.join(output, "admin", "server.js"), "console.log(JSON.stringify({provider:process.env.MEDIA_STORAGE_PROVIDER, enabled:process.env.MEDIA_ASSET_V1_ENABLED, bucket:process.env.MEDIA_STORAGE_BUCKET, configStatus:process.env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS}));");
  const result = spawnSync("sh", [path.join(output, "scripts", "start.sh")], { encoding: "utf8", env: { ...process.env, ATELIER_ENVIRONMENT: "staging", ATELIER_DB_BACKEND: "meoo", PORT: "19001" }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  assert.deepEqual(JSON.parse(line), { provider: "meoo", enabled: "true", bucket: "merchant-assets", configStatus: "LOADED_VALIDATED" });
});
