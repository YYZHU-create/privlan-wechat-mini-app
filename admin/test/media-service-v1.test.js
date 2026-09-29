const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const { canonicalObjectKey, createMediaService, MediaServiceError } = require("../media-service-v1");
const { createMeooStorageProvider, StorageProviderError } = require("../storage-provider");
const { hasTrustedPublicMessage } = require("../public-error");
const { respondUnexpectedError, createStagingMediaDiagnostic, isStagingMediaDiagnosticRequest } = require("../error-response");
const { AssetRepositoryError } = require("../asset-repository");

const SCOPE = { userId: "00000000-0000-0000-0000-000000000001", tenantId: "00000000-0000-0000-0000-000000000002", workspaceId: "00000000-0000-0000-0000-000000000003", storeId: "00000000-0000-0000-0000-000000000004", requestId: "req-test" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function repository(overrides = {}) {
  const calls = []; const assets = new Map(); const objects = new Map(); const links = new Map(); const attempts = new Map(); const attemptKeys = new Map();
  return { calls, assets, objects, links, attempts,
    async createPendingAsset(scope, input) { calls.push(["pending", input]); const row = { ...input, object_key: input.objectKey, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, status: "pending" }; assets.set(input.id, row); return row; },
    async createAssetObject(scope, input) { calls.push(["object", input]); const row = { ...input, object_key: input.objectKey, variant: input.variant, mime_type: input.mimeType, size_bytes: input.sizeBytes, checksum: input.checksum, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, id: input.id || "object-id" }; objects.set(input.assetId, row); return row; },
    async createAssetLink(scope, input) { calls.push(["link", input]); links.set(input.assetId, [{ ...input, asset_id: input.assetId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId }]); return input; },
    async transitionAssetStatus(scope, id, status, input = {}) { calls.push(["status", id, status, input]); const row = assets.get(id); if (row) { row.status = status; if (input.metadata) row.metadata = input.metadata; } return row; },
    async getAssetByIdScoped(scope, id) { const row = assets.get(id); return row && row.tenant_id === scope.tenantId && row.workspace_id === scope.workspaceId ? row : null; },
    async getAssetObject(scope, id) { return objects.get(id) || null; },
    async listAssetObjects(scope, id) { const row = objects.get(id); return row ? (Array.isArray(row) ? row : [row]) : []; },
    async listAssetLinks(scope, id) { return links.get(id) || []; },
    async deleteUploadAttempt(scope, id, { objectKey, uploadAttemptId }) { calls.push(["cleanup", id, objectKey, uploadAttemptId]); const row = assets.get(id); if (!row || row.metadata?.uploadAttemptId !== uploadAttemptId || row.object_key !== objectKey || !["pending", "failed"].includes(row.status)) throw new Error("exact cleanup target mismatch"); assets.delete(id); objects.delete(id); links.delete(id); return { deleted: true }; },
    async reserveUploadAttempt(scope, input) {
      const key = [scope.tenantId, scope.workspaceId, scope.storeId || "", scope.userId, "POST /api/media/v1/upload", input.idempotencyKeyHash].join("|");
      const existingId = attemptKeys.get(key);
      if (existingId) { const attempt = attempts.get(existingId); return { created: false, attempt, fingerprintMismatch: attempt.request_fingerprint !== input.requestFingerprint }; }
      const attempt = { attempt_id: input.attemptId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId || null, owner_user_id: scope.userId, operation: "POST /api/media/v1/upload", idempotency_key_hash: input.idempotencyKeyHash, request_fingerprint: input.requestFingerprint, asset_id: input.assetId, expected_object_key: input.expectedObjectKey, content_sha256: input.contentSha256, content_length: input.contentLength, content_type: input.contentType, original_name: input.originalName, purpose: input.purpose, variant: input.variant, entity_id: input.entityId == null ? null : String(input.entityId), position: input.position, synthetic_canary: input.syntheticCanary, asset_metadata: input.assetMetadata, phase: "ATTEMPT_CREATED", terminal_state: null, lease_token: input.leaseToken, lease_expires_at: input.leaseExpiresAt, result: null };
      attempts.set(input.attemptId, attempt); attemptKeys.set(key, input.attemptId); return { created: true, attempt };
    },
    async getUploadAttempt(scope, id) { const a = attempts.get(id); return a && a.tenant_id === scope.tenantId && a.workspace_id === scope.workspaceId && a.store_id === (scope.storeId || null) && a.owner_user_id === scope.userId ? a : null; },
    async getUploadAttemptByKey(scope, keyHash) { return [...attempts.values()].find(a => a.tenant_id === scope.tenantId && a.workspace_id === scope.workspaceId && a.store_id === (scope.storeId || null) && a.owner_user_id === scope.userId && a.idempotency_key_hash === keyHash) || null; },
    async claimUploadAttempt(scope, id, token, now, expires) { const a = await this.getUploadAttempt(scope, id); if (!a || new Date(a.lease_expires_at) > new Date(now) || ["READY_COMMITTED", "CLEANED"].includes(a.phase)) return null; a.lease_token = token; a.lease_expires_at = expires; return a; },
    async renewUploadAttemptLease(scope, id, token, expires) { const a = await this.getUploadAttempt(scope, id); if (!a || a.lease_token !== token || ["READY_COMMITTED", "CLEANED"].includes(a.phase)) return null; a.lease_expires_at = expires; return a; },
    async transitionUploadAttempt(scope, id, token, from, patch) { const a = await this.getUploadAttempt(scope, id); if (!a || a.lease_token !== token || a.phase !== from) return null; Object.assign(a, patch); return a; },
    async releaseUploadAttemptLease(scope, id, token) { const a = await this.getUploadAttempt(scope, id); if (!a || a.lease_token !== token) return false; a.lease_token = null; a.lease_expires_at = new Date().toISOString(); return true; },
    async listRecoverableUploadAttempts(now, limit) { return [...attempts.values()].filter(a => !["READY_COMMITTED", "CLEANED"].includes(a.phase) && new Date(a.lease_expires_at) <= new Date(now)).slice(0, limit); },
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
  const calls = []; let present = true; let storedMime = "image/png";
  const storage = {
    async upload(key, bytes, options) { calls.push(["upload", key, options.upsert]); return { data: { path: key }, error: null }; },
    async download(key) { calls.push(["download", key]); return present ? { data: new Blob([Buffer.from("ok")], { type: storedMime }), error: null } : { data: null, error: { statusCode: 404 } }; },
    async remove(keys) { calls.push(["remove", keys]); present = false; return { data: [], error: null }; },
  };
  const p = createMeooStorageProvider({ url: "https://example.test", serviceRoleKey: "server-only", bucket: "feeldao-production-media", client: { storage: { from(bucket) { assert.equal(bucket, "feeldao-production-media"); return storage; } } } });
  const uploaded = await p.uploadObject(SCOPE, "tenant/a", Buffer.from("ok"), "image/png");
  const verified = await p.verifyObject(SCOPE, "tenant/a", { sizeBytes: 2, checksum: uploaded.checksum, mimeType: "image/png" });
  assert.equal(verified.sizeBytes, 2);
  storedMime = "";
  await assert.rejects(() => p.verifyObject(SCOPE, "tenant/a", { sizeBytes: 2, checksum: uploaded.checksum, mimeType: "image/png" }), error => error instanceof StorageProviderError && error.code === "STORAGE_VERIFY_FAILED");
  storedMime = "image/png";
  const read = await p.readObject(SCOPE, "tenant/a"); assert.equal(read.sizeBytes, 2);
  await p.deleteObject(SCOPE, "tenant/a"); assert.equal(await p.verifyDeleted(SCOPE, "tenant/a"), true);
  assert.deepEqual(calls.map(call => call[0]), ["upload", "download", "download", "download", "remove", "download"]);
  assert.equal(calls[0][2], false);
});

test("V1 upload creates pending asset, object, link and ready state with an attempt marker", async () => {
  const repo = repository(); const svc = createMediaService({ provider: provider(), repository: repo });
  const diagnosticState = diagnosticProgress();
  const result = await svc.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 4 }, { diagnosticState });
  assert.equal(result.status, "ready"); assert.equal(result.path, `/api/media/v1/content/${result.id}`);
  assert.equal(diagnosticState.assetConfirmReason, undefined);
  assert.deepEqual(repo.calls.map(call => call[0]), ["pending", "object", "link", "status"]);
  assert.equal(repo.calls.at(-1)[2], "ready");
  const pending = repo.calls[0][1];
  assert.match(pending.metadata.uploadAttemptId, /^[0-9a-f-]{36}$/i);
  assert.equal(repo.assets.get(result.id).metadata.uploadState, "ready");
});

