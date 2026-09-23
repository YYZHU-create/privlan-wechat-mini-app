const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { STAGING_PROJECT_ID, disabledCanaryConfig, isCanaryScopeConfigured, canaryConfigDigest } = require("./asset-lifecycle-permit");

const SCHEMA_VERSION = "v1";
const MEDIA_KEYS = ["MEDIA_STORAGE_PROVIDER", "MEDIA_ASSET_V1_ENABLED", "MEDIA_STORAGE_BUCKET", "ASSET_LIFECYCLE_MUTATIONS_ENABLED", "ASSET_LIFECYCLE_CANARY_ENABLED", "ASSET_LIFECYCLE_CANARY_TENANT_ID", "ASSET_LIFECYCLE_CANARY_WORKSPACE_ID", "ASSET_LIFECYCLE_CANARY_STORE_ID", "ASSET_LIFECYCLE_CANARY_ASSET_ID", "ASSET_LIFECYCLE_CANARY_OPERATION", "ASSET_LIFECYCLE_CANARY_EXPECTED_STATUS", "ASSET_LIFECYCLE_CANARY_OBJECT_KEY", "ASSET_LIFECYCLE_CANARY_MARKER", "ASSET_LIFECYCLE_CANARY_EXPIRES_AT", "ASSET_LIFECYCLE_CANARY_POLICY_ID", "ASSET_LIFECYCLE_CANARY_ATTEMPT_ID"];
const ROOT_KEYS = ["schemaVersion", "targetProjectId", "environment", "media"];
const MEDIA_FIELDS = ["storageProvider", "assetV1Enabled", "storageBucket", "assetLifecycleMutationsEnabled", "lifecycleCanary"];
const CANARY_FIELDS = ["enabled", "tenantId", "workspaceId", "storeId", "assetId", "operation", "expectedStatus", "expectedObjectKey", "marker", "expiresAt", "policyId", "attemptId"];
const SECRET_NAME_RE = /(secret|token|password|cookie|private.?key|credential|database.?url|service.?role|supabase.?url)/i;
const TARGETS = {
  staging: { schemaVersion: SCHEMA_VERSION, targetProjectId: "asmhysidbg5g", environment: "staging", media: { storageProvider: "meoo", assetV1Enabled: true, storageBucket: "merchant-assets", assetLifecycleMutationsEnabled: false, lifecycleCanary: disabledCanaryConfig() } },
  production: { schemaVersion: SCHEMA_VERSION, targetProjectId: "g8o5cv1om41o", environment: "production", media: { storageProvider: "legacy", assetV1Enabled: false, storageBucket: "", assetLifecycleMutationsEnabled: false, lifecycleCanary: disabledCanaryConfig() } }
};

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
function rejectUnknownKeys(value, allowed, label) {
  Object.keys(value).forEach(key => {
    if (!allowed.includes(key) || SECRET_NAME_RE.test(key)) throw new Error(`CONFIG_FIELD_NOT_ALLOWED:${label}.${key}`);
  });
}
function validateRuntimeConfig(input, { deploymentProjectId } = {}) {
  assertPlainObject(input, "config");
  rejectUnknownKeys(input, ROOT_KEYS, "config");
  if (input.schemaVersion !== SCHEMA_VERSION) throw new Error("CONFIG_SCHEMA_VERSION_INVALID");
  if (!/^([a-z0-9]{6,32})$/.test(String(input.targetProjectId || ""))) throw new Error("TARGET_PROJECT_ID_INVALID");
  if (!['staging', 'production'].includes(input.environment)) throw new Error("CONFIG_ENVIRONMENT_INVALID");
  assertPlainObject(input.media, "config.media");
  rejectUnknownKeys(input.media, MEDIA_FIELDS, "config.media");
  if (typeof input.media.storageProvider !== "string" || !['legacy', 'meoo'].includes(input.media.storageProvider)) throw new Error("MEDIA_PROVIDER_INVALID");
  if (typeof input.media.assetV1Enabled !== "boolean") throw new Error("MEDIA_FLAG_INVALID");
  if (typeof input.media.storageBucket !== "string") throw new Error("MEDIA_BUCKET_INVALID");
  if (typeof input.media.assetLifecycleMutationsEnabled !== "boolean") throw new Error("MEDIA_LIFECYCLE_MUTATION_FLAG_INVALID");
  const rawCanary = input.media.lifecycleCanary === undefined ? disabledCanaryConfig() : input.media.lifecycleCanary;
  assertPlainObject(rawCanary, "config.media.lifecycleCanary");
  rejectUnknownKeys(rawCanary, CANARY_FIELDS, "config.media.lifecycleCanary");
  if (typeof rawCanary.enabled !== "boolean") throw new Error("MEDIA_LIFECYCLE_CANARY_FLAG_INVALID");
  let lifecycleCanary = disabledCanaryConfig();
  if (rawCanary.enabled) {
    if (input.environment !== "staging" || input.targetProjectId !== STAGING_PROJECT_ID) throw new Error("LIFECYCLE_CANARY_STAGING_ONLY");
    if (input.media.assetLifecycleMutationsEnabled !== false) throw new Error("LIFECYCLE_CANARY_REQUIRES_GLOBAL_GATE_OFF");
    lifecycleCanary = {
      enabled: true,
      tenantId: String(rawCanary.tenantId || "").trim().toLowerCase(),
      workspaceId: String(rawCanary.workspaceId || "").trim().toLowerCase(),
      storeId: rawCanary.storeId === null ? null : String(rawCanary.storeId || "").trim().toLowerCase(),
      assetId: String(rawCanary.assetId || "").trim().toLowerCase(),
      operation: rawCanary.operation,
      expectedStatus: rawCanary.expectedStatus,
      expectedObjectKey: rawCanary.expectedObjectKey,
      marker: rawCanary.marker,
      expiresAt: rawCanary.expiresAt,
      policyId: String(rawCanary.policyId || "").trim().toLowerCase(),
      attemptId: String(rawCanary.attemptId || "").trim().toLowerCase()
    };
    if (!isCanaryScopeConfigured(lifecycleCanary)) throw new Error("LIFECYCLE_CANARY_SCOPE_INVALID");
  } else if (Object.keys(rawCanary).some(key => key !== "enabled" && rawCanary[key] !== undefined && rawCanary[key] !== "" && rawCanary[key] !== null)) {
    throw new Error("LIFECYCLE_CANARY_DISABLED_SCOPE_MUST_BE_EMPTY");
  }
  if (input.media.assetV1Enabled && (input.media.storageProvider !== "meoo" || !input.media.storageBucket.trim())) throw new Error("MEDIA_INVARIANT_INVALID");
  if (input.environment === "production" && input.media.assetV1Enabled) throw new Error("PRODUCTION_MEDIA_MUST_REMAIN_DISABLED");
  if (input.environment === "production" && input.media.assetLifecycleMutationsEnabled) throw new Error("PRODUCTION_LIFECYCLE_MUTATIONS_MUST_REMAIN_DISABLED");
  if (deploymentProjectId !== undefined && String(deploymentProjectId) !== input.targetProjectId) throw new Error("DEPLOYMENT_TARGET_CONFIG_MISMATCH");
  return { schemaVersion: SCHEMA_VERSION, targetProjectId: input.targetProjectId, environment: input.environment, media: { storageProvider: input.media.storageProvider, assetV1Enabled: input.media.assetV1Enabled, storageBucket: input.media.storageBucket, assetLifecycleMutationsEnabled: input.media.assetLifecycleMutationsEnabled, lifecycleCanary } };
}
function canonicalizeRuntimeConfig(input) { return JSON.stringify(validateRuntimeConfig(input)); }
function runtimeConfigDigest(input) { return crypto.createHash("sha256").update(canonicalizeRuntimeConfig(input), "utf8").digest("hex"); }
function loadRuntimeConfig(filePath, { env = process.env, deploymentProjectId } = {}) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const config = validateRuntimeConfig(parsed, { deploymentProjectId });
  const digest = runtimeConfigDigest(config);
  const canary = config.media.lifecycleCanary;
  const expected = { MEDIA_STORAGE_PROVIDER: config.media.storageProvider, MEDIA_ASSET_V1_ENABLED: String(config.media.assetV1Enabled), MEDIA_STORAGE_BUCKET: config.media.storageBucket, ASSET_LIFECYCLE_MUTATIONS_ENABLED: String(config.media.assetLifecycleMutationsEnabled), ASSET_LIFECYCLE_CANARY_ENABLED: String(canary.enabled), ASSET_LIFECYCLE_CANARY_TENANT_ID: canary.tenantId || "", ASSET_LIFECYCLE_CANARY_WORKSPACE_ID: canary.workspaceId || "", ASSET_LIFECYCLE_CANARY_STORE_ID: canary.storeId || "", ASSET_LIFECYCLE_CANARY_ASSET_ID: canary.assetId || "", ASSET_LIFECYCLE_CANARY_OPERATION: canary.operation || "", ASSET_LIFECYCLE_CANARY_EXPECTED_STATUS: canary.expectedStatus || "", ASSET_LIFECYCLE_CANARY_OBJECT_KEY: canary.expectedObjectKey || "", ASSET_LIFECYCLE_CANARY_MARKER: canary.marker || "", ASSET_LIFECYCLE_CANARY_EXPIRES_AT: canary.expiresAt || "", ASSET_LIFECYCLE_CANARY_POLICY_ID: canary.policyId || "", ASSET_LIFECYCLE_CANARY_ATTEMPT_ID: canary.attemptId || "" };
  if (env.ATELIER_ENVIRONMENT !== undefined && String(env.ATELIER_ENVIRONMENT).trim().toLowerCase() !== config.environment) throw new Error("RUNTIME_ENVIRONMENT_CONFLICT");
  if (env.MEOO_PROJECT_URL_ID !== undefined && String(env.MEOO_PROJECT_URL_ID).trim() !== config.targetProjectId) throw new Error("RUNTIME_PROJECT_TARGET_CONFLICT");
  for (const key of MEDIA_KEYS) {
    if (env[key] !== undefined && String(env[key]).trim() !== expected[key]) throw new Error(`MEDIA_CONFIG_CONFLICT:${key}`);
  }
  for (const key of MEDIA_KEYS) env[key] = expected[key];
  env.ATELIER_ENVIRONMENT = config.environment;
  env.ATELIER_RUNTIME_CONFIG_DIGEST = digest;
  env.ATELIER_CANARY_CONFIG_DIGEST = canaryConfigDigest(canary);
  return { config, runtimeConfigDigest: digest };
}
function createBuildMetadata({ sourceCommit, targetProjectId, environment, runtimeConfigDigest: digest, configSchemaVersion = SCHEMA_VERSION }) {
  if (!/^[0-9a-f]{40,64}$/i.test(String(sourceCommit || ""))) throw new Error("SOURCE_COMMIT_INVALID");
  return { schemaVersion: "g2c10n-v1", sourceCommit: String(sourceCommit).toLowerCase(), commitSha: String(sourceCommit).toLowerCase(), declaredTargetProjectId: targetProjectId, environment, runtimeConfigDigest: digest, configSchemaVersion };
}
function hashDirectory(root, skip = new Set([".git", "node_modules"])) {
  const entries = [];
  function walk(dir, rel = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (skip.has(entry.name) || entry.name === ".runtime.env") continue;
      const childRel = path.join(rel, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, childRel);
      else entries.push([childRel.replaceAll(path.sep, "/"), fs.readFileSync(full)]);
    }
  }
  walk(root);
  const h = crypto.createHash("sha256");
  for (const [name, data] of entries) { h.update(name); h.update("\0"); h.update(data); h.update("\0"); }
  return h.digest("hex");
}
function createDeploymentArtifact({ sourceDir, outputDir, targetProjectId, sourceCommit, config }) {
  const validated = validateRuntimeConfig(config, { deploymentProjectId: targetProjectId });
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, outputDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.includes(`${path.sep}node_modules${path.sep}`) && !src.endsWith(`${path.sep}.runtime.env`) });
  const digest = runtimeConfigDigest(validated);
  fs.writeFileSync(path.join(outputDir, "runtime-config.json"), canonicalizeRuntimeConfig(validated) + "\n");
  fs.writeFileSync(path.join(outputDir, "runtime-build.json"), JSON.stringify(createBuildMetadata({ sourceCommit, targetProjectId, environment: validated.environment, runtimeConfigDigest: digest }), null, 2) + "\n");
  const artifactDigest = hashDirectory(outputDir);
  const evidence = { sourceCommit, targetProjectId, runtimeConfigDigest: digest, artifactDigest, configSchemaVersion: SCHEMA_VERSION };
  return { config: validated, runtimeConfigDigest: digest, artifactDigest, evidence };
}
module.exports = { SCHEMA_VERSION, MEDIA_KEYS, TARGETS, validateRuntimeConfig, canonicalizeRuntimeConfig, runtimeConfigDigest, loadRuntimeConfig, createBuildMetadata, hashDirectory, createDeploymentArtifact };
