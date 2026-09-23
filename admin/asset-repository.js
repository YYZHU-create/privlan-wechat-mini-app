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

function rpcError(result) {
  const error = new AssetRepositoryError(String(result?.code || "ASSET_LIFECYCLE_FAILED"), "asset lifecycle request failed", 409);
  error.detail = result || null;
  return error;
}

const READ_RETRY_STATUSES = new Set([429, 502, 503]);
const RECONCILIATION = Object.freeze({
  SUCCEEDED: "CONFIRMED_SUCCEEDED",
  NOT_APPLIED: "CONFIRMED_NOT_APPLIED",
  INDETERMINATE: "INDETERMINATE"
});
const DELETE_CLAIM = Object.freeze({
  ACQUIRED: "CAS_ACQUIRED",
  NOT_ACQUIRED: "CAS_NOT_ACQUIRED",
  INDETERMINATE: "CAS_INDETERMINATE"
});

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

function transportError(error, controller) {
  if (error instanceof AssetRepositoryError) return error;
  const timedOut = Boolean(controller?.signal?.aborted) || error?.name === "AbortError";
  const result = new AssetRepositoryError("DATABASE_UNAVAILABLE", "asset repository request failed", 503);
  result.transport = { category: timedOut ? "timeout" : "network", retryable: true };
  return result;
}

function responseError(response) {
  const status = Number(response.status || 0);
  const result = new AssetRepositoryError(status === 404 ? "NOT_FOUND" : "DATABASE_UNAVAILABLE", "asset repository request failed", status >= 500 ? 503 : status);
  result.transport = { category: "http", status, retryable: READ_RETRY_STATUSES.has(status) };
  return result;
}

function isAmbiguousLifecycleError(error) {
  return Boolean(error?.transport?.retryable);
}

