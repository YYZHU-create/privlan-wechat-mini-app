const crypto = require("node:crypto");
const { decode } = require("./workspace-media");
const { markTrustedPublicMessage } = require("./public-error");
const { CANARY_MARKER, CANARY_OPERATION, fingerprintCanaryId, canaryIdentityMatches, canaryRecoveryIdentityMatches, canaryRecoveryAssetMatches, permitLifecycleMutation } = require("./asset-lifecycle-permit");

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

function createMediaService({ provider, repository, lifecycleMutationsEnabled = false, lifecycleCanaryConfig = { enabled: false }, runtimeEnvironment = "", runtimeProjectId = "", onEvent = () => {} }) {
  if (!provider || !repository) throw new Error("MediaService provider and repository are required");
  const emit = (event, fields) => { try { onEvent(event, fields); } catch {} };

  function canaryIdentityFields() {
    const policyFingerprint = fingerprintCanaryId(lifecycleCanaryConfig.policyId);
    const attemptFingerprint = fingerprintCanaryId(lifecycleCanaryConfig.attemptId);
    return policyFingerprint && attemptFingerprint ? { policyFingerprint, attemptFingerprint } : {};
  }

  function lifecycleFields(scope, assetId, operation, input = {}) {
    return {
      operation,
      assetId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requestId: scope.requestId || null,
      attempt: input.attempt || 1,
      ...canaryIdentityFields(),
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
    if (input.syntheticCanary === true && (purpose !== "content_image" || variant !== "original" || input.entityId != null)) throw new MediaServiceError(400, "SYNTHETIC_CANARY_ASSET_INVALID", "synthetic lifecycle fixture shape is invalid");
    const decoded = decode(input.name, input.data); const assetId = crypto.randomUUID(); const objectKey = canonicalObjectKey(scope, assetId, variant, decoded.extension);
    emit("asset_create_started", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "upload" });
    await repository.createPendingAsset(scope, { id: assetId, objectKey, originalName: String(input.name || "").slice(0, 160), mimeType: decoded.mime, bytes: decoded.buffer.length, purpose, metadata: { kind: decoded.kind, dimensions: decoded.dimensions || null, ...(input.syntheticCanary === true ? { lifecycleCanary: CANARY_MARKER } : {}) } });
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

  async function remove(scope, assetId, identity = {}) {
    const canaryIdentityMatched = lifecycleMutationsEnabled !== true && canaryIdentityMatches(lifecycleCanaryConfig, {
      environment: runtimeEnvironment,
      projectId: runtimeProjectId,
      scope,
      assetId,
      operation: identity.operation,
      policyId: identity.policyId,
      attemptId: identity.attemptId
    });
    if (lifecycleMutationsEnabled !== true && !canaryIdentityMatched) {
      throw markTrustedPublicMessage(new MediaServiceError(409, "ASSET_LIFECYCLE_MUTATION_DISABLED", "资产生命周期删除当前不可用"), "资产生命周期删除当前不可用");
    }
    const asset = await repository.getAssetByIdScoped(scope, assetId); if (!asset) throw new MediaServiceError(404, "ASSET_NOT_FOUND", "asset is not available");
    let canaryObjects = null;
    if (canaryIdentityMatched) {
      const objects = typeof repository.listAssetObjects === "function" ? await repository.listAssetObjects(scope, asset.id) : [];
      const links = typeof repository.listAssetLinks === "function" ? await repository.listAssetLinks(scope, asset.id) : null;
      if (permitLifecycleMutation({
        normalGlobalGateEnabled: false,
        canaryConfig: lifecycleCanaryConfig,
        environment: runtimeEnvironment,
        projectId: runtimeProjectId,
        scope,
        assetId,
        operation: identity.operation,
        policyId: identity.policyId,
        attemptId: identity.attemptId,
        asset,
        objects,
        links
      }) !== "canary") {
        throw new MediaServiceError(409, "ASSET_LIFECYCLE_CANARY_SCOPE_DENIED", "canary asset preconditions do not match");
      }
      canaryObjects = objects;
    }
    if (asset.status === "deleted" && asset.deleted_at) return { id: asset.id, deleted: true, duplicate: true };
    if (asset.status === "ready") {
      assertAssetTransition("ready", "deletion_requested");
      try {
        const claim = await repository.requestAssetDeletion(scope, asset.id, canaryIdentityMatched ? {
          asset,
          canaryIdentity: { policyId: lifecycleCanaryConfig.policyId, attemptId: lifecycleCanaryConfig.attemptId }
        } : {});
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
    const objects = canaryObjects || (typeof repository.listAssetObjects === "function"
      ? await repository.listAssetObjects(scope, asset.id)
      : [await repository.getAssetObject(scope, asset.id, "original")].filter(Boolean));
    if (!objects.length) throw new MediaServiceError(409, "ASSET_OBJECT_NOT_FOUND", "asset object is not available");
    for (const object of objects) {
      emit("storage_delete_requested", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete", ...canaryIdentityFields() });
      try { await provider.deleteObject(scope, object.object_key); }
      catch (error) {
        emit("storage_delete_failed", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete", ...canaryIdentityFields() });
        if (storageErrorIsAmbiguous(error)) {
          await reconcileStorageDelete(scope, asset.id, object, 1);
          continue;
        }
        throw error;
      }
      try { await reconcileStorageDelete(scope, asset.id, object, 1); }
      catch (error) {
        emit("storage_delete_failed", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "verify-delete", ...canaryIdentityFields() });
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
    emit("asset_deleted", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete", ...canaryIdentityFields() });
    return { id: asset.id, deleted: true, duplicate: Boolean(finalized?.duplicate) };
  }

  async function recoverDeletion(scope, assetId, identity = {}) {
    if (!canaryRecoveryIdentityMatches(lifecycleCanaryConfig, {
      environment: runtimeEnvironment,
      projectId: runtimeProjectId,
      scope,
      assetId,
      operation: identity.operation,
      policyId: identity.policyId,
      attemptId: identity.attemptId,
      normalGlobalGateEnabled: lifecycleMutationsEnabled === true
    })) {
      throw new MediaServiceError(409, "ASSET_LIFECYCLE_RECOVERY_SCOPE_DENIED", "canary recovery target is not authorized");
    }

    const asset = await repository.getAssetByIdScoped(scope, assetId);
    if (!asset) throw new MediaServiceError(404, "ASSET_NOT_FOUND", "asset is not available");
    const objects = typeof repository.listAssetObjects === "function" ? await repository.listAssetObjects(scope, asset.id) : [];
    const links = typeof repository.listAssetLinks === "function" ? await repository.listAssetLinks(scope, asset.id) : null;
    if (!canaryRecoveryAssetMatches(lifecycleCanaryConfig, { asset, objects, links })) {
      throw new MediaServiceError(409, "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED", "canary recovery preconditions do not match");
    }
    const object = objects[0];
    if (typeof provider.verifyDeleted !== "function") throw new MediaServiceError(503, "STORAGE_DELETE_VERIFY_UNAVAILABLE", "storage delete verification is unavailable");

    let storageAbsent;
    try { storageAbsent = await provider.verifyDeleted(scope, object.object_key); }
    catch { throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_STORAGE_INDETERMINATE", "canary object state could not be verified"); }

    if (asset.status === "ready") {
      if (storageAbsent) throw new MediaServiceError(409, "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED", "ready canary object is unexpectedly absent");
      return { id: asset.id, state: "CONSISTENT_PRE_DELETE", duplicate: true };
    }

    if (asset.status === "deleted") {
      const audits = typeof repository.listLifecycleAuditEvents === "function"
        ? await repository.listLifecycleAuditEvents(scope, asset.id, { action: "asset.deleted" })
        : null;
      if (!storageAbsent || !Array.isArray(audits) || audits.length < 1) {
        throw new MediaServiceError(409, "ASSET_LIFECYCLE_RECOVERY_STATE_DENIED", "completed canary does not have terminal evidence");
      }
      return { id: asset.id, state: "CONSISTENT_DELETED", deleted: true, duplicate: true };
    }

    if (!storageAbsent) {
      emit("storage_delete_requested", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete-recovery", ...canaryIdentityFields() });
      try { await provider.deleteObject(scope, object.object_key); }
      catch (error) {
        emit("storage_delete_failed", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete-recovery", ...canaryIdentityFields() });
        if (!storageErrorIsAmbiguous(error)) throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_STORAGE_DELETE_FAILED", "canary object deletion failed");
        try { storageAbsent = await provider.verifyDeleted(scope, object.object_key); }
        catch { throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_STORAGE_INDETERMINATE", "canary object state could not be verified"); }
        if (!storageAbsent) throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_STORAGE_STILL_PRESENT", "canary object remains present after delete attempt");
      }
      if (!storageAbsent) {
        try { storageAbsent = await provider.verifyDeleted(scope, object.object_key); }
        catch { throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_STORAGE_INDETERMINATE", "canary object state could not be verified"); }
      }
      if (!storageAbsent) throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_STORAGE_STILL_PRESENT", "canary object remains present after delete attempt");
    }

    const storageVerifiedAt = new Date().toISOString();
    let finalized;
    let finalizeError = null;
    try {
      finalized = await repository.finalizeAssetDeletion(scope, asset.id, {
        storageVerifiedAt,
        objectCount: objects.length,
        retryNotApplied: false
      });
      emitRepositoryReconciliation(scope, asset.id, "finalize-recovery", finalized);
    } catch (error) {
      emit("lifecycle_reconciliation", lifecycleFields(scope, asset.id, "finalize-recovery", { errorClass: error.code || "DATABASE_UNAVAILABLE", reconciliationResult: error.reconciliation?.outcome || "INDETERMINATE" }));
      finalizeError = error;
    }
    let terminalAsset;
    let terminalObjects;
    let terminalLinks;
    let terminalAudits;
    let terminalStorageAbsent = false;
    try {
      [terminalAsset, terminalObjects, terminalLinks, terminalAudits, terminalStorageAbsent] = await Promise.all([
        repository.getAssetByIdScoped(scope, asset.id),
        repository.listAssetObjects(scope, asset.id),
        repository.listAssetLinks(scope, asset.id),
        repository.listLifecycleAuditEvents(scope, asset.id, { action: "asset.deleted" }),
        provider.verifyDeleted(scope, object.object_key)
      ]);
    } catch {
      if (finalizeError) throw finalizeError;
      throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_FINALIZE_UNCONFIRMED", "canary deletion completion could not be verified");
    }
    const terminal = terminalStorageAbsent
      && Array.isArray(terminalAudits) && terminalAudits.length > 0
      && canaryRecoveryAssetMatches(lifecycleCanaryConfig, { asset: terminalAsset, objects: terminalObjects, links: terminalLinks })
      && terminalAsset.status === "deleted" && Boolean(terminalAsset.deleted_at);
    if (!terminal) {
      if (finalizeError) throw finalizeError;
      throw new MediaServiceError(503, "ASSET_LIFECYCLE_RECOVERY_FINALIZE_UNCONFIRMED", "canary deletion completion could not be verified");
    }
    emit("asset_deleted", { requestId: scope.requestId || null, assetId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "delete-recovery", ...canaryIdentityFields() });
    return { id: asset.id, state: "CONSISTENT_DELETED", deleted: true, duplicate: Boolean(finalizeError || finalized?.duplicate) };
  }

  return { upload, read, remove, recoverDeletion, canonicalObjectKey };
}

module.exports = { createMediaService, canonicalObjectKey, assertAssetTransition, MediaServiceError, PURPOSES, VARIANT_SET };
