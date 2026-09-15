const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildMediaRuntimeDiagnostic, resolveBuildIdentity, classifyRuntimeEnv, inspectRuntimeEnvFile, inspectRuntimeBuildMetadata } = require("../media-runtime-diagnostic");
const { registerLaunchV1OpsRoutes } = require("../launch-v1-routes");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const valid = {
  buildIdentity: { buildCommit: SHA, buildIdentitySource: "build-metadata" },
  environmentResolved: "staging",
  projectIdentity: "asmhysidbg5g",
  databaseBackendResolved: "meoo",
  mediaProviderResolved: "meoo",
  mediaAssetV1Requested: true,
  mediaAssetV1Active: true,
  mediaUploadRouteRegistered: true,
  storageValidation: { ok: true },
  supabaseUrlPresent: true,
  serviceRolePresent: true,
  databaseUrlPresent: false,
  bucket: "merchant-assets"
};

test("build identity uses immutable metadata and never git fallback", () => {
  assert.deepEqual(resolveBuildIdentity({ env: { ATELIER_GIT_SHA: "bad", ATELIER_RELEASE_METADATA_PATH: "missing" } }), { buildCommit: "unknown", buildIdentitySource: "unknown" });
  assert.deepEqual(resolveBuildIdentity({ env: { ATELIER_GIT_SHA: SHA } }), { buildCommit: SHA, buildIdentitySource: "runtime-metadata" });
});

test("active state requires the effective media service prerequisites", () => {
  const result = buildMediaRuntimeDiagnostic({ ...valid, mediaAssetV1Active: true, databaseBackendResolved: "native" });
  assert.equal(result.mediaAssetV1Active, false);
  assert.ok(result.activationBlockers.includes("DATABASE_BACKEND_NOT_MEOO"));
  assert.ok(result.activationBlockers.includes("MEDIA_SERVICE_NOT_CREATED"));
});

test("staging requested and active returns safe diagnostic with no blockers", () => {
  const result = buildMediaRuntimeDiagnostic(valid);
  assert.equal(result.diagnosticSchemaVersion, "g2c10e-v1");
  assert.equal(result.mediaAssetV1Requested, true);
  assert.equal(result.mediaAssetV1Active, true);
  assert.equal(result.mediaUploadRouteRegistered, true);
  assert.equal(result.mediaBucketClass, "project-bound-staging");
  assert.deepEqual(result.activationBlockers, []);
});

test("route registration and requested/active state remain distinct", () => {
  const result = buildMediaRuntimeDiagnostic({ ...valid, mediaUploadRouteRegistered: false, mediaAssetV1Active: false });
  assert.equal(result.mediaUploadRouteRegistered, false);
  assert.equal(result.mediaAssetV1Active, false);
  assert.ok(result.activationBlockers.includes("MEDIA_UPLOAD_ROUTE_NOT_REGISTERED"));
  assert.ok(result.activationBlockers.includes("MEDIA_SERVICE_NOT_CREATED"));
});

test("multiple blockers are returned together", () => {
  const result = buildMediaRuntimeDiagnostic({ buildIdentity: { buildCommit: "unknown", buildIdentitySource: "unknown" }, environmentResolved: "production", projectIdentity: "other", databaseBackendResolved: "native", mediaProviderResolved: "legacy", mediaAssetV1Requested: false, mediaAssetV1Active: false, mediaUploadRouteRegistered: false, storageValidation: { ok: false } });
  assert.deepEqual(result.activationBlockers, ["BUILD_IDENTITY_UNKNOWN", "ENVIRONMENT_NOT_STAGING", "PROJECT_IDENTITY_MISMATCH", "FLAG_DISABLED", "PROVIDER_NOT_MEOO", "DATABASE_BACKEND_NOT_MEOO", "INVALID_STORAGE_CONFIG", "MEDIA_UPLOAD_ROUTE_NOT_REGISTERED"]);
  assert.equal(result.mediaBucketClass, "missing");
});

test("unknown and production environments fail closed", () => {
  for (const environmentResolved of ["", "unknown", "production"]) {
    const result = buildMediaRuntimeDiagnostic({ ...valid, environmentResolved });
    assert.ok(result.activationBlockers.includes("ENVIRONMENT_NOT_STAGING"));
  }
});

test("diagnostic has no raw URL, secret, bucket or DSN values", () => {
  const result = buildMediaRuntimeDiagnostic({ ...valid, bucket: "merchant-assets", supabaseUrlPresent: true, serviceRolePresent: true });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /merchant-assets|https?:\/\/|postgres(?:ql)?:\/\/|secret-value|token-value|password-value/i);
  assert.equal(result.supabaseUrlPresent, true);
  assert.equal(result.serviceRolePresent, true);
});

