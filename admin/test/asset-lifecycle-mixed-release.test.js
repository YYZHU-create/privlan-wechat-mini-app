const assert = require("node:assert/strict");
const test = require("node:test");
const { createMediaService } = require("../media-service-v1");
const { CANARY_MARKER, CANARY_OPERATION } = require("../asset-lifecycle-permit");

const TENANT = "00000000-0000-4000-8000-000000000001";
const WORKSPACE = "00000000-0000-4000-8000-000000000002";
const STORE = "00000000-0000-4000-8000-000000000003";
const ASSET_A = "00000000-0000-4000-8000-000000000004";
const ASSET_B = "00000000-0000-4000-8000-000000000005";
const POLICY_1 = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_1 = "20000000-0000-4000-8000-000000000001";
const POLICY_2 = "10000000-0000-4000-8000-000000000002";
const ATTEMPT_2 = "20000000-0000-4000-8000-000000000002";
const SCOPE = { tenantId: TENANT, workspaceId: WORKSPACE, storeId: STORE, userId: "fixture-user", requestId: "mixed-release" };
const keyFor = id => `tenant/${TENANT}/workspace/${WORKSPACE}/asset/${id}/original.png`;
const config = (enabled, assetId, policyId, attemptId) => ({ enabled, ...(enabled ? { tenantId: TENANT, workspaceId: WORKSPACE, storeId: STORE, assetId, operation: CANARY_OPERATION, expectedStatus: "ready", expectedObjectKey: keyFor(assetId), marker: CANARY_MARKER, policyId, attemptId, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } : {}) });
const auth = (policyId, attemptId, operation = CANARY_OPERATION) => ({ operation, policyId, attemptId });

