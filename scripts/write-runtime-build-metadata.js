const fs = require("node:fs");
const path = require("node:path");
const { safeArtifactDigest, safeBranch, safeBuildTime, safeCommitSha } = require("../admin/runtime-identity");

function readExisting(filePath, readFile = fs.readFileSync) {
  try {
    const value = JSON.parse(readFile(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function buildMetadata({ env = process.env, existing = {} } = {}) {
  const commitSha = safeCommitSha(env.ATELIER_GIT_SHA) !== "unknown"
    ? safeCommitSha(env.ATELIER_GIT_SHA)
    : safeCommitSha(existing.commitSha || existing.sourceCommit);
  const branch = safeBranch(env.ATELIER_GIT_BRANCH) !== "unknown"
    ? safeBranch(env.ATELIER_GIT_BRANCH)
    : safeBranch(existing.branch);
  const buildTime = safeBuildTime(env.ATELIER_BUILD_TIME) !== "unknown"
    ? safeBuildTime(env.ATELIER_BUILD_TIME)
    : safeBuildTime(existing.buildTime);
  const environment = [env.ATELIER_ENVIRONMENT, existing.environment]
    .map(value => String(value || "").trim().toLowerCase())
    .find(value => ["development", "staging", "production"].includes(value)) || "unknown";
  const targetProjectId = /^[a-z0-9]{6,32}$/.test(String(existing.declaredTargetProjectId || ""))
    ? String(existing.declaredTargetProjectId)
    : null;
  const runtimeConfigDigest = /^[0-9a-f]{64}$/i.test(String(existing.runtimeConfigDigest || ""))
    ? String(existing.runtimeConfigDigest).toLowerCase()
    : "unknown";
  const configSchemaVersion = /^[a-zA-Z0-9._-]{1,40}$/.test(String(existing.configSchemaVersion || ""))
    ? String(existing.configSchemaVersion)
    : "unknown";
  const artifactDigest = safeArtifactDigest(env.ATELIER_ARTIFACT_DIGEST) !== "unknown"
    ? safeArtifactDigest(env.ATELIER_ARTIFACT_DIGEST)
    : safeArtifactDigest(existing.artifactDigest);
  return {
    schemaVersion: "feeldao-build-identity-v1",
    commitSha,
    sourceCommit: commitSha,
    branch,
    buildTime,
    artifactDigest,
    declaredTargetProjectId: targetProjectId,
    environment,
    runtimeConfigDigest,
    configSchemaVersion
  };
}

function writeRuntimeBuildMetadata({ filePath = path.resolve(__dirname, "..", "runtime-build.json"), env = process.env } = {}) {
  const metadata = buildMetadata({ env, existing: readExisting(filePath) });
  fs.writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

if (require.main === module) writeRuntimeBuildMetadata();

module.exports = { readExisting, buildMetadata, writeRuntimeBuildMetadata };
