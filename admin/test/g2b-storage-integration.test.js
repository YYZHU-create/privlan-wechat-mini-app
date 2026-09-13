const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createMediaService, assertAssetTransition, MediaServiceError } = require("../media-service-v1");
const { createMeooStorageProvider, sha256Hex, StorageProviderError } = require("../storage-provider");

const ROOT = path.resolve(__dirname, "..");
const SCOPE = {
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  workspaceId: "00000000-0000-0000-0000-000000000003",
  storeId: "00000000-0000-0000-0000-000000000004",
  requestId: "g2b-test",
};
const OTHER_SCOPE = { ...SCOPE, tenantId: "00000000-0000-0000-0000-000000000099", workspaceId: "00000000-0000-0000-0000-000000000098" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makeRepository(overrides = {}) {
  const calls = [];
  const assets = new Map();
  const objects = new Map();
  const repo = {
    calls, assets, objects,
    async createPendingAsset(scope, input) { calls.push(["pending", input]); const row = { ...input, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, status: "pending" }; assets.set(input.id, row); return row; },
    async createAssetObject(scope, input) { calls.push(["object", input]); const row = { ...input, id: input.id || "object" }; objects.set(input.assetId, row); return row; },
    async createAssetLink(scope, input) { calls.push(["link", input]); return input; },
    async transitionAssetStatus(scope, id, status) { calls.push(["status", id, status]); const row = assets.get(id); if (row) row.status = status; return row; },
    async getAssetByIdScoped(scope, id) { const row = assets.get(id); return row && row.tenant_id === scope.tenantId && row.workspace_id === scope.workspaceId ? row : null; },
    async getAssetObject(scope, id) { return objects.get(id) || null; },
    async requestAssetDeletion(scope, id) { calls.push(["deletion_requested", id]); return this.transitionAssetStatus(scope, id, "deletion_requested"); },
    async markAssetDeleted(scope, id) { calls.push(["deleted", id]); return this.transitionAssetStatus(scope, id, "deleted"); },
    async productInScope() { return true; },
    ...overrides,
  };
  return repo;
}

function makeProvider(overrides = {}) {
  const calls = [];
  return {
    name: "meoo", bucket: "isolated-g2b-bucket", calls,
    async uploadObject(scope, key, bytes) { calls.push(["upload", key]); return { checksum: sha256Hex(bytes) }; },
    async verifyObject(scope, key, expected) { calls.push(["verify", key]); return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType, bytes: new Uint8Array(expected.sizeBytes) }; },
    async readObject(scope, key) { calls.push(["read", key]); return { bytes: new Uint8Array([1, 2]), mimeType: "image/png", sizeBytes: 2 }; },
    async deleteObject(scope, key) { calls.push(["delete", key]); return { deleted: true }; },
    async verifyDeleted(scope, key) { calls.push(["verifyDeleted", key]); return true; },
    ...overrides,
  };
}

test("state machine accepts only the V1 lifecycle", () => {
  for (const [from, to] of [["pending", "ready"], ["pending", "failed"], ["ready", "deletion_requested"], ["deletion_requested", "deleted"]]) assert.doesNotThrow(() => assertAssetTransition(from, to));
  for (const [from, to] of [["ready", "pending"], ["deleted", "ready"], ["failed", "ready"], ["deleted", "deleted"]]) assert.throws(() => assertAssetTransition(from, to), MediaServiceError);
});

test("client scope and bucket/object-key fields cannot override server scope", async () => {
  const repo = makeRepository(); const p = makeProvider(); const service = createMediaService({ provider: p, repository: repo });
  await service.upload(SCOPE, { name: "你好 ../hero.png", data: PNG, tenantId: OTHER_SCOPE.tenantId, tenant_id: OTHER_SCOPE.tenantId, workspaceId: OTHER_SCOPE.workspaceId, workspace_id: OTHER_SCOPE.workspaceId, bucket: "attacker", object_key: "../../other" });
  const objectKey = p.calls.find(call => call[0] === "upload")[1];
  assert.match(objectKey, new RegExp(`^tenant/${SCOPE.tenantId}/workspace/${SCOPE.workspaceId}/asset/`));
  assert.equal(objectKey.includes("attacker"), false);
  assert.equal(objectKey.includes("other"), false);
});

test("upload failure leaves no ready asset and never falls back to local storage", async () => {
  const repo = makeRepository(); const p = makeProvider({ async uploadObject() { throw new Error("provider down"); } }); const service = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_FAILED");
  const id = repo.calls.find(call => call[0] === "pending")[1].id;
  assert.equal(repo.assets.get(id).status, "failed");
  assert.equal(repo.objects.size, 0);
  assert.equal(p.calls.some(call => call[0] === "delete"), false);
});

