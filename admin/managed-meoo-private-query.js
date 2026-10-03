"use strict";
const path = require("node:path");
function failure(code) { return new Error(code); }
function createPrivateMeooQuery({ projectId, loadCredentials, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  if (!["asmhysidbg5g", "g8o5cv1om41o"].includes(projectId) || typeof loadCredentials !== "function" ||
      typeof fetchImpl !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw failure("AUTH_MIGRATION_PRIVATE_TRANSPORT_REQUIRED");
  }
  return async function queryOnce(input) {
    if (input?.projectId !== projectId || typeof input.sql !== "string" || !input.sql.trim() || input.sql.length > 131072) {
      throw failure("AUTH_MIGRATION_QUERY_BINDING_MISMATCH");
    }
    let credentials;
    try { credentials = await loadCredentials(); } catch { throw failure("AUTH_MIGRATION_CLI_CREDENTIAL_REQUIRED"); }
    if (!credentials || credentials.apiBaseUrl !== "https://meoo.com" ||
        (credentials.projectUrlId && credentials.projectUrlId !== projectId)) {
      throw failure("AUTH_MIGRATION_CLI_CREDENTIAL_BINDING_MISMATCH");
    }
    const type = credentials.credentialType;
    if (type === "oauth" && (!Number.isFinite(credentials.accessTokenExpiresAt) || credentials.accessTokenExpiresAt <= Date.now() + 60000)) {
      throw failure("AUTH_MIGRATION_CLI_CREDENTIAL_EXPIRED");
    }
    const token = type === "api_key" ? credentials.apiKey : ["oauth", "bearer"].includes(type) ? credentials.accessToken : null;
    if (typeof token !== "string" || !token.trim()) throw failure("AUTH_MIGRATION_CLI_CREDENTIAL_REQUIRED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { "Content-Type": "application/json", "Accept": "application/json", Authorization: `Bearer ${token}`, "X-Meoo-Client": "cli" };
      if (type === "api_key") headers["OneDay-App-Id"] = projectId;
      const response = await fetchImpl(`https://meoo.com/open/v1/cli-compat/projects/${projectId}/cloud/database/query`, {
        method: "POST", headers, redirect: "error", cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ query: input.sql, disable_statement_timeout: false })
      });
      if (!response.ok) throw new Error();
      const envelope = await response.json();
      if (envelope?.success === false || envelope?.ok === false) throw new Error();
      const data = envelope?.data ?? envelope;
      const rows = Array.isArray(data) ? data : data?.rows ?? data?.result;
      if (!Array.isArray(rows) || rows.length > 100) throw new Error();
      return rows;
    } catch { throw failure("AUTH_MIGRATION_PRIVATE_QUERY_NOT_CONFIRMED"); }
    finally { clearTimeout(timer); }
  };
}
function createInstalledCliPrivateQuery({ cliRoot, projectId, fetchImpl, timeoutMs }) {
  if (!path.isAbsolute(cliRoot || "")) throw failure("AUTH_MIGRATION_CLI_INSTALLATION_REQUIRED");
  let loader;
  try {
    const metadata = require(path.join(cliRoot, "package.json"));
    if (metadata.name !== "@aliyun-meoo/cli" || metadata.version !== "0.5.4") throw new Error();
    loader = require(path.join(cliRoot, "dist/lib/credentials.js")).loadCredentials;
  } catch { throw failure("AUTH_MIGRATION_CLI_INSTALLATION_NOT_VERIFIED"); }
  return createPrivateMeooQuery({ projectId, loadCredentials: loader, fetchImpl, timeoutMs });
}
module.exports = { createPrivateMeooQuery, createInstalledCliPrivateQuery };