test("successful asset insert representation confirms the asset without a read-after-write lookup", async () => {
  const repo = repository();
  let readVisible = false;
  let storagePresent = false;
  let readCount = 0;
  let readsAtStoragePut = null;
  const getAsset = repo.getAssetByIdScoped.bind(repo);
  repo.getAssetByIdScoped = async (...args) => { readCount += 1; return readVisible ? getAsset(...args) : null; };
  const diagnosticState = diagnosticProgress();
  const p = provider({
    async verifyObject(_scope, _key, expected) {
      if (!storagePresent) throw Object.assign(new Error("not found"), { status: 404 });
      return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType };
    },
    async readObject() { if (!storagePresent) throw Object.assign(new Error("not found"), { status: 404 }); return { bytes: new Uint8Array(1), mimeType: "image/png", sizeBytes: 1 }; },
    async uploadObject(scope, key, bytes) { readsAtStoragePut = readCount; readVisible = true; storagePresent = true; return { checksum: require("../storage-provider").sha256Hex(bytes) }; }
  });
  const svc = createMediaService({ provider: p, repository: repo });
  const result = await svc.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 4 }, { diagnosticState });
  assert.equal(result.status, "ready");
  assert.equal(diagnosticState.failedOperation, null);
  assert.equal(diagnosticState.assetConfirmReason, undefined);
  assert.equal(readsAtStoragePut, 1, "confirmation should use the successful INSERT representation");
  assert.deepEqual(repo.calls.map(call => call[0]), ["pending", "object", "link", "status"]);
});

async function runInsertRepresentationCase(representation) {
  const repo = repository();
  const diagnosticState = diagnosticProgress();
  let insertReturned = false;
  let confirmFallbackReads = 0;
  const getAsset = repo.getAssetByIdScoped.bind(repo);
  repo.getAssetByIdScoped = async (...args) => {
    if (insertReturned && diagnosticState.currentOperation === "ASSET_CONFIRM") confirmFallbackReads += 1;
    return getAsset(...args);
  };
  const create = repo.createPendingAsset.bind(repo);
  repo.createPendingAsset = async (...args) => {
    await create(...args);
    insertReturned = true;
    return representation;
  };
  let result = null;
  let error = null;
  try {
    result = await createMediaService({ provider: provider(), repository: repo, runtimeEnvironment: "staging" })
      .upload({ ...SCOPE, requestId: "representation-state-test" }, { name: "fixture.png", data: PNG }, {
        idempotencyKey: `representation-${typeof representation}-${Array.isArray(representation) ? "array" : "value"}`,
        diagnosticState
      });
  } catch (caught) { error = caught; }
  return { result, error, repo, diagnosticState, confirmFallbackReads };
}

