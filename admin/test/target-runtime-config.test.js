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
const { CANARY_MARKER, CANARY_OPERATION, canaryConfigDigest } = require("../asset-lifecycle-permit");
const POLICY_ID = "10000000-0000-4000-8000-000000000011";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000012";
const { bootstrapRuntimeConfig } = require("../../scripts/runtime-bootstrap");

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
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, assetLifecycleMutationsEnabled: "true" } }), /MEDIA_LIFECYCLE_MUTATION_FLAG_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { storageProvider: "meoo", assetV1Enabled: true, storageBucket: "merchant-assets" } }), /MEDIA_LIFECYCLE_MUTATION_FLAG_INVALID/);
  assert.equal(validateRuntimeConfig(production).media.assetV1Enabled, false);
  assert.equal(validateRuntimeConfig(staging).media.assetLifecycleMutationsEnabled, false);
  assert.equal(validateRuntimeConfig(staging).media.lifecycleCanary.enabled, false);
  assert.equal(validateRuntimeConfig(production).media.lifecycleCanary.enabled, false);
});

test("canary runtime config binds one Staging target and always keeps the global gate off", () => {
  const now = Date.now();
  const tenantId = "00000000-0000-0000-0000-000000000002";
  const workspaceId = "00000000-0000-0000-0000-000000000003";
  const storeId = "00000000-0000-0000-0000-000000000004";
  const assetId = "00000000-0000-0000-0000-000000000005";
  const canary = {
    enabled: true, tenantId, workspaceId, storeId, assetId,
    operation: CANARY_OPERATION, expectedStatus: "ready",
    expectedObjectKey: `tenant/${tenantId}/workspace/${workspaceId}/asset/${assetId}/original.png`,
    marker: CANARY_MARKER, policyId: POLICY_ID, attemptId: ATTEMPT_ID, expiresAt: new Date(now + 5 * 60 * 1000).toISOString()
  };
  const config = validateRuntimeConfig({ ...staging, media: { ...staging.media, lifecycleCanary: canary } }, { deploymentProjectId: staging.targetProjectId });
  assert.equal(config.media.assetLifecycleMutationsEnabled, false);
  assert.deepEqual(config.media.lifecycleCanary, canary);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, assetLifecycleMutationsEnabled: true, lifecycleCanary: canary } }), /REQUIRES_GLOBAL_GATE_OFF/);
  expectThrow(() => validateRuntimeConfig({ ...production, media: { ...production.media, lifecycleCanary: canary } }), /STAGING_ONLY/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, lifecycleCanary: { ...canary, assetId: "" } } }), /SCOPE_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, lifecycleCanary: { ...canary, policyId: "bad" } } }), /SCOPE_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, lifecycleCanary: { ...canary, attemptId: canary.policyId } } }), /SCOPE_INVALID/);
  const expired = validateRuntimeConfig({ ...staging, media: { ...staging.media, lifecycleCanary: { ...canary, expiresAt: new Date(now - 1).toISOString() } } });
  assert.equal(expired.media.lifecycleCanary.enabled, true);
  expectThrow(() => validateRuntimeConfig({ ...staging, media: { ...staging.media, lifecycleCanary: { ...canary, expiresAt: "malformed" } } }), /SCOPE_INVALID/);
  expectThrow(() => validateRuntimeConfig({ ...production, media: { ...production.media, assetLifecycleMutationsEnabled: true } }), /PRODUCTION_LIFECYCLE_MUTATIONS_MUST_REMAIN_DISABLED/);
});

test("validated Canary config is injected through startup with exact scope and operation values", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-canary-config-"));
  const file = path.join(temp, "runtime-config.json");
  const tenantId = "00000000-0000-0000-0000-000000000002";
  const workspaceId = "00000000-0000-0000-0000-000000000003";
  const storeId = "00000000-0000-0000-0000-000000000004";
  const assetId = "00000000-0000-0000-0000-000000000005";
  const input = { ...staging, media: { ...staging.media, lifecycleCanary: { enabled: true, tenantId, workspaceId, storeId, assetId, operation: CANARY_OPERATION, expectedStatus: "ready", expectedObjectKey: `tenant/${tenantId}/workspace/${workspaceId}/asset/${assetId}/original.png`, marker: CANARY_MARKER, policyId: POLICY_ID, attemptId: ATTEMPT_ID, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() } } };
  fs.writeFileSync(file, JSON.stringify(input));
  const env = { ATELIER_ENVIRONMENT: "staging", MEOO_PROJECT_URL_ID: staging.targetProjectId };
  try {
    const loaded = loadRuntimeConfig(file, { env, deploymentProjectId: staging.targetProjectId });
    assert.equal(loaded.config.media.assetLifecycleMutationsEnabled, false);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_ENABLED, "true");
    assert.equal(env.ASSET_LIFECYCLE_CANARY_TENANT_ID, tenantId);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_WORKSPACE_ID, workspaceId);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_STORE_ID, storeId);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_ASSET_ID, assetId);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_OPERATION, CANARY_OPERATION);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_MARKER, CANARY_MARKER);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_POLICY_ID, POLICY_ID);
    assert.equal(env.ASSET_LIFECYCLE_CANARY_ATTEMPT_ID, ATTEMPT_ID);
    assert.equal(env.ATELIER_CANARY_CONFIG_DIGEST, canaryConfigDigest(loaded.config.media.lifecycleCanary));
    assert.match(env.ATELIER_RUNTIME_CONFIG_DIGEST, /^[0-9a-f]{64}$/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("malformed or absent runtime config never enables media", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "g2c10n-config-"));
  const malformed = path.join(temp, "bad.json");
  fs.writeFileSync(malformed, "not-json");
  expectThrow(() => loadRuntimeConfig(malformed, { env: {} }), /Unexpected token/);
  expectThrow(() => loadRuntimeConfig(path.join(temp, "absent.json"), { env: {} }), /ENOENT/);
  assert.equal(process.env.MEDIA_ASSET_V1_ENABLED, undefined);
  assert.equal(process.env.ASSET_LIFECYCLE_MUTATIONS_ENABLED, undefined);
});

