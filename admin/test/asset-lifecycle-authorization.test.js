const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANARY_MARKER, CANARY_OPERATION, MAX_CANARY_WINDOW_MS,
  isCanaryConfigValid, canaryIdentityMatches, canaryAssetMatches,
  canaryRecoveryIdentityMatches, canaryRecoveryAssetMatches, canaryRuntimeStatus,
  permitLifecycleMutation, normalGlobalMutationGateEnabled, createCanaryIdentity, canaryConfigDigest
} = require("../asset-lifecycle-permit");

const TENANT = "00000000-0000-0000-0000-000000000002";
const WORKSPACE = "00000000-0000-0000-0000-000000000003";
const STORE = "00000000-0000-0000-0000-000000000004";
const ASSET = "00000000-0000-0000-0000-000000000005";
const OTHER = "00000000-0000-0000-0000-000000000006";
const POLICY_ID = "10000000-0000-4000-8000-000000000011";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000012";
const SCOPE = { tenantId: TENANT, workspaceId: WORKSPACE, storeId: STORE };

function config(now = Date.now()) {
  return {
    enabled: true,
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    storeId: STORE,
    assetId: ASSET,
    operation: CANARY_OPERATION,
    expectedStatus: "ready",
    expectedObjectKey: `tenant/${TENANT}/workspace/${WORKSPACE}/asset/${ASSET}/original.png`,
    marker: CANARY_MARKER,
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
    policyId: POLICY_ID,
    attemptId: ATTEMPT_ID
  };
}

function assetFixture(overrides = {}) {
  const c = config();
  return {
    asset: { id: ASSET, tenant_id: TENANT, workspace_id: WORKSPACE, store_id: STORE, purpose: "content_image", status: "ready", deleted_at: null, metadata: { lifecycleCanary: CANARY_MARKER } },
    objects: [{ variant: "original", object_key: c.expectedObjectKey }],
    links: [],
    ...overrides
  };
}

function identity(overrides = {}) {
  return {
    environment: "staging", projectId: "asmhysidbg5g", scope: SCOPE, assetId: ASSET,
    operation: CANARY_OPERATION, policyId: POLICY_ID, attemptId: ATTEMPT_ID, now: Date.now(), ...overrides
  };
}

test("canary config fails closed on missing, malformed, stale, or overlong scope", () => {
  const now = Date.now();
  assert.equal(isCanaryConfigValid({ ...config(now), tenantId: "" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), workspaceId: "unknown" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), assetId: "" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), operation: "" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), operation: "asset.purge" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), expectedStatus: "" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), expectedObjectKey: "" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), marker: "" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), expiresAt: "not-a-date" }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), expiresAt: new Date(now - 1).toISOString() }, { now }), false);
  assert.equal(isCanaryConfigValid({ ...config(now), expiresAt: new Date(now + MAX_CANARY_WINDOW_MS + 1).toISOString() }, { now }), false);
});

test("normal global gate off with no canary denies", () => {
  assert.equal(permitLifecycleMutation({ normalGlobalGateEnabled: false }), null);
  assert.equal(normalGlobalMutationGateEnabled({ runtimeConfigLoadStatus: "NOT_LOADED", configuredValue: "true" }), false);
  assert.equal(normalGlobalMutationGateEnabled({ runtimeConfigLoadStatus: "LOADED_VALIDATED", configuredValue: "false" }), false);
  assert.equal(normalGlobalMutationGateEnabled({ runtimeConfigLoadStatus: "LOADED_VALIDATED", configuredValue: "true" }), true);
});

test("exact Staging tenant, workspace, asset, operation and prestate are permitted when global gate is off", () => {
  const c = config();
  assert.equal(canaryIdentityMatches(c, identity()), true);
  assert.equal(permitLifecycleMutation({ normalGlobalGateEnabled: false, canaryConfig: c, ...identity(), ...assetFixture() }), "canary");
});

test("tenant, workspace, asset, operation, environment, and project mismatches deny", () => {
  const c = config();
  assert.equal(canaryIdentityMatches(c, identity({ scope: { ...SCOPE, tenantId: OTHER } })), false);
  assert.equal(canaryIdentityMatches(c, identity({ scope: { ...SCOPE, workspaceId: OTHER } })), false);
  assert.equal(canaryIdentityMatches(c, identity({ scope: { ...SCOPE, storeId: OTHER } })), false);
  assert.equal(canaryIdentityMatches(c, identity({ assetId: OTHER })), false);
  assert.equal(canaryIdentityMatches(c, identity({ operation: "asset.purge" })), false);
  assert.equal(canaryIdentityMatches(c, identity({ policyId: "30000000-0000-4000-8000-000000000013" })), false);
  assert.equal(canaryIdentityMatches(c, identity({ attemptId: "40000000-0000-4000-8000-000000000014" })), false);
  assert.equal(canaryIdentityMatches(c, identity({ environment: "production" })), false);
  assert.equal(canaryIdentityMatches(c, identity({ projectId: "g8o5cv1om41o" })), false);
});

