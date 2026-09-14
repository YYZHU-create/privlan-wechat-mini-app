const fs = require("node:fs");
const { readBuildMetadata, safeCommitSha } = require("./runtime-identity");

const DIAGNOSTIC_SCHEMA_VERSION = "g2c10e-v1";
const STAGING_PROJECT_ID = "asmhysidbg5g";
const PRODUCTION_BUCKET = "feeldao-production-media";

function resolveBuildIdentity({ env = process.env, readFile = fs.readFileSync } = {}) {
  const metadata = readBuildMetadata(env.ATELIER_RELEASE_METADATA_PATH, readFile);
  const runtimeCommit = safeCommitSha(env.ATELIER_GIT_SHA);
  const buildCommit = safeCommitSha(metadata.commitSha);
  if (buildCommit !== "unknown") return { buildCommit, buildIdentitySource: "build-metadata" };
  if (runtimeCommit !== "unknown") return { buildCommit: runtimeCommit, buildIdentitySource: "runtime-metadata" };
  return { buildCommit: "unknown", buildIdentitySource: "unknown" };
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
  bucket = ""
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
  return {
    diagnosticSchemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    buildCommit: buildIdentity.buildCommit || "unknown",
    buildIdentitySource: ["build-metadata", "runtime-metadata", "unknown"].includes(buildIdentity.buildIdentitySource) ? buildIdentity.buildIdentitySource : "unknown",
    environmentResolved: environment || "unknown",
    projectIdentityClass: projectClass,
    databaseBackendResolved: backend,
    mediaProviderResolved: provider,
    mediaAssetV1Requested: requested,
    mediaAssetV1Active: active,
    mediaUploadRouteRegistered: routeRegistered,
    mediaBucketClass: bucketClass({ environmentResolved: environment, projectIdentityClass: projectClass, mediaProviderResolved: provider, bucket: String(bucket || "").trim() }),
    supabaseUrlPresent: Boolean(supabaseUrlPresent),
    serviceRolePresent: Boolean(serviceRolePresent),
    databaseUrlPresent: Boolean(databaseUrlPresent),
    activationBlockers: blockers
  };
}

module.exports = { DIAGNOSTIC_SCHEMA_VERSION, STAGING_PROJECT_ID, resolveBuildIdentity, buildMediaRuntimeDiagnostic };
