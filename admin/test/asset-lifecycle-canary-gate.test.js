const assert = require("node:assert/strict");
const test = require("node:test");
const { CANARY_MARKER, CANARY_OPERATION } = require("../asset-lifecycle-permit");
const { createMediaService } = require("../media-service-v1");

const SCOPE = {
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  workspaceId: "00000000-0000-0000-0000-000000000003",
  storeId: "00000000-0000-0000-0000-000000000004",
  requestId: "merchant-test"
};
const ASSET_ID = "00000000-0000-0000-0000-000000000005";
const POLICY_ID = "10000000-0000-4000-8000-000000000011";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000012";
const AUTH = { operation: CANARY_OPERATION, policyId: POLICY_ID, attemptId: ATTEMPT_ID };

function config(overrides = {}) {
  return {
    enabled: true,
    tenantId: SCOPE.tenantId,
    workspaceId: SCOPE.workspaceId,
    storeId: SCOPE.storeId,
    assetId: ASSET_ID,
    operation: CANARY_OPERATION,
    expectedStatus: "ready",
    expectedObjectKey: `tenant/${SCOPE.tenantId}/workspace/${SCOPE.workspaceId}/asset/${ASSET_ID}/original.png`,
    marker: CANARY_MARKER,
    policyId: POLICY_ID, attemptId: ATTEMPT_ID, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides
  };
}

function fixture({ assetOverrides = {}, objects, links = [] } = {}) {
  const calls = [];
  const asset = {
    id: ASSET_ID, tenant_id: SCOPE.tenantId, workspace_id: SCOPE.workspaceId,
    store_id: SCOPE.storeId, purpose: "content_image", status: "ready", deleted_at: null,
    metadata: { lifecycleCanary: CANARY_MARKER }, ...assetOverrides
  };
  const rows = objects || [{ asset_id: ASSET_ID, variant: "original", object_key: config().expectedObjectKey }];
  const repository = {
    async getAssetByIdScoped(scope, id) { calls.push(["read-asset", scope.tenantId, scope.workspaceId, id]); return id === ASSET_ID && scope.tenantId === asset.tenant_id && scope.workspaceId === asset.workspace_id ? asset : null; },
    async listAssetObjects(scope, id) { calls.push(["read-objects", id]); return rows; },
    async listAssetLinks(scope, id) { calls.push(["read-links", id]); return links; },
    async requestAssetDeletion(scope, id, input = {}) { calls.push(["cas", id]); asset.status = "deletion_requested"; if (input.canaryIdentity) asset.metadata = { ...asset.metadata, lifecycleCanaryAuthorization: input.canaryIdentity }; return { outcome: "CAS_ACQUIRED", asset }; },
    async finalizeAssetDeletion(scope, id) { calls.push(["finalize", id]); asset.status = "deleted"; asset.deleted_at = new Date().toISOString(); return { deleted: true, duplicate: false }; }
  };
  const storageCalls = [];
  const provider = {
    name: "staging-test",
    async deleteObject(scope, key) { storageCalls.push(["delete", key]); },
    async verifyDeleted(scope, key) { storageCalls.push(["verify", key]); return true; }
  };
  return { calls, asset, storageCalls, service: createMediaService({
    provider, repository, lifecycleMutationsEnabled: false,
    lifecycleCanaryConfig: config(), runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g"
  }), repository };
}

test("global lifecycle gate off permits exactly the configured synthetic delete", async () => {
  const f = fixture();
  const result = await f.service.remove(SCOPE, ASSET_ID, AUTH);
  assert.equal(result.deleted, true);
  assert.deepEqual(f.storageCalls, [["delete", config().expectedObjectKey], ["verify", config().expectedObjectKey]]);
  assert.equal(f.calls.filter(call => call[0] === "cas").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "finalize").length, 1);
  assert.equal(f.asset.status, "deleted");
});

test("wrong tenant, workspace, asset, environment, or disabled Canary is denied before database or Storage access", async () => {
  const denied = [
    { scope: { ...SCOPE, tenantId: "00000000-0000-0000-0000-000000000006" }, assetId: ASSET_ID },
    { scope: { ...SCOPE, workspaceId: "00000000-0000-0000-0000-000000000006" }, assetId: ASSET_ID },
    { scope: SCOPE, assetId: "00000000-0000-0000-0000-000000000006" }
  ];
  for (const target of denied) {
    const f = fixture();
    await assert.rejects(() => f.service.remove(target.scope, target.assetId, AUTH), error => error.code === "ASSET_LIFECYCLE_MUTATION_DISABLED");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.storageCalls, []);
  }
  const f = fixture();
  f.service = createMediaService({ provider: { deleteObject: async () => f.storageCalls.push(["delete"]), verifyDeleted: async () => true }, repository: f.repository, lifecycleMutationsEnabled: false });
  await assert.rejects(() => f.service.remove(SCOPE, ASSET_ID), error => error.code === "ASSET_LIFECYCLE_MUTATION_DISABLED");
  assert.deepEqual(f.storageCalls, []);
});

test("Canary request requires the exact immutable policy and attempt identity", async () => {
  for (const identity of [{ operation: CANARY_OPERATION, policyId: POLICY_ID }, { operation: CANARY_OPERATION, attemptId: ATTEMPT_ID }, { operation: CANARY_OPERATION, policyId: "bad", attemptId: ATTEMPT_ID }, { operation: CANARY_OPERATION, policyId: POLICY_ID, attemptId: "bad" }]) {
    const f = fixture();
    await assert.rejects(() => f.service.remove(SCOPE, ASSET_ID, identity), error => error.code === "ASSET_LIFECYCLE_MUTATION_DISABLED");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.storageCalls, []);
  }
});
test("Canary permit denies a wrong operation, malformed expiry, object shape, marker, or linked asset", async () => {
  for (const variation of [
    { operation: "asset.purge" },
    { expiresAt: "bad" },
    { expectedObjectKey: "tenant/other" }
  ]) {
    const f = fixture();
    f.service = createMediaService({ provider: { deleteObject: async () => f.storageCalls.push(["delete"]), verifyDeleted: async () => true }, repository: f.repository, lifecycleMutationsEnabled: false, lifecycleCanaryConfig: config(variation), runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g" });
    await assert.rejects(() => f.service.remove(SCOPE, ASSET_ID), error => error.code === "ASSET_LIFECYCLE_MUTATION_DISABLED");
    assert.deepEqual(f.storageCalls, []);
  }
  for (const setup of [
    { assetOverrides: { status: "deletion_requested" } },
    { assetOverrides: { metadata: {} } },
    { objects: [] },
    { links: [{ id: "business-link" }] }
  ]) {
    const f = fixture(setup);
    await assert.rejects(() => f.service.remove(SCOPE, ASSET_ID, AUTH), error => error.code === "ASSET_LIFECYCLE_CANARY_SCOPE_DENIED");
    assert.deepEqual(f.storageCalls, []);
  }
});

test("completed Canary state cannot replay the exact request while global-mode idempotency remains separate", async () => {
  const f = fixture();
  await f.service.remove(SCOPE, ASSET_ID, AUTH);
  const callsAfterFirst = f.storageCalls.length;
  await assert.rejects(() => f.service.remove(SCOPE, ASSET_ID, AUTH), error => error.code === "ASSET_LIFECYCLE_CANARY_SCOPE_DENIED");
  assert.equal(f.storageCalls.length, callsAfterFirst);
});