function makeFleet() {
  const rows = new Map([ASSET_A, ASSET_B].map(id => [id, { id, tenant_id: TENANT, workspace_id: WORKSPACE, store_id: STORE, purpose: "content_image", status: "ready", deleted_at: null, metadata: { lifecycleCanary: CANARY_MARKER } }]));
  const objects = new Map([ASSET_A, ASSET_B].map(id => [id, [{ asset_id: id, variant: "original", object_key: keyFor(id) }]]));
  const audits = new Map([[ASSET_A, []], [ASSET_B, []]]);
  const calls = [];
  const objectPresent = new Map([[ASSET_A, true], [ASSET_B, true]]);
  const repo = {
    async getAssetByIdScoped(scope, id) { calls.push(["read", id]); const row = rows.get(id); return row && row.tenant_id === scope.tenantId && row.workspace_id === scope.workspaceId ? row : null; },
    async listAssetObjects(_scope, id) { calls.push(["objects", id]); return objects.get(id) || []; },
    async listAssetLinks(_scope, id) { calls.push(["links", id]); return []; },
    async requestAssetDeletion(_scope, id, input = {}) { const row = rows.get(id); if (!row || row.status !== "ready") return { outcome: "CAS_NOT_ACQUIRED", asset: row }; row.status = "deletion_requested"; row.metadata = { ...row.metadata, lifecycleCanaryAuthorization: input.canaryIdentity }; calls.push(["claim", id, input.canaryIdentity]); return { outcome: "CAS_ACQUIRED", asset: row }; },
    async finalizeAssetDeletion(_scope, id) { const row = rows.get(id); row.status = "deleted"; row.deleted_at = new Date().toISOString(); audits.set(id, [{ action: "asset.deleted", request_id: "fixture" }]); calls.push(["finalize", id]); return { deleted: true }; },
    async listLifecycleAuditEvents(_scope, id) { return audits.get(id) || []; }
  };
  const storageCalls = [];
  const provider = { name: "mixed-release-simulator", async deleteObject(_scope, key) { storageCalls.push(["delete", key]); const id = key.includes(ASSET_A) ? ASSET_A : ASSET_B; objectPresent.set(id, false); }, async verifyDeleted(_scope, key) { storageCalls.push(["verify", key]); const id = key.includes(ASSET_A) ? ASSET_A : ASSET_B; return !objectPresent.get(id); } };
  const service = c => createMediaService({ provider, repository: repo, lifecycleMutationsEnabled: false, lifecycleCanaryConfig: c, runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g" });
  return { rows, calls, storageCalls, objectPresent, repo, provider, service };
}

const A1 = config(true, ASSET_A, POLICY_1, ATTEMPT_1);
const B2 = config(true, ASSET_B, POLICY_2, ATTEMPT_2);
const H0 = config(false);
const H2 = config(false);

test("randomized H0/H1 routing permits only exact C001 target request", async () => {
  const f = makeFleet(); const h0 = f.service(H0); const h1 = f.service(A1);
  const cases = [
    [h0, ASSET_A, auth(POLICY_1, ATTEMPT_1), false],
    [h1, ASSET_A, auth(POLICY_1, ATTEMPT_1), true],
    [h1, ASSET_B, auth(POLICY_1, ATTEMPT_1), false],
    [h1, ASSET_A, auth(POLICY_1, ATTEMPT_2), false],
    [h1, ASSET_A, auth(POLICY_2, ATTEMPT_1), false],
    [h1, ASSET_A, auth(POLICY_1, ATTEMPT_1, "asset.purge"), false],
    [h1, ASSET_A, auth(POLICY_1, ATTEMPT_1), true]
  ];
  let seed = 91; const routed = [];
  for (let i = 0; i < 24; i++) { seed = (seed * 48271) % 2147483647; const [svc, id, identity, allowed] = cases[seed % cases.length]; routed.push({ svc, id, identity, allowed }); }
  await assert.rejects(() => h1.remove({ ...SCOPE, tenantId: "00000000-0000-4000-8000-000000000006" }, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  await assert.rejects(() => h1.remove({ ...SCOPE, workspaceId: "00000000-0000-4000-8000-000000000006" }, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  let allowedCount = 0;
  for (const item of routed) {
    if (item.allowed && f.rows.get(item.id).status === "ready") { await item.svc.remove(SCOPE, item.id, item.identity); allowedCount++; }
    else await assert.rejects(() => item.svc.remove(SCOPE, item.id, item.identity), `unexpected permit for route ${routed.indexOf(item)}: ${item.id} ${JSON.stringify(item.identity)}`);
  }
  assert.ok(allowedCount <= 1);
  assert.equal(f.rows.get(ASSET_B).status, "ready");
  assert.equal(f.storageCalls.filter(call => call[0] === "delete").length, allowedCount);
});

test("H1/H2 overlap and duplicate, response-loss, terminal replay produce no second destructive effect", async () => {
  const f = makeFleet(); const h1 = f.service(A1); const h2 = f.service(H2);
  await assert.rejects(async () => { await h1.remove(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1)); throw new Error("simulated response loss after commit"); }, /simulated response loss/);
  const deleteCount = f.storageCalls.filter(call => call[0] === "delete").length;
  await assert.rejects(() => h2.remove(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  await assert.rejects(() => h1.remove(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  const recovered = await h1.recoverDeletion(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1));
  assert.equal(recovered.state, "CONSISTENT_DELETED");
  await assert.rejects(() => h2.recoverDeletion(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  assert.equal(f.rows.get(ASSET_A).status, "deleted");
  assert.equal(f.storageCalls.filter(call => call[0] === "delete").length, deleteCount);
  assert.equal(f.rows.get(ASSET_B).status, "ready");
});

test("stale C001 rejects C002 traffic while C002 release accepts only B and rejects A", async () => {
  const f = makeFleet(); const old = f.service(A1); const current = f.service(B2);
  await assert.rejects(() => old.remove(SCOPE, ASSET_B, auth(POLICY_2, ATTEMPT_2)));
  await assert.rejects(() => old.recoverDeletion(SCOPE, ASSET_B, auth(POLICY_2, ATTEMPT_2)));
  await assert.rejects(() => current.remove(SCOPE, ASSET_A, auth(POLICY_2, ATTEMPT_2)));
  await assert.rejects(() => current.remove(SCOPE, ASSET_B, auth(POLICY_1, ATTEMPT_1)));
  await current.remove(SCOPE, ASSET_B, auth(POLICY_2, ATTEMPT_2));
  assert.equal(f.rows.get(ASSET_A).status, "ready");
  assert.equal(f.rows.get(ASSET_B).status, "deleted");
  await assert.rejects(() => old.remove(SCOPE, ASSET_B, auth(POLICY_2, ATTEMPT_2)));
});

test("same C001 identity recovers persisted in-flight attempt with H2 rejecting the request", async () => {
  const f = makeFleet(); const h1 = f.service(A1); const h2 = f.service(H2);
  f.rows.get(ASSET_A).status = "deletion_requested";
  f.rows.get(ASSET_A).metadata = { ...f.rows.get(ASSET_A).metadata, lifecycleCanaryAuthorization: { policyId: POLICY_1, attemptId: ATTEMPT_1 } };
  f.objectPresent.set(ASSET_A, false);
  await assert.rejects(() => h2.recoverDeletion(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  assert.equal((await h1.recoverDeletion(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1))).state, "CONSISTENT_DELETED");
  await assert.rejects(() => h1.remove(SCOPE, ASSET_A, auth(POLICY_1, ATTEMPT_1)));
  assert.equal(f.storageCalls.filter(call => call[0] === "delete").length, 0);
  assert.equal(f.rows.get(ASSET_A).status, "deleted");
});