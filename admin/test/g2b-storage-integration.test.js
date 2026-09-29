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
  const links = new Map();
  const attempts = new Map();
  const keys = new Map();
  const repo = {
    calls, assets, objects, links, attempts,
    async createPendingAsset(scope, input) { calls.push(["pending", input]); const row = { ...input, object_key: input.objectKey, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, status: "pending" }; assets.set(input.id, row); return row; },
    async createAssetObject(scope, input) { calls.push(["object", input]); const row = { ...input, object_key: input.objectKey, variant: input.variant, mime_type: input.mimeType, size_bytes: input.sizeBytes, checksum: input.checksum, id: input.id || "object" }; objects.set(input.assetId, row); return row; },
    async listAssetObjects(scope, id) { const row = objects.get(id); return row ? [row] : []; },
    async createAssetLink(scope, input) { calls.push(["link", input]); links.set(input.assetId, [{ ...input, asset_id: input.assetId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId }]); return input; },
    async listAssetLinks(scope, id) { return links.get(id) || []; },
    async transitionAssetStatus(scope, id, status, input = {}) { calls.push(["status", id, status]); const row = assets.get(id); if (row) { row.status = status; if (input.metadata) row.metadata = input.metadata; } return row; },
    async getAssetByIdScoped(scope, id) { const row = assets.get(id); return row && row.tenant_id === scope.tenantId && row.workspace_id === scope.workspaceId ? row : null; },
    async getAssetObject(scope, id) { return objects.get(id) || null; },
    async deleteUploadAttempt(scope, id, input) { calls.push(["cleanup", id, input]); const row = assets.get(id); if (row) { if (row.metadata?.uploadAttemptId !== input.uploadAttemptId || row.object_key !== input.objectKey || !["pending", "failed"].includes(row.status)) throw new Error("exact cleanup mismatch"); assets.delete(id); objects.delete(id); links.delete(id); } return { deleted: true }; },
    async reserveUploadAttempt(scope, input) { const key = [scope.tenantId, scope.workspaceId, scope.storeId || "", scope.userId, input.idempotencyKeyHash].join("|"); if (keys.has(key)) { const a = attempts.get(keys.get(key)); return { created: false, attempt: a, fingerprintMismatch: a.request_fingerprint !== input.requestFingerprint }; } const a = { attempt_id: input.attemptId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId || null, owner_user_id: scope.userId, operation: "POST /api/media/v1/upload", idempotency_key_hash: input.idempotencyKeyHash, request_fingerprint: input.requestFingerprint, asset_id: input.assetId, expected_object_key: input.expectedObjectKey, content_sha256: input.contentSha256, content_length: input.contentLength, content_type: input.contentType, original_name: input.originalName, purpose: input.purpose, variant: input.variant, entity_id: input.entityId == null ? null : String(input.entityId), position: input.position, synthetic_canary: input.syntheticCanary, asset_metadata: input.assetMetadata, phase: "ATTEMPT_CREATED", terminal_state: null, lease_token: input.leaseToken, lease_expires_at: input.leaseExpiresAt, result: null }; attempts.set(a.attempt_id, a); keys.set(key, a.attempt_id); return { created: true, attempt: a }; },
    async getUploadAttempt(scope, id) { const a = attempts.get(id); return a && a.tenant_id === scope.tenantId && a.workspace_id === scope.workspaceId && a.owner_user_id === scope.userId ? a : null; },
    async claimUploadAttempt(scope, id, token, now, expires) { const a = await this.getUploadAttempt(scope,id); if (!a || new Date(a.lease_expires_at) > new Date(now) || ["READY_COMMITTED","CLEANED"].includes(a.phase)) return null; a.lease_token=token; a.lease_expires_at=expires; return a; },
    async renewUploadAttemptLease(scope,id,token,expires) { const a=await this.getUploadAttempt(scope,id); if(!a||a.lease_token!==token)return null; a.lease_expires_at=expires; return a; },
    async transitionUploadAttempt(scope,id,token,from,patch) { const a=await this.getUploadAttempt(scope,id); if(!a||a.lease_token!==token||a.phase!==from)return null; Object.assign(a,patch); return a; },
    async listRecoverableUploadAttempts(now,limit) { return [...attempts.values()].filter(a=>!['READY_COMMITTED','CLEANED'].includes(a.phase)&&new Date(a.lease_expires_at)<=new Date(now)).slice(0,limit); },
    async requestAssetDeletion(scope, id) { calls.push(["deletion_requested", id]); return { outcome: "CAS_ACQUIRED", asset: await this.transitionAssetStatus(scope, id, "deletion_requested") }; },
    async markAssetDeleted(scope, id) { calls.push(["deleted", id]); return this.transitionAssetStatus(scope, id, "deleted"); },
    async finalizeAssetDeletion(_scope, id, input) { calls.push(["finalize", id, input]); const row = assets.get(id); if (row) { row.status = "deleted"; row.deleted_at = input.storageVerifiedAt; } return { id, deleted: true, duplicate: false }; },
    async productInScope() { return true; },
    ...overrides,
  };
  return repo;
}

