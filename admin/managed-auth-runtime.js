"use strict";
const { createManagedAuth } = require("./managed-auth");
const { createManagedAuthRepository, createMeooManagedAuthRepository } = require("./managed-auth-repository");

const REQUIRED_MIGRATIONS = ["017_managed_auth_identity_links", "018_managed_auth_session_provenance", "019_managed_merchant_provisioning", "020_managed_auth_session_state", "021_managed_auth_session_rpc"];
const { createManagedSessionLifetime } = require("./managed-session-lifetime");
const { createManagedSessionStateRepository } = require("./managed-session-state-repository");
const { createMeooSessionStateRepository } = require("./managed-meoo-session-state-repository");
const TARGETS = { asmhysidbg5g: "staging", g8o5cv1om41o: "production" };
function failure(code) { const error = new Error(code); error.code = code; return error; }
function readManagedAuthConfig(env = process.env) {
  const mode = String(env.ATELIER_AUTH_PROVIDER || "legacy").trim().toLowerCase();
  if (mode === "legacy") return null;
  if (mode !== "supabase") throw failure("MANAGED_AUTH_PROVIDER_INVALID");
  const projectId = String(env.MEOO_PROJECT_URL_ID || "").trim();
  if (!TARGETS[projectId] || env.ATELIER_ENVIRONMENT !== TARGETS[projectId] ||
      env.ATELIER_RUNTIME_CONFIG_LOAD_STATUS !== "LOADED_VALIDATED") {
    throw failure("MANAGED_AUTH_TARGET_NOT_VERIFIED");
  }
  if (env.ATELIER_AUTO_MIGRATE !== "0") throw failure("MANAGED_AUTH_APPLICATION_MIGRATION_GUARD_REQUIRED");
  const backend = String(env.ATELIER_DB_BACKEND || "native").trim().toLowerCase();
  if (!["native", "meoo"].includes(backend) || (backend === "meoo" && env.DATABASE_URL)) {
    throw failure("MANAGED_AUTH_DATABASE_SELECTION_INVALID");
  }
  let provider;
  try { provider = new URL(env.SUPABASE_URL); } catch { throw failure("MANAGED_AUTH_PROVIDER_NOT_CONFIGURED"); }
  if (provider.protocol !== "https:" || provider.username || provider.password ||
      provider.pathname !== "/" || provider.search || provider.hash) throw failure("MANAGED_AUTH_PROVIDER_NOT_CONFIGURED");
  const anonKey = String(env.SUPABASE_ANON_KEY || "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!anonKey || anonKey === serviceRoleKey || anonKey.startsWith("sb_secret_")) throw failure("MANAGED_AUTH_PUBLIC_KEY_REQUIRED");
  try {
    const payload = JSON.parse(Buffer.from(anonKey.split(".")[1] || "", "base64url").toString());
    if (payload.role === "service_role") throw failure("MANAGED_AUTH_PUBLIC_KEY_REQUIRED");
  } catch (error) { if (error.code === "MANAGED_AUTH_PUBLIC_KEY_REQUIRED") throw error; }
  if (backend === "meoo" && !serviceRoleKey) throw failure("MANAGED_AUTH_REPOSITORY_NOT_CONFIGURED");
  const encodedKey = String(env.ATELIER_MASTER_KEY || "");
  const sessionKey = Buffer.from(encodedKey, "base64");
  if (sessionKey.length !== 32 || sessionKey.toString("base64") !== encodedKey) throw failure("MANAGED_SESSION_ATELIER_MASTER_KEY_REQUIRED");
  // Private config: never serialize this object into health/runtime responses.
  return { projectId, environment: TARGETS[projectId], backend, supabaseUrl: provider.origin,
    anonKey, serviceRoleKey, sessionKey, applicationOrigin: `https://${projectId}.meoo.pub` };
}

async function verifyManagedAuthSchema({ config, db, fetchImpl = globalThis.fetch }) {
  const probes = [
    ["managed_auth_identity_links", "project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id"],
    ["merchant_sessions", "auth_provider"], ["operator_sessions", "auth_provider"],
    ["managed_auth_session_state", "session_id,project_id,provider_origin,surface,provider_user_id,business_user_id,issued_at_ms,deadline_ms,encrypted_state,lease_token,lease_until,rotation_pending,revoked"]
  ];
  try {
    let versions;
    if (config.backend === "meoo") {
      async function read(table, params) {
        const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(params)}`, {
          method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
          headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, Accept: "application/json" }
        });
        if (!response.ok) throw new Error();
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error();
        return rows;
      }
      versions = await read("schema_migrations", { select: "version", version: `in.(${REQUIRED_MIGRATIONS.join(",")})`, limit: String(REQUIRED_MIGRATIONS.length + 1) });
      for (const [table, select] of probes) {
        if ((await read(table, { select, limit: "0" })).length !== 0) throw new Error();
      }
    } else {
      versions = (await db.query("select version from schema_migrations where version=any($1::text[])", [REQUIRED_MIGRATIONS])).rows;
      for (const [table, fields] of probes) await db.query(`select ${fields} from ${table} where false`);
    }
    if (!Array.isArray(versions) || versions.length !== REQUIRED_MIGRATIONS.length ||
        !REQUIRED_MIGRATIONS.every(version => versions.some(row => row.version === version))) throw new Error();
  } catch { throw failure("MANAGED_AUTH_SCHEMA_NOT_READY"); }
}

async function createManagedAuthRuntime({ env = process.env, db, fetchImpl, createClient } = {}) {
  const config = readManagedAuthConfig(env);
  if (!config) return null;
  if (!db || (db.kind === "meoo") !== (config.backend === "meoo")) throw failure("MANAGED_AUTH_DATABASE_SELECTION_INVALID");
  await verifyManagedAuthSchema({ config, db, fetchImpl });
  const repository = config.backend === "meoo"
    ? createMeooManagedAuthRepository({ url: config.supabaseUrl, serviceRoleKey: config.serviceRoleKey, fetchImpl })
    : createManagedAuthRepository({ db });
  const auth = createManagedAuth({ ...config, createClient,
    resolveIdentityLink: repository.resolveIdentityLink, loadBusinessPrincipal: repository.loadBusinessPrincipal });
  const stateRepository = config.backend === "meoo"
    ? createMeooSessionStateRepository({ projectId: config.projectId, providerOrigin: config.supabaseUrl, serviceRoleKey: config.serviceRoleKey, fetchImpl })
    : createManagedSessionStateRepository({ db, projectId: config.projectId, providerOrigin: config.supabaseUrl });
  const sessions = createManagedSessionLifetime({ projectId: config.projectId, providerOrigin: config.supabaseUrl,
    key: config.sessionKey, repository: stateRepository, managedAuth: auth });
  return { auth, repository, sessions };
}
module.exports = { readManagedAuthConfig, verifyManagedAuthSchema, createManagedAuthRuntime, REQUIRED_MIGRATIONS };
