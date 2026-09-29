const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readBuildMetadata, safeArtifactDigest, safeSha256Digest, safeBranch, safeBuildTime, safeCommitSha } = require("./runtime-identity");

const DIAGNOSTIC_SCHEMA_VERSION = "g2c10e-v1";
const STAGING_PROJECT_ID = "asmhysidbg5g";
const PRODUCTION_BUCKET = "feeldao-production-media";
const STAGING_BUCKET = "merchant-assets";
const CONFIG_SOURCE_DIAGNOSTIC_VERSION = "g2c10k-v1";
const DEFAULT_METADATA_PATH = path.resolve(__dirname, "..", "runtime-build.json");

function classifyExpected(value, expected) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "ABSENT";
  return normalized === expected ? `EXPECTED_${expected.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` : "UNEXPECTED";
}

function classifyBooleanTrue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "ABSENT";
  return normalized === "true" ? "EXPECTED_TRUE" : "UNEXPECTED";
}

function classifyMetadataPath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "ABSENT";
  return path.resolve(normalized) === DEFAULT_METADATA_PATH ? "EXPECTED_DEFAULT_PATH" : "CUSTOM_PATH_PRESENT";
}

function parseRuntimeEnvFile(filePath, readFile = fs.readFileSync) {
  try {
    const text = String(readFile(filePath, "utf8"));
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(MEDIA_STORAGE_PROVIDER|MEDIA_ASSET_V1_ENABLED|MEDIA_STORAGE_BUCKET|ATELIER_DB_BACKEND|ATELIER_ENVIRONMENT|ATELIER_RELEASE_METADATA_PATH)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
    return { present: true, values };
  } catch {
    return { present: false, values: {} };
  }
}

function classifyRuntimeEnv(env = process.env) {
  const mediaProvider = classifyExpected(env.MEDIA_STORAGE_PROVIDER, "meoo");
  const mediaFlag = classifyBooleanTrue(env.MEDIA_ASSET_V1_ENABLED);
  const mediaBucket = classifyExpected(env.MEDIA_STORAGE_BUCKET, STAGING_BUCKET);
  const backend = classifyExpected(env.ATELIER_DB_BACKEND, "meoo");
  const environment = classifyExpected(env.ATELIER_ENVIRONMENT, "staging");
  const metadataPath = classifyMetadataPath(env.ATELIER_RELEASE_METADATA_PATH);
  return {
    runtimeEnvMediaStorageProviderClass: mediaProvider,
    runtimeEnvMediaAssetV1EnabledClass: mediaFlag,
    runtimeEnvMediaStorageBucketClass: mediaBucket,
    runtimeEnvAtelierDbBackendClass: backend,
    runtimeEnvAtelierEnvironmentClass: environment,
    runtimeEnvReleaseMetadataPathClass: metadataPath
  };
}

function inspectRuntimeEnvFile({ rootPath = path.resolve(__dirname, ".."), readFile = fs.readFileSync } = {}) {
  const filePath = path.join(rootPath, ".runtime.env");
  const parsed = parseRuntimeEnvFile(filePath, readFile);
  if (!parsed.present) return {
    runtimeEnvFilePresent: false,
    runtimeEnvFileMediaProviderClass: "ABSENT",
    runtimeEnvFileMediaFlagClass: "ABSENT",
    runtimeEnvFileMediaBucketClass: "ABSENT",
    runtimeEnvFileDbBackendClass: "ABSENT",
    runtimeEnvFileEnvironmentClass: "ABSENT",
    runtimeEnvFileReleaseMetadataPathClass: "ABSENT"
  };
  return {
    runtimeEnvFilePresent: true,
    runtimeEnvFileMediaProviderClass: classifyExpected(parsed.values.MEDIA_STORAGE_PROVIDER, "meoo"),
    runtimeEnvFileMediaFlagClass: classifyBooleanTrue(parsed.values.MEDIA_ASSET_V1_ENABLED),
    runtimeEnvFileMediaBucketClass: classifyExpected(parsed.values.MEDIA_STORAGE_BUCKET, STAGING_BUCKET),
    runtimeEnvFileDbBackendClass: classifyExpected(parsed.values.ATELIER_DB_BACKEND, "meoo"),
    runtimeEnvFileEnvironmentClass: classifyExpected(parsed.values.ATELIER_ENVIRONMENT, "staging"),
    runtimeEnvFileReleaseMetadataPathClass: classifyMetadataPath(parsed.values.ATELIER_RELEASE_METADATA_PATH)
  };
}