test("verification and asset_objects failures compensate with exact-key delete", async () => {
  for (const overrides of [
    { provider: { async verifyObject() { throw new Error("mismatch"); } } },
    { repository: { async createAssetObject() { throw new Error("db"); } } },
  ]) {
    const repo = makeRepository(overrides.repository); const p = makeProvider(overrides.provider); const events = [];
    const service = createMediaService({ provider: p, repository: repo, onEvent: event => events.push(event) });
    await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG }));
    assert.equal(p.calls.filter(call => call[0] === "delete").length, 1);
    assert.equal(repo.calls.at(-1)[2], "failed");
    assert.equal(events.includes("orphan_object_detected"), false);
  }
});

test("asset link failure follows frozen failed-plus-compensation policy", async () => {
  const repo = makeRepository({ async createAssetLink() { throw new Error("link db"); } }); const p = makeProvider(); const service = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 4 }));
  assert.equal(p.calls.filter(call => call[0] === "delete").length, 1);
  const id = repo.calls.find(call => call[0] === "pending")[1].id;
  assert.equal(repo.assets.get(id).status, "failed");
});

test("cleanup failure retains the original failure and emits orphan evidence", async () => {
  const repo = makeRepository(); const p = makeProvider({ async verifyObject() { throw new Error("verify mismatch"); }, async deleteObject() { throw new Error("cleanup unavailable"); } }); const events = [];
  await assert.rejects(() => createMediaService({ provider: p, repository: repo, onEvent: event => events.push(event) }).upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_FAILED");
  assert.equal(events.includes("orphan_object_detected"), true);
});

test("private reads require ready state and scoped identity", async () => {
  const repo = makeRepository(); const p = makeProvider(); const service = createMediaService({ provider: p, repository: repo });
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  repo.objects.set("asset", { object_key: "tenant/x", mime_type: "image/png" });
  assert.equal((await service.read(SCOPE, "asset")).sizeBytes, 2);
  for (const status of ["pending", "failed", "deletion_requested", "deleted"]) { repo.assets.get("asset").status = status; await assert.rejects(() => service.read(SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND"); }
  repo.assets.get("asset").status = "ready";
  await assert.rejects(() => service.read(OTHER_SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND");
});

test("delete verifies exact object removal before marking deleted", async () => {
  const repo = makeRepository(); const p = makeProvider(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" }); repo.objects.set("asset", { object_key: "tenant/exact" });
  await createMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset");
  assert.deepEqual(p.calls.filter(call => ["delete", "verifyDeleted"].includes(call[0])).map(call => call[1]), ["tenant/exact", "tenant/exact"]);
  assert.equal(repo.assets.get("asset").status, "deleted");
  await assert.rejects(() => createMediaService({ provider: p, repository: repo }).remove(SCOPE, "asset"), error => error.code === "ASSET_STATUS_TRANSITION_INVALID");
});

test("V1 response and source do not expose credentials or provider URLs", () => {
  const source = fs.readFileSync(path.join(ROOT, "media-service-v1.js"), "utf8");
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|Authorization|Bearer|signedUrl/i);
  const responseKeys = ["id", "status", "purpose", "variant", "mimeType", "bytes", "path"];
  assert.deepEqual(responseKeys.filter(key => /(?:token|secret|credential|url|bucket|objectKey)/i.test(key)), []);
});

test("product links are workspace-scoped and use the canonical discriminator", async () => {
  const repo = makeRepository({ async productInScope(scope, id) { return String(id) === "4" && scope.workspaceId === SCOPE.workspaceId; } }); const p = makeProvider();
  const service = createMediaService({ provider: p, repository: repo });
  await service.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_gallery", entityId: 4, position: 1 });
  const link = repo.calls.find(call => call[0] === "link")[1]; assert.equal(link.entityType, "workspace_config_product"); assert.equal(link.entityId, "4"); assert.equal(link.position, 1);
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 99 }), error => error.code === "PRODUCT_SCOPE_DENIED");
});

test("provider failures normalize to stable error categories", async () => {
  const storage = {
    async upload() { return { error: { message: "private provider detail" } }; },
    async download() { return { data: null, error: { statusCode: 503, message: "private provider detail" } }; },
    async remove() { return { error: { message: "private provider detail" } }; },
  };
  const provider = createMeooStorageProvider({ url: "https://example.test", serviceRoleKey: "server-only", bucket: "isolated-g2b-bucket", client: { storage: { from() { return storage; } } } });
  await assert.rejects(() => provider.uploadObject(SCOPE, "tenant/x", Buffer.from("x"), "image/png"), error => error instanceof StorageProviderError && error.code === "STORAGE_UPLOAD_FAILED");
  await assert.rejects(() => provider.readObject(SCOPE, "tenant/x"), error => error instanceof StorageProviderError && error.code === "STORAGE_READ_FAILED" && error.status === 503);
  await assert.rejects(() => provider.deleteObject(SCOPE, "tenant/x"), error => error instanceof StorageProviderError && error.code === "STORAGE_DELETE_FAILED");
});
