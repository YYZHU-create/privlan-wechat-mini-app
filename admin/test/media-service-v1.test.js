const assert = require("node:assert/strict");
const test = require("node:test");
const { canonicalObjectKey, createMediaService, MediaServiceError } = require("../media-service-v1");
const { createMeooStorageProvider, StorageProviderError } = require("../storage-provider");
const { hasTrustedPublicMessage } = require("../public-error");

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
    async listAssetObjects(scope, id) { const row = objects.get(id); return row ? (Array.isArray(row) ? row : [row]) : []; },
    async requestAssetDeletion(scope, id) { calls.push(["deletion_requested", id]); return { outcome: "CAS_ACQUIRED", asset: await this.transitionAssetStatus(scope, id, "deletion_requested") }; },
    async markAssetDeleted(scope, id) { calls.push(["deleted", id]); return this.transitionAssetStatus(scope, id, "deleted"); },
    async finalizeAssetDeletion(scope, id, input) { calls.push(["finalize", id, input]); const row = assets.get(id); if (row) { row.status = "deleted"; row.deleted_at = input.storageVerifiedAt; } return { id, deleted: true, duplicate: false }; },
    async productInScope() { return true; }, ...overrides };
}

function provider(overrides = {}) {
  const calls = [];
  return { name: "meoo", bucket: "feeldao-production-media", calls,
    async uploadObject(scope, key, bytes) { calls.push(["upload", key]); return { checksum: require("../storage-provider").sha256Hex(bytes) }; },
    async verifyObject(scope, key, expected) { calls.push(["verify", key]); return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType, bytes: new Uint8Array(expected.sizeBytes) }; },
    async readObject(_scope, key) { calls.push(["read", key]); return { bytes: new Uint8Array([1, 2]), mimeType: "image/png", sizeBytes: 2 }; },
    async deleteObject(scope, key) { calls.push(["delete", key]); return { deleted: true }; },
    async verifyDeleted(scope, key) { calls.push(["verify-deleted", key]); return true; }, ...overrides };
}

