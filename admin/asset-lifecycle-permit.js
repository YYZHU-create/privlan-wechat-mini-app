const crypto = require("node:crypto");

const CANARY_MARKER = "feeldao.lifecycle-canary.v1";
const CANARY_OPERATION = "asset.delete";
const STAGING_PROJECT_ID = "asmhysidbg5g";
const MAX_CANARY_WINDOW_MS = 15 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CANARY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedUuid(value) {
  const text = String(value || "").trim();
  return UUID_RE.test(text) ? text.toLowerCase() : "";
}

function normalizedCanaryId(value) {
  const text = String(value || "").trim();
  return CANARY_ID_RE.test(text) ? text.toLowerCase() : "";
}

function createCanaryIdentity({ randomUUID = () => crypto.randomUUID() } = {}) {
  const policyId = normalizedCanaryId(randomUUID());
  const attemptId = normalizedCanaryId(randomUUID());
  if (!policyId || !attemptId || policyId === attemptId) throw new Error("CANARY_IDENTITY_GENERATION_FAILED");
  return { policyId, attemptId };
}

function fingerprintCanaryId(value) {
  const id = normalizedCanaryId(value);
  return id ? crypto.createHash("sha256").update(`feeldao-canary-id-v1\0${id}`).digest("hex").slice(0, 16) : null;
}

function canaryConfigDigest(config) {
  const enabled = config?.enabled === true;
  const canonical = enabled ? {
    schemaVersion: "feeldao-canary-policy-v1",
    enabled: true,
    tenantId: normalizedUuid(config.tenantId) || null,
    workspaceId: normalizedUuid(config.workspaceId) || null,
    storeId: config.storeId === null ? null : normalizedUuid(config.storeId) || null,
    assetId: normalizedUuid(config.assetId) || null,
    operation: String(config.operation || "") || null,
    policyId: normalizedCanaryId(config.policyId) || null,
    attemptId: normalizedCanaryId(config.attemptId) || null,
    expectedStatus: String(config.expectedStatus || "") || null,
    expectedObjectKey: String(config.expectedObjectKey || "") || null,
    marker: String(config.marker || "") || null,
    expiresAt: String(config.expiresAt || "") || null
  } : { schemaVersion: "feeldao-canary-policy-v1", enabled: false };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function disabledCanaryConfig() {
  return { enabled: false };
}

function normalGlobalMutationGateEnabled({ runtimeConfigLoadStatus, configuredValue } = {}) {
  return runtimeConfigLoadStatus === "LOADED_VALIDATED"
    && (configuredValue === true || String(configuredValue || "false").trim().toLowerCase() === "true");
}

function isCanaryScopeConfigured(config) {
  if (!config || config.enabled !== true) return false;
  const tenantId = normalizedUuid(config.tenantId);
  const workspaceId = normalizedUuid(config.workspaceId);
  const assetId = normalizedUuid(config.assetId);
  const policyId = normalizedCanaryId(config.policyId);
  const attemptId = normalizedCanaryId(config.attemptId);
  const storeId = config.storeId === null ? null : normalizedUuid(config.storeId);
  const expiresAt = String(config.expiresAt || "");
  const expiry = Date.parse(expiresAt);
  if (!tenantId || !workspaceId || !assetId || !policyId || !attemptId || policyId === attemptId || (config.storeId !== null && !storeId)) return false;
  if (config.operation !== CANARY_OPERATION || config.expectedStatus !== "ready" || config.marker !== CANARY_MARKER) return false;
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== expiresAt) return false;
  const expectedPrefix = `tenant/${tenantId}/workspace/${workspaceId}/asset/${assetId}/original.`;
  const objectKey = String(config.expectedObjectKey || "");
  return objectKey.startsWith(expectedPrefix) && /^[a-z0-9]{1,10}$/i.test(objectKey.slice(expectedPrefix.length));
}

function isCanaryConfigValid(config, { now = Date.now() } = {}) {
  if (!isCanaryScopeConfigured(config)) return false;
  const expiry = Date.parse(String(config.expiresAt));
  return expiry > now && expiry <= now + MAX_CANARY_WINDOW_MS;
}

function canaryIdentityMatches(config, { environment, projectId, scope, assetId, operation, policyId, attemptId, now = Date.now() } = {}) {
  if (!isCanaryConfigValid(config, { now })) return false;
  if (environment !== "staging" || projectId !== STAGING_PROJECT_ID || operation !== config.operation) return false;
  if (normalizedCanaryId(policyId) !== normalizedCanaryId(config.policyId)
    || normalizedCanaryId(attemptId) !== normalizedCanaryId(config.attemptId)) return false;
  return normalizedUuid(scope?.tenantId) === normalizedUuid(config.tenantId)
    && normalizedUuid(scope?.workspaceId) === normalizedUuid(config.workspaceId)
    && (config.storeId === null ? scope?.storeId == null || scope?.storeId === "" : normalizedUuid(scope?.storeId) === normalizedUuid(config.storeId))
    && normalizedUuid(assetId) === normalizedUuid(config.assetId);
}

function canaryRecoveryIdentityMatches(config, { environment, projectId, scope, assetId, operation, policyId, attemptId, normalGlobalGateEnabled = false } = {}) {
  if (normalGlobalGateEnabled === true || !isCanaryScopeConfigured(config)) return false;
  if (environment !== "staging" || projectId !== STAGING_PROJECT_ID || operation !== CANARY_OPERATION) return false;
  if (normalizedCanaryId(policyId) !== normalizedCanaryId(config.policyId)
    || normalizedCanaryId(attemptId) !== normalizedCanaryId(config.attemptId)) return false;
  return normalizedUuid(scope?.tenantId) === normalizedUuid(config.tenantId)
    && normalizedUuid(scope?.workspaceId) === normalizedUuid(config.workspaceId)
    && (config.storeId === null ? scope?.storeId == null || scope?.storeId === "" : normalizedUuid(scope?.storeId) === normalizedUuid(config.storeId))
    && normalizedUuid(assetId) === normalizedUuid(config.assetId);
}