function inspectRuntimeBuildMetadata({ env = process.env, readFile = fs.readFileSync } = {}) {
  const configuredPath = String(env.ATELIER_RELEASE_METADATA_PATH || "").trim();
  const metadataPath = configuredPath ? path.resolve(configuredPath) : DEFAULT_METADATA_PATH;
  let parsed;
  try {
    parsed = JSON.parse(readFile(metadataPath, "utf8"));
  } catch (error) {
    const code = error && error.code === "ENOENT" ? "FILE_ABSENT" : error instanceof SyntaxError ? "INVALID_JSON" : "FILE_UNREADABLE";
    return { runtimeBuildMetadataFilePresent: code !== "FILE_ABSENT", runtimeBuildMetadataReadable: false, runtimeBuildMetadataPathSource: configuredPath ? "ENV" : "DEFAULT", runtimeBuildMetadataCommit: "unknown", runtimeBuildMetadataSourceCommit: "unknown", runtimeBuildMetadataBranch: "unknown", runtimeBuildMetadataBuildTime: "unknown", runtimeBuildMetadataArtifactDigest: "unknown", runtimeBuildMetadataDeclaredTargetProjectId: null, runtimeBuildMetadataEnvironment: "unknown", runtimeBuildMetadataRuntimeConfigDigest: "unknown", runtimeBuildMetadataConfigSchemaVersion: "unknown", runtimeBuildMetadataSchemaVersion: "unknown", runtimeBuildMetadataErrorClass: code };
  }
  const commit = safeCommitSha(parsed?.commitSha || parsed?.sha);
  return { runtimeBuildMetadataFilePresent: true, runtimeBuildMetadataReadable: true, runtimeBuildMetadataPathSource: configuredPath ? "ENV" : "DEFAULT", runtimeBuildMetadataCommit: commit, runtimeBuildMetadataSourceCommit: safeCommitSha(parsed.sourceCommit), runtimeBuildMetadataBranch: safeBranch(parsed.branch), runtimeBuildMetadataBuildTime: safeBuildTime(parsed.buildTime), runtimeBuildMetadataArtifactDigest: safeArtifactDigest(parsed.artifactDigest), runtimeBuildMetadataDeclaredTargetProjectId: /^[a-z0-9]{6,32}$/.test(String(parsed.declaredTargetProjectId || "")) ? parsed.declaredTargetProjectId : null, runtimeBuildMetadataEnvironment: ["development", "staging", "production"].includes(String(parsed.environment || "")) ? parsed.environment : "unknown", runtimeBuildMetadataRuntimeConfigDigest: /^[0-9a-f]{64}$/i.test(String(parsed.runtimeConfigDigest || "")) ? String(parsed.runtimeConfigDigest).toLowerCase() : "unknown", runtimeBuildMetadataConfigSchemaVersion: String(parsed.configSchemaVersion || "unknown"), runtimeBuildMetadataSchemaVersion: String(parsed.schemaVersion || "unknown"), runtimeBuildMetadataErrorClass: commit === "unknown" ? "COMMIT_MISSING" : "NONE" };
}

function compareEnvResolved(envClass, resolved, expectedClass, { absentDefault = false, fallbackValue = "" } = {}) {
  if (envClass === "ABSENT") {
    if (absentDefault && String(resolved) === fallbackValue) return "ENV_ABSENT_DEFAULT_USED";
    return fallbackValue ? "MISMATCH" : "ENV_ABSENT";
  }
  return (envClass === expectedClass && String(resolved) === expectedValueForClass(expectedClass)) ? "MATCH" : "MISMATCH";
}

