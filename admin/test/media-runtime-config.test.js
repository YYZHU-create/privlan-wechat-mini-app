const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMediaStorageConfig } = require("../runtime-config");

const base = { ATELIER_ENVIRONMENT: "production", MEDIA_STORAGE_PROVIDER: "meoo", MEDIA_ASSET_V1_ENABLED: "true" };

test("Production V1 requires the exact Production bucket", () => {
  assert.equal(validateMediaStorageConfig({ ...base, MEDIA_STORAGE_BUCKET: "feeldao-production-media" }).bucket, "feeldao-production-media");
  assert.throws(() => validateMediaStorageConfig({ ...base, MEDIA_STORAGE_BUCKET: "merchant-assets" }), /Production Meoo V1 storage requires/);
  assert.throws(() => validateMediaStorageConfig({ ...base }), /MEDIA_STORAGE_BUCKET is required/);
});

test("Staging V1 accepts its explicit project-local bucket and rejects the Production bucket", () => {
  const staging = { ...base, ATELIER_ENVIRONMENT: "staging", MEDIA_STORAGE_BUCKET: "merchant-assets" };
  assert.deepEqual(validateMediaStorageConfig(staging), { ok: true, enabled: true, provider: "meoo", environment: "staging", bucket: "merchant-assets" });
  assert.throws(() => validateMediaStorageConfig({ ...staging, MEDIA_STORAGE_BUCKET: "feeldao-production-media" }), /cannot use the Production bucket/);
});

test("V1 fails closed when the trusted environment signal is missing", () => {
  assert.throws(() => validateMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "meoo", MEDIA_ASSET_V1_ENABLED: "true", MEDIA_STORAGE_BUCKET: "merchant-assets" }), /ATELIER_ENVIRONMENT is required/);
});

test("Legacy mode does not require V1 bucket configuration", () => {
  assert.deepEqual(validateMediaStorageConfig({ ATELIER_ENVIRONMENT: "staging" }), { ok: true, enabled: false, provider: "legacy", environment: null, bucket: null });
});