test("missing INSERT representations alone use the exact GET fallback", async t => {
  for (const [label, representation] of [["null", null], ["undefined", undefined]]) {
    await t.test(label, async () => {
      const state = await runInsertRepresentationCase(representation);
      assert.equal(state.error, null);
      assert.equal(state.result.status, "ready");
      assert.equal(state.confirmFallbackReads, 1);
    });
  }
});

test("malformed INSERT representations fail closed without the GET fallback", async t => {
  const cases = [
    ["string", "malformed", "ASSET_CONFIRM_OTHER_ERROR"],
    ["number", 123, "ASSET_CONFIRM_OTHER_ERROR"],
    ["boolean", true, "ASSET_CONFIRM_OTHER_ERROR"],
    ["array", [], "ASSET_CONFIRM_OTHER_ERROR"],
    ["object missing row fields", {}, "ASSET_CONFIRM_BINDING_MISMATCH"]
  ];
  for (const [label, representation, expectedReason] of cases) {
    await t.test(label, async () => {
      const state = await runInsertRepresentationCase(representation);
      assert.ok(state.error, "malformed representation must fail the upload");
      assert.equal(state.result, null);
      assert.equal(state.confirmFallbackReads, 0);
      assert.equal(state.diagnosticState.failedOperation, "ASSET_CONFIRM");
      assert.equal(state.diagnosticState.assetConfirmReason, expectedReason);
    });
  }
});

function diagnosticProgress() { return { lastCompletedPhase: null, currentOperation: "REQUEST_VALIDATION", failedOperation: null, lastFailedCompletedPhase: null }; }

async function runDiagnosticFailure({ repo = repository(), p = provider(), inputName = "fixture.png" } = {}) {
  const create = repo.createPendingAsset.bind(repo);
  repo.createPendingAsset = async (...args) => { await create(...args); return null; };
  const progress = diagnosticProgress();
  let thrown;
  try {
    await createMediaService({ provider: p, repository: repo, runtimeEnvironment: "staging" }).upload({ ...SCOPE, requestId: "media-diagnostic-request" }, { name: inputName, data: PNG }, { idempotencyKey: "fixture-idempotency-key", diagnosticState: progress });
  } catch (error) { thrown = error; }
  assert.ok(thrown, "fixture must fail");
  return { progress, error: thrown };
}

test("ASSET_CONFIRM assigns bounded request-local reasons for its source branches", async t => {
  const scenarios = [
    {
      name: "reread not found",
      reason: "ASSET_CONFIRM_REREAD_NOT_FOUND",
      override(reads, read) { return reads === 2 ? null : read(); }
    },
    {
      name: "reread repository error",
      reason: "ASSET_CONFIRM_REREAD_ERROR",
      override(reads, read) { if (reads === 2) throw new AssetRepositoryError("DATABASE_UNAVAILABLE", "fixture private error", 503); return read(); }
    },
    ...[
      ["id", "id", "different-id"], ["tenant scope", "tenant_id", "different-tenant"],
      ["workspace scope", "workspace_id", "different-workspace"], ["store scope", "store_id", "different-store"],
      ["object binding", "object_key", "different-key"], ["attempt metadata binding", "metadata", { uploadAttemptId: "different-attempt" }]
    ].map(([name, field, value]) => ({
      name: `binding mismatch: ${name}`,
      reason: "ASSET_CONFIRM_BINDING_MISMATCH",
      override(reads, read) {
        if (reads !== 2) return read();
        const row = read();
        return { ...row, [field]: value };
      }
    })),
    {
      name: "other reread exception",
      reason: "ASSET_CONFIRM_OTHER_ERROR",
      override(reads, read) { if (reads === 2) throw Object.assign(new Error("fixture private error"), { status: 503 }); return read(); }
    }
  ];

  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const repo = repository();
    const read = repo.getAssetByIdScoped.bind(repo);
    let reads = 0;
    repo.getAssetByIdScoped = async (...args) => scenario.override(++reads, () => read(...args));
    const { progress } = await runDiagnosticFailure({ repo });
    assert.equal(progress.failedOperation, "ASSET_CONFIRM");
    assert.equal(progress.lastFailedCompletedPhase, "ASSET_CREATED");
    assert.equal(progress.assetConfirmReason, scenario.reason);
    const diagnostic = createStagingMediaDiagnostic({ environment: "staging", authenticated: true, headerValue: "1", requestId: "confirm-branch-test", progress, error: progress.failureError });
    assert.equal(diagnostic.failedOperation, "ASSET_CONFIRM");
    assert.equal(diagnostic.assetConfirmReason, scenario.reason);
    const serialized = JSON.stringify(diagnostic);
    for (const forbidden of ["fixture private error", "different-id", "different-tenant", "different-workspace", "different-store", "different-key", "different-attempt", SCOPE.userId, SCOPE.tenantId, SCOPE.workspaceId]) assert.equal(serialized.includes(forbidden), false, `diagnostic disclosed ${forbidden}`);
  });
});