function createAssetRepository({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, timeoutMs = 8000, sleep = delay } = {}) {
  if (!url || !/^https:\/\//i.test(String(url)) || !serviceRoleKey || typeof fetchImpl !== "function") throw new AssetRepositoryError("DATABASE_CONFIG_REQUIRED", "asset repository configuration is required", 503);
  const base = String(url).replace(/\/$/, "");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", "Cache-Control": "no-store" };

  async function requestOnce(table, query = "", options = {}) {
    const method = options.method || "GET";
    const { returnResponse, ...fetchOptions } = options;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/rest/v1/${table}${query}`, { ...fetchOptions, signal: controller.signal, headers: { ...headers, ...(fetchOptions.headers || {}) } });
      const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!response.ok) throw responseError(response);
      return returnResponse ? { body, headers: response.headers } : body;
    } catch (error) {
      if (error instanceof AssetRepositoryError) throw error;
      throw transportError(error, controller);
    } finally { clearTimeout(timer); }
  }

  async function request(table, query = "", options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const attempts = method === "GET" ? 3 : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try { return await requestOnce(table, query, options); }
      catch (error) {
        lastError = error;
        if (attempt === attempts || !error?.transport?.retryable) throw error;
        await sleep(attempt * 100);
      }
    }
    throw lastError;
  }

  function contentRangeTotal(headers) {
    const value = typeof headers?.get === "function" ? headers.get("content-range") : headers?.["content-range"];
    const match = String(value || "").match(/\/([0-9]+)$/);
    if (!match) throw new AssetRepositoryError("DATABASE_UNAVAILABLE", "asset repository count response was invalid", 503);
    return Number(match[1]);
  }

  async function requestCount(table, query = "") {
    const separator = query.includes("?") ? "&" : "?";
    const result = await request(table, `${query}${separator}limit=1`, {
      headers: { Prefer: "count=exact", Range: "0-0" },
      returnResponse: true
    });
    return contentRangeTotal(result.headers);
  }

  async function invokeRpc(name, body) {
    const response = await request(`rpc/${name}`, "", { method: "POST", body: JSON.stringify(body) });
    if (!response?.ok) throw rpcError(response);
    return response.data || {};
  }

  async function listLifecycleAuditEvents(scope, assetId, input = {}) {
    const [tenantId, workspaceId] = scopeValues(scope);
    const action = String(input.action || "").trim();
    const requestId = String(input.requestId || "").trim();
    const actionQuery = action ? `&action=eq.${encode(action)}` : "";
    const requestQuery = requestId ? `&request_id=eq.${encode(requestId)}` : "";
    const rows = await request("audit_events", `?select=id,action,resource_id,request_id,metadata&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}&resource_type=eq.asset&resource_id=eq.${encode(assetId)}${actionQuery}${requestQuery}&order=created_at.desc`);
    return Array.isArray(rows) ? rows : [];
  }

  async function reconcileDeleteClaim(scope, assetId) {
    try {
      const asset = await getAssetByIdScoped(scope, assetId);
      if (["deletion_requested", "deleted", "failed"].includes(String(asset?.status || ""))) return { outcome: DELETE_CLAIM.NOT_ACQUIRED, asset };
      return { outcome: DELETE_CLAIM.INDETERMINATE, asset: asset || null };
    } catch {
      return { outcome: DELETE_CLAIM.INDETERMINATE };
    }
  }

  async function reconcileLifecycleOperation(scope, assetId, input = {}) {
    const action = String(input.action || "");
    const requestId = String(input.requestId || "");
    try {
      const [asset, objects, links, audits] = await Promise.all([
        getAssetByIdScoped(scope, assetId),
        listAssetObjects(scope, assetId),
        listAssetLinks(scope, assetId),
        listLifecycleAuditEvents(scope, assetId, { action, requestId })
      ]);
      const audited = audits.length > 0;
      if (action === "asset.deleted") {
        if (asset?.status === "deleted" && asset.deleted_at && links.length === 0 && audited) return { outcome: RECONCILIATION.SUCCEEDED, asset, objects, links, audits };
        if (asset?.status === "deletion_requested" && !audited) return { outcome: RECONCILIATION.NOT_APPLIED, asset, objects, links, audits };
      }
      if (action === "asset.links_reconciled") {
        if (asset?.status === "deleted" && asset.deleted_at && links.length === 0 && audited) return { outcome: RECONCILIATION.SUCCEEDED, asset, objects, links, audits };
        if (asset?.status === "deleted" && asset.deleted_at && links.length > 0 && !audited) return { outcome: RECONCILIATION.NOT_APPLIED, asset, objects, links, audits };
      }
      if (action === "asset.purged") {
        if (!asset && audited) return { outcome: RECONCILIATION.SUCCEEDED, asset: null, objects, links, audits };
        if (asset?.status === "deleted" && asset.deleted_at && !audited) return { outcome: RECONCILIATION.NOT_APPLIED, asset, objects, links, audits };
      }
      return { outcome: RECONCILIATION.INDETERMINATE, asset: asset || null, objects, links, audits };
    } catch {
      return { outcome: RECONCILIATION.INDETERMINATE };
    }
  }

  async function invokeLifecycleRpc(name, action, scope, assetId, body, { retryNotApplied = true } = {}) {
    try { return await invokeRpc(name, body); }
    catch (error) {
      if (!isAmbiguousLifecycleError(error)) throw error;
      const reconciliation = await reconcileLifecycleOperation(scope, assetId, { action, requestId: body.p_request_id });
      if (reconciliation.outcome === RECONCILIATION.SUCCEEDED) return { id: assetId, duplicate: true, reconciliation };
      if (reconciliation.outcome === RECONCILIATION.NOT_APPLIED) {
        if (!retryNotApplied) {
          error.reconciliation = reconciliation;
          throw error;
        }
        try { return { ...(await invokeRpc(name, body)), reconciliation }; }
        catch (retryError) {
          if (!isAmbiguousLifecycleError(retryError)) throw retryError;
          const retryReconciliation = await reconcileLifecycleOperation(scope, assetId, { action, requestId: body.p_request_id });
          if (retryReconciliation.outcome === RECONCILIATION.SUCCEEDED) return { id: assetId, duplicate: true, reconciliation: retryReconciliation };
          retryError.reconciliation = retryReconciliation;
          throw retryError;
        }
      }
      error.reconciliation = reconciliation;
      throw error;
    }
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

  async function listAssetObjects(scope, assetId) {
    if (!(await getAssetByIdScoped(scope, assetId))) return [];
    const rows = await request("asset_objects", `?select=*&asset_id=eq.${encode(assetId)}&order=variant.asc`);
    return Array.isArray(rows) ? rows : [];
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

  async function countDeletedAssets(scope, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const cutoff = String(input.retentionCutoff || "").trim();
    const store = input.allStores === true ? "" : (storeId ? `&store_id=eq.${encode(storeId)}` : "&store_id=is.null");
    const cutoffQuery = cutoff ? `&deleted_at=lte.${encode(cutoff)}` : "";
    const select = input.withLinks === true ? "id,asset_links!inner(id)" : "id";
    const linkQuery = input.withLinks === true
      ? `&asset_links.tenant_id=eq.${encode(tenantId)}&asset_links.workspace_id=eq.${encode(workspaceId)}&asset_links.limit=1`
      : "";
    const query = `?select=${encode(select)}&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${store}&status=eq.deleted&deleted_at=not.is.null${cutoffQuery}${linkQuery}`;
    return requestCount("assets", query);
  }

  async function transitionAssetStatus(scope, assetId, status, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const store = storeId ? `&store_id=eq.${encode(storeId)}` : "&store_id=is.null";
    const expectedStatus = input.expectedStatus ? `&status=eq.${encode(input.expectedStatus)}` : "";
    const rows = await request("assets", `?id=eq.${encode(assetId)}&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${store}${expectedStatus}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...(input.metadata ? { metadata: input.metadata } : {}), ...(status === "deleted" ? { deleted_at: new Date().toISOString() } : {}) }) });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function requestAssetDeletion(scope, assetId, input = {}) {
    try {
      const canaryIdentity = input.canaryIdentity;
      const metadata = canaryIdentity ? {
        ...(input.asset?.metadata && typeof input.asset.metadata === "object" && !Array.isArray(input.asset.metadata) ? input.asset.metadata : {}),
        lifecycleCanaryAuthorization: { policyId: String(canaryIdentity.policyId || ""), attemptId: String(canaryIdentity.attemptId || "") }
      } : undefined;
      const asset = await transitionAssetStatus(scope, assetId, "deletion_requested", { expectedStatus: "ready", metadata });
      if (asset) return { outcome: DELETE_CLAIM.ACQUIRED, asset };
      return reconcileDeleteClaim(scope, assetId);
    }
    catch (error) {
      if (!isAmbiguousLifecycleError(error)) throw error;
      return reconcileDeleteClaim(scope, assetId);
    }
  }
  async function markAssetDeleted(scope, assetId) { return transitionAssetStatus(scope, assetId, "deleted"); }

  function lifecycleContext(scope, assetId, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    return {
      p_tenant_id: tenantId,
      p_workspace_id: workspaceId,
      p_store_id: storeId || null,
      p_actor_type: String(input.actorType || scope.actorType || "merchant"),
      p_actor_id: String(input.actorId || scope.userId || ""),
      p_request_id: String(input.requestId || scope.requestId || ""),
      p_asset_id: String(assetId)
    };
  }

  async function finalizeAssetDeletion(scope, assetId, input = {}) {
    const { retryNotApplied = true, ...rpcInput } = input;
    const body = {
      ...lifecycleContext(scope, assetId, rpcInput),
      p_storage_verified_at: rpcInput.storageVerifiedAt,
      p_object_count: Number(rpcInput.objectCount || 0)
    };
    return invokeLifecycleRpc("atelier_asset_finalize_delete_v1", "asset.deleted", scope, assetId, body, { retryNotApplied });
  }

  async function cleanupDeletedAssetLinks(scope, assetId, input = {}) {
    const body = lifecycleContext(scope, assetId, input);
    return invokeLifecycleRpc("atelier_asset_cleanup_deleted_links_v1", "asset.links_reconciled", scope, assetId, body);
  }

  async function purgeDeletedAsset(scope, assetId, input = {}) {
    const body = {
      ...lifecycleContext(scope, assetId, input),
      p_retention_cutoff: input.retentionCutoff,
      p_storage_verified_at: input.storageVerifiedAt,
      p_object_count: Number(input.objectCount || 0)
    };
    return invokeLifecycleRpc("atelier_asset_purge_v1", "asset.purged", scope, assetId, body);
  }

  async function listDeletedAssets(scope, input = {}) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const cutoff = String(input.retentionCutoff || "").trim();
    const batchSize = Math.max(1, Math.min(100, Number(input.batchSize) || 25));
    const store = input.allStores === true ? "" : (storeId ? `&store_id=eq.${encode(storeId)}` : "&store_id=is.null");
    const cutoffQuery = cutoff ? `&deleted_at=lte.${encode(cutoff)}` : "";
    const rows = await request("assets", `?select=*&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${store}&status=eq.deleted&deleted_at=not.is.null${cutoffQuery}&order=deleted_at.asc&limit=${batchSize}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function productInScope(scope, productId) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const query = `?select=document&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}${storeId ? `&store_id=eq.${encode(storeId)}` : ""}&limit=1`;
    const rows = await request("workspace_configs", query);
    const products = rows?.[0]?.document?.products;
    return Array.isArray(products) && products.some(product => String(product?.id) === String(productId));
  }

  return { createPendingAsset, getAssetByIdScoped, createAssetObject, getAssetObject, listAssetObjects, createAssetLink, listAssetLinks, countDeletedAssets, listLifecycleAuditEvents, reconcileLifecycleOperation, transitionAssetStatus, requestAssetDeletion, markAssetDeleted, finalizeAssetDeletion, cleanupDeletedAssetLinks, purgeDeletedAsset, listDeletedAssets, productInScope };
}

module.exports = { createAssetRepository, AssetRepositoryError, scopeValues, RECONCILIATION, DELETE_CLAIM };