test("runtime wiring passes effective state and privileged no-store route", () => {
  const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const ops = fs.readFileSync(path.resolve(__dirname, "../launch-v1-routes.js"), "utf8");
  assert.match(server, /MEDIA_STORAGE_VALIDATION/);
  assert.match(server, /MERCHANT_ROUTE_REGISTRATION\.mediaUploadRouteRegistered/);
  assert.match(server, /mediaAssetV1Active: Boolean\(mediaService\)/);
  assert.match(server, /MEOO_PROJECT_URL_ID/);
  assert.match(ops, /\/ops\/v1\/runtime\/media-diagnostic/);
  assert.match(ops, /Cache-Control.*no-store/);
  assert.match(ops, /!req\.operator/);
});

test("diagnostic route requires operator auth and marks responses no-store", async () => {
  const routes = {};
  registerLaunchV1OpsRoutes({ get(route, handler) { routes[route] = handler; }, patch() {}, post() {} }, () => Promise.resolve(null), { runtimeDiagnostic: () => ({ environmentResolved: "staging", diagnosticSchemaVersion: "g2c10e-v1" }) });
  const unauthorized = makeResponse();
  await routes["/ops/v1/runtime/media-diagnostic"]({}, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.code, "OPS_AUTH_REQUIRED");
  const authorized = makeResponse();
  await routes["/ops/v1/runtime/media-diagnostic"]({ operator: { id: "operator" }, requestId: "req" }, authorized);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.headers["Cache-Control"], "no-store");
  assert.equal(authorized.body.data.diagnosticSchemaVersion, "g2c10e-v1");
});

test("safe process environment classifications cover expected and absent values", () => {
  assert.deepEqual(classifyRuntimeEnv({ MEDIA_STORAGE_PROVIDER: "meoo", MEDIA_ASSET_V1_ENABLED: "true", MEDIA_STORAGE_BUCKET: "merchant-assets", ATELIER_DB_BACKEND: "meoo", ATELIER_ENVIRONMENT: "staging", ATELIER_RELEASE_METADATA_PATH: "" }), {
    runtimeEnvMediaStorageProviderClass: "EXPECTED_MEOO",
    runtimeEnvMediaAssetV1EnabledClass: "EXPECTED_TRUE",
    runtimeEnvMediaStorageBucketClass: "EXPECTED_MERCHANT_ASSETS",
    runtimeEnvAtelierDbBackendClass: "EXPECTED_MEOO",
    runtimeEnvAtelierEnvironmentClass: "EXPECTED_STAGING",
    runtimeEnvReleaseMetadataPathClass: "ABSENT"
  });
  assert.equal(classifyRuntimeEnv({}).runtimeEnvMediaStorageProviderClass, "ABSENT");
  assert.equal(classifyRuntimeEnv({ MEDIA_STORAGE_PROVIDER: "legacy", MEDIA_ASSET_V1_ENABLED: "0", MEDIA_STORAGE_BUCKET: "other", ATELIER_DB_BACKEND: "native", ATELIER_ENVIRONMENT: "production" }).runtimeEnvMediaStorageProviderClass, "UNEXPECTED");
});

test("diagnostic adds source classifications without exposing raw values", () => {
  const result = buildMediaRuntimeDiagnostic({ ...valid, env: { MEOO_PROJECT_URL_ID: "asmhysidbg5g", MEDIA_STORAGE_PROVIDER: "meoo", MEDIA_ASSET_V1_ENABLED: "true", MEDIA_STORAGE_BUCKET: "merchant-assets", ATELIER_DB_BACKEND: "meoo", ATELIER_ENVIRONMENT: "staging" }, runtimeRoot: path.resolve(__dirname, "../..") });
  assert.equal(result.configSourceDiagnosticVersion, "g2c10k-v1");
  assert.equal(result.runtimeEnvMediaStorageProviderClass, "EXPECTED_MEOO");
  assert.equal(result.mediaProviderEnvVsResolved, "MATCH");
  assert.equal(result.runtimeMediaConfigSourceClass, "PROCESS_ENV_EXPECTED");
  assert.equal(result.supabaseProjectBindingClass, "EXPECTED_STAGING_PROJECT");
  assert.equal(result.trustedProjectIdResolved, "asmhysidbg5g");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /merchant-assets|https?:\/\/|postgres(?:ql)?:\/\/|service-role|password|token/i);
});

test("runtime env file classifications are safe and non-secret", () => {
  const temp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "g2c10k-env-"));
  fs.writeFileSync(path.join(temp, ".runtime.env"), "export MEDIA_STORAGE_PROVIDER=meoo\nMEDIA_ASSET_V1_ENABLED=true\nMEDIA_STORAGE_BUCKET=merchant-assets\nATELIER_DB_BACKEND=meoo\nATELIER_ENVIRONMENT=staging\nATELIER_RELEASE_METADATA_PATH=/app/runtime-build.json\nSECRET=value\n");
  const result = inspectRuntimeEnvFile({ rootPath: temp });
  assert.equal(result.runtimeEnvFilePresent, true);
  assert.equal(result.runtimeEnvFileMediaProviderClass, "EXPECTED_MEOO");
  assert.equal(result.runtimeEnvFileMediaFlagClass, "EXPECTED_TRUE");
  assert.equal(result.runtimeEnvFileMediaBucketClass, "EXPECTED_MERCHANT_ASSETS");
  assert.equal(result.runtimeEnvFileReleaseMetadataPathClass, "CUSTOM_PATH_PRESENT");
  assert.doesNotMatch(JSON.stringify(result), /SECRET|value|merchant-assets/i);
});