async function runImmediateRereadFailureCase({ diagnosticEnabled = true } = {}) {
  const repo = repository();
  const create = repo.createPendingAsset.bind(repo);
  repo.createPendingAsset = async (...args) => { await create(...args); return null; };
  const baseRead = repo.getAssetByIdScoped.bind(repo);
  const reads = [];
  repo.getAssetByIdScoped = async (scope, assetId) => {
    reads.push({ scope, assetId });
    if (reads.length === 2) return null;
    return baseRead(scope, assetId);
  };
  const progress = diagnosticProgress();
  const service = createMediaService({ provider: provider(), repository: repo, runtimeEnvironment: "staging" });
  const scopedRequest = { ...SCOPE, requestId: "asset-confirm-readback-test" };
  let result = null;
  let thrown = null;
  try {
    result = await service.upload(scopedRequest, { name: "fixture.png", data: PNG }, {
      idempotencyKey: `asset-confirm-readback-${diagnosticEnabled}`,
      ...(diagnosticEnabled ? { diagnosticState: progress } : {})
    });
  } catch (error) {
    thrown = error;
  }
  return { repo, reads, progress, result, thrown };
}

test("ASSET_CONFIRM diagnostic reports the immediate reread result without a follow-up probe", async () => {
  const diagnosticState = await runImmediateRereadFailureCase({ diagnosticEnabled: true });
  const ordinaryState = await runImmediateRereadFailureCase({ diagnosticEnabled: false });
  assert.ok(diagnosticState.thrown);
  assert.ok(ordinaryState.thrown);
  assert.equal(diagnosticState.progress.failedOperation, "ASSET_CONFIRM");
  assert.equal(diagnosticState.progress.assetConfirmReason, "ASSET_CONFIRM_REREAD_NOT_FOUND");
  assert.equal(diagnosticState.thrown.code, ordinaryState.thrown.code);
  assert.equal(diagnosticState.reads.length, ordinaryState.reads.length);
  assert.equal(Object.hasOwn(diagnosticState.progress, "delayedRereadResult"), false);
  const diagnostic = createStagingMediaDiagnostic({ environment: "staging", authenticated: true, headerValue: "1", requestId: "asset-confirm-readback-test", progress: diagnosticState.progress, error: diagnosticState.progress.failureError });
  assert.equal(diagnostic.failedOperation, "ASSET_CONFIRM");
  assert.equal(diagnostic.assetConfirmReason, "ASSET_CONFIRM_REREAD_NOT_FOUND");
  assert.equal(Object.hasOwn(diagnostic, "delayedRereadResult"), false);
  assert.equal(Object.hasOwn(diagnostic, "delayedRereadDelayMs"), false);
  assert.equal(Object.hasOwn(diagnostic, "delayedRereadBindingMatch"), false);
  const response = { status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; return this; } };
  respondUnexpectedError(response, diagnosticState.progress.failureError, { requestId: "asset-confirm-readback-test", fallbackStatus: 500, fallbackCode: "INTERNAL_ERROR", stagingDiagnostic: diagnostic, logger: { error() {} } });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.diagnostic.assetConfirmReason, "ASSET_CONFIRM_REREAD_NOT_FOUND");
  assert.equal(JSON.stringify(response.body).includes("fixture private error"), false);
});

test("journal advancement write failure localizes independently of journal readback", async () => {
  const repo = repository();
  const transition = repo.transitionUploadAttempt.bind(repo);
  repo.transitionUploadAttempt = async (...args) => {
    if (args[4]?.phase === "DB_ASSET_CREATED") throw new Error("fixture journal write failure");
    return transition(...args);
  };
  const { progress } = await runDiagnosticFailure({ repo });
  assert.equal(progress.failedOperation, "JOURNAL_DB_ASSET_CREATED_WRITE");
  assert.equal(progress.lastFailedCompletedPhase, "ASSET_CREATED");
});

test("journal advancement readback failure has its own operation label", async () => {
  const repo = repository();
  const transition = repo.transitionUploadAttempt.bind(repo);
  repo.transitionUploadAttempt = async (...args) => {
    if (args[4]?.phase === "DB_ASSET_CREATED") {
      args[5]?.("JOURNAL_DB_ASSET_CREATED_VERIFY");
      throw new Error("fixture journal readback failure");
    }
    return transition(...args);
  };
  const { progress } = await runDiagnosticFailure({ repo });
  assert.equal(progress.failedOperation, "JOURNAL_DB_ASSET_CREATED_VERIFY");
  assert.equal(progress.lastFailedCompletedPhase, "ASSET_CREATED");
});

test("Storage expected-object existence failure localizes to STORAGE_EXISTS_CHECK", async () => {
  const p = provider({
    async verifyObject() { throw new Error("fixture storage verify failure"); },
    async readObject() { throw Object.assign(new Error("fixture storage read failure"), { status: 503 }); }
  });
  const { progress } = await runDiagnosticFailure({ p });
  assert.equal(progress.failedOperation, "STORAGE_EXISTS_CHECK");
  assert.equal(progress.lastFailedCompletedPhase, "DB_ASSET_CREATED");
});

test("synthetic Storage PUT failure localizes to STORAGE_PUT", async () => {
  const absent = () => Object.assign(new Error("fixture object absent"), { status: 404, code: "STORAGE_OBJECT_NOT_FOUND" });
  const p = provider({
    async verifyObject() { throw absent(); },
    async readObject() { throw absent(); },
    async uploadObject() { throw Object.assign(new Error("fixture Storage PUT failure"), { status: 400 }); }
  });
  const { progress } = await runDiagnosticFailure({ p });
  assert.equal(progress.failedOperation, "STORAGE_PUT");
  assert.equal(progress.lastFailedCompletedPhase, "DB_ASSET_CREATED");
});

