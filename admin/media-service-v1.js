const crypto = require("node:crypto");
const { decode } = require("./workspace-media");
const { markTrustedPublicMessage } = require("./public-error");

const PURPOSES = new Set(["product_main", "product_gallery", "product_detail", "brand_logo", "workspace_branding", "mini_program_banner", "content_image", "content_video"]);
const VARIANT_SET = new Set(["original", "thumbnail", "web"]);
const PURPOSE_ENTITY = new Set(["product_main", "product_gallery", "product_detail"]);
const ALLOWED_TRANSITIONS = new Map([["pending", new Set(["ready", "failed"])], ["ready", new Set(["deletion_requested"])], ["deletion_requested", new Set(["deleted"])]]);

class MediaServiceError extends Error {
  constructor(status, code, message) { super(message); this.name = "MediaServiceError"; this.status = status; this.code = code; }
}

function canonicalObjectKey(scope, assetId, variant, extension) {
  const tenantId = String(scope?.tenantId || "").trim(); const workspaceId = String(scope?.workspaceId || "").trim();
  if (!tenantId || !workspaceId || !/^[0-9a-f-]{36}$/i.test(String(assetId))) throw new MediaServiceError(400, "SCOPE_OR_ASSET_INVALID", "asset scope is invalid");
  if (!VARIANT_SET.has(variant) || !/^\.[a-z0-9]+$/i.test(extension)) throw new MediaServiceError(400, "OBJECT_KEY_INVALID", "object variant is invalid");
  return `tenant/${tenantId}/workspace/${workspaceId}/asset/${assetId}/${variant}${extension.toLowerCase()}`;
}

function assertAssetTransition(from, to) {
  if (!ALLOWED_TRANSITIONS.get(String(from))?.has(String(to))) throw new MediaServiceError(409, "ASSET_STATUS_TRANSITION_INVALID", "asset status transition is invalid");
}