test("asset status, scope, marker, exact object and empty link invariants deny mismatches", () => {
  const c = config();
  const good = assetFixture();
  assert.equal(canaryAssetMatches(c, good), true);
  assert.equal(canaryAssetMatches(c, { ...good, asset: { ...good.asset, status: "deletion_requested" } }), false);
  assert.equal(canaryAssetMatches(c, { ...good, asset: { ...good.asset, workspace_id: OTHER } }), false);
  assert.equal(canaryAssetMatches(c, { ...good, asset: { ...good.asset, metadata: {} } }), false);
  assert.equal(canaryAssetMatches(c, { ...good, objects: [] }), false);
  assert.equal(canaryAssetMatches(c, { ...good, objects: [...good.objects, ...good.objects] }), false);
  assert.equal(canaryAssetMatches(c, { ...good, objects: [{ variant: "original", object_key: "other/key" }] }), false);
  assert.equal(canaryAssetMatches(c, { ...good, links: [{ id: "link" }] }), false);
});

test("global permit remains separate and canary retries cannot reuse changed prestate", () => {
  const c = config();
  assert.equal(permitLifecycleMutation({ normalGlobalGateEnabled: true }), "global");
  assert.equal(permitLifecycleMutation({ normalGlobalGateEnabled: false, canaryConfig: c, ...identity(), ...assetFixture({ asset: { ...assetFixture().asset, status: "deleted", deleted_at: "2026-09-23T00:00:00.000Z" } }) }), null);
});

test("expired exact scope turns the mutation gate off while retaining only target recovery capability", () => {
  const expired = { ...config(), expiresAt: new Date(Date.now() - 60_000).toISOString() };
  const status = canaryRuntimeStatus({ config: expired, runtimeConfigLoadStatus: "LOADED_VALIDATED", environment: "staging", projectId: "asmhysidbg5g", normalGlobalGateEnabled: false });
  assert.equal(status.enabled, false);
  assert.equal(status.configValid, true);
  assert.equal(status.recoveryAvailable, true);
  assert.equal(status.scopeConfigured, true);
  assert.equal(status.operation, CANARY_OPERATION);
  assert.match(status.scopeFingerprint, /^[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(`${TENANT}|${WORKSPACE}|${ASSET}`));
  assert.equal(canaryRecoveryIdentityMatches(expired, { ...identity(), normalGlobalGateEnabled: false }), true);
  assert.equal(canaryRecoveryIdentityMatches(expired, { ...identity(), scope: { ...SCOPE, tenantId: OTHER }, normalGlobalGateEnabled: false }), false);
  assert.equal(canaryRecoveryIdentityMatches(expired, { ...identity(), normalGlobalGateEnabled: true }), false);
});

test("terminal recovery preconditions accept only consistent target-scoped states", () => {
  const c = config();
  const good = assetFixture();
  assert.equal(canaryRecoveryAssetMatches(c, good), true);
  const bound = { lifecycleCanary: CANARY_MARKER, lifecycleCanaryAuthorization: { policyId: c.policyId, attemptId: c.attemptId } };
  assert.equal(canaryRecoveryAssetMatches(c, { ...good, asset: { ...good.asset, status: "deletion_requested", metadata: bound } }), true);
  assert.equal(canaryRecoveryAssetMatches(c, { ...good, asset: { ...good.asset, status: "deleted", deleted_at: "2026-09-23T00:00:00.000Z", metadata: bound } }), true);
  assert.equal(canaryRecoveryAssetMatches(c, { ...good, asset: { ...good.asset, status: "deleted", deleted_at: null } }), false);
  assert.equal(canaryRecoveryAssetMatches(c, { ...good, asset: { ...good.asset, status: "deletion_requested", metadata: { ...bound, lifecycleCanaryAuthorization: { policyId: c.policyId, attemptId: "40000000-0000-4000-8000-000000000014" } } } }), false);
  assert.equal(canaryRecoveryAssetMatches(c, { ...good, links: [{ id: "unexpected" }] }), false);
});

test("Canary identity generation is unique and authorization digest changes with each bound dimension", () => {
  const ids = createCanaryIdentity();
  assert.match(ids.policyId, /^[0-9a-f-]{36}$/);
  assert.match(ids.attemptId, /^[0-9a-f-]{36}$/);
  assert.notEqual(ids.policyId, ids.attemptId);
  const c = config();
  assert.equal(canaryConfigDigest(c), canaryConfigDigest({ ...c }));
  for (const change of [
    { enabled: false }, { tenantId: OTHER }, { workspaceId: OTHER }, { assetId: OTHER },
    { operation: "asset.purge" }, { policyId: "30000000-0000-4000-8000-000000000013" },
    { attemptId: "40000000-0000-4000-8000-000000000014" }
  ]) assert.notEqual(canaryConfigDigest(c), canaryConfigDigest({ ...c, ...change }));
});