test("Staging diagnostic envelope is bounded and excludes request, scope, and error contents", () => {
  const forbiddenValues = [
    "data:image/png;base64,SECRET_PAYLOAD",
    "private-original-name.png",
    "Bearer secret-authorization",
    "session=secret-cookie",
    "csrf-secret-token",
    "postgres://secret-db-credential",
    "service-role-secret",
    SCOPE.tenantId,
    SCOPE.workspaceId,
    SCOPE.userId,
    "private/canonical/object-key",
    "https://storage.invalid/signed-secret",
    "raw provider response body",
    "fixture-secret-raw-error-message",
    "fixture-secret-stack"
  ];
  const error = Object.assign(new StorageProviderError("STORAGE_UPLOAD_FAILED", forbiddenValues.join(" "), 503), { stack: forbiddenValues.join(" ") });
  const diagnostic = createStagingMediaDiagnostic({ environment: "staging", authenticated: true, headerValue: "1", requestId: "media-diagnostic-request", progress: { lastFailedCompletedPhase: "DB_ASSET_CREATED", failedOperation: "STORAGE_PUT", ...Object.fromEntries(forbiddenValues.map((value, index) => [`untrusted${index}`, value])) }, error });
  assert.deepEqual(diagnostic, { requestId: "media-diagnostic-request", lastCompletedPhase: "DB_ASSET_CREATED", failedOperation: "STORAGE_PUT", errorClass: "StorageProviderError", providerStatus: 503, providerCode: "STORAGE_UPLOAD_FAILED" });
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  respondUnexpectedError(response, error, { requestId: "media-diagnostic-request", fallbackCode: "INTERNAL_ERROR", fallbackMessage: "safe public message", stagingDiagnostic: diagnostic, logger: { error() {} } });
  const serialized = JSON.stringify(response.body);
  for (const forbidden of forbiddenValues) assert.equal(serialized.includes(forbidden), false, `diagnostic disclosed ${forbidden}`);
  assert.equal(response.body.diagnostic.failedOperation, "STORAGE_PUT");
  for (const reason of ["ASSET_CONFIRM_REREAD_NOT_FOUND", "ASSET_CONFIRM_REREAD_ERROR", "ASSET_CONFIRM_BINDING_MISMATCH", "ASSET_CONFIRM_OTHER_ERROR"]) {
    const confirm = createStagingMediaDiagnostic({ environment: "staging", authenticated: true, headerValue: "1", requestId: "media-diagnostic-request", progress: { failedOperation: "ASSET_CONFIRM", assetConfirmReason: reason }, error: Object.assign(new Error(forbiddenValues.join(" ")), { status: 500, stack: forbiddenValues.join(" ") }) });
    assert.deepEqual(confirm, { requestId: "media-diagnostic-request", lastCompletedPhase: null, failedOperation: "ASSET_CONFIRM", errorClass: "UNKNOWN_INTERNAL", assetConfirmReason: reason });
    for (const forbidden of forbiddenValues) assert.equal(JSON.stringify(confirm).includes(forbidden), false, `confirm diagnostic disclosed ${forbidden}`);
  }
  const invalidReason = createStagingMediaDiagnostic({ environment: "staging", authenticated: true, headerValue: "1", requestId: "media-diagnostic-request", progress: { failedOperation: "ASSET_CONFIRM", assetConfirmReason: "raw-error-message" }, error });
  assert.equal("assetConfirmReason" in invalidReason, false);
  const unrelatedOperation = createStagingMediaDiagnostic({ environment: "staging", authenticated: true, headerValue: "1", requestId: "media-diagnostic-request", progress: { failedOperation: "STORAGE_PUT", assetConfirmReason: "ASSET_CONFIRM_REREAD_ERROR" }, error });
  assert.equal("assetConfirmReason" in unrelatedOperation, false);
});

test("diagnostic activation requires Staging, authenticated scope, and the explicit header", () => {
  const req = { saasService: {}, merchantScope: { tenantId: "scope" }, get(name) { return name === "X-FEELDAO-Media-Diagnostic" ? "1" : undefined; } };
  assert.equal(isStagingMediaDiagnosticRequest({ environment: "staging", req }), true);
  assert.equal(isStagingMediaDiagnosticRequest({ environment: "production", req }), false);
  assert.equal(isStagingMediaDiagnosticRequest({ environment: "staging", req: { ...req, merchantScope: null } }), false);
  assert.equal(createStagingMediaDiagnostic({ environment: "production", authenticated: true, headerValue: "1", requestId: "media-diagnostic-request", progress: diagnosticProgress(), error: Object.assign(new Error("secret"), { status: 500 }) }), null);
});

test("diagnostic-disabled public error contract remains unchanged", () => {
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  respondUnexpectedError(response, Object.assign(new Error("fixture internal error"), { status: 500 }), { requestId: "media-public-request", fallbackCode: "INTERNAL_ERROR", fallbackMessage: "safe public message", logger: { error() {} } });
  assert.deepEqual(response.body, { ok: false, code: "INTERNAL_ERROR", message: "safe public message", error: "safe public message", data: null, requestId: "media-public-request" });
  assert.equal("diagnostic" in response.body, false);
});

test("synthetic canary upload marker is explicit, purpose-neutral, and unlinked", async () => {
  const repo = repository(); const p = provider(); const service = createMediaService({ provider: p, repository: repo });
  const result = await service.upload(SCOPE, { name: "feeldao-canary.png", data: PNG, purpose: "content_image", variant: "original", syntheticCanary: true });
  assert.equal(result.status, "ready");
  const pending = repo.calls.find(call => call[0] === "pending")[1];
  assert.equal(pending.metadata.lifecycleCanary, require("../asset-lifecycle-permit").CANARY_MARKER);
  assert.equal(repo.calls.some(call => call[0] === "link"), false);
  await assert.rejects(() => service.upload(SCOPE, { name: "invalid-canary.png", data: PNG, purpose: "product_main", syntheticCanary: true, entityId: "product" }), error => error.code === "SYNTHETIC_CANARY_ASSET_INVALID");
});

test("upload failure deletes and verifies the exact Storage key, then removes exact partial metadata", async () => {
  const repo = repository(); const p = provider({ async verifyObject() { throw new Error("verify"); } }); const svc = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => svc.upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_OBJECT_MISMATCH");
  assert.equal(p.calls.filter(c => c[0] === "delete").length, 1);
  assert.equal(p.calls.filter(c => c[0] === "verify-deleted").length, 1);
  assert.equal(repo.calls.at(-1)[0], "cleanup");
  assert.equal(repo.assets.size, 0);
});

test("same-key replay after cleanup returns the persisted CONSISTENT_CLEANED result without restarting upload", async () => {
  const repo = repository();
  const p = provider({
    async uploadObject() { this.calls.push(["upload-failed"]); const error = new Error("rejected"); error.status = 400; throw error; },
    async verifyObject() { const error = new Error("absent"); error.status = 404; throw error; },
    async readObject() { const error = new Error("absent"); error.status = 404; throw error; }
  });
  const service = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "clean-replay" }));
  const cleanedAttempt = [...repo.attempts.values()][0];
  assert.equal(cleanedAttempt.phase, "CLEANED");
  assert.equal(cleanedAttempt.terminal_state, "CONSISTENT_CLEANED");
  const replay = await service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "clean-replay" });
  assert.equal(replay.terminalState, "CONSISTENT_CLEANED");
  assert.equal(replay.status, "cleaned");
  assert.equal(replay.id, cleanedAttempt.asset_id);
  assert.equal(replay.uploadAttemptId, cleanedAttempt.attempt_id);
  assert.equal(replay.duplicate, true);
  assert.equal(p.calls.filter(call => call[0] === "upload-failed").length, 1);
  assert.equal(repo.assets.size, 0);
  await assert.rejects(() => service.upload(SCOPE, { name: "different.png", data: PNG }, { idempotencyKey: "clean-replay" }), error => error.code === "MEDIA_IDEMPOTENCY_KEY_REUSE");
});

test("V1 upload retains folder metadata and binds it into the same-key fingerprint", async () => {
  const repo = repository();
  const service = createMediaService({ provider: provider(), repository: repo });
  const input = { name: "hero.png", data: PNG, folderId: "folder-a" };
  const first = await service.upload(SCOPE, input, { idempotencyKey: "folder-replay" });
  assert.equal(repo.assets.get(first.id).metadata.folderId, "folder-a");
  const replay = await service.upload(SCOPE, input, { idempotencyKey: "folder-replay" });
  assert.equal(replay.id, first.id);
  await assert.rejects(() => service.upload(SCOPE, { ...input, folderId: "folder-b" }, { idempotencyKey: "folder-replay" }), error => error.code === "MEDIA_IDEMPOTENCY_KEY_REUSE");
});

