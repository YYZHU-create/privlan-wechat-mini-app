const { execFileSync } = require("node:child_process");
const path = require("node:path");

function normalizeEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dev") return "development";
  if (normalized === "stage") return "staging";
  if (normalized === "prod") return "production";
  return normalized;
}

function cleanGitValue(value, fallback = "unknown") {
  const cleaned = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || fallback;
}

function safeServerPort(value) {
  const port = Number(String(value || "").trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : "unknown";
}

function safeDatabaseLabel(env, fallback) {
  const explicit = cleanGitValue(env.ATELIER_DATABASE_LABEL);
  if (explicit !== "unknown") return /^[A-Za-z0-9._-]{1,120}$/.test(explicit) ? explicit : fallback;
  const connection = String(env.DATABASE_URL || env.ATELIER_REAL_POSTGRES_URL || "").trim();
  if (!connection) return fallback;
  try {
    const name = decodeURIComponent(new URL(connection).pathname.replace(/^\/+/, ""));
    return cleanGitValue(name.replace(/[^A-Za-z0-9._-]/g, "_"), fallback);
  } catch (error) {
    return fallback;
  }
}

function safeBuildTime(value, now) {
  const supplied = value ? new Date(value) : null;
  if (supplied && !Number.isNaN(supplied.getTime())) return supplied.toISOString();
  return now().toISOString();
}

function resolveRuntimeIdentity({ env = process.env, repoRoot = path.resolve(__dirname, ".."), readGit, now = () => new Date() } = {}) {
  const signals = [env.ATELIER_ENVIRONMENT, env.DATABASE_ENV, env.NODE_ENV].map(normalizeEnvironment).filter(Boolean);
  if (signals.includes("production")) return { visible: false };

  const environment = signals[0] || "development";
  if (!new Set(["development", "staging"]).has(environment)) return { visible: false };

  const git = readGit || (args => execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1500,
    windowsHide: true
  }));
  const read = args => {
    try { return cleanGitValue(git(args)); }
    catch (error) { return "unknown"; }
  };
  const branch = cleanGitValue(env.ATELIER_GIT_BRANCH) !== "unknown"
    ? cleanGitValue(env.ATELIER_GIT_BRANCH)
    : read(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commitSha = cleanGitValue(env.ATELIER_GIT_SHA) !== "unknown"
    ? cleanGitValue(env.ATELIER_GIT_SHA)
    : read(["rev-parse", "HEAD"]);

  return {
    visible: true,
    environment,
    application: "ATELIER OS Merchant Console",
    branch,
    commitSha,
    server: safeServerPort(env.PORT),
    database: safeDatabaseLabel(env, environment),
    buildTime: safeBuildTime(env.ATELIER_BUILD_TIME, now)
  };
}

module.exports = { normalizeEnvironment, resolveRuntimeIdentity, safeServerPort, safeDatabaseLabel };
