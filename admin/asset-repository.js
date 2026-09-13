const crypto = require("node:crypto");

class AssetRepositoryError extends Error {
  constructor(code, message, status = 503) { super(message); this.name = "AssetRepositoryError"; this.code = code; this.status = status; }
}

function scopeValues(scope) {
  const values = [scope?.tenantId, scope?.workspaceId, scope?.storeId].map(value => String(value || "").trim());
  if (values.slice(0, 2).some(value => !value)) throw new AssetRepositoryError("SCOPE_REQUIRED", "tenant/workspace scope is required", 400);
  return values;
}

function encode(value) { return encodeURIComponent(String(value)); }

function createAssetRepository({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!url || !/^https:\/\//i.test(String(url)) || !serviceRoleKey || typeof fetchImpl !== "function") throw new AssetRepositoryError("DATABASE_CONFIG_REQUIRED", "asset repository configuration is required", 503);
  const base = String(url).replace(/\/$/, "");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", "Cache-Control": "no-store" };

  async function request(table, query = "", options = {}) {
    const method = options.method || "GET";
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/rest/v1/${table}${query}`, { ...options, signal: controller.signal, headers: { ...headers, ...(options.headers || {}) } });
      const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!response.ok) throw new AssetRepositoryError(response.status === 404 ? "NOT_FOUND" : "DATABASE_UNAVAILABLE", "asset repository request failed", response.status >= 500 ? 503 : response.status);
      return body;
    } catch (error) {
      if (error instanceof AssetRepositoryError) throw error;
      throw new AssetRepositoryError("DATABASE_UNAVAILABLE", "asset repository request failed", 503);
    } finally { clearTimeout(timer); }
  }

  async function createPendingAsset(scope, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const row = { id: input.id || crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId || null, object_key: input.objectKey, original_name: input.originalName, mime_type: input.mimeType, bytes: input.bytes, metadata: input.metadata || {}, purpose: input.purpose || null, visibility: "PRIVATE", status: "pending", created_by: scope.userId || null };
    const rows = await request("assets", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function getAssetByIdScoped(scope, assetId) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const store = storeId ? `&store_id=eq.${encode(storeId)}` : "";
    const rows = await request("assets", `?select=*&id=eq.${encode(assetId)}&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${store}&limit=1`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function createAssetObject(scope, input = {}) {
    scopeValues(scope);
    const rows = await request("asset_objects", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ id: input.id || crypto.randomUUID(), asset_id: input.assetId, storage_provider: "meoo", bucket: input.bucket, object_key: input.objectKey, variant: input.variant, mime_type: input.mimeType, size_bytes: input.sizeBytes, checksum: input.checksum, checksum_algorithm: "sha256", original_filename: input.originalFilename || null, width: input.width || null, height: input.height || null }) });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function getAssetObject(scope, assetId, variant = "original") {
    // Resolve the parent asset through the caller scope before reading the
    // provider object; asset_objects intentionally has no tenant columns.
    if (!(await getAssetByIdScoped(scope, assetId))) return null;
    const rows = await request("asset_objects", `?select=*&asset_id=eq.${encode(assetId)}&variant=eq.${encode(variant)}&limit=1`);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function createAssetLink(scope, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const rows = await request("asset_links", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ id: input.id || crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId || null, asset_id: input.assetId, entity_type: input.entityType, entity_id: String(input.entityId), purpose: input.purpose, position: input.position == null ? null : Number(input.position) }) });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function listAssetLinks(scope, assetId) {
    const [tenantId, workspaceId] = scopeValues(scope);
    const rows = await request("asset_links", `?select=*&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}&asset_id=eq.${encode(assetId)}&order=position.asc`);
    return Array.isArray(rows) ? rows : [];
  }

  async function transitionAssetStatus(scope, assetId, status) {
    const [tenantId, workspaceId] = scopeValues(scope);
    const rows = await request("assets", `?id=eq.${encode(assetId)}&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...(status === "deleted" ? { deleted_at: new Date().toISOString() } : {}) }) });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function requestAssetDeletion(scope, assetId) { return transitionAssetStatus(scope, assetId, "deletion_requested"); }
  async function markAssetDeleted(scope, assetId) { return transitionAssetStatus(scope, assetId, "deleted"); }

  async function productInScope(scope, productId) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const query = `?select=document&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${storeId ? `&store_id=eq.${encode(storeId)}` : ""}&limit=1`;
    const rows = await request("workspace_configs", query);
    const products = rows?.[0]?.document?.products;
    return Array.isArray(products) && products.some(product => String(product?.id) === String(productId));
  }

  return { createPendingAsset, getAssetByIdScoped, createAssetObject, getAssetObject, createAssetLink, listAssetLinks, transitionAssetStatus, requestAssetDeletion, markAssetDeleted, productInScope };
}

module.exports = { createAssetRepository, AssetRepositoryError, scopeValues };
