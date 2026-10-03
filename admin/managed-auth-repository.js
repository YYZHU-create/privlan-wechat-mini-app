"use strict";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(code) { const error = new Error(code); error.code = code; return error; }
function selection({ projectId, providerOrigin, surface, providerUserId }) {
  if (typeof projectId !== "string" || !projectId || projectId.length > 100 ||
      !["merchant", "operator"].includes(surface) || !UUID.test(providerUserId || "")) {
    throw failure("MANAGED_AUTH_INVALID_IDENTITY_QUERY");
  }
  let origin;
  try { origin = new URL(providerOrigin); } catch { throw failure("MANAGED_AUTH_INVALID_IDENTITY_QUERY"); }
  if (origin.protocol !== "https:" || origin.origin !== providerOrigin || origin.username || origin.password) {
    throw failure("MANAGED_AUTH_INVALID_IDENTITY_QUERY");
  }
  return { projectId, providerOrigin, surface, providerUserId };
}
function publicLink(row) {
  if (!row) return null;
  return { projectId: row.project_id, providerOrigin: row.provider_origin,
    surface: row.surface, providerUserId: row.provider_user_id,
    businessUserId: row.surface === "merchant" ? row.merchant_user_id : row.operator_user_id };
}
function principalQuery(surface, businessUserId) {
  if (!["merchant", "operator"].includes(surface) || !UUID.test(businessUserId || "")) {
    throw failure("MANAGED_AUTH_INVALID_BUSINESS_IDENTITY");
  }
  return surface === "merchant"
    ? { table: "users", fields: "id,login_identifier,display_name,status", businessUserId }
    : { table: "operator_users", fields: "id,email,display_name,role,status", businessUserId };
}
function createManagedAuthRepository({ db }) {
  if (typeof db?.query !== "function") throw failure("MANAGED_AUTH_REPOSITORY_NOT_CONFIGURED");
  async function resolveIdentityLink(input) {
    const s = selection(input);
    const result = await db.query(`select project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id
      from managed_auth_identity_links where project_id=$1 and provider_origin=$2 and surface=$3 and provider_user_id=$4`,
    [s.projectId, s.providerOrigin, s.surface, s.providerUserId]);
    if (result.rows.length > 1) throw failure("MANAGED_AUTH_AMBIGUOUS_IDENTITY");
    return publicLink(result.rows[0]);
  }
  async function loadBusinessPrincipal({ surface, businessUserId }) {
    const q = principalQuery(surface, businessUserId);
    return (await db.query(`select ${q.fields} from ${q.table} where id=$1`, [q.businessUserId])).rows[0] || null;
  }
  return { resolveIdentityLink, loadBusinessPrincipal };
}

function createMeooManagedAuthRepository({ url, serviceRoleKey, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  let origin;
  try { origin = new URL(url); } catch { throw failure("MANAGED_AUTH_REPOSITORY_NOT_CONFIGURED"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || !serviceRoleKey ||
      typeof fetchImpl !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw failure("MANAGED_AUTH_REPOSITORY_NOT_CONFIGURED");
  }
  async function read(table, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${origin.origin}/rest/v1/${table}?${params}`, {
        method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" }
      });
      if (!response.ok) throw failure("MANAGED_AUTH_REPOSITORY_UNAVAILABLE");
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw failure("MANAGED_AUTH_AMBIGUOUS_IDENTITY");
      return rows[0] || null;
    } catch (error) {
      if (error?.code === "MANAGED_AUTH_AMBIGUOUS_IDENTITY") throw error;
      throw failure("MANAGED_AUTH_REPOSITORY_UNAVAILABLE");
    } finally { clearTimeout(timer); }
  }
  async function resolveIdentityLink(input) {
    const s = selection(input);
    const params = new URLSearchParams({ select: "project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id",
      project_id: `eq.${s.projectId}`, provider_origin: `eq.${s.providerOrigin}`, surface: `eq.${s.surface}`,
      provider_user_id: `eq.${s.providerUserId}`, limit: "2" });
    return publicLink(await read("managed_auth_identity_links", params));
  }
  async function loadBusinessPrincipal({ surface, businessUserId }) {
    const q = principalQuery(surface, businessUserId);
    return read(q.table, new URLSearchParams({ select: q.fields, id: `eq.${q.businessUserId}`, limit: "2" }));
  }
  async function provisionMerchant({ proof, storeName, contactName, document, template, requestId }) {
    selection({ ...proof, surface: "merchant" });
    if (proof.emailVerified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proof.email || "") ||
        proof.email.length > 64 || typeof storeName !== "string" || storeName.length < 2 || storeName.length > 64 ||
        !document || typeof document !== "object" || Array.isArray(document) ||
        !["retail", "service", "restaurant", "education", "studio", "blank"].includes(template)) {
      throw failure("MANAGED_AUTH_INVALID_PROVISIONING");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${origin.origin}/rest/v1/rpc/provision_managed_merchant`, {
        method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_project: proof.projectId, p_origin: proof.providerOrigin, p_subject: proof.providerUserId,
          p_email: proof.email, p_store_name: storeName, p_contact: String(contactName || "").slice(0,120),
          p_document: document, p_template: template, p_request_id: requestId })
      });
      if (!response.ok) throw failure(response.status === 409 ? "MANAGED_AUTH_ACCOUNT_EXISTS" : "MANAGED_AUTH_REPOSITORY_UNAVAILABLE");
      const result = await response.json();
      if (result?.alreadyProvisioned === true) return { alreadyProvisioned: true };
      if (!UUID.test(result?.user?.id || "") || result.user.login !== proof.email ||
          !UUID.test(result?.workspace?.id || "") || !UUID.test(result?.workspace?.tenantId || "") ||
          !UUID.test(result?.workspace?.storeId || "") || !UUID.test(result?.subscription?.id || "") ||
          result.subscription.planId !== "TRIAL" || result.subscription.status !== "inactive") {
        throw failure("MANAGED_AUTH_REPOSITORY_UNAVAILABLE");
      }
      return { user: { id: result.user.id, login: result.user.login, displayName: String(result.user.displayName || "") },
        workspace: { id: result.workspace.id, tenantId: result.workspace.tenantId, storeId: result.workspace.storeId,
          publicStoreId: result.workspace.publicStoreId, name: result.workspace.name },
        subscription: { id: result.subscription.id, planId: "TRIAL", status: "inactive", expiresAt: null } };
    } catch (error) {
      if (error?.code === "MANAGED_AUTH_ACCOUNT_EXISTS") throw error;
      throw failure("MANAGED_AUTH_REPOSITORY_UNAVAILABLE");
    } finally { clearTimeout(timer); }
  }
  return { resolveIdentityLink, loadBusinessPrincipal, provisionMerchant };
}

module.exports = { createManagedAuthRepository, createMeooManagedAuthRepository };