function makeProvider(overrides = {}) {
  const calls = [];
  let present = false;
  return {
    name: "meoo", bucket: "isolated-g2b-bucket", calls,
    async uploadObject(scope, key, bytes) { calls.push(["upload", key]); present = true; return { checksum: sha256Hex(bytes) }; },
    async verifyObject(scope, key, expected) { calls.push(["verify", key]); if (!present) { const error = new Error("not found"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType, bytes: new Uint8Array(expected.sizeBytes) }; },
    async readObject(scope, key) { calls.push(["read", key]); if (!present) { const error = new Error("not found"); error.status = 404; throw error; } return { bytes: new Uint8Array([1, 2]), mimeType: "image/png", sizeBytes: 2 }; },
    async deleteObject(scope, key) { calls.push(["delete", key]); present = false; return { deleted: true }; },
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
  assert.equal(repo.assets.has(id), false);
  assert.equal(repo.attempts.values().next().value.terminal_state, "CONSISTENT_CLEANED");
  assert.equal(repo.objects.size, 0);
  assert.equal(p.calls.some(call => call[0] === "delete"), false);
});

test("verification and asset_objects failures compensate with exact-key delete", async () => {
  const repo = makeRepository(); const p = makeProvider({ async verifyObject() { throw new Error("verification unavailable"); }, async readObject() { return { bytes: new Uint8Array([9]), mimeType: "image/png", sizeBytes: 1 }; } });
  await assert.rejects(() => createMediaService({ provider: p, repository: repo }).upload(SCOPE, { name: "hero.png", data: PNG }));
  assert.equal(p.calls.filter(call => call[0] === "delete").length, 1);
  assert.equal(repo.calls.at(-1)[0], "cleanup"); assert.equal(repo.assets.size, 0);
  const recoveringRepo = makeRepository(); let failObjectRecord = true;
  recoveringRepo.createAssetObject = async function(scope, input) { if (failObjectRecord) { failObjectRecord = false; throw new Error("transient db response loss"); } const row = { ...input, object_key: input.objectKey, variant: input.variant, mime_type: input.mimeType, size_bytes: input.sizeBytes, checksum: input.checksum }; this.objects.set(input.assetId, row); return row; };
  const p2 = makeProvider(); const service = createMediaService({ provider: p2, repository: recoveringRepo });
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_CLEANUP_INDETERMINATE");
  const attempt = recoveringRepo.attempts.values().next().value; attempt.lease_expires_at = "2000-01-01T00:00:00.000Z";
  const recovery = await service.recoverExpiredUploadAttempts();
  assert.equal(recovery[0].outcome, "CONSISTENT_READY"); assert.equal(recoveringRepo.assets.get(attempt.asset_id).status, "ready");
  assert.equal(p2.calls.filter(call => call[0] === "delete").length, 0);
});

test("asset link failure follows frozen failed-plus-compensation policy", async () => {
  const repo = makeRepository(); let failOnce = true;
  repo.createAssetLink = async function(scope, input) { if (failOnce) { failOnce = false; throw new Error("transient link write response loss"); } this.links.set(input.assetId, [{ ...input, asset_id: input.assetId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId }]); return input; };
  const p = makeProvider(); const service = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 4 }), error => error.code === "MEDIA_UPLOAD_CLEANUP_INDETERMINATE");
  const attempt = repo.attempts.values().next().value; attempt.lease_expires_at = "2000-01-01T00:00:00.000Z";
  assert.equal((await service.recoverExpiredUploadAttempts())[0].outcome, "CONSISTENT_READY");
  assert.equal(repo.assets.get(attempt.asset_id).status, "ready"); assert.equal(p.calls.filter(call => call[0] === "delete").length, 0);
});

test("cleanup failure retains the original failure and durable reconciliation state", async () => {
  const repo = makeRepository(); const p = makeProvider({ async verifyObject() { throw new Error("verify mismatch"); }, async deleteObject() { throw new Error("cleanup unavailable"); } });
  await assert.rejects(() => createMediaService({ provider: p, repository: repo }).upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_CLEANUP_INDETERMINATE");
  const attempt = repo.attempts.values().next().value;
  assert.equal(attempt.phase, "CLEANUP_REQUIRED");
  assert.equal(repo.assets.has(attempt.asset_id), true);
});

test("private reads require ready state and scoped identity", async () => {
  const repo = makeRepository(); const p = makeProvider({ async readObject() { return { bytes: new Uint8Array([1, 2]), mimeType: "image/png", sizeBytes: 2 }; } }); const service = createMediaService({ provider: p, repository: repo });
  repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" });
  repo.objects.set("asset", { object_key: "tenant/x", mime_type: "image/png" });
  assert.equal((await service.read(SCOPE, "asset")).sizeBytes, 2);
  for (const status of ["pending", "failed", "deletion_requested", "deleted"]) { repo.assets.get("asset").status = status; await assert.rejects(() => service.read(SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND"); }
  repo.assets.get("asset").status = "ready";
  await assert.rejects(() => service.read(OTHER_SCOPE, "asset"), error => error.code === "ASSET_NOT_FOUND");
});

test("delete verifies exact object removal before marking deleted", async () => {
  const repo = makeRepository(); const p = makeProvider(); repo.assets.set("asset", { id: "asset", tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, status: "ready" }); repo.objects.set("asset", { object_key: "tenant/exact" });
  await createMediaService({ provider: p, repository: repo, lifecycleMutationsEnabled: true }).remove(SCOPE, "asset");
  assert.deepEqual(p.calls.filter(call => ["delete", "verifyDeleted"].includes(call[0])).map(call => call[1]), ["tenant/exact", "tenant/exact"]);
  assert.equal(repo.assets.get("asset").status, "deleted");
  assert.deepEqual(await createMediaService({ provider: p, repository: repo, lifecycleMutationsEnabled: true }).remove(SCOPE, "asset"), { id: "asset", deleted: true, duplicate: true });
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