function createMediaService({ provider, repository, lifecycleMutationsEnabled = false, onEvent = () => {} }) {
  if (!provider || !repository) throw new Error("MediaService provider and repository are required");
  const emit = (event, fields) => { try { onEvent(event, fields); } catch {} };

  function lifecycleFields(scope, assetId, operation, input = {}) {
    return {
      operation,
      assetId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requestId: scope.requestId || null,
      attempt: input.attempt || 1,
      errorClass: input.errorClass || null,
      reconciliationResult: input.reconciliationResult || null
    };
  }

  function storageErrorIsAmbiguous(error) {
    const status = Number(error?.status || 0);
    return error?.name === "AbortError" || /TIMEOUT|NETWORK|UNAVAILABLE/i.test(String(error?.code || "")) || [429, 502, 503].includes(status);
  }

  async function verifyStorageAbsent(scope, assetId, object, operation, attempt) {
    if (typeof provider.verifyDeleted !== "function") throw new MediaServiceError(503, "STORAGE_DELETE_VERIFY_UNAVAILABLE", "storage delete verification is unavailable");
    try {
      const absent = await provider.verifyDeleted(scope, object.object_key);
      if (absent) return true;
      const error = new MediaServiceError(502, "STORAGE_DELETE_VERIFY_FAILED", "storage object remains present");
      error.storagePresent = true;
      throw error;
    } catch (error) {
      emit("lifecycle_reconciliation", lifecycleFields(scope, assetId, operation, { attempt, errorClass: error.code || "STORAGE_VERIFY_FAILED", reconciliationResult: error.storagePresent ? "PRESENT" : "INDETERMINATE" }));
      if (error instanceof MediaServiceError) throw error;
      throw new MediaServiceError(503, "STORAGE_DELETE_INDETERMINATE", "storage deletion could not be verified");
    }
  }

  async function reconcileStorageDelete(scope, assetId, object, attempt) {
    const absent = await verifyStorageAbsent(scope, assetId, object, "storage-delete", attempt);
    emit("lifecycle_reconciliation", lifecycleFields(scope, assetId, "storage-delete", { attempt, reconciliationResult: "CONFIRMED_SUCCEEDED" }));
    return absent;
  }

  function emitRepositoryReconciliation(scope, assetId, operation, result, attempt = 1) {
    const reconciliationResult = result?.reconciliation?.outcome;
    if (reconciliationResult) emit("lifecycle_reconciliation", lifecycleFields(scope, assetId, operation, { attempt, reconciliationResult }));
  }

  async function upload(scope, input = {}) {
    const purpose = String(input.purpose || "content_image"); const variant = String(input.variant || "original");
    if (!PURPOSES.has(purpose) || (purpose === "content_video" && variant !== "original") || !VARIANT_SET.has(variant)) throw new MediaServiceError(400, "MEDIA_PURPOSE_INVALID", "media purpose or variant is invalid");
    const decoded = decode(input.name, input.data); const assetId = crypto.randomUUID(); const objectKey = canonicalObjectKey(scope, assetId, variant, decoded.extension);
    emit("asset_create_started", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "upload" });
    await repository.createPendingAsset(scope, { id: assetId, objectKey, originalName: String(input.name || "").slice(0, 160), mimeType: decoded.mime, bytes: decoded.buffer.length, purpose, metadata: { kind: decoded.kind, dimensions: decoded.dimensions || null } });
    let stored = false;
    try {
      const uploaded = await provider.uploadObject(scope, objectKey, decoded.buffer, decoded.mime); stored = true; emit("storage_upload_succeeded", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "upload" });
      const verified = await provider.verifyObject(scope, objectKey, { sizeBytes: decoded.buffer.length, checksum: uploaded.checksum, mimeType: decoded.mime });
      emit("storage_verify_succeeded", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "verify" });
      await repository.createAssetObject(scope, { assetId, bucket: provider.bucket, objectKey, variant, mimeType: decoded.mime, sizeBytes: verified.sizeBytes, checksum: verified.checksum, originalFilename: String(input.name || "").slice(0, 160), width: decoded.dimensions?.width, height: decoded.dimensions?.height });
      emit("asset_object_registered", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "register" });
      if (input.entityId != null) {
        if (!PURPOSE_ENTITY.has(purpose) || !(await repository.productInScope(scope, input.entityId))) throw new MediaServiceError(403, "PRODUCT_SCOPE_DENIED", "product is outside the workspace scope");
        await repository.createAssetLink(scope, { assetId, entityType: "workspace_config_product", entityId: String(input.entityId), purpose, position: input.position == null ? null : Number(input.position) });
        emit("asset_link_created", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "link" });
      }
      assertAssetTransition("pending", "ready"); const ready = await repository.transitionAssetStatus(scope, assetId, "ready"); emit("asset_ready", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "upload" });
      return { id: assetId, status: ready?.status || "ready", purpose, variant, mimeType: decoded.mime, bytes: verified.sizeBytes, path: `/api/media/v1/content/${assetId}` };
    } catch (error) {
      emit(stored ? "storage_verify_failed" : "storage_upload_failed", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "upload" });
      try { if (stored) await provider.deleteObject(scope, objectKey); } catch { emit("orphan_object_detected", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "cleanup" }); }
      try { assertAssetTransition("pending", "failed"); await repository.transitionAssetStatus(scope, assetId, "failed"); } catch {}
      if (error instanceof MediaServiceError) throw error;
      throw new MediaServiceError(503, "MEDIA_UPLOAD_FAILED", "media upload failed");
    }
  }

  async function read(scope, assetId) {
    const asset = await repository.getAssetByIdScoped(scope, assetId);
    if (!asset || !["ready"].includes(String(asset.status || "")) || asset.deleted_at) throw new MediaServiceError(404, "ASSET_NOT_FOUND", "asset is not available");
    const object = await repository.getAssetObject(scope, asset.id, "original"); if (!object) throw new MediaServiceError(404, "ASSET_OBJECT_NOT_FOUND", "asset object is not available");
    const result = await provider.readObject(scope, object.object_key); return { bytes: result.bytes, mimeType: object.mime_type || result.mimeType, sizeBytes: result.sizeBytes };
  }

  async function remove(scope, assetId) {
    if (lifecycleMutationsEnabled !== true) {
      throw markTrustedPublicMessage(new MediaServiceError(409, "ASSET_LIFECYCLE_MUTATION_DISABLED", "资产生命周期删除当前不可用"), "资产生命周期删除当前不可用");
    }
    const asset = await repository.getAssetByIdScoped(scope, assetId); if (!asset) throw new MediaServiceError(404, "ASSET_NOT_FOUND", "asset is not available");
    if (asset.status === "deleted" && asset.deleted_at) return { id: asset.id, deleted: true, duplicate: true };
    if (asset.status === "ready") {
      assertAssetTransition("ready", "deletion_requested");
      try {
        const claim = await repository.requestAssetDeletion(scope, asset.id);
        emitRepositoryReconciliation(scope, asset.id, "deletion-transition", claim);
        if (claim?.outcome === "CAS_ACQUIRED") {
          // This request alone may continue to the irreversible Storage operation.
        } else if (claim?.asset?.status === "deleted" && claim.asset.deleted_at) {
          return { id: asset.id, deleted: true, duplicate: true };
        } else if (claim?.outcome === "CAS_NOT_ACQUIRED") {
          throw new MediaServiceError(409, "ASSET_DELETION_IN_PROGRESS", "asset deletion is already in progress");
        } else {
          throw new MediaServiceError(503, "ASSET_DELETE_CLAIM_INDETERMINATE", "asset deletion ownership could not be confirmed");
        }
      } catch (error) {
        emit("lifecycle_reconciliation", lifecycleFields(scope, asset.id, "deletion-transition", { errorClass: error.code || "DATABASE_UNAVAILABLE", reconciliationResult: error.reconciliation?.outcome || "INDETERMINATE" }));
        throw error;
      }
    } else if (asset.status === "deletion_requested") {
      throw new MediaServiceError(409, "ASSET_DELETION_IN_PROGRESS", "asset deletion ownership could not be confirmed");
    } else {
      throw new MediaServiceError(409, "ASSET_STATUS_TRANSITION_INVALID", "asset status transition is invalid");
    }
    const objects = typeof repository.listAssetObjects === "function"
      ? await repository.listAssetObjects(scope, asset.id)
      : [await repository.getAssetObject(scope, asset.id, "original")].filter(Boolean);
    if (!objects.length) throw new MediaServiceError(409, "ASSET_OBJECT_NOT_FOUND", "asset object is not available");
    for (const object of objects) {
      emit("storage_delete_requested", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete" });
      try { await provider.deleteObject(scope, object.object_key); }
      catch (error) {
        emit("storage_delete_failed", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete" });
        if (storageErrorIsAmbiguous(error)) {
          await reconcileStorageDelete(scope, asset.id, object, 1);
          continue;
        }
        throw error;
      }
      try { await reconcileStorageDelete(scope, asset.id, object, 1); }
      catch (error) {
        emit("storage_delete_failed", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "verify-delete" });
        throw error;
      }
    }
    const storageVerifiedAt = new Date().toISOString();
    let finalized;
    try {
      finalized = typeof repository.finalizeAssetDeletion === "function"
        ? await repository.finalizeAssetDeletion(scope, asset.id, { storageVerifiedAt, objectCount: objects.length })
        : (assertAssetTransition("deletion_requested", "deleted"), await repository.markAssetDeleted(scope, asset.id));
      emitRepositoryReconciliation(scope, asset.id, "finalize", finalized);
    } catch (error) {
      emit("lifecycle_reconciliation", lifecycleFields(scope, asset.id, "finalize", { errorClass: error.code || "DATABASE_UNAVAILABLE", reconciliationResult: error.reconciliation?.outcome || "INDETERMINATE" }));
      throw error;
    }
    emit("asset_deleted", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete" });
    return { id: asset.id, deleted: true, duplicate: Boolean(finalized?.duplicate) };
  }
  return { upload, read, remove, canonicalObjectKey };
}

module.exports = { createMediaService, canonicalObjectKey, assertAssetTransition, MediaServiceError, PURPOSES, VARIANT_SET };
