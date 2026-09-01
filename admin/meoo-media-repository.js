const crypto = require("node:crypto");
const { SupabaseAdapterError } = require("./meoo-supabase-adapter");

function requireScope(scope) {
  const values = [scope?.tenantId, scope?.workspaceId, scope?.storeId].map(value => String(value || "").trim());
  if (values.some(value => !value)) throw new SupabaseAdapterError("SCOPE_REQUIRED", "tenant/workspace/store scope is required", 400);
  return values;
}

function encode(value) { return encodeURIComponent(String(value)); }
function queryScope(scope, includeStore = true) {
  const [tenantId, workspaceId, storeId] = requireScope(scope);
  return `tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${includeStore ? `&store_id=eq.${encode(storeId)}` : ""}`;
}

function createMeooMediaRepository({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!url || !/^https:\/\//i.test(String(url)) || !serviceRoleKey || typeof fetchImpl !== "function") throw new Error("Meoo media repository configuration is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("Meoo media repository timeout is invalid");
  const base = String(url).replace(/\/$/, "");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", "Cache-Control": "no-store" };

  async function request(table, query = "", options = {}) {
    const method = options.method || "GET";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${base}/rest/v1/${table}${query}`, { ...options, signal: controller.signal, headers: { ...headers, ...(options.headers || {}) } });
        const text = await response.text();
        let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        if (response.ok) return body;
        if (method === "GET" && [429, 502, 503].includes(response.status) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt))); continue; }
        const status = response.status >= 500 ? 503 : response.status;
        throw new SupabaseAdapterError(response.status === 404 ? "NOT_FOUND" : "DATABASE_UNAVAILABLE", "database request failed", status);
      } catch (error) {
        if (error instanceof SupabaseAdapterError) throw error;
        if (method === "GET" && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt))); continue; }
        throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "database request failed", 503);
      } finally { clearTimeout(timer); }
    }
    throw new SupabaseAdapterError("DATABASE_UNAVAILABLE", "database request failed", 503);
  }

  async function listAssets(scope) {
    const rows = await request("assets", `?select=id,tenant_id,workspace_id,store_id,object_key,original_name,mime_type,bytes,metadata,created_at&${queryScope(scope)}&order=created_at.desc`);
    return Array.isArray(rows) ? rows : [];
  }
  async function getAsset(scope, assetId) {
    const rows = await request("assets", `?select=id,tenant_id,workspace_id,store_id,object_key,original_name,mime_type,bytes,metadata,created_at&${queryScope(scope)}&id=eq.${encode(assetId)}&limit=1`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }
  async function createAsset(scope, input) {
    const [tenantId, workspaceId, storeId] = requireScope(scope);
    const row = { id: input.id || crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, object_key: input.objectKey, original_name: input.originalName, mime_type: input.mimeType, bytes: input.bytes, metadata: input.metadata || {} };
    const rows = await request("assets", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async function updateAssetMetadata(scope, assetId, metadata) {
    const rows = await request("assets", `?${queryScope(scope)}&id=eq.${encode(assetId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ metadata }) });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }
  async function listFolders(scope) {
    const rows = await request("workspace_media_folders", `?select=id,tenant_id,workspace_id,name,created_at&${queryScope(scope, false)}&order=created_at.asc`);
    return Array.isArray(rows) ? rows : [];
  }
  async function createFolder(scope, input) {
    const [tenantId, workspaceId] = requireScope(scope);
    const rows = await request("workspace_media_folders", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ id: input.id || crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, name: input.name }) });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async function renameFolder(scope, folderId, name) {
    const rows = await request("workspace_media_folders", `?${queryScope(scope, false)}&id=eq.${encode(folderId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name }) });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }
  async function deleteFolder(scope, folderId) {
    const rows = await request("workspace_media_folders", `?${queryScope(scope, false)}&id=eq.${encode(folderId)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }
  async function hasFolder(scope, folderId) {
    const rows = await request("workspace_media_folders", `?select=id&${queryScope(scope, false)}&id=eq.${encode(folderId)}&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  }
  return { listAssets, getAsset, createAsset, updateAssetMetadata, listFolders, createFolder, renameFolder, deleteFolder, hasFolder };
}

module.exports = { createMeooMediaRepository };