test("ambiguous Storage upload timeout discovers and rolls forward the exact accepted object", async () => {
  const repo = repository(); let present = false;
  const p = provider({
    async uploadObject(_scope, key) { this.calls.push(["upload", key]); present = true; const error = new Error("timeout"); error.code = "STORAGE_UNAVAILABLE"; throw error; },
    async verifyObject(_scope, key, expected) { this.calls.push(["verify", key]); if (!present) { const error = new Error("missing"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; },
    async readObject(_scope, key) { this.calls.push(["read", key]); if (!present) { const error = new Error("missing"); error.status = 404; throw error; } return { sizeBytes: 68, checksum: "different" }; },
    async deleteObject(_scope, key) { this.calls.push(["delete", key]); present = false; },
    async verifyDeleted(_scope, key) { this.calls.push(["verify-deleted", key]); return !present; }
  });
  const svc = createMediaService({ provider: p, repository: repo });
  const result = await svc.upload(SCOPE, { name: "hero.png", data: PNG });
  assert.equal(result.status, "ready");
  assert.equal(present, true);
  assert.equal(repo.assets.size, 1);
  assert.equal(p.calls.filter(call => call[0] === "delete").length, 0);
});

test("cleanup failure is surfaced as indeterminate and never reported as a clean failure", async () => {
  const repo = repository({ async deleteUploadAttempt() { throw new Error("database unavailable"); } });
  const p = provider({ async verifyObject() { throw new Error("verify"); } });
  await assert.rejects(() => createMediaService({ provider: p, repository: repo }).upload(SCOPE, { name: "hero.png", data: PNG }), error => error.code === "MEDIA_UPLOAD_CLEANUP_INDETERMINATE");
  assert.equal([...repo.attempts.values()][0].phase, "CLEANUP_REQUIRED");
});

test("ambiguous ready PATCH is rolled forward only after exact asset, object, link, and bytes verify", async () => {
  const repo = repository(); const transition = repo.transitionAssetStatus.bind(repo);
  repo.transitionAssetStatus = async (...args) => { await transition(...args); throw new Error("database response lost"); };
  const result = await createMediaService({ provider: provider(), repository: repo }).upload(SCOPE, { name: "hero.png", data: PNG });
  assert.equal(result.status, "ready");
  assert.equal(result.duplicate, true);
  assert.equal(repo.assets.get(result.id).metadata.uploadState, "ready");
  assert.equal(repo.calls.some(call => call[0] === "cleanup"), false);
});

test("ambiguous asset insert is reconciled by exact row identity before one Storage upload", async () => {
  const repo = repository(); const create = repo.createPendingAsset.bind(repo);
  repo.createPendingAsset = async (...args) => { await create(...args); throw new Error("database response lost"); };
  let present = false;
  const p = provider({
    async uploadObject(scope, key, bytes) { this.calls.push(["upload", key]); present = true; return { checksum: require("../storage-provider").sha256Hex(bytes) }; },
    async verifyObject(_scope, _key, expected) { if (!present) { const error = new Error("not found"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; },
    async readObject() { if (!present) { const error = new Error("not found"); error.status = 404; throw error; } return { sizeBytes: 68, checksum: require("../storage-provider").sha256Hex(Buffer.from("")) }; }
  });
  const result = await createMediaService({ provider: p, repository: repo }).upload(SCOPE, { name: "hero.png", data: PNG });
  assert.equal(result.status, "ready");
  assert.equal(p.calls.some(call => call[0] === "upload"), true);
  assert.equal(p.calls.some(call => call[0] === "delete"), false);
  assert.equal(repo.assets.size, 1);
});

test("same key and payload replay the canonical ready result without another asset or upload", async () => {
  const repo = repository(); let present = false; const p = provider({ async uploadObject(_scope, key, bytes) { this.calls.push(["upload", key]); present = true; return { checksum: require("../storage-provider").sha256Hex(bytes) }; }, async verifyObject(_scope, _key, expected) { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; }, async readObject() { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { bytes: new Uint8Array(68), mimeType: "image/png", sizeBytes: 68 }; } }); const service = createMediaService({ provider: p, repository: repo });
  const first = await service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "retry-1" });
  const replay = await service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "retry-1" });
  assert.equal(replay.id, first.id); assert.equal(replay.uploadAttemptId, first.uploadAttemptId); assert.equal(replay.duplicate, true);
  assert.equal(repo.assets.size, 1); assert.equal(p.calls.filter(c => c[0] === "upload").length, 1);
});

test("same scoped idempotency key with a different canonical fingerprint is rejected", async () => {
  const repo = repository(); let present = false; const p = provider({ async uploadObject(_scope, key, bytes) { this.calls.push(["upload", key]); present = true; return { checksum: require("../storage-provider").sha256Hex(bytes) }; }, async verifyObject(_scope, _key, expected) { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; }, async readObject() { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { bytes: new Uint8Array(68), mimeType: "image/png", sizeBytes: 68 }; } }); const service = createMediaService({ provider: p, repository: repo });
  await service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "retry-2" });
  await assert.rejects(() => service.upload(SCOPE, { name: "other.png", data: PNG }, { idempotencyKey: "retry-2" }), error => error.code === "MEDIA_IDEMPOTENCY_KEY_REUSE");
  assert.equal(repo.assets.size, 1); assert.equal(p.calls.filter(c => c[0] === "upload").length, 1);
});

test("concurrent same-key requests have one lease owner and one canonical upload", async () => {
  const repo = repository(); let releaseUpload; let entered; const waiting = new Promise(resolve => { entered = resolve; });
  let present = false;
  const p = provider({ async uploadObject(_scope, key, bytes) { this.calls.push(["upload", key]); entered(); await new Promise(resolve => { releaseUpload = resolve; }); present = true; return { checksum: require("../storage-provider").sha256Hex(bytes) }; }, async verifyObject(_scope, _key, expected) { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; }, async readObject() { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { bytes: new Uint8Array(68), mimeType: "image/png", sizeBytes: 68 }; } });
  const service = createMediaService({ provider: p, repository: repo });
  const firstPromise = service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "concurrent-1" });
  await waiting;
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "concurrent-1" }), error => error.code === "MEDIA_UPLOAD_IN_PROGRESS");
  releaseUpload(); const first = await firstPromise;
  assert.equal(repo.assets.size, 1); assert.equal(p.calls.filter(c => c[0] === "upload").length, 1); assert.equal(first.status, "ready");
});

test("idempotency records are isolated by authenticated tenant, workspace, and merchant", async () => {
  const repo = repository(); const p = provider(); const service = createMediaService({ provider: p, repository: repo });
  const scopes = [SCOPE, { ...SCOPE, tenantId: "00000000-0000-0000-0000-000000000012" }, { ...SCOPE, workspaceId: "00000000-0000-0000-0000-000000000013" }, { ...SCOPE, userId: "00000000-0000-0000-0000-000000000014" }];
  const results = [];
  for (const scope of scopes) results.push(await service.upload(scope, { name: "hero.png", data: PNG }, { idempotencyKey: "same-text-key" }));
  assert.equal(new Set(results.map(r => r.id)).size, 4); assert.equal(repo.assets.size, 4);
  assert.equal(await repo.getUploadAttempt({ ...SCOPE, workspaceId: "00000000-0000-0000-0000-000000000099" }, results[0].uploadAttemptId), null);
});

