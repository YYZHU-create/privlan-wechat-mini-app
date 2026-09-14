const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildMediaRuntimeDiagnostic, resolveBuildIdentity } = require("../media-runtime-diagnostic");
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
