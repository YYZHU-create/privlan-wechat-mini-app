const test = require("node:test");
const assert = require("node:assert/strict");
const { createMeooMediaRepository } = require("../meoo-media-repository");
const { createAssetRepository, RECONCILIATION, DELETE_CLAIM } = require("../asset-repository");
const SCOPE = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a" };
const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => body == null ? "" : JSON.stringify(body) });

test("Meoo media repository scopes reads and writes", async () => {
  const calls = [];
  const repo = createMeooMediaRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, [{ id: "asset-a", tenant_id: "tenant-a", workspace_id: "workspace-a", store_id: "store-a", object_key: "asset-a.png", original_name: "a.png", mime_type: "image/png", bytes: 10, metadata: {} }]); } });
  assert.equal((await repo.listAssets(SCOPE))[0].id, "asset-a");
  assert.equal((await repo.getAsset(SCOPE, "asset-a")).id, "asset-a");
  await repo.createAsset(SCOPE, { id: "asset-b", objectKey: "b.png", originalName: "b.png", mimeType: "image/png", bytes: 4, metadata: {} });
  for (const call of calls.slice(0, 2)) {
    assert.match(call.url, /tenant_id=eq\.tenant-a/);
    assert.match(call.url, /workspace_id=eq\.workspace-a/);
    assert.match(call.url, /store_id=eq\.store-a/);
    assert.match(call.url, /status,purpose,deleted_at/);
  }
  assert.match(calls[1].url, /id=eq\.asset-a/);
  const body = JSON.parse(calls[2].options.body); assert.equal(body.tenant_id, "tenant-a"); assert.equal(body.workspace_id, "workspace-a"); assert.equal(body.store_id, "store-a");
});

test("Meoo media repository retries transient reads and normalizes failure", async () => {
  let attempts = 0;
  const repo = createMeooMediaRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async () => { attempts += 1; return attempts < 3 ? response(503, { message: "busy" }) : response(200, []); } });
  assert.deepEqual(await repo.listAssets(SCOPE), []); assert.equal(attempts, 3);
});

test("asset repository scopes lifecycle reads and invokes only explicit lifecycle RPCs", async () => {
  const calls = [];
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("atelier_asset_finalize_delete_v1")) return response(200, { ok: true, data: { id: "asset-a", deleted: true } });
    if (url.includes("atelier_asset_purge_v1")) return response(200, { ok: true, data: { id: "asset-a", purged: true } });
    if (url.includes("atelier_asset_cleanup_deleted_links_v1")) return response(200, { ok: true, data: { id: "asset-a", linksRemoved: 1 } });
    return response(200, [{ id: "asset-a", object_key: "tenant/a/original.png", variant: "original", status: "deleted", deleted_at: "2026-01-01T00:00:00.000Z" }]);
  } });
  const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a", userId: "merchant-a", requestId: "request-a" };
  assert.equal((await repo.listAssetObjects(scope, "asset-a")).length, 1);
  assert.equal((await repo.listDeletedAssets(scope, { retentionCutoff: "2026-01-02T00:00:00.000Z", batchSize: 9 })).length, 1);
  await repo.finalizeAssetDeletion(scope, "asset-a", { storageVerifiedAt: "2026-01-01T00:00:00.000Z", objectCount: 1 });
  await repo.cleanupDeletedAssetLinks(scope, "asset-a", {});
  await repo.purgeDeletedAsset(scope, "asset-a", { retentionCutoff: "2025-12-01T00:00:00.000Z", storageVerifiedAt: "2026-01-01T00:00:00.000Z", objectCount: 1 });
  const deletedAssetsCall = calls.find(call => call.url.includes("/rest/v1/assets?") && call.url.includes("status=eq.deleted"));
  assert.ok(deletedAssetsCall);
  assert.match(deletedAssetsCall.url, /tenant_id=eq\.tenant-a/);
  assert.match(deletedAssetsCall.url, /workspace_id=eq\.workspace-a/);
  assert.match(deletedAssetsCall.url, /deleted_at=lte\.2026-01-02T00%3A00%3A00.000Z/);
  const rpcCalls = calls.filter(call => call.url.includes("/rest/v1/rpc/"));
  assert.equal(rpcCalls.length, 3);
  assert.match(rpcCalls[0].url, /rpc\/atelier_asset_finalize_delete_v1$/);
  const finalizeBody = JSON.parse(rpcCalls[0].options.body);
  assert.equal(finalizeBody.p_actor_id, "merchant-a");
  assert.equal(finalizeBody.p_object_count, 1);
  assert.match(rpcCalls[2].url, /rpc\/atelier_asset_purge_v1$/);
});

