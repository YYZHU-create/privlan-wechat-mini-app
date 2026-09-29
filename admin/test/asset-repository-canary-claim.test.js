const assert = require("node:assert/strict");
const test = require("node:test");
const { createAssetRepository } = require("../asset-repository");

const ids = { policyId: "10000000-0000-4000-8000-000000000011", attemptId: "20000000-0000-4000-8000-000000000012" };
const scope = { tenantId: "00000000-0000-0000-0000-000000000002", workspaceId: "00000000-0000-0000-0000-000000000003", storeId: "00000000-0000-0000-0000-000000000004" };

test("Canary attempt identity is persisted atomically with the ready-to-deletion_requested CAS", async () => {
  const calls = [];
  const sourceAsset = { id: "00000000-0000-0000-0000-000000000005", tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, status: "ready", metadata: { lifecycleCanary: "feeldao.lifecycle-canary.v1" } };
  const repository = createAssetRepository({ url: "https://fixture.invalid", serviceRoleKey: "fixture", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    assert.match(url, /status=eq\.ready/);
    assert.equal(body.status, "deletion_requested");
    sourceAsset.status = body.status;
    sourceAsset.metadata = body.metadata;
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify([sourceAsset]) };
  } });
  const result = await repository.requestAssetDeletion(scope, sourceAsset.id, { asset: sourceAsset, canaryIdentity: ids });
  assert.equal(result.outcome, "CAS_ACQUIRED");
  assert.deepEqual(result.asset.metadata.lifecycleCanaryAuthorization, ids);
  assert.deepEqual(JSON.parse(calls[0].options.body).metadata.lifecycleCanaryAuthorization, ids);
  assert.equal(calls.length, 1);
});