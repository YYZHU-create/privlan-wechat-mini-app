const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ALLOWED_ENVIRONMENTS = new Set(["development", "staging", "production"]);

function normalizeEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dev") return "development";
  if (normalized === "stage") return "staging";
  if (normalized === "prod") return "production";
  return normalized;
}

function cleanValue(value, fallback = "unknown") {
  const cleaned = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || fallback;
}

function safeCommitSha(value) {
  const candidate = cleanValue(value);
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

function safeBranch(value) {
  const candidate = cleanValue(value);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(candidate) ? candidate : "unknown";
}

function safeServerPort(value) {
  const port = Number(String(value || "").trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : "unknown";
}

function safeDatabaseLabel(env, fallback) {
  const explicit = cleanValue(env.ATELIER_DATABASE_LABEL);
  if (explicit !== "unknown") return /^[A-Za-z0-9._-]{1,120}$/.test(explicit) ? explicit : fallback;
  const connection = String(env.DATABASE_URL || env.ATELIER_REAL_POSTGRES_URL || "").trim();
  if (!connection) return fallback;
  try {
    const name = decodeURIComponent(new URL(connection).pathname.replace(/^\/+/, ""));
    return cleanValue(name.replace(/[^A-Za-z0-9._-]/g, "_"), fallback);
  } catch {
    return fallback;
  }
}

function safeBuildTime(value) {
  if (!value) return "unknown";
  const supplied = new Date(value);
  return Number.isNaN(supplied.getTime()) ? "unknown" : supplied.toISOString();
}

function readBuildMetadata(filePath, readFile = fs.readFileSync) {
  if (!filePath) return {};
  try {
    const parsed = JSON.parse(readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      commitSha: parsed.commitSha || parsed.sha,
      branch: parsed.branch,
      environment: parsed.environment,
      buildTime: parsed.buildTime
    };
  } catch {
    return {};
  }
}

function firstValid(values, validator) {
  for (const value of values) {
    const validated = validator(value);
    if (validated !== "unknown") return validated;
  }
  return "unknown";
}

function resolveRuntimeIdentity({ env = process.env, repoRoot = path.resolve(__dirname, ".."), readGit, readFile, buildMetadata, now = () => new Date() } = {}) {
  const metadata = buildMetadata || readBuildMetadata(env.ATELIER_RELEASE_METADATA_PATH, readFile);
  const environment = [env.ATELIER_ENVIRONMENT, metadata.environment, env.DATABASE_ENV, env.NODE_ENV]
    .map(normalizeEnvironment)
    .find(value => ALLOWED_ENVIRONMENTS.has(value));
  if (!environment) return { visible: false };

  const git = readGit || (args => execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1500,
    windowsHide: true
  }));
  const read = args => {
    try { return cleanValue(git(args)); }
    catch { return "unknown"; }
  };
  const canUseGitFallback = environment !== "production";
  let commitSha = firstValid([env.ATELIER_GIT_SHA, metadata.commitSha], safeCommitSha);
  let branch = firstValid([env.ATELIER_GIT_BRANCH, metadata.branch], safeBranch);
  if (canUseGitFallback && commitSha === "unknown") commitSha = safeCommitSha(read(["rev-parse", "HEAD"]));
  if (canUseGitFallback && branch === "unknown") branch = safeBranch(read(["rev-parse", "--abbrev-ref", "HEAD"]));
  const buildTime = firstValid([env.ATELIER_BUILD_TIME, metadata.buildTime], safeBuildTime);
  const identityStatus = commitSha !== "unknown" && buildTime !== "unknown" ? "verified" : "unknown/unverified";

  return {
    visible: true,
    environment,
    application: "Feeldao OS Merchant Console",
    branch,
    commitSha,
    buildTime,
    identityStatus,
    server: safeServerPort(env.PORT),
    database: environment === "production" ? "protected" : safeDatabaseLabel(env, environment),
    ...(environment === "development" && buildTime === "unknown" ? { generatedAt: now().toISOString() } : {})
  };
}

module.exports = { ALLOWED_ENVIRONMENTS, normalizeEnvironment, readBuildMetadata, resolveRuntimeIdentity, safeBranch, safeBuildTime, safeCommitSha, safeServerPort, safeDatabaseLabel };