test("bootstrap defaults missing, malformed, and partial runtime config to fail-closed status", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-bootstrap-failclosed-"));
  const missingEnv = { ATELIER_RUNTIME_CONFIG_LOAD_STATUS: "LOADED_VALIDATED", ASSET_LIFECYCLE_CANARY_ENABLED: "true" };
  const missing = bootstrapRuntimeConfig({ root: temp, env: missingEnv, log() {} });
  assert.equal(missing.status, "NOT_FOUND_FAIL_CLOSED");
  assert.equal(missingEnv.ATELIER_RUNTIME_CONFIG_LOAD_STATUS, "NOT_FOUND_FAIL_CLOSED");
  const malformed = path.join(temp, "malformed.json"); fs.writeFileSync(malformed, "{");
  const malformedEnv = { ATELIER_RUNTIME_CONFIG_PATH: malformed, ATELIER_RUNTIME_CONFIG_LOAD_STATUS: "LOADED_VALIDATED", ASSET_LIFECYCLE_CANARY_ENABLED: "true" };
  assert.equal(bootstrapRuntimeConfig({ root: temp, env: malformedEnv, log() {} }).status, "INVALID_FAIL_CLOSED");
  assert.equal(malformedEnv.ATELIER_RUNTIME_CONFIG_LOAD_STATUS, "INVALID_FAIL_CLOSED");
  const partial = path.join(temp, "partial.json");
  fs.writeFileSync(partial, JSON.stringify({ ...staging, media: { ...staging.media, lifecycleCanary: { enabled: true, tenantId: "" } } }));
  const partialEnv = { ATELIER_RUNTIME_CONFIG_PATH: partial, ATELIER_ENVIRONMENT: "staging", MEOO_PROJECT_URL_ID: staging.targetProjectId };
  assert.equal(bootstrapRuntimeConfig({ root: temp, env: partialEnv, log() {} }).status, "INVALID_FAIL_CLOSED");
  assert.equal(partialEnv.ASSET_LIFECYCLE_CANARY_ENABLED, undefined);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("fresh process and restarted process with no config keep Canary OFF", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-bootstrap-restart-"));
  try {
    const modulePath = path.resolve(__dirname, "../../scripts/runtime-bootstrap.js");
    const source = `const { bootstrapRuntimeConfig } = require(${JSON.stringify(modulePath)}); const env = { ...process.env }; const result = bootstrapRuntimeConfig({ root: process.argv[1], env, log() {} }); const enabled = env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS === "LOADED_VALIDATED" && env.ASSET_LIFECYCLE_CANARY_ENABLED === "true"; process.stdout.write(result.status + "|" + enabled);`;
    for (const launch of ["fresh-instance", "process-restart"]) {
      const child = spawnSync(process.execPath, ["-e", source, temp], {
        encoding: "utf8",
        env: { ...process.env, ATELIER_RUNTIME_CONFIG_PATH: "", ATELIER_RUNTIME_CONFIG_LOAD_STATUS: "LOADED_VALIDATED", ASSET_LIFECYCLE_CANARY_ENABLED: "true" }
      });
      assert.equal(child.status, 0, `${launch}: ${child.stderr}`);
      assert.equal(child.stdout, "NOT_FOUND_FAIL_CLOSED|false", launch);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("image entrypoint uses validated bootstrap before starting the server", () => {
  const dockerfile = fs.readFileSync(path.resolve(__dirname, "../../Dockerfile"), "utf8");
  assert.match(dockerfile, /CMD\s+\["node",\s*"\/app\/scripts\/runtime-bootstrap\.js"\]/);
  const bootstrapSource = fs.readFileSync(path.resolve(__dirname, "../../scripts/runtime-bootstrap.js"), "utf8");
  assert.match(bootstrapSource, /prepareApplicationRuntime\(\{ root \}\);[\s\S]*require\(path\.join\(root, "admin", "server\.js"\)\)/);
  assert.match(bootstrapSource, /const result = bootstrapRuntimeConfig\([\s\S]*validateApplicationTarget\(result.config, env\)/);
});

test("config is authoritative but conflicting process media values fail closed and unrelated secrets stay intact", () => {
  const env = { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "secret-value", MEDIA_STORAGE_PROVIDER: "legacy" };
  expectThrow(() => loadRuntimeConfig(path.resolve(__dirname, "../../runtime-config/staging.json"), { env }), /MEDIA_CONFIG_CONFLICT/);
  const cleanEnv = { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "secret-value" };
  const result = loadRuntimeConfig(path.resolve(__dirname, "../../runtime-config/staging.json"), { env: cleanEnv, deploymentProjectId: staging.targetProjectId });
  assert.equal(cleanEnv.SUPABASE_URL, "https://example.invalid");
  assert.equal(cleanEnv.SUPABASE_SERVICE_ROLE_KEY, "secret-value");
  assert.equal(cleanEnv.MEDIA_STORAGE_PROVIDER, "meoo");
  assert.equal(cleanEnv.ASSET_LIFECYCLE_MUTATIONS_ENABLED, "false");
  assert.equal(cleanEnv.ASSET_LIFECYCLE_CANARY_ENABLED, "false");
  assert.equal(cleanEnv.ASSET_LIFECYCLE_CANARY_ASSET_ID, "");
  assert.equal(result.config.targetProjectId, staging.targetProjectId);
});

test("canonical serialization and digest are deterministic and metadata carries exact source", () => {
  const a = canonicalizeRuntimeConfig(staging);
  const b = canonicalizeRuntimeConfig({ media: { storageBucket: "merchant-assets", assetLifecycleMutationsEnabled: false, assetV1Enabled: true, storageProvider: "meoo" }, environment: "staging", targetProjectId: "asmhysidbg5g", schemaVersion: "v1" });
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
  fs.writeFileSync(path.join(output, "admin", "server.js"), "console.log(JSON.stringify({provider:process.env.MEDIA_STORAGE_PROVIDER, enabled:process.env.MEDIA_ASSET_V1_ENABLED, lifecycleMutationsEnabled:process.env.ASSET_LIFECYCLE_MUTATIONS_ENABLED, bucket:process.env.MEDIA_STORAGE_BUCKET, configStatus:process.env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS}));");
  const result = spawnSync("sh", [path.join(output, "scripts", "start.sh")], { encoding: "utf8", env: { ...process.env, ATELIER_ENVIRONMENT: "staging", ATELIER_DB_BACKEND: "meoo", PORT: "19001" }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  assert.deepEqual(JSON.parse(line), { provider: "meoo", enabled: "true", lifecycleMutationsEnabled: "false", bucket: "merchant-assets", configStatus: "LOADED_VALIDATED" });
});