function mutableMediaService(input) {
  return createMediaService({ ...input, lifecycleMutationsEnabled: true });
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
  const repo = repository(); const p = provider(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" }); repo.objects.set("asset", { assetId: "asset", objectKey: "tenant/a" , object_key: "tenant/a", mimeType: "image/png", mime_type: "image/png" });
  const result = await createMediaService({ provider: p, repository: repo }).read(SCOPE, "asset"); assert.equal(result.mimeType, "image/png"); assert.deepEqual(p.calls, [["read", "tenant/a"]]);
  repo.assets.get("asset").status = "pending"; await assert.rejects(() => createMediaService({ provider: provider(), repository: repo }).read(SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND");
});

test("delete verifies every registered object before finalizing the audited tombstone", async () => {
  const repo = repository(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" }); repo.objects.set("asset", { object_key: "tenant/x" }); const p = provider();
  repo.objects.set("asset", [{ object_key: "tenant/x" }, { object_key: "tenant/x-web" }]);
  const result = await mutableMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset"); assert.equal(result.deleted, true);
  assert.deepEqual(repo.calls.map(c => c[0]), ["deletion_requested", "status", "finalize"]);
  assert.deepEqual(p.calls, [["delete", "tenant/x"], ["verify-deleted", "tenant/x"], ["delete", "tenant/x-web"], ["verify-deleted", "tenant/x-web"]]);
  assert.equal(repo.calls.at(-1)[2].objectCount, 2);
});

test("deletion_requested assets never resume Storage deletion without a persisted owner", async () => {
  const repo = repository(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "deletion_requested" }); repo.objects.set("asset", { object_key: "tenant/x" });
  const p = provider();
  await assert.rejects(() => mutableMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset"), error => error.code === "ASSET_DELETION_IN_PROGRESS");
  assert.equal(repo.calls.some(call => call[0] === "deletion_requested"), false);
  assert.equal(repo.calls.some(call => call[0] === "finalize"), false);
  assert.equal(p.calls.length, 0);
  assert.equal(repo.assets.get("asset").status, "deletion_requested");
});

test("already deleted assets return the idempotent result without Storage access", async () => {
  const repo = repository();
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "deleted", deleted_at: "2026-09-20T00:00:00.000Z" });
  const p = provider();
  const result = await mutableMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset");
  assert.deepEqual(result, { id: "asset", deleted: true, duplicate: true });
  assert.equal(p.calls.length, 0);
  assert.equal(repo.calls.length, 0);
});

test("delete leaves an asset pending reconciliation when no registered object exists", async () => {
  const repo = repository();
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  await assert.rejects(() => mutableMediaService({ provider: provider(), repository: repo }).remove(SCOPE, "asset"), error => error.code === "ASSET_OBJECT_NOT_FOUND");
  assert.equal(repo.calls.some(call => call[0] === "finalize"), false);
  assert.equal(repo.assets.get("asset").status, "deletion_requested");
});

test("concurrent ready deletes yield one CAS owner and one Storage delete", async () => {
  const repo = repository();
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  repo.objects.set("asset", { object_key: "tenant/x" });
  let arrivals = 0; let release;
  const contenderBarrier = new Promise(resolve => { release = resolve; });
  repo.requestAssetDeletion = async function claim(_scope, id) {
    this.calls.push(["deletion_requested", id]);
    arrivals += 1;
    if (arrivals === 2) release();
    await contenderBarrier;
    const asset = this.assets.get(id);
    if (asset.status === "ready") {
      asset.status = "deletion_requested";
      return { outcome: "CAS_ACQUIRED", asset };
    }
    return { outcome: "CAS_NOT_ACQUIRED", asset };
  };
  const p = provider(); const service = mutableMediaService({ provider: p, repository: repo });
  const results = await Promise.allSettled([service.remove(SCOPE, "asset"), service.remove(SCOPE, "asset")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "ASSET_DELETION_IN_PROGRESS").length, 1);
  assert.equal(p.calls.filter(call => call[0] === "delete").length, 1);
  assert.equal(repo.calls.filter(call => call[0] === "finalize").length, 1);
});

test("partial multi-object Storage failure retains deletion_requested and never finalizes", async () => {
  const repo = repository();
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  repo.objects.set("asset", [{ object_key: "tenant/a" }, { object_key: "tenant/b" }]);
  const p = provider({ async deleteObject(_scope, key) { this.calls.push(["delete", key]); if (key === "tenant/b") { const error = new Error("network"); error.code = "STORAGE_UNAVAILABLE"; throw error; } return { deleted: true }; }, async verifyDeleted(_scope, key) { this.calls.push(["verify-deleted", key]); return key !== "tenant/b"; } });
  await assert.rejects(() => mutableMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset"), error => error.code === "STORAGE_DELETE_VERIFY_FAILED");
  assert.equal(repo.calls.some(call => call[0] === "finalize"), false);
  assert.equal(repo.assets.get("asset").status, "deletion_requested");
});

test("delete rejects assets outside the authenticated scope before Storage access", async () => {
  const repo = repository();
  repo.assets.set("asset", { id: "asset", tenant_id: "other-tenant", workspace_id: SCOPE.workspaceId, status: "ready" });
  const p = provider();
  await assert.rejects(() => mutableMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND");
  assert.equal(p.calls.length, 0);
});

test("lifecycle reconciliation events retain only scoped, sanitized operational fields", async () => {
  const repo = repository({ async finalizeAssetDeletion(scope, id, input) { this.calls.push(["finalize", id, input]); return { id, deleted: true, reconciliation: { outcome: "CONFIRMED_SUCCEEDED" } }; } });
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  repo.objects.set("asset", { object_key: "tenant/x" });
  const events = [];
  await mutableMediaService({ provider: provider(), repository: repo, onEvent: (event, fields) => events.push({ event, fields }) }).remove({ ...SCOPE, requestId: "request-a" }, "asset");
  const reconciliation = events.find(item => item.event === "lifecycle_reconciliation" && item.fields.operation === "finalize");
  assert.deepEqual(reconciliation.fields, { operation: "finalize", assetId: "asset", tenantId: SCOPE.tenantId, workspaceId: SCOPE.workspaceId, requestId: "request-a", attempt: 1, errorClass: null, reconciliationResult: "CONFIRMED_SUCCEEDED" });
});

test("lifecycle deletion defaults closed before asset, Storage, or finalization access", async () => {
  const repo = repository();
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  repo.objects.set("asset", { object_key: "tenant/x" });
  const p = provider();
  const service = createMediaService({ provider: p, repository: repo, lifecycleMutationsEnabled: "true" });
  await assert.rejects(
    () => service.remove({ ...SCOPE, lifecycleMutationsEnabled: true, query: { assetLifecycleMutationsEnabled: true }, headers: { "x-asset-lifecycle-mutations-enabled": "true" }, cookies: { assetLifecycleMutationsEnabled: "true" } }, "asset"),
    error => error.code === "ASSET_LIFECYCLE_MUTATION_DISABLED" && error.status === 409 && hasTrustedPublicMessage(error)
  );
  assert.deepEqual(repo.calls, []);
  assert.deepEqual(p.calls, []);
});

test("unsupported MIME and malformed data are rejected by server validation", async () => {
  const svc = createMediaService({ provider: provider(), repository: repository() });
  await assert.rejects(() => svc.upload(SCOPE, { name: "bad.txt", data: "data:text/plain;base64,SGk=" }), error => error.code === "MEDIA_TYPE_MISMATCH");
});