function expectedValueForClass(expectedClass) {
  return ({ EXPECTED_MEOO: "meoo", EXPECTED_TRUE: "true", EXPECTED_MERCHANT_ASSETS: "merchant-assets", EXPECTED_STAGING: "staging" })[expectedClass] || "";
}

function deriveRuntimeMediaConfigSourceClass(envInfo, runtimeEnvFile) {
  const envMedia = [envInfo.runtimeEnvMediaStorageProviderClass, envInfo.runtimeEnvMediaAssetV1EnabledClass, envInfo.runtimeEnvMediaStorageBucketClass];
  const fileMedia = [runtimeEnvFile.runtimeEnvFileMediaProviderClass, runtimeEnvFile.runtimeEnvFileMediaFlagClass, runtimeEnvFile.runtimeEnvFileMediaBucketClass];
  const envExpected = envMedia.every(value => ["EXPECTED_MEOO", "EXPECTED_TRUE", "EXPECTED_MERCHANT_ASSETS"].includes(value));
  const envAbsent = envMedia.every(value => value === "ABSENT");
  const fileExpected = fileMedia.every(value => ["EXPECTED_MEOO", "EXPECTED_TRUE", "EXPECTED_MERCHANT_ASSETS"].includes(value));
  const fileUnexpected = fileMedia.some(value => value === "UNEXPECTED");
  if (envExpected && runtimeEnvFile.runtimeEnvFilePresent && fileUnexpected) return "RUNTIME_ENV_FILE_OVERRIDE_UNEXPECTED";
  if (envExpected) return "PROCESS_ENV_EXPECTED";
  if (envAbsent && runtimeEnvFile.runtimeEnvFilePresent && fileExpected) return "RUNTIME_ENV_FILE_OVERRIDE_EXPECTED";
  if (envAbsent && !runtimeEnvFile.runtimeEnvFilePresent) return "PROCESS_ENV_MEDIA_KEYS_ABSENT";
  if (envAbsent && runtimeEnvFile.runtimeEnvFilePresent && fileUnexpected) return "RUNTIME_ENV_FILE_OVERRIDE_UNEXPECTED";
  if (envMedia.some(value => value === "UNEXPECTED")) return "PROCESS_ENV_MEDIA_KEYS_UNEXPECTED";
  return "MIXED_OR_INCOMPLETE";
}

function resolveBuildIdentity({ env = process.env, readFile = fs.readFileSync } = {}) {
  const metadata = readBuildMetadata(env.ATELIER_RELEASE_METADATA_PATH, readFile);
  const runtimeCommit = safeCommitSha(env.ATELIER_GIT_SHA);
  const buildCommit = safeCommitSha(metadata.commitSha);
  const commit = buildCommit !== "unknown" ? buildCommit : runtimeCommit;
  const buildIdentitySource = buildCommit !== "unknown" ? "build-metadata" : runtimeCommit !== "unknown" ? "runtime-metadata" : "unknown";
  const buildTime = safeBuildTime(metadata.buildTime || env.ATELIER_BUILD_TIME);
  const artifactDigest = safeArtifactDigest(metadata.artifactDigest || env.ATELIER_ARTIFACT_DIGEST);
  const sourceId = safeCommitSha(metadata.sourceCommit || metadata.commitSha || env.ATELIER_GIT_SHA);
  const artifactId = artifactDigest;
  const configDigest = safeSha256Digest(metadata.runtimeConfigDigest);
  const effectiveConfigDigest = safeSha256Digest(env.ATELIER_RUNTIME_CONFIG_DIGEST);
  const buildId = sourceId !== "unknown" && artifactId !== "unknown" && configDigest !== "unknown"
    ? `sha256:${crypto.createHash("sha256").update(JSON.stringify([sourceId, artifactId, configDigest])).digest("hex")}`
    : "unknown";
  const branch = safeBranch(metadata.branch || env.ATELIER_GIT_BRANCH);
  return { buildCommit: commit, buildIdentitySource, buildTime, artifactDigest, branch, sourceId, artifactId, configDigest, effectiveConfigDigest, buildId, buildIdentityStatus: commit !== "unknown" && buildTime !== "unknown" ? "verified" : "unknown/unverified" };
}

