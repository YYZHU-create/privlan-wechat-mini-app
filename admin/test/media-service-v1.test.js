const assert = require("node:assert/strict");
const test = require("node:test");
const { canonicalObjectKey, createMediaService, MediaServiceError } = require("../media-service-v1");
const { createMeooStorageProvider, StorageProviderError } = require("../storage-provider");

const SCOPE = { userId: "00000000-0000-0000-0000-000000000001", tenantId: "00000000-0000-0000-0000-000000000002", workspaceId: "00000000-0000-0000-0000-000000000003", storeId: "00000000-0000-0000-0000-000000000004", requestId: "req-test" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function repository(overrides = {}) {
  const calls = []; const assets = new Map(); const objects = new Map();
  return { calls, assets, objects,
    async createPendingAsset(scope, input) { calls.push(["pending", input]); const row = { ...input, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, status: "pending" }; assets.set(input.id, row); return row; },
    async createAssetObject(scope, input) { calls.push(["object", input]); const row = { ...input, id: input.id || "object-id" }; objects.set(input.assetId, row); return row; },
    async createAssetLink(scope, input) { calls.push(["link", input]); return input; },
    async transitionAssetStatus(scope, id, status) { calls.push(["status", id, status]); const row = assets.get(id); if (row) row.status = status; return row; },
    async getAssetByIdScoped(scope, id) { const row = assets.get(id); return row && row.tenant_id === scope.tenantId && row.workspace_id === scope.workspaceId ? row : null; },
    async getAssetObject(scope, id) { return objects.get(id) || null; },
    async requestAssetDeletion(scope, id) { calls.push(["deletion_requested", id]); return this.transitionAssetStatus(scope, id, "deletion_requested"); },
    async markAssetDeleted(scope, id) { calls.push(["deleted", id]); return this.transitionAssetStatus(scope, id, "deleted"); },
    async productInScope() { return true; }, ...overrides };
}

function provider(overrides = {}) {
  const calls = [];
  return { name: "meoo", bucket: "feeldao-production-media", calls,
    async uploadObject(scope, key, bytes) { calls.push(["upload", key]); return { checksum: require("../storage-provider").sha256Hex(bytes) }; },
    async verifyObject(scope, key, expected) { calls.push(["verify", key]); return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType, bytes: new Uint8Array(expected.sizeBytes) }; },
    async readObject() { return { bytes: new Uint8Array([1, 2]), mimeType: "image/png", sizeBytes: 2 }; },
    async deleteObject(scope, key) { calls.push(["delete", key]); return { deleted: true }; }, ...overrides };
}

test("canonical key is scoped, UUID-based and traversal-resistant", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(canonicalObjectKey(SCOPE, id, "original", ".png"), `tenant/${SCOPE.tenantId}/workspace/${SCOPE.workspaceId}/asset/${id}/original.png`);
  assert.throws(() => canonicalObjectKey(SCOPE, id, "../x", ".png"), MediaServiceError);
});

test("Meoo provider requires explicit bucket configuration", () => {
  assert.throws(() => createMeooStorageProvider({ url: "https://example.test", serviceRoleKey: "server-only", bucket: "" }), error => error instanceof StorageProviderError && error.code === "STORAGE_BUCKET_REQUIRED");
});

test("Meoo provider exposes provider-neutral upload, verify, read and exact delete", async () => {
  const calls = []; let present = true;
  const storage = {
    async upload(key, bytes, options) { calls.push(["upload", key, options.upsert]); return { data: { path: key }, error: null }; },
    async download(key) { calls.push(["download", key]); return present ? { data: new Blob([Buffer.from("ok")], { type: "image/png" }), error: null } : { data: null, error: { statusCode: 404 } }; },
    async remove(keys) { calls.push(["remove", keys]); present = false; return { data: [], error: null }; },
  };
  const p = createMeooStorageProvider({ url: "https://example.test", serviceRoleKey: "server-only", bucket: "feeldao-production-media", client: { storage: { from(bucket) { assert.equal(bucket, "feeldao-production-media"); return storage; } } } });
  const uploaded = await p.uploadObject(SCOPE, "tenant/a", Buffer.from("ok"), "image/png");
  const verified = await p.verifyObject(SCOPE, "tenant/a", { sizeBytes: 2, checksum: uploaded.checksum, mimeType: "image/png" });
  assert.equal(verified.sizeBytes, 2);
  const read = await p.readObject(SCOPE, "tenant/a"); assert.equal(read.sizeBytes, 2);
  await p.deleteObject(SCOPE, "tenant/a"); assert.equal(await p.verifyDeleted(SCOPE, "tenant/a"), true);
  assert.deepEqual(calls.map(call => call[0]), ["upload", "download", "download", "remove", "download"]);
  assert.equal(calls[0][2], false);
});

test("V1 upload creates pending asset, object, link and ready state", async () => {
  const repo = repository(); const svc = createMediaService({ provider: provider(), repository: repo });
  const result = await svc.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 4 });
  assert.equal(result.status, "ready"); assert.equal(result.path, `/api/media/v1/content/${result.id}`);
  assert.deepEqual(repo.calls.map(call => call[0]), ["pending", "object", "link", "status"]);
  assert.equal(repo.calls.at(-1)[2], "ready");
});

test("upload failure marks asset failed and deletes only the exact key", async () => {
  const repo = repository(); const p = provider({ async verifyObject() { throw new Error("verify"); } }); const svc = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => svc.upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_FAILED");
  assert.equal(p.calls.filter(c => c[0] === "delete").length, 1); assert.equal(repo.calls.at(-1)[2], "failed");
});

test("product link requires same workspace scope", async () => {
  const repo = repository({ async productInScope() { return false; } }); const p = provider(); const svc = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => svc.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 999 }), error => error.code === "PRODUCT_SCOPE_DENIED");
  assert.equal(repo.calls.some(c => c[0] === "link"), false); assert.equal(p.calls.some(c => c[0] === "delete"), true);
});

test("read requires ready non-deleted asset and downloads through provider", async () => {
  const repo = repository(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" }); repo.objects.set("asset", { assetId: "asset", objectKey: "tenant/a" , object_key: "tenant/a", mimeType: "image/png", mime_type: "image/png" });
  const result = await createMediaService({ provider: provider(), repository: repo }).read(SCOPE, "asset"); assert.equal(result.mimeType, "image/png");
  repo.assets.get("asset").status = "pending"; await assert.rejects(() => createMediaService({ provider: provider(), repository: repo }).read(SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND");
});

test("delete follows deletion_requested, exact provider delete and deleted", async () => {
  const repo = repository(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" }); repo.objects.set("asset", { object_key: "tenant/x" }); const p = provider();
  const result = await createMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset"); assert.equal(result.deleted, true); assert.deepEqual(repo.calls.map(c => c[0]), ["deletion_requested", "status", "deleted", "status"]);
  assert.deepEqual(p.calls.at(-1), ["delete", "tenant/x"]);
});

test("unsupported MIME and malformed data are rejected by server validation", async () => {
  const svc = createMediaService({ provider: provider(), repository: repository() });
  await assert.rejects(() => svc.upload(SCOPE, { name: "bad.txt", data: "data:text/plain;base64,SGk=" }), error => error.code === "MEDIA_TYPE_MISMATCH");
});