test("expired post-Storage crash resumes the same durable attempt and rolls forward", async () => {
  const repo = repository(); const assetId = "11111111-1111-4111-8111-111111111111"; const attemptId = "22222222-2222-4222-8222-222222222222"; const rawKey = "crash-retry-1";
  const bytes = Buffer.from(PNG.split(",")[1], "base64"); const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const objectKey = canonicalObjectKey(SCOPE, assetId, "original", ".png"); const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ operation: "POST /api/media/v1/upload", contentSha256: checksum, contentLength: bytes.length, contentType: "image/png", originalName: "hero.png", purpose: "content_image", variant: "original", entityId: null, position: null, folderId: "", syntheticCanary: false })).digest("hex");
  const reservation = await repo.reserveUploadAttempt(SCOPE, { attemptId, assetId, expectedObjectKey: objectKey, idempotencyKeyHash: keyHash, requestFingerprint: fingerprint, contentSha256: checksum, contentLength: bytes.length, contentType: "image/png", originalName: "hero.png", purpose: "content_image", variant: "original", entityId: null, position: null, syntheticCanary: false, assetMetadata: {}, leaseToken: "expired-owner", leaseExpiresAt: "2000-01-01T00:00:00.000Z" });
  Object.assign(reservation.attempt, { phase: "STORAGE_OBJECT_PRESENT" });
  repo.assets.set(assetId, { id: assetId, tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, store_id: SCOPE.storeId, object_key: objectKey, status: "pending", metadata: { uploadAttemptId: attemptId } });
  const p = provider({ async uploadObject() { assert.fail("crash retry must not upload a second object"); }, async verifyObject(_scope, key, expected) { assert.equal(key, objectKey); return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; } });
  const result = await createMediaService({ provider: p, repository: repo }).upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: rawKey });
  assert.equal(result.id, assetId); assert.equal(result.uploadAttemptId, attemptId); assert.equal(repo.assets.size, 1); assert.equal(repo.assets.get(assetId).status, "ready");
  assert.equal(reservation.attempt.terminal_state, "CONSISTENT_READY"); assert.equal(p.calls.filter(c => c[0] === "upload").length, 0);
});

test("upload timeout with absent object remains durable and restart recovery cleans without inventing bytes", async () => {
  const repo = repository(); let present = false;
  const p = provider({ async uploadObject(_scope, key) { this.calls.push(["upload-timeout", key]); const error = new Error("network timeout"); error.code = "STORAGE_UNAVAILABLE"; throw error; }, async verifyObject() { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } }, async readObject() { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { bytes: new Uint8Array(68), mimeType: "image/png", sizeBytes: 68 }; }, async deleteObject(_scope, key) { this.calls.push(["delete", key]); present = false; }, async verifyDeleted() { return !present; } });
  const service = createMediaService({ provider: p, repository: repo });
  await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "upload-timeout-absent" }), error => error.code === "MEDIA_UPLOAD_CLEANUP_INDETERMINATE");
  const attempt = repo.attempts.values().next().value; assert.notEqual(attempt.phase, "CLEANED");
  attempt.lease_expires_at = "2000-01-01T00:00:00.000Z";
  assert.equal((await service.recoverExpiredUploadAttempts())[0].outcome, "CONSISTENT_CLEANED");
  assert.equal(repo.assets.size, 0); assert.equal(attempt.terminal_state, "CONSISTENT_CLEANED");
  const cleanedReplay = await service.upload(SCOPE, { name: "hero.png", data: PNG }, { idempotencyKey: "upload-timeout-absent" });
  assert.equal(cleanedReplay.terminalState, "CONSISTENT_CLEANED");
  assert.equal(cleanedReplay.duplicate, true);
  assert.equal(repo.assets.size, 0);
});

test("delete response loss is reconciled by exact absence or retried while object remains", async () => {
  for (const deleteLeavesObject of [false, true]) {
    const repo = repository({ async productInScope() { return false; } }); let present = false;
    const p = provider({ async uploadObject(_scope, key, bytes) { this.calls.push(["upload", key]); present = true; return { checksum: require("../storage-provider").sha256Hex(bytes) }; }, async verifyObject(_scope, _key, expected) { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { sizeBytes: expected.sizeBytes, checksum: expected.checksum, mimeType: expected.mimeType }; }, async readObject() { if (!present) { const error = new Error("absent"); error.status = 404; throw error; } return { bytes: new Uint8Array(68), mimeType: "image/png", sizeBytes: 68 }; }, async deleteObject(_scope, key) { this.calls.push(["delete-timeout", key]); if (!deleteLeavesObject) present = false; const error = new Error("delete response timed out"); error.code = "STORAGE_NETWORK_TIMEOUT"; throw error; }, async verifyDeleted() { return !present; } });
    const service = createMediaService({ provider: p, repository: repo });
    await assert.rejects(() => service.upload(SCOPE, { name: "hero.png", data: PNG, purpose: "product_main", entityId: 10 }), error => error.code === (deleteLeavesObject ? "MEDIA_UPLOAD_CLEANUP_INDETERMINATE" : "PRODUCT_SCOPE_DENIED"));
    const attempt = repo.attempts.values().next().value;
    if (deleteLeavesObject) { assert.equal(attempt.phase, "CLEANUP_REQUIRED"); present = false; attempt.lease_expires_at = "2000-01-01T00:00:00.000Z"; assert.equal((await service.recoverExpiredUploadAttempts())[0].outcome, "CONSISTENT_CLEANED"); }
    else assert.equal(attempt.terminal_state, "CONSISTENT_CLEANED");
    assert.equal(repo.assets.size, 0);
  }
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