test("asset repository retries only transient GET reads with bounded backoff", async () => {
  let attempts = 0; const waits = [];
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async milliseconds => waits.push(milliseconds), fetchImpl: async () => {
    attempts += 1;
    return attempts < 3 ? response(503, { message: "busy" }) : response(200, [{ id: "asset-a", status: "ready" }]);
  } });
  assert.equal((await repo.getAssetByIdScoped(SCOPE, "asset-a")).id, "asset-a");
  assert.equal(attempts, 3); assert.deepEqual(waits, [100, 200]);
});

test("asset repository does not retry definite read failures and reports retry exhaustion", async () => {
  let definiteAttempts = 0;
  const definite = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async () => assert.fail("definite errors must not back off"), fetchImpl: async () => { definiteAttempts += 1; return response(400, { message: "invalid" }); } });
  await assert.rejects(() => definite.getAssetByIdScoped(SCOPE, "asset-a"), error => error.status === 400);
  assert.equal(definiteAttempts, 1);
  let exhaustedAttempts = 0;
  const exhausted = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async () => {}, fetchImpl: async () => { exhaustedAttempts += 1; return response(503, { message: "busy" }); } });
  await assert.rejects(() => exhausted.getAssetByIdScoped(SCOPE, "asset-a"), error => error.code === "DATABASE_UNAVAILABLE" && error.transport.retryable === true);
  assert.equal(exhaustedAttempts, 3);
});

function lifecycleFetch({ action, initialRpc, asset, audit = [], replayRpc = response(200, { ok: true, data: { id: "asset-a", done: true } }) }) {
  let rpcAttempts = 0; const requestIds = [];
  return {
    requestIds,
    fetchImpl: async (url, options = {}) => {
      if (url.includes(`/rpc/${action === "asset.deleted" ? "atelier_asset_finalize_delete_v1" : "atelier_asset_purge_v1"}`)) {
        rpcAttempts += 1; requestIds.push(JSON.parse(options.body).p_request_id);
        return rpcAttempts === 1 ? initialRpc : replayRpc;
      }
      if (url.includes("/rest/v1/assets?")) return response(200, asset ? [asset] : []);
      if (url.includes("/rest/v1/asset_objects?")) return response(200, []);
      if (url.includes("/rest/v1/asset_links?")) return response(200, []);
      if (url.includes("/rest/v1/audit_events?")) return response(200, audit);
      throw new Error(`unexpected URL ${url}`);
    }
  };
}

test("ambiguous finalization confirms a completed lifecycle audit without replay", async () => {
  const fixture = lifecycleFetch({ action: "asset.deleted", initialRpc: response(503, {}), asset: { id: "asset-a", status: "deleted", deleted_at: "2026-01-01T00:00:00.000Z" }, audit: [{ id: "audit-a", action: "asset.deleted", request_id: "request-a" }] });
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async () => {}, fetchImpl: fixture.fetchImpl });
  const result = await repo.finalizeAssetDeletion({ ...SCOPE, userId: "merchant-a", requestId: "request-a" }, "asset-a", { storageVerifiedAt: "2026-01-01T00:00:00.000Z", objectCount: 0 });
  assert.equal(result.duplicate, true); assert.equal(result.reconciliation.outcome, RECONCILIATION.SUCCEEDED); assert.deepEqual(fixture.requestIds, ["request-a"]);
});