test("missing runtime env file is explicit", () => {
  const temp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "g2c10k-env-missing-"));
  assert.deepEqual(inspectRuntimeEnvFile({ rootPath: temp }), { runtimeEnvFilePresent: false, runtimeEnvFileMediaProviderClass: "ABSENT", runtimeEnvFileMediaFlagClass: "ABSENT", runtimeEnvFileMediaBucketClass: "ABSENT", runtimeEnvFileDbBackendClass: "ABSENT", runtimeEnvFileEnvironmentClass: "ABSENT", runtimeEnvFileReleaseMetadataPathClass: "ABSENT" });
});

test("absent process media keys are distinguished from file overrides", () => {
  const result = buildMediaRuntimeDiagnostic({ ...valid, env: { MEOO_PROJECT_URL_ID: "asmhysidbg5g" }, runtimeRoot: fs.mkdtempSync(path.join(require("node:os").tmpdir(), "g2c10k-source-")) });
  assert.equal(result.runtimeMediaConfigSourceClass, "PROCESS_ENV_MEDIA_KEYS_ABSENT");
});

test("runtime build metadata reports valid and missing files", () => {
  const temp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "g2c10k-build-"));
  const metadata = path.join(temp, "runtime-build.json");
  fs.writeFileSync(metadata, JSON.stringify({ schemaVersion: "g2c10n-v1", commitSha: SHA, sourceCommit: SHA, declaredTargetProjectId: "asmhysidbg5g", environment: "staging", runtimeConfigDigest: "a".repeat(64), configSchemaVersion: "v1", branch: "main", buildTime: "2026-09-14T00:00:00Z" }));
  const validResult = inspectRuntimeBuildMetadata({ env: { ATELIER_RELEASE_METADATA_PATH: metadata } });
  assert.equal(validResult.runtimeBuildMetadataReadable, true);
  assert.equal(validResult.runtimeBuildMetadataCommit, SHA);
  assert.equal(validResult.runtimeBuildMetadataSourceCommit, SHA);
  assert.equal(validResult.runtimeBuildMetadataDeclaredTargetProjectId, "asmhysidbg5g");
  assert.equal(validResult.runtimeBuildMetadataRuntimeConfigDigest, "a".repeat(64));
  assert.equal(validResult.runtimeBuildMetadataConfigSchemaVersion, "v1");
  const missingResult = inspectRuntimeBuildMetadata({ env: { ATELIER_RELEASE_METADATA_PATH: path.join(temp, "missing.json") } });
  assert.equal(missingResult.runtimeBuildMetadataErrorClass, "FILE_ABSENT");
  fs.writeFileSync(metadata, "not-json");
  assert.equal(inspectRuntimeBuildMetadata({ env: { ATELIER_RELEASE_METADATA_PATH: metadata } }).runtimeBuildMetadataErrorClass, "INVALID_JSON");
});

test("wrong project binding is classified without returning a URL", () => {
  const result = buildMediaRuntimeDiagnostic({ ...valid, env: { MEOO_PROJECT_URL_ID: "other-project", MEDIA_STORAGE_PROVIDER: "meoo", MEDIA_ASSET_V1_ENABLED: "true", MEDIA_STORAGE_BUCKET: "merchant-assets", ATELIER_DB_BACKEND: "meoo", ATELIER_ENVIRONMENT: "staging" } });
  assert.equal(result.supabaseProjectBindingClass, "OTHER_PROJECT");
  assert.equal(result.trustedProjectIdResolved, null);
  assert.doesNotMatch(JSON.stringify(result), /other-project/);
});

test("production and unknown environments remain denied by the operator route", async () => {
  const routes = {};
  registerLaunchV1OpsRoutes({ get(route, handler) { routes[route] = handler; }, patch() {}, post() {} }, () => Promise.resolve(null), { runtimeDiagnostic: () => ({ environmentResolved: "production" }) });
  const production = makeResponse();
  await routes["/ops/v1/runtime/media-diagnostic"]({ operator: { id: "operator" } }, production);
  assert.equal(production.statusCode, 404);
  assert.equal(production.body.code, "OPS_FEATURE_NOT_AVAILABLE");
  const unknownRoutes = {};
  registerLaunchV1OpsRoutes({ get(route, handler) { unknownRoutes[route] = handler; }, patch() {}, post() {} }, () => Promise.resolve(null), { runtimeDiagnostic: () => ({ environmentResolved: "unknown" }) });
  const unknown = makeResponse();
  await unknownRoutes["/ops/v1/runtime/media-diagnostic"]({ operator: { id: "operator" } }, unknown);
  assert.equal(unknown.statusCode, 404);
});

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; }
  };
}
