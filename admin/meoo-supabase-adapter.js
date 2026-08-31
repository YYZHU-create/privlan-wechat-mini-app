const crypto = require("node:crypto");

class SupabaseAdapterError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function scopeValues(scope) {
  const values = [scope?.tenantId, scope?.workspaceId, scope?.storeId].map(value => String(value || "").trim());
  if (values.some(value => !value)) throw new SupabaseAdapterError("SCOPE_REQUIRED", "tenant/workspace/store scope is required", 400);
  return values;
}

function normalizeError(error, status) {
  if (status === 404) return new SupabaseAdapterError("NOT_FOUND", "resource not found", 404);
  if (status === 409 || error?.code === "23505") return new SupabaseAdapterError("TAG_EXISTS", "标签已存在", 409);
  if (error?.code === "23514") return new SupabaseAdapterError("TAG_INVALID", "标签名称不能为空", 400);
  return new SupabaseAdapterError("DATABASE_UNAVAILABLE", "database request failed", 503);
}

function createSupabaseAdapter({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, table = "customer_tags", sessionTable = "merchant_sessions", timeoutMs = 8000, onEvent = () => {} } = {}) {
  if (!url || !/^https:\/\//i.test(String(url)) || !serviceRoleKey || typeof fetchImpl !== "function") throw new Error("Supabase server configuration is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("Supabase timeout is invalid");
  const endpoint = `${String(url).replace(/\/$/, "")}/rest/v1/${table}`;
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };

  async function request(path = "", options = {}, baseEndpoint = endpoint) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseEndpoint}${path}`, { ...options, signal: controller.signal, headers: { ...headers, ...(options.headers || {}) } });
    } catch (error) {
      onEvent({ backend: "meoo", operation: options.method || "GET", durationMs: Date.now() - startedAt, success: false, errorCategory: "DATABASE_UNAVAILABLE" });
      throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "database request failed", 503);
    } finally { clearTimeout(timer); }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const normalized = normalizeError(body, response.status);
      onEvent({ backend: "meoo", operation: options.method || "GET", durationMs: Date.now() - startedAt, success: false, errorCategory: normalized.code });
      throw normalized;
    }
    onEvent({ backend: "meoo", operation: options.method || "GET", durationMs: Date.now() - startedAt, success: true, errorCategory: null });
    return body;
  }

  async function callRpc(name, body = {}) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(name || ""))) throw new SupabaseAdapterError("RPC_INVALID", "database operation is invalid", 400);
    const rpcEndpoint = `${String(url).replace(/\/$/, "")}/rest/v1/rpc/${name}`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(rpcEndpoint, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(body) });
    } catch (error) {
      onEvent({ backend: "meoo", operation: `rpc.${name}`, durationMs: Date.now() - startedAt, success: false, errorCategory: "DATABASE_UNAVAILABLE" });
      throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "database request failed", 503);
    } finally { clearTimeout(timer); }
    const text = await response.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch { result = null; }
    if (!response.ok) {
      const normalized = normalizeError(result, response.status);
      onEvent({ backend: "meoo", operation: `rpc.${name}`, durationMs: Date.now() - startedAt, success: false, errorCategory: normalized.code });
      throw normalized;
    }
    onEvent({ backend: "meoo", operation: `rpc.${name}`, durationMs: Date.now() - startedAt, success: true, errorCategory: null });
    return result;
  }

  function query(scope, extra = "") {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    return `tenant_id=eq.${encodeURIComponent(tenantId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&store_id=eq.${encodeURIComponent(storeId)}${extra ? `&${extra}` : ""}`;
  }

  async function listTags(scope) {
    const rows = await request(`?select=id,name,created_at&${query(scope)}&order=name.asc`);
    return Array.isArray(rows) ? rows : [];
  }

  async function createTag(scope, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const name = String(input.name || "").trim().slice(0, 80);
    if (!name) throw new SupabaseAdapterError("TAG_INVALID", "标签名称不能为空", 400);
    const rows = await request("", {
      method: "POST",
      headers: { Prefer: "return=representation,resolution=standard" },
      body: JSON.stringify({ id: input.id || crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, name })
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function deleteTag(scope, tagId) {
    const rows = await request(`?${query(scope, `id=eq.${encodeURIComponent(String(tagId))}`)}&select=id`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" }
    });
    if (!Array.isArray(rows) || !rows[0]) throw new SupabaseAdapterError("NOT_FOUND", "resource not found", 404);
    return { id: rows[0].id, deleted: true };
  }

  async function createSession(scope, input = {}) {
    const [tenantId, workspaceId] = scopeValues(scope);
    if (!input.userId || !input.tokenHash || !input.csrfTokenHash) throw new SupabaseAdapterError("SESSION_INVALID", "session fields are required", 400);
    const sessionEndpoint = `${String(url).replace(/\/$/, "")}/rest/v1/${sessionTable}`;
    const rows = await request("", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ id: input.id || crypto.randomUUID(), user_id: input.userId, workspace_id: workspaceId, tenant_id: tenantId, token_hash: input.tokenHash, csrf_token_hash: input.csrfTokenHash, expires_at: input.expiresAt || null }) }, sessionEndpoint);
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function findSession(scope, sessionId) {
    const [tenantId, workspaceId] = scopeValues(scope);
    const sessionEndpoint = `${String(url).replace(/\/$/, "")}/rest/v1/${sessionTable}`;
    const rows = await request(`?select=id,user_id,workspace_id,tenant_id,token_hash,csrf_token_hash,expires_at&id=eq.${encodeURIComponent(String(sessionId))}&tenant_id=eq.${encodeURIComponent(tenantId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`, {}, sessionEndpoint);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function revokeSession(scope, sessionId) {
    const [tenantId, workspaceId] = scopeValues(scope);
    const sessionEndpoint = `${String(url).replace(/\/$/, "")}/rest/v1/${sessionTable}`;
    const rows = await request(`?id=eq.${encodeURIComponent(String(sessionId))}&tenant_id=eq.${encodeURIComponent(tenantId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`, { method: "DELETE", headers: { Prefer: "return=representation" } }, sessionEndpoint);
    if (!Array.isArray(rows) || !rows[0]) throw new SupabaseAdapterError("NOT_FOUND", "resource not found", 404);
    return { id: rows[0].id, revoked: true };
  }

  async function readConfig(scope) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const rows = await request(`?select=workspace_id,tenant_id,store_id,document,version,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&store_id=eq.${encodeURIComponent(storeId)}&limit=1`, {}, `${String(url).replace(/\/$/, "")}/rest/v1/workspace_configs`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new SupabaseAdapterError("CONFIG_NOT_FOUND", "工作区配置不存在", 404);
    return { document: row.document, version: Number(row.version), updatedAt: row.updated_at };
  }

  async function writeConfig(scope, document) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const current = await readConfig(scope);
    let rows;
    try {
      rows = await request(`?workspace_id=eq.${encodeURIComponent(workspaceId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&store_id=eq.${encodeURIComponent(storeId)}&version=eq.${encodeURIComponent(String(current.version))}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ document, version: current.version + 1, updated_at: new Date().toISOString() })
      }, `${String(url).replace(/\/$/, "")}/rest/v1/workspace_configs`);
    } catch (error) {
      if (error?.status === 409) throw new SupabaseAdapterError("CONFIG_CONFLICT", "配置已被其他操作更新，请刷新后重试", 409);
      throw error;
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new SupabaseAdapterError("CONFIG_CONFLICT", "配置已被其他操作更新，请刷新后重试", 409);
    return { document: row.document, version: Number(row.version), updatedAt: row.updated_at };
  }

  async function getSubscription(scope) {
    const [tenantId, workspaceId] = scopeValues(scope);
    const rows = await request(`?select=id,tenant_id,workspace_id,plan_id,status,started_at,expires_at,source&workspace_id=eq.${encodeURIComponent(workspaceId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=1`, {}, `${String(url).replace(/\/$/, "")}/rest/v1/subscriptions`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function getAiPolicy(scope) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const rows = await request(`?select=tenant_id,workspace_id,store_id,mode,connection_id,fallback_to_rules&tenant_id=eq.${encodeURIComponent(tenantId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&store_id=eq.${encodeURIComponent(storeId)}&limit=1`, {}, `${String(url).replace(/\/$/, "")}/rest/v1/merchant_ai_policies`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function readResource(tableName, query = "") {
    const allowed = new Set(["customers", "customer_memberships", "customer_tag_links", "customer_tags", "customer_notes", "customer_events", "customer_points_accounts", "customer_points_ledger", "membership_levels", "membership_programs", "appointments", "orders", "appointment_services", "appointment_advisors", "audit_events"]);
    if (!allowed.has(String(tableName || ""))) throw new SupabaseAdapterError("RESOURCE_INVALID", "database resource is invalid", 400);
    if (query && !/^[A-Za-z0-9_.=(),%:+&-]+$/.test(String(query))) throw new SupabaseAdapterError("QUERY_INVALID", "database query is invalid", 400);
    return request(`${query ? `?${query}` : ""}`, {}, `${String(url).replace(/\/$/, "")}/rest/v1/${tableName}`);
  }

  return { listTags, createTag, deleteTag, createSession, findSession, revokeSession, readConfig, writeConfig, getSubscription, getAiPolicy, readResource, callRpc };
}

function createMeooAuthRepository({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!url || !/^https:\/\//i.test(String(url)) || !serviceRoleKey || typeof fetchImpl !== "function") throw new Error("Meoo server configuration is required");
  const base = String(url).replace(/\/$/, "");
  const revokedSessionIds = new Set();
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  async function request(table, query = "", options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/rest/v1/${table}${query}`, { ...options, signal: controller.signal, headers: { ...headers, "Cache-Control": "no-store", ...(options.headers || {}) } });
      const text = await response.text();
      let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!response.ok) throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "database request failed", response.status >= 500 ? 503 : response.status);
      return body;
    } finally { clearTimeout(timer); }
  }
  async function findUserByLogin(login) {
    const rows = await request("users", `?select=id,login_identifier,password_hash,display_name,avatar_url,status&login_identifier=eq.${encodeURIComponent(login)}&limit=1`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }
  async function findMembership(userId) {
    const rows = await request("memberships", `?select=tenant_id,workspace_id,user_id,role&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=1`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }
  async function getProfile(userId, workspaceId) {
    const [users, memberships] = await Promise.all([
      request("users", `?select=id,login_identifier,display_name,avatar_url,status&id=eq.${encodeURIComponent(userId)}&status=eq.active&limit=1`),
      request("memberships", `?select=user_id,workspace_id,role&user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`)
    ]);
    const user = users?.[0]; const membership = memberships?.[0];
    return user && membership ? { ...user, role: membership.role } : null;
  }
  async function loadSession(tokenHash) {
    const sessions = await request("merchant_sessions", `?select=id,user_id,workspace_id,csrf_token_hash,expires_at,revoked_at&token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&limit=1`);
    const session = Array.isArray(sessions) ? sessions[0] : null;
    if (!session || revokedSessionIds.has(session.id) || session.revoked_at || (session.expires_at && new Date(session.expires_at) <= new Date())) return null;
    const [users, memberships, workspaces, stores, subscriptions] = await Promise.all([
      request("users", `?select=id,login_identifier,display_name,avatar_url,status&id=eq.${encodeURIComponent(session.user_id)}&status=eq.active&limit=1`),
      request("memberships", `?select=tenant_id,workspace_id,user_id,role&user_id=eq.${encodeURIComponent(session.user_id)}&workspace_id=eq.${encodeURIComponent(session.workspace_id)}&limit=1`),
      request("workspaces", `?select=id,tenant_id,name,plan_id&id=eq.${encodeURIComponent(session.workspace_id)}&limit=1`),
      request("stores", `?select=id,workspace_id,tenant_id,name,public_store_id&workspace_id=eq.${encodeURIComponent(session.workspace_id)}&limit=1`),
      request("subscriptions", `?select=id,workspace_id,plan_id,status,started_at,expires_at&workspace_id=eq.${encodeURIComponent(session.workspace_id)}&limit=1`)
    ]);
    const user = users?.[0]; const membership = memberships?.[0]; const workspace = workspaces?.[0]; const store = stores?.[0]; const subscription = subscriptions?.[0];
    if (!user || !membership || !workspace || !store || membership.tenant_id !== workspace.tenant_id || store.tenant_id !== workspace.tenant_id) return null;
    return { session_id: session.id, user_id: user.id, workspace_id: workspace.id, csrf_token_hash: session.csrf_token_hash, expires_at: session.expires_at, login_identifier: user.login_identifier, display_name: user.display_name, avatar_url: user.avatar_url, user_status: user.status, tenant_id: workspace.tenant_id, workspace_name: workspace.name, plan_id: workspace.plan_id, store_id: store.id, store_name: store.name, public_store_id: store.public_store_id, role: membership.role, subscription_id: subscription?.id || null, subscription_status: subscription?.status || null, subscription_plan_id: subscription?.plan_id || null, started_at: subscription?.started_at || null, subscription_expires_at: subscription?.expires_at || null };
  }
  async function createSession(input) {
    const rows = await request("merchant_sessions", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(input) });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async function revokeSession(sessionId) {
    const rows = await request("merchant_sessions", `?id=eq.${encodeURIComponent(sessionId)}&revoked_at=is.null&select=id,revoked_at`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    if (!Array.isArray(rows) || !rows[0]) throw new SupabaseAdapterError("NOT_FOUND", "resource not found", 404);
    revokedSessionIds.add(String(sessionId));
  }
  async function recordAudit(input) {
    await request("audit_events", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(input) });
  }
  return { findUserByLogin, findMembership, getProfile, loadSession, createSession, revokeSession, recordAudit };
}

module.exports = { createSupabaseAdapter, createMeooAuthRepository, SupabaseAdapterError };