function canaryRecoveryAssetMatches(config, { asset, objects, links } = {}) {
  if (!asset || !["ready", "deletion_requested", "deleted"].includes(String(asset.status || ""))) return false;
  if (asset.status === "deleted" ? !asset.deleted_at : Boolean(asset.deleted_at)) return false;
  if (normalizedUuid(asset.id) !== normalizedUuid(config.assetId)
    || normalizedUuid(asset.tenant_id) !== normalizedUuid(config.tenantId)
    || normalizedUuid(asset.workspace_id) !== normalizedUuid(config.workspaceId)
    || (config.storeId === null ? asset.store_id != null : normalizedUuid(asset.store_id) !== normalizedUuid(config.storeId))) return false;
  if (asset.purpose !== "content_image" || asset.metadata?.lifecycleCanary !== config.marker) return false;
  const storedAuthorization = asset.metadata?.lifecycleCanaryAuthorization;
  if (asset.status === "ready") {
    if (storedAuthorization != null) return false;
  } else if (!storedAuthorization
    || normalizedCanaryId(storedAuthorization.policyId) !== normalizedCanaryId(config.policyId)
    || normalizedCanaryId(storedAuthorization.attemptId) !== normalizedCanaryId(config.attemptId)) return false;
  if (!Array.isArray(objects) || objects.length !== 1) return false;
  if (String(objects[0]?.variant || "") !== "original" || String(objects[0]?.object_key || "") !== config.expectedObjectKey) return false;
  return Array.isArray(links) && links.length === 0;
}

function canaryAssetMatches(config, { asset, objects, links } = {}) {
  if (!asset || asset.status !== config.expectedStatus || asset.deleted_at) return false;
  if (normalizedUuid(asset.id) !== normalizedUuid(config.assetId)
    || normalizedUuid(asset.tenant_id) !== normalizedUuid(config.tenantId)
    || normalizedUuid(asset.workspace_id) !== normalizedUuid(config.workspaceId)
    || (config.storeId === null ? asset.store_id != null : normalizedUuid(asset.store_id) !== normalizedUuid(config.storeId))) return false;
  if (asset.purpose !== "content_image") return false;
  if (asset.metadata?.lifecycleCanary !== config.marker) return false;
  if (asset.metadata?.lifecycleCanaryAuthorization != null) return false;
  if (!Array.isArray(objects) || objects.length !== 1) return false;
  if (String(objects[0]?.variant || "") !== "original" || String(objects[0]?.object_key || "") !== config.expectedObjectKey) return false;
  return Array.isArray(links) && links.length === 0;
}

function canaryRuntimeStatus({ config, runtimeConfigLoadStatus, environment, projectId, normalGlobalGateEnabled = false, now = Date.now() } = {}) {
  const scopeConfigured = isCanaryScopeConfigured(config);
  const configValid = runtimeConfigLoadStatus === "LOADED_VALIDATED" && (config?.enabled === false || scopeConfigured);
  const enabled = configValid && isCanaryConfigValid(config, { now }) && environment === "staging" && projectId === STAGING_PROJECT_ID && normalGlobalGateEnabled !== true;
  const scopeFingerprint = scopeConfigured
    ? crypto.createHash("sha256").update([config.tenantId, config.workspaceId, config.storeId || "", config.assetId, config.operation, config.expectedObjectKey].join("\0")).digest("hex").slice(0, 16)
    : null;
  return {
    enabled,
    configValid,
    operation: scopeConfigured ? CANARY_OPERATION : null,
    scopeConfigured,
    scopeFingerprint,
    policyFingerprint: scopeConfigured ? fingerprintCanaryId(config.policyId) : null,
    attemptFingerprint: scopeConfigured ? fingerprintCanaryId(config.attemptId) : null,
    configDigest: canaryConfigDigest(config),
    recoveryAvailable: runtimeConfigLoadStatus === "LOADED_VALIDATED" && scopeConfigured && environment === "staging" && projectId === STAGING_PROJECT_ID && normalGlobalGateEnabled !== true
  };
}

function permitLifecycleMutation({ normalGlobalGateEnabled = false, canaryConfig, environment, projectId, scope, assetId, operation, policyId, attemptId, asset, objects, links, now = Date.now() } = {}) {
  if (normalGlobalGateEnabled === true) return "global";
  if (!canaryIdentityMatches(canaryConfig, { environment, projectId, scope, assetId, operation, policyId, attemptId, now })) return null;
  return canaryAssetMatches(canaryConfig, { asset, objects, links }) ? "canary" : null;
}

module.exports = {
  CANARY_MARKER,
  CANARY_OPERATION,
  MAX_CANARY_WINDOW_MS,
  STAGING_PROJECT_ID,
  createCanaryIdentity,
  normalizedCanaryId,
  fingerprintCanaryId,
  canaryConfigDigest,
  disabledCanaryConfig,
  normalGlobalMutationGateEnabled,
  isCanaryConfigValid,
  isCanaryScopeConfigured,
  canaryIdentityMatches,
  canaryRecoveryIdentityMatches,
  canaryRecoveryAssetMatches,
  canaryAssetMatches,
  canaryRuntimeStatus,
  permitLifecycleMutation
};