test("ambiguous purge replays only after scoped metadata proves no mutation", async () => {
  const fixture = lifecycleFetch({ action: "asset.purged", initialRpc: response(503, {}), asset: { id: "asset-a", status: "deleted", deleted_at: "2026-01-01T00:00:00.000Z" } });
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async () => {}, fetchImpl: fixture.fetchImpl });
  const result = await repo.purgeDeletedAsset({ ...SCOPE, userId: "merchant-a", requestId: "run-a" }, "asset-a", { retentionCutoff: "2025-12-01T00:00:00.000Z", storageVerifiedAt: "2026-01-01T00:00:00.000Z", objectCount: 0 });
  assert.equal(result.done, true); assert.equal(result.reconciliation.outcome, RECONCILIATION.NOT_APPLIED); assert.deepEqual(fixture.requestIds, ["run-a", "run-a"]);
});

test("ambiguous finalization stops when authoritative state is indeterminate", async () => {
  const fixture = lifecycleFetch({ action: "asset.deleted", initialRpc: response(503, {}), asset: { id: "asset-a", status: "ready" } });
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async () => {}, fetchImpl: fixture.fetchImpl });
  await assert.rejects(() => repo.finalizeAssetDeletion({ ...SCOPE, userId: "merchant-a", requestId: "request-a" }, "asset-a", { storageVerifiedAt: "2026-01-01T00:00:00.000Z", objectCount: 0 }), error => error.reconciliation?.outcome === RECONCILIATION.INDETERMINATE);
  assert.deepEqual(fixture.requestIds, ["request-a"]);
});

test("CAS deletion transition never treats an ambiguous committed state as this request's ownership", async () => {
  let patchAttempts = 0;
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", sleep: async () => {}, fetchImpl: async (url, options = {}) => {
    if (options.method === "PATCH") { patchAttempts += 1; return response(503, {}); }
    if (url.includes("/rest/v1/assets?")) return response(200, [{ id: "asset-a", status: "deletion_requested" }]);
    throw new Error(`unexpected URL ${url}`);
  } });
  const result = await repo.requestAssetDeletion(SCOPE, "asset-a");
  assert.equal(result.outcome, DELETE_CLAIM.NOT_ACQUIRED); assert.equal(result.asset.status, "deletion_requested"); assert.equal(patchAttempts, 1);
});

test("CAS deletion transition scopes the atomic ready predicate and rejects zero affected rows", async () => {
  const calls = [];
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "PATCH") return response(200, []);
    if (url.includes("/rest/v1/assets?")) return response(200, [{ id: "asset-a", status: "deletion_requested" }]);
    throw new Error(`unexpected URL ${url}`);
  } });
  const result = await repo.requestAssetDeletion(SCOPE, "asset-a");
  assert.equal(result.outcome, DELETE_CLAIM.NOT_ACQUIRED);
  const patch = calls.find(call => call.options.method === "PATCH");
  assert.match(patch.url, /tenant_id=eq\.tenant-a/);
  assert.match(patch.url, /workspace_id=eq\.workspace-a/);
  assert.match(patch.url, /store_id=eq\.store-a/);
  assert.match(patch.url, /status=eq\.ready/);
});

test("cross-scope CAS cannot acquire an asset or issue a second mutation", async () => {
  let patchAttempts = 0;
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async (_url, options = {}) => {
    if (options.method === "PATCH") { patchAttempts += 1; return response(200, []); }
    return response(200, []);
  } });
  const result = await repo.requestAssetDeletion({ ...SCOPE, tenantId: "other-tenant" }, "asset-a");
  assert.equal(result.outcome, DELETE_CLAIM.INDETERMINATE);
  assert.equal(patchAttempts, 1);
});

test("asset lifecycle aggregate reads use exact counts with database-side row bounds", async () => {
  const calls = [];
  const repo = createAssetRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    return response(200, [{ id: "asset-a" }], { "content-range": "0-0/137" });
  } });
  const count = await repo.countDeletedAssets({ tenantId: "tenant-a", workspaceId: "workspace-a" }, { allStores: true, withLinks: true });
  assert.equal(count, 137);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("asset_links.limit=1"));
  assert.ok(calls[0].url.includes("asset_links.tenant_id=eq.tenant-a"));
  assert.ok(calls[0].url.includes("asset_links.workspace_id=eq.workspace-a"));
  assert.ok(calls[0].url.includes("limit=1"));
  assert.equal(calls[0].options.headers.Prefer, "count=exact");
  assert.equal(calls[0].options.headers.Range, "0-0");
});