function cleanEnvironment(value) {
  return String(value || "").trim().toLowerCase();
}

function bucketClass({ environmentResolved, projectIdentityClass, mediaProviderResolved, bucket }) {
  if (!bucket) return "missing";
  if (environmentResolved === "production" || bucket === PRODUCTION_BUCKET) return "production";
  if (environmentResolved === "staging" && projectIdentityClass === "staging-project" && mediaProviderResolved === "meoo") {
    return "project-bound-staging";
  }
  return "present-unverified";
}

function buildMediaRuntimeDiagnostic({
  buildIdentity = {},
  environmentResolved,
  projectIdentity,
  databaseBackendResolved,
  mediaProviderResolved,
  mediaAssetV1Requested,
  mediaAssetV1Active,
  mediaUploadRouteRegistered,
  storageValidation,
  supabaseUrlPresent = false,
  serviceRolePresent = false,
  databaseUrlPresent = false,
  bucket = "",
  lifecycleMutationGlobalEnabled = false,
  lifecycleCanaryConfigured = false,
  lifecycleCanaryAuthorizationAvailable = false,
  env = process.env,
  runtimeRoot = path.resolve(__dirname, ".."),
  readFile = fs.readFileSync
} = {}) {
  const environment = cleanEnvironment(environmentResolved);
  const projectClass = projectIdentity === STAGING_PROJECT_ID ? "staging-project" : (projectIdentity ? "mismatch" : "unverified");
  const requested = mediaAssetV1Requested === true;
  const backend = ["native", "meoo"].includes(databaseBackendResolved) ? databaseBackendResolved : "unknown";
  const provider = ["legacy", "meoo"].includes(mediaProviderResolved) ? mediaProviderResolved : "unknown";
  const active = mediaAssetV1Active === true
    && requested
    && provider === "meoo"
    && backend === "meoo"
    && storageValidation?.ok === true;
  const routeRegistered = mediaUploadRouteRegistered === true;
  const blockers = [];
  if (buildIdentity.buildCommit === "unknown") blockers.push("BUILD_IDENTITY_UNKNOWN");
  if (environment !== "staging") blockers.push("ENVIRONMENT_NOT_STAGING");
  if (projectClass === "unverified") blockers.push("PROJECT_IDENTITY_UNVERIFIED");
  if (projectClass === "mismatch") blockers.push("PROJECT_IDENTITY_MISMATCH");
  if (!requested) blockers.push("FLAG_DISABLED");
  if (provider !== "meoo") blockers.push("PROVIDER_NOT_MEOO");
  if (backend !== "meoo") blockers.push("DATABASE_BACKEND_NOT_MEOO");
  if (storageValidation && storageValidation.ok !== true) blockers.push("INVALID_STORAGE_CONFIG");
  if (requested && !active) blockers.push("MEDIA_SERVICE_NOT_CREATED");
  if (!routeRegistered) blockers.push("MEDIA_UPLOAD_ROUTE_NOT_REGISTERED");
  const envInfo = classifyRuntimeEnv(env);
  const runtimeEnvFile = inspectRuntimeEnvFile({ rootPath: runtimeRoot, readFile });
  const buildMetadata = inspectRuntimeBuildMetadata({ env, readFile });
  const projectBinding = env.MEOO_PROJECT_URL_ID === STAGING_PROJECT_ID ? "EXPECTED_STAGING_PROJECT" : (env.MEOO_PROJECT_URL_ID ? "OTHER_PROJECT" : "ABSENT");
  const resolvedBucket = String(bucket || "").trim();
  const mediaProviderEnvVsResolved = compareEnvResolved(envInfo.runtimeEnvMediaStorageProviderClass, provider, "EXPECTED_MEOO", { absentDefault: true, fallbackValue: "legacy" });
  const mediaFlagEnvVsResolved = compareEnvResolved(envInfo.runtimeEnvMediaAssetV1EnabledClass, requested ? "true" : "false", "EXPECTED_TRUE", { absentDefault: true, fallbackValue: "false" });
  const mediaBucketEnvVsResolved = compareEnvResolved(envInfo.runtimeEnvMediaStorageBucketClass, resolvedBucket || "", "EXPECTED_MERCHANT_ASSETS", { fallbackValue: "" });
  const databaseBackendEnvVsResolved = compareEnvResolved(envInfo.runtimeEnvAtelierDbBackendClass, backend, "EXPECTED_MEOO", { absentDefault: true, fallbackValue: "native" });
  const environmentEnvVsResolved = compareEnvResolved(envInfo.runtimeEnvAtelierEnvironmentClass, environment, "EXPECTED_STAGING", { absentDefault: true, fallbackValue: "development" });
  const runtimeMediaConfigSourceClass = deriveRuntimeMediaConfigSourceClass(envInfo, runtimeEnvFile);
  return {
    diagnosticSchemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    configSourceDiagnosticVersion: CONFIG_SOURCE_DIAGNOSTIC_VERSION,
    buildCommit: buildIdentity.buildCommit || "unknown",
    buildIdentitySource: ["build-metadata", "runtime-metadata", "unknown"].includes(buildIdentity.buildIdentitySource) ? buildIdentity.buildIdentitySource : "unknown",
    buildTime: safeBuildTime(buildIdentity.buildTime),
    buildArtifactDigest: safeArtifactDigest(buildIdentity.artifactDigest),
    buildBranch: safeBranch(buildIdentity.branch),
    buildIdentityStatus: buildIdentity.buildIdentityStatus === "verified" ? "verified" : "unknown/unverified",
    environmentResolved: environment || "unknown",
    projectIdentityClass: projectClass,
    databaseBackendResolved: backend,
    mediaProviderResolved: provider,
    mediaAssetV1Requested: requested,
    mediaAssetV1Active: active,
    mediaUploadRouteRegistered: routeRegistered,
    lifecycleMutationGlobalEnabled: lifecycleMutationGlobalEnabled === true,
    lifecycleCanaryConfigured: lifecycleCanaryConfigured === true,
    lifecycleCanaryAuthorizationAvailable: lifecycleCanaryAuthorizationAvailable === true,
    mediaBucketClass: bucketClass({ environmentResolved: environment, projectIdentityClass: projectClass, mediaProviderResolved: provider, bucket: String(bucket || "").trim() }),
    supabaseUrlPresent: Boolean(supabaseUrlPresent),
    serviceRolePresent: Boolean(serviceRolePresent),
    databaseUrlPresent: Boolean(databaseUrlPresent),
    activationBlockers: blockers,
    ...envInfo,
    mediaProviderEnvVsResolved,
    mediaFlagEnvVsResolved,
    mediaBucketEnvVsResolved,
    databaseBackendEnvVsResolved,
    environmentEnvVsResolved,
    ...runtimeEnvFile,
    ...buildMetadata,
    runtimeConfigFilePresent: String(env.ATELIER_RUNTIME_CONFIG_FILE_PRESENT || "false") === "true",
    runtimeConfigFileReadable: String(env.ATELIER_RUNTIME_CONFIG_FILE_READABLE || "false") === "true",
    runtimeConfigLoadStatus: String(env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS || "NOT_LOADED"),
    supabaseProjectBindingClass: projectBinding,
    trustedProjectIdResolved: projectBinding === "EXPECTED_STAGING_PROJECT" ? STAGING_PROJECT_ID : null,
    runtimeMediaConfigSourceClass
  };
}

module.exports = { DIAGNOSTIC_SCHEMA_VERSION, CONFIG_SOURCE_DIAGNOSTIC_VERSION, STAGING_PROJECT_ID, resolveBuildIdentity, buildMediaRuntimeDiagnostic, classifyRuntimeEnv, inspectRuntimeEnvFile, inspectRuntimeBuildMetadata, deriveRuntimeMediaConfigSourceClass };
