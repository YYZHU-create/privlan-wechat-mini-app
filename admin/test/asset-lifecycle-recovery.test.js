const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { CANARY_MARKER, CANARY_OPERATION } = require("../asset-lifecycle-permit");
const { createMediaService } = require("../media-service-v1");
const { registerMerchantRoutes } = require("../merchant-routes");

const SCOPE = { userId: "00000000-0000-0000-0000-000000000001", tenantId: "00000000-0000-0000-0000-000000000002", workspaceId: "00000000-0000-0000-0000-000000000003", storeId: "00000000-0000-0000-0000-000000000004", requestId: "recovery-test" };
const ASSET = "00000000-0000-0000-0000-000000000005";
const POLICY_ID = "10000000-0000-4000-8000-000000000011";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000012";
const AUTH = { operation: CANARY_OPERATION, policyId: POLICY_ID, attemptId: ATTEMPT_ID };
const OTHER = "00000000-0000-0000-0000-000000000006";
const keyFor = id => `tenant/${SCOPE.tenantId}/workspace/${SCOPE.workspaceId}/asset/${id}/original.png`;

function fixture({ status = "deletion_requested", present = false, configOverrides = {}, assetOverrides = {}, links = [] } = {}) {
  const canary = { enabled: true, tenantId: SCOPE.tenantId, workspaceId: SCOPE.workspaceId, storeId: SCOPE.storeId, assetId: ASSET, operation: CANARY_OPERATION, expectedStatus: "ready", expectedObjectKey: keyFor(ASSET), marker: CANARY_MARKER, policyId: POLICY_ID, attemptId: ATTEMPT_ID, expiresAt: new Date(Date.now() - 60_000).toISOString(), ...configOverrides };
  const asset = { id: ASSET, tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, store_id: SCOPE.storeId, purpose: "content_image", status, deleted_at: status === "deleted" ? new Date().toISOString() : null, metadata: { lifecycleCanary: CANARY_MARKER, ...(status === "ready" ? {} : { lifecycleCanaryAuthorization: { policyId: POLICY_ID, attemptId: ATTEMPT_ID } }) }, ...assetOverrides };
  const other = { id: OTHER, tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId, store_id: SCOPE.storeId, purpose: "content_image", status: "ready", deleted_at: null, metadata: {} };
  const rows = new Map([[ASSET, asset], [OTHER, other]]);
  const objects = new Map([[ASSET, [{ asset_id: ASSET, variant: "original", object_key: keyFor(ASSET) }]], [OTHER, [{ asset_id: OTHER, variant: "original", object_key: keyFor(OTHER) }]]]);
  const audit = new Map([[ASSET, status === "deleted" ? [{ action: "asset.deleted", request_id: "prior" }] : []]]);
  const repoCalls = [];
  const storageCalls = [];
  const repository = {
    async getAssetByIdScoped(scope, id) { repoCalls.push(["asset", scope.tenantId, scope.workspaceId, id]); const row = rows.get(id); return row && row.tenant_id === scope.tenantId && row.workspace_id === scope.workspaceId ? row : null; },
    async listAssetObjects(_scope, id) { repoCalls.push(["objects", id]); return objects.get(id) || []; },
    async listAssetLinks(_scope, id) { repoCalls.push(["links", id]); return id === ASSET ? links : []; },
    async listLifecycleAuditEvents(_scope, id, input) { repoCalls.push(["audit", id, input.action]); return audit.get(id) || []; },
    async finalizeAssetDeletion(_scope, id, input) { repoCalls.push(["finalize", id, input.retryNotApplied]); const row = rows.get(id); row.status = "deleted"; row.deleted_at = input.storageVerifiedAt; audit.set(id, [{ action: "asset.deleted", request_id: SCOPE.requestId }]); return { id, deleted: true, duplicate: false }; }
  };
  const state = { present };
  const provider = {
    name: "storage-simulator",
    async verifyDeleted(_scope, key) { storageCalls.push(["verify", key]); return !state.present; },
    async deleteObject(_scope, key) { storageCalls.push(["delete", key]); state.present = false; return { deleted: true }; }
  };
  const service = createMediaService({ provider, repository, lifecycleMutationsEnabled: false, lifecycleCanaryConfig: canary, runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g" });
  return { service, repository, provider, rows, objects, audit, state, repoCalls, storageCalls, canary, asset, other };
}

test("recovery resumes only the configured exact target after expiry and reaches CONSISTENT_DELETED", async () => {
  const f = fixture({ present: false });
  let finalizeFailures = 1;
  f.repository.finalizeAssetDeletion = async (_scope, id, input) => {
    f.repoCalls.push(["finalize", id, input.retryNotApplied]);
    if (finalizeFailures--) throw Object.assign(new Error("simulated database outage"), { code: "DATABASE_UNAVAILABLE" });
    const row = f.rows.get(id); row.status = "deleted"; row.deleted_at = input.storageVerifiedAt;
    f.audit.set(id, [{ action: "asset.deleted", request_id: SCOPE.requestId }]);
    return { id, deleted: true, duplicate: false };
  };
  await assert.rejects(() => f.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "DATABASE_UNAVAILABLE");
  assert.equal(f.asset.status, "deletion_requested");
  assert.deepEqual(f.storageCalls, [["verify", keyFor(ASSET)], ["verify", keyFor(ASSET)]]);
  const result = await f.service.recoverDeletion(SCOPE, ASSET, AUTH);
  assert.equal(result.state, "CONSISTENT_DELETED");
  assert.equal(f.asset.status, "deleted");
  assert.equal(f.repoCalls.filter(call => call[0] === "finalize").length, 2);
  assert.equal(f.repoCalls.some(call => (call[0] === "asset" && call[3] === OTHER) || (["objects", "links", "audit", "finalize"].includes(call[0]) && call[1] === OTHER)), false);
  assert.equal(f.other.status, "ready");
  assert.equal(f.state.present, false);
});

test("recovery explicitly rolls forward when exact Storage object remains present", async () => {
  const f = fixture({ present: true });
  const result = await f.service.recoverDeletion(SCOPE, ASSET, AUTH);
  assert.equal(result.state, "CONSISTENT_DELETED");
  assert.deepEqual(f.storageCalls, [["verify", keyFor(ASSET)], ["delete", keyFor(ASSET)], ["verify", keyFor(ASSET)], ["verify", keyFor(ASSET)]]);
  assert.equal(f.asset.status, "deleted");
  assert.equal(f.other.status, "ready");
});

test("Storage delete failure with object still present leaves an explicit recoverable intermediate state", async () => {
  const f = fixture({ present: true });
  f.provider.deleteObject = async (_scope, key) => { f.storageCalls.push(["delete", key]); throw Object.assign(new Error("storage unavailable"), { code: "STORAGE_DELETE_FAILED", status: 503 }); };
  await assert.rejects(() => f.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "ASSET_LIFECYCLE_RECOVERY_STORAGE_STILL_PRESENT");
  assert.equal(f.asset.status, "deletion_requested");
  assert.equal(f.repoCalls.some(call => call[0] === "finalize"), false);
  assert.equal(f.other.status, "ready");
});

test("Storage delete that removes the object but loses its response is reconciled by exact readback", async () => {
  const f = fixture({ present: true });
  f.provider.deleteObject = async (_scope, key) => {
    f.storageCalls.push(["delete", key]);
    f.state.present = false;
    throw Object.assign(new Error("response lost after object removal"), { code: "NETWORK_ERROR", status: 502 });
  };
  const result = await f.service.recoverDeletion(SCOPE, ASSET, AUTH);
  assert.equal(result.state, "CONSISTENT_DELETED");
  assert.equal(f.asset.status, "deleted");
  assert.equal(f.state.present, false);
  assert.deepEqual(f.storageCalls, [["verify", keyFor(ASSET)], ["delete", keyFor(ASSET)], ["verify", keyFor(ASSET)], ["verify", keyFor(ASSET)]]);
  assert.equal(f.other.status, "ready");
});

test("ready target is reported as CONSISTENT_PRE_DELETE only while its exact object exists", async () => {
  const present = fixture({ status: "ready", present: true });
  assert.deepEqual(await present.service.recoverDeletion(SCOPE, ASSET, AUTH), { id: ASSET, state: "CONSISTENT_PRE_DELETE", duplicate: true });
  const absent = fixture({ status: "ready", present: false });
  await assert.rejects(() => absent.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED");
});

test("expired target scope cannot recover a different tenant, workspace, asset, or operation", async () => {
  const denied = [
    { scope: { ...SCOPE, tenantId: "00000000-0000-0000-0000-000000000007" }, id: ASSET, config: {} },
    { scope: { ...SCOPE, workspaceId: "00000000-0000-0000-0000-000000000007" }, id: ASSET, config: {} },
    { scope: SCOPE, id: OTHER, config: {} },
    { scope: SCOPE, id: ASSET, config: { operation: "asset.purge" } }
  ];
  for (const target of denied) {
    const f = fixture({ configOverrides: target.config });
    await assert.rejects(() => f.service.recoverDeletion(target.scope, target.id, AUTH), error => error.code === "ASSET_LIFECYCLE_RECOVERY_SCOPE_DENIED");
    assert.deepEqual(f.storageCalls, []);
    assert.equal(f.asset.status, "deletion_requested");
  }
});

test("recovery rejects links, mismatched persisted object, and unexpected terminal Storage object", async () => {
  const linked = fixture({ links: [{ id: "unexpected" }] });
  await assert.rejects(() => linked.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED");
  const wrongObject = fixture();
  wrongObject.objects.set(ASSET, [{ asset_id: ASSET, variant: "original", object_key: "tenant/wrong" }]);
  await assert.rejects(() => wrongObject.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED");
  const terminalPresent = fixture({ status: "deleted", present: true });
  await assert.rejects(() => terminalPresent.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED");
  assert.equal(terminalPresent.asset.status, "deleted");
  assert.equal(terminalPresent.storageCalls.length, 1);
});

test("completed deletion recovery is idempotent and performs no delete or finalization", async () => {
  const f = fixture({ status: "deleted", present: false });
  const first = await f.service.recoverDeletion(SCOPE, ASSET, AUTH);
  const second = await f.service.recoverDeletion(SCOPE, ASSET, AUTH);
  assert.equal(first.state, "CONSISTENT_DELETED");
  assert.equal(second.state, "CONSISTENT_DELETED");
  assert.equal(f.storageCalls.filter(call => call[0] === "delete").length, 0);
  assert.equal(f.repoCalls.filter(call => call[0] === "finalize").length, 0);
  assert.equal(f.other.status, "ready");
});

test("ambiguous finalization outcome is surfaced once without automatic retry", async () => {
  const f = fixture({ present: false });
  let attempts = 0;
  f.repository.finalizeAssetDeletion = async () => { attempts += 1; throw Object.assign(new Error("request outcome unknown"), { code: "DATABASE_UNAVAILABLE" }); };
  await assert.rejects(() => f.service.recoverDeletion(SCOPE, ASSET, AUTH), error => error.code === "DATABASE_UNAVAILABLE");
  assert.equal(attempts, 1);
  assert.equal(f.asset.status, "deletion_requested");
  assert.equal(f.other.status, "ready");
});

test("HTTP recovery route requires the authenticated merchant path and forwards no client scope", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-recovery-route-"));
  const calls = [];
  const mediaService = { async recoverDeletion(scope, assetId, auth) { calls.push({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, storeId: scope.storeId, assetId, auth }); return { state: "CONSISTENT_DELETED" }; } };
  const merchantService = { async resolveSession() { return { ...SCOPE, role: "owner", workspace: { name: "Synthetic" } }; }, verifyCsrf() { return true; }, assertWritable() {} };
  const app = express(); app.use(express.json());
  registerMerchantRoutes(app, async () => merchantService, { dataRoot: root, imagesDir: root, mediaService });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = { "Content-Type": "application/json", Cookie: "atelier_merchant_session=fixture", "x-atelier-csrf": "fixture" };
    const mismatched = await fetch(`${origin}/api/media/v1/delete/recover`, { method: "POST", headers, body: JSON.stringify({ assetId: ASSET, tenantId: "attacker", workspaceId: "attacker", operation: "asset.purge" }) });
    assert.equal(mismatched.status, 403);
    assert.deepEqual(calls, []);
    const response = await fetch(`${origin}/api/media/v1/delete/recover`, { method: "POST", headers, body: JSON.stringify({ assetId: ASSET, ...AUTH }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.state, "CONSISTENT_DELETED");
    assert.deepEqual(calls, [{ tenantId: SCOPE.tenantId, workspaceId: SCOPE.workspaceId, storeId: SCOPE.storeId, assetId: ASSET, auth: AUTH }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
