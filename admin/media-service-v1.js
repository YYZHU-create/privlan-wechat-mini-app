const crypto = require("node:crypto");
const { decode } = require("./workspace-media");
const { markTrustedPublicMessage } = require("./public-error");
const { CANARY_MARKER, CANARY_OPERATION, fingerprintCanaryId, canaryIdentityMatches, canaryRecoveryIdentityMatches, canaryRecoveryAssetMatches, permitLifecycleMutation } = require("./asset-lifecycle-permit");

const PURPOSES = new Set(["product_main", "product_gallery", "product_detail", "brand_logo", "workspace_branding", "mini_program_banner", "content_image", "content_video"]);
const VARIANT_SET = new Set(["original", "thumbnail", "web"]);
const PURPOSE_ENTITY = new Set(["product_main", "product_gallery", "product_detail"]);
const ALLOWED_TRANSITIONS = new Map([["pending", new Set(["ready", "failed"])], ["ready", new Set(["deletion_requested"])], ["deletion_requested", new Set(["deleted"])]]);
const UPLOAD_OPERATION = "POST /api/media/v1/upload";
const UPLOAD_LEASE_MS = 120_000;
const UPLOAD_HEARTBEAT_MS = 20_000;
const UPLOAD_RECOVERY_LIMIT = 20;

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

function assetConfirmDiagnosticReason(error) {
  if (error?.code === "MEDIA_UPLOAD_ASSET_CREATE_INDETERMINATE") return "ASSET_CONFIRM_REREAD_NOT_FOUND";
  if (error?.code === "MEDIA_UPLOAD_ASSET_BINDING_MISMATCH") return "ASSET_CONFIRM_BINDING_MISMATCH";
  if (["AssetRepositoryError", "DatabaseError", "PostgrestError"].includes(String(error?.name || ""))) return "ASSET_CONFIRM_REREAD_ERROR";
  return "ASSET_CONFIRM_OTHER_ERROR";
}

function createMediaService({ provider, repository, lifecycleMutationsEnabled = false, lifecycleCanaryConfig = { enabled: false }, runtimeEnvironment = "", runtimeProjectId = "", onEvent = () => {} }) {
  if (!provider || !repository) throw new Error("MediaService provider and repository are required");
  const emit = (event, fields) => { try { onEvent(event, fields); } catch {} };
  async function uploadBoundary(progress, { operation, phase }, action) {
    if (!progress) return action();
    progress.currentOperation = operation;
    try {
      const result = await action();
      if (phase) progress.lastCompletedPhase = phase;
      progress.currentOperation = null;
      return result;
    } catch (error) {
      if (!progress.failedOperation) {
        progress.failedOperation = progress.currentOperation || operation;
        progress.lastFailedCompletedPhase = progress.lastCompletedPhase || null;
        progress.failureError = error;
        if (progress.failedOperation === "ASSET_CONFIRM") progress.assetConfirmReason = assetConfirmDiagnosticReason(error);
      }
      throw error;
    }
  }

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

  function stableRequestFingerprint({ checksum, byteLength, mimeType, originalName, purpose, variant, entityId, position, folderId, syntheticCanary }) {
    const stable = { operation: UPLOAD_OPERATION, contentSha256: checksum, contentLength: byteLength, contentType: mimeType, originalName, purpose, variant, entityId: entityId == null ? null : String(entityId), position: position == null ? null : Number(position), folderId: String(folderId || ""), syntheticCanary: syntheticCanary === true };
    return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
  }

  function attemptMetadata(attempt) {
    return {
      ...(attempt.asset_metadata && typeof attempt.asset_metadata === "object" ? attempt.asset_metadata : {}),
      uploadAttemptId: attempt.attempt_id,
      requestFingerprint: attempt.request_fingerprint,
      contentSha256: attempt.content_sha256,
      contentLength: Number(attempt.content_length),
      contentType: attempt.content_type,
      uploadState: "pending",
      uploadPhase: attempt.phase,
      ...(attempt.synthetic_canary ? { lifecycleCanary: CANARY_MARKER } : {})
    };
  }

  function assertAttemptBoundToScope(scope, attempt) {
    const assetId = String(attempt?.asset_id || ""); const variant = String(attempt?.variant || "");
    const match = String(attempt?.expected_object_key || "").match(/\.([a-z0-9]+)$/i);
    if (!attempt || attempt.operation !== UPLOAD_OPERATION || String(attempt.tenant_id) !== String(scope.tenantId) || String(attempt.workspace_id) !== String(scope.workspaceId) || String(attempt.store_id || "") !== String(scope.storeId || "") || String(attempt.owner_user_id) !== String(scope.userId) || !match || canonicalObjectKey(scope, assetId, variant, `.${match[1]}`) !== attempt.expected_object_key) {
      throw new MediaServiceError(409, "MEDIA_UPLOAD_ATTEMPT_SCOPE_MISMATCH", "upload attempt scope does not match");
    }
  }

  function startAttemptHeartbeat(scope, attempt, leaseToken) {
    let failure = null; let stopped = false; let running = false;
    const timer = setInterval(async () => {
      if (stopped || running) return;
      running = true;
      try {
        const renewed = await repository.renewUploadAttemptLease(scope, attempt.attempt_id, leaseToken, new Date(Date.now() + UPLOAD_LEASE_MS).toISOString());
        if (!renewed) failure = new MediaServiceError(409, "MEDIA_UPLOAD_LEASE_LOST", "upload attempt lease was lost");
      } catch (error) { failure = error; }
      finally { running = false; }
    }, UPLOAD_HEARTBEAT_MS);
    timer.unref?.();
    return { stop() { stopped = true; clearInterval(timer); }, assert() { if (failure) throw new MediaServiceError(503, "MEDIA_UPLOAD_LEASE_INDETERMINATE", "upload attempt ownership could not be confirmed"); } };
  }

  async function writeAttemptPhase(scope, attempt, leaseToken, nextPhase, extra = {}, progress = null) {
    const fromPhase = String(attempt.phase);
    const patch = { phase: nextPhase, ...extra };
    return uploadBoundary(progress, {
      operation: nextPhase === "DB_ASSET_CREATED" ? "JOURNAL_DB_ASSET_CREATED_WRITE" : "JOURNAL_PHASE_TRANSITION",
      phase: nextPhase,
    }, async () => {
      const updated = await repository.transitionUploadAttempt(scope, attempt.attempt_id, leaseToken, fromPhase, patch, operation => {
        if (progress) progress.currentOperation = operation;
      });
      if (!updated) {
        if (progress && nextPhase === "DB_ASSET_CREATED" && !progress.failedOperation) {
          progress.failedOperation = "JOURNAL_DB_ASSET_CREATED_VERIFY";
          progress.lastFailedCompletedPhase = progress.lastCompletedPhase || null;
        }
        throw new MediaServiceError(409, "MEDIA_UPLOAD_LEASE_LOST", "upload attempt ownership changed");
      }
      Object.assign(attempt, updated);
      return attempt;
    });
  }

  async function verifyAttemptObject(scope, attempt) {
    const expected = { sizeBytes: Number(attempt.content_length), checksum: String(attempt.content_sha256), mimeType: String(attempt.content_type) };
    try {
      const result = await provider.verifyObject(scope, attempt.expected_object_key, expected);
      return { state: "valid", result };
    } catch (verifyError) {
      try {
        await provider.readObject(scope, attempt.expected_object_key);
        return { state: "mismatch", error: verifyError };
      } catch (readError) {
        if (Number(readError?.status) === 404 || readError?.code === "STORAGE_OBJECT_NOT_FOUND") return { state: "absent" };
        throw new MediaServiceError(503, "MEDIA_UPLOAD_STORAGE_STATE_UNKNOWN", "upload object state could not be verified");
      }
    }
  }

  async function verifyAttemptObjectForUpload(scope, attempt, progress, operation) {
    const result = await uploadBoundary(progress, {
      operation,
    }, () => verifyAttemptObject(scope, attempt));
    return result;
  }

  async function exactAsset(scope, attempt) {
    const asset = await repository.getAssetByIdScoped(scope, attempt.asset_id);
    if (!asset) return null;
    if (String(asset.id) !== String(attempt.asset_id) || String(asset.tenant_id) !== String(attempt.tenant_id) || String(asset.workspace_id) !== String(attempt.workspace_id) || String(asset.store_id || "") !== String(attempt.store_id || "") || String(asset.object_key) !== String(attempt.expected_object_key) || String(asset.metadata?.uploadAttemptId || "") !== String(attempt.attempt_id)) {
      throw new MediaServiceError(409, "MEDIA_UPLOAD_ASSET_BINDING_MISMATCH", "upload asset binding does not match its attempt");
    }
    return asset;
  }

  async function persistAttemptAsset(scope, attempt, progress = null) {
    const metadata = attemptMetadata(attempt);
    const asset = { id: attempt.asset_id, objectKey: attempt.expected_object_key, originalName: attempt.original_name, mimeType: attempt.content_type, bytes: Number(attempt.content_length), purpose: attempt.purpose, metadata };
    try {
      await uploadBoundary(progress, {
        operation: "ASSET_CREATE",
        phase: "ASSET_CREATED",
      }, () => repository.createPendingAsset(scope, asset));
    }
    catch (error) {
      const existing = await exactAsset(scope, attempt).catch(() => null);
      if (!existing && !error?.transport?.retryable && Number(error?.status) !== 409) throw error;
      if (!existing) throw new MediaServiceError(503, "MEDIA_UPLOAD_ASSET_CREATE_INDETERMINATE", "upload asset creation could not be reconciled");
    }
    const confirmed = await uploadBoundary(progress, {
      operation: "ASSET_CONFIRM",
      phase: "ASSET_CREATED",
    }, async () => {
      const asset = await exactAsset(scope, attempt);
      if (!asset) throw new MediaServiceError(503, "MEDIA_UPLOAD_ASSET_CREATE_INDETERMINATE", "upload asset creation could not be confirmed");
      return asset;
    });
    return confirmed;
  }

  async function resultForAttempt(attempt, extra = {}) {
    return attempt.result && typeof attempt.result === "object"
      ? { ...attempt.result, uploadAttemptId: attempt.attempt_id, duplicate: true, ...extra }
      : { id: attempt.asset_id, uploadAttemptId: attempt.attempt_id, status: "ready", purpose: attempt.purpose, variant: attempt.variant, mimeType: attempt.content_type, bytes: Number(attempt.content_length), path: `/api/media/v1/content/${attempt.asset_id}`, ...extra };
  }

  async function cleanAttempt(scope, attempt, leaseToken, progress = null) {
    assertAttemptBoundToScope(scope, attempt);
    if (attempt.phase !== "CLEANUP_REQUIRED") await writeAttemptPhase(scope, attempt, leaseToken, "CLEANUP_REQUIRED", { terminal_state: null }, progress);
    const asset = await uploadBoundary(progress, {
      operation: "COMPENSATION_ASSET_REVALIDATION",
    }, () => exactAsset(scope, attempt));
    if (asset?.status === "ready") throw new MediaServiceError(409, "MEDIA_UPLOAD_READY_NOT_CLEANABLE", "ready upload cannot be cleaned");
    if (asset && !["pending", "failed"].includes(String(asset.status))) throw new MediaServiceError(409, "MEDIA_UPLOAD_CLEANUP_STATE_INVALID", "upload cleanup state is not eligible");
    const observed = progress
      ? await verifyAttemptObjectForUpload(scope, attempt, progress, "COMPENSATION_STORAGE_VERIFY")
      : await verifyAttemptObject(scope, attempt);
    if (observed.state !== "absent") {
      try {
        await uploadBoundary(progress, {
          operation: "COMPENSATION_STORAGE_DELETE",
        }, () => provider.deleteObject(scope, attempt.expected_object_key));
      }
      catch (error) { if (!storageErrorIsAmbiguous(error)) throw error; }
      await uploadBoundary(progress, {
        operation: "COMPENSATION_STORAGE_DELETE_VERIFY",
      }, () => verifyStorageAbsent(scope, attempt.asset_id, { object_key: attempt.expected_object_key }, "upload-compensation", 1));
    }
    if (asset) await uploadBoundary(progress, {
      operation: "COMPENSATION_ASSET_METADATA_DELETE",
    }, () => repository.deleteUploadAttempt(scope, attempt.asset_id, { objectKey: attempt.expected_object_key, uploadAttemptId: attempt.attempt_id, variant: attempt.variant }));
    const remaining = await uploadBoundary(progress, {
      operation: "COMPENSATION_ASSET_METADATA_VERIFY",
    }, () => repository.getAssetByIdScoped(scope, attempt.asset_id));
    if (remaining) throw new MediaServiceError(503, "MEDIA_UPLOAD_CLEANUP_INDETERMINATE", "upload cleanup could not be confirmed");
    const result = { terminalState: "CONSISTENT_CLEANED", status: "cleaned", id: attempt.asset_id, uploadAttemptId: attempt.attempt_id };
    await writeAttemptPhase(scope, attempt, leaseToken, "CLEANED", { terminal_state: "CONSISTENT_CLEANED", last_error_class: attempt.last_error_class || null, result }, progress);
    return result;
  }


  async function completeAttempt(scope, attempt, leaseToken, inputBytes = null, progress = null) {
    assertAttemptBoundToScope(scope, attempt);
    const cleanupWithOutcome = async error => {
      const outcome = await cleanAttempt(scope, attempt, leaseToken, progress);
      if (inputBytes) throw error;
      return outcome;
    };
    let asset = await uploadBoundary(progress, {
      operation: "ASSET_REVALIDATION",
      phase: attempt.phase,
    }, () => exactAsset(scope, attempt));
    if (!asset) {
      if (!inputBytes) return cleanAttempt(scope, attempt, leaseToken, progress);
      await persistAttemptAsset(scope, attempt, progress);
      asset = await uploadBoundary(progress, {
        operation: "ASSET_REVALIDATION",
        phase: "ASSET_CREATED",
      }, () => exactAsset(scope, attempt));
    }
    const wasAlreadyReady = asset.status === "ready";
    if (asset.status === "ready" && attempt.phase === "READY_COMMITTED") return resultForAttempt(attempt);
    if (asset.status !== "pending" && asset.status !== "ready") return cleanupWithOutcome(new MediaServiceError(409, "MEDIA_UPLOAD_ASSET_STATE_INVALID", "upload asset state is not recoverable"));
    if (attempt.phase === "ATTEMPT_CREATED") await writeAttemptPhase(scope, attempt, leaseToken, "DB_ASSET_CREATED", {}, progress);

    let storage = await verifyAttemptObjectForUpload(scope, attempt, progress, "STORAGE_EXISTS_CHECK");
    if (storage.state === "mismatch") return cleanupWithOutcome(new MediaServiceError(409, "MEDIA_UPLOAD_OBJECT_MISMATCH", "stored upload content does not match the attempt"));
    if (storage.state === "absent") {
      if (!inputBytes) return cleanAttempt(scope, attempt, leaseToken, progress);
      const digest = crypto.createHash("sha256").update(inputBytes).digest("hex");
      if (digest !== String(attempt.content_sha256) || inputBytes.length !== Number(attempt.content_length)) throw new MediaServiceError(409, "MEDIA_UPLOAD_RETRY_FINGERPRINT_MISMATCH", "retry payload does not match the durable attempt");
      try {
        await uploadBoundary(progress, {
          operation: "STORAGE_PUT",
          phase: attempt.phase,
        }, () => provider.uploadObject(scope, attempt.expected_object_key, inputBytes, attempt.content_type));
      }
      catch (uploadError) {
        storage = await verifyAttemptObjectForUpload(scope, attempt, progress, "STORAGE_VERIFY_AFTER_PUT_ERROR");
        if (storage.state !== "valid") {
          if (storage.state === "absent" && !storageErrorIsAmbiguous(uploadError)) return cleanupWithOutcome(new MediaServiceError(503, "MEDIA_UPLOAD_FAILED", "media upload failed"));
          throw new MediaServiceError(503, "MEDIA_UPLOAD_STORAGE_STATE_UNKNOWN", "upload object state could not be verified");
        }
      }
      storage = await verifyAttemptObjectForUpload(scope, attempt, progress, "STORAGE_VERIFY_AFTER_PUT");
      if (storage.state !== "valid") return cleanupWithOutcome(new MediaServiceError(503, "MEDIA_UPLOAD_FAILED", "media upload failed"));
    }
    if (attempt.phase === "DB_ASSET_CREATED") await writeAttemptPhase(scope, attempt, leaseToken, "STORAGE_OBJECT_PRESENT", {}, progress);

    let objects = await uploadBoundary(progress, {
      operation: "ASSET_OBJECT_LOOKUP",
      phase: attempt.phase,
    }, () => repository.listAssetObjects(scope, attempt.asset_id));
    const objectMatches = object => String(object.object_key) === String(attempt.expected_object_key) && String(object.variant) === String(attempt.variant) && String(object.mime_type) === String(attempt.content_type) && Number(object.size_bytes) === Number(attempt.content_length) && String(object.checksum) === String(attempt.content_sha256);
    if (objects.some(object => !objectMatches(object)) || objects.length > 1) return cleanupWithOutcome(new MediaServiceError(409, "MEDIA_UPLOAD_OBJECT_RECORD_MISMATCH", "upload object metadata does not match the attempt"));
    if (objects.length === 0) {
      try {
        await uploadBoundary(progress, {
          operation: "ASSET_OBJECT_WRITE",
          phase: attempt.phase,
        }, () => repository.createAssetObject(scope, { assetId: attempt.asset_id, bucket: provider.bucket, objectKey: attempt.expected_object_key, variant: attempt.variant, mimeType: attempt.content_type, sizeBytes: Number(attempt.content_length), checksum: String(attempt.content_sha256), originalFilename: attempt.original_name, width: attempt.asset_metadata?.dimensions?.width, height: attempt.asset_metadata?.dimensions?.height }));
      } catch (error) {
        objects = await uploadBoundary(progress, {
          operation: "ASSET_OBJECT_RECONCILIATION",
          phase: attempt.phase,
        }, () => repository.listAssetObjects(scope, attempt.asset_id));
        if (objects.length !== 1 || !objectMatches(objects[0])) throw error;
      }
    }
    if (attempt.phase === "STORAGE_OBJECT_PRESENT") await writeAttemptPhase(scope, attempt, leaseToken, "ASSET_OBJECT_RECORDED", {}, progress);

    let links = await uploadBoundary(progress, {
      operation: "ASSET_LINK_LOOKUP",
      phase: attempt.phase,
    }, () => repository.listAssetLinks(scope, attempt.asset_id));
    const linkMatches = link => String(link.asset_id) === String(attempt.asset_id) && String(link.tenant_id) === String(attempt.tenant_id) && String(link.workspace_id) === String(attempt.workspace_id) && String(link.store_id || "") === String(attempt.store_id || "") && String(link.entity_type) === "workspace_config_product" && String(link.entity_id) === String(attempt.entity_id) && String(link.purpose) === String(attempt.purpose) && (link.position == null ? null : Number(link.position)) === (attempt.position == null ? null : Number(attempt.position));
    if (attempt.entity_id == null) {
      if (links.length) return cleanupWithOutcome(new MediaServiceError(409, "MEDIA_UPLOAD_LINK_MISMATCH", "upload links do not match the attempt"));
    } else {
      if (!PURPOSE_ENTITY.has(String(attempt.purpose)) || !(await repository.productInScope(scope, attempt.entity_id))) return cleanupWithOutcome(new MediaServiceError(403, "PRODUCT_SCOPE_DENIED", "product is outside the workspace scope"));
      if (links.some(link => !linkMatches(link)) || links.length > 1) return cleanupWithOutcome(new MediaServiceError(409, "MEDIA_UPLOAD_LINK_MISMATCH", "upload links do not match the attempt"));
      if (links.length === 0) {
        try {
          await uploadBoundary(progress, {
            operation: "ASSET_LINK_WRITE",
            phase: attempt.phase,
          }, () => repository.createAssetLink(scope, { assetId: attempt.asset_id, entityType: "workspace_config_product", entityId: String(attempt.entity_id), purpose: attempt.purpose, position: attempt.position }));
        }
        catch (error) {
          links = await uploadBoundary(progress, {
            operation: "ASSET_LINK_RECONCILIATION",
            phase: attempt.phase,
          }, () => repository.listAssetLinks(scope, attempt.asset_id));
          if (links.length !== 1 || !linkMatches(links[0])) throw error;
        }
      }
    }
    if (attempt.phase === "ASSET_OBJECT_RECORDED") await writeAttemptPhase(scope, attempt, leaseToken, "LINKS_RECORDED", {}, progress);

    asset = await uploadBoundary(progress, {
      operation: "READY_ASSET_REVALIDATION",
      phase: attempt.phase,
    }, () => exactAsset(scope, attempt));
    const readyMetadata = { ...attemptMetadata(attempt), uploadState: "ready", uploadPhase: "READY_COMMITTED" };
    if (asset.status !== "ready") {
      assertAssetTransition("pending", "ready");
      const ready = await uploadBoundary(progress, {
        operation: "READY_FINALIZE",
      }, () => repository.transitionAssetStatus(scope, attempt.asset_id, "ready", { expectedStatus: "pending", metadata: readyMetadata }));
      asset = ready || await uploadBoundary(progress, {
        operation: "READY_ASSET_CONFIRMATION",
      }, () => exactAsset(scope, attempt));
    }
    if (!asset || asset.status !== "ready" || asset.metadata?.uploadAttemptId !== attempt.attempt_id) throw new MediaServiceError(503, "MEDIA_UPLOAD_FINALIZATION_INDETERMINATE", "upload finalization could not be confirmed");
    if (progress) {
      progress.lastCompletedPhase = "ASSET_READY";
      progress.currentOperation = "READY_ASSET_VERIFIED";
    }
    const result = { id: attempt.asset_id, uploadAttemptId: attempt.attempt_id, status: "ready", purpose: attempt.purpose, variant: attempt.variant, mimeType: attempt.content_type, bytes: Number(attempt.content_length), path: `/api/media/v1/content/${attempt.asset_id}` };
    if (attempt.phase !== "READY_COMMITTED") await writeAttemptPhase(scope, attempt, leaseToken, "READY_COMMITTED", { terminal_state: "CONSISTENT_READY", result }, progress);
    emit("asset_ready", { requestId: scope.requestId || null, assetId: attempt.asset_id, uploadAttemptId: attempt.attempt_id, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: provider.name, operation: "upload" });
    return wasAlreadyReady ? { ...result, duplicate: true } : result;
  }

  async function upload(scope, input = {}, { idempotencyKey = null, diagnosticState = null } = {}) {
    const progress = diagnosticState || { lastCompletedPhase: null, currentOperation: "REQUEST_VALIDATION", failedOperation: null, lastFailedCompletedPhase: null };
    try {
    const purpose = String(input.purpose || "content_image"); const variant = String(input.variant || "original");
    const folderId = String(input.folderId || "").trim();
    if (folderId.length > 128) throw new MediaServiceError(400, "MEDIA_FOLDER_ID_INVALID", "media folder id is invalid");
    if (!PURPOSES.has(purpose) || (purpose === "content_video" && variant !== "original") || !VARIANT_SET.has(variant)) throw new MediaServiceError(400, "MEDIA_PURPOSE_INVALID", "media purpose or variant is invalid");
    if (input.syntheticCanary === true && (purpose !== "content_image" || variant !== "original" || input.entityId != null)) throw new MediaServiceError(400, "SYNTHETIC_CANARY_ASSET_INVALID", "synthetic lifecycle fixture shape is invalid");
    if (idempotencyKey != null && (!/^[\x21-\x7e]{1,200}$/.test(String(idempotencyKey)))) throw new MediaServiceError(400, "MEDIA_IDEMPOTENCY_KEY_INVALID", "upload idempotency key is invalid");
    const decoded = decode(input.name, input.data); const checksum = crypto.createHash("sha256").update(decoded.buffer).digest("hex");
    const originalName = String(input.name || "").slice(0, 160); const normalizedPosition = input.position == null ? null : Number(input.position);
    const requestFingerprint = stableRequestFingerprint({ checksum, byteLength: decoded.buffer.length, mimeType: decoded.mime, originalName, purpose, variant, entityId: input.entityId, position: normalizedPosition, folderId, syntheticCanary: input.syntheticCanary });
    const rawKey = idempotencyKey == null ? crypto.randomUUID() : String(idempotencyKey);
    const idempotencyKeyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const attemptId = crypto.randomUUID(); const assetId = crypto.randomUUID(); const leaseToken = crypto.randomUUID(); const objectKey = canonicalObjectKey(scope, assetId, variant, decoded.extension);
    progress.currentOperation = "ATTEMPT_RESERVATION";
    const expiresAt = new Date(Date.now() + UPLOAD_LEASE_MS).toISOString();
    const reservation = await uploadBoundary(progress, {
      operation: "ATTEMPT_RESERVATION",
    }, () => repository.reserveUploadAttempt(scope, { attemptId, assetId, expectedObjectKey: objectKey, idempotencyKeyHash, requestFingerprint, contentSha256: checksum, contentLength: decoded.buffer.length, contentType: decoded.mime, originalName, purpose, variant, entityId: input.entityId, position: normalizedPosition, syntheticCanary: input.syntheticCanary === true, assetMetadata: { kind: decoded.kind, dimensions: decoded.dimensions || null, folderId }, leaseToken, leaseExpiresAt: expiresAt }));
    let attempt = reservation.attempt;
    if (!attempt) throw new MediaServiceError(503, "MEDIA_UPLOAD_ATTEMPT_RESERVATION_INDETERMINATE", "upload attempt reservation could not be confirmed");
    progress.lastCompletedPhase = attempt.phase;
    if (reservation.fingerprintMismatch || String(attempt.request_fingerprint) !== requestFingerprint) throw new MediaServiceError(409, "MEDIA_IDEMPOTENCY_KEY_REUSE", "idempotency key is bound to a different upload request");
    assertAttemptBoundToScope(scope, attempt);
    if (!reservation.created && attempt.phase === "READY_COMMITTED") {
      const result = await verifyReadyAttempt(scope, attempt);
      return result;
    }
    if (!reservation.created && attempt.phase === "CLEANED") return { ...(await resultForAttempt(attempt)), duplicate: true };
    let ownerToken = String(attempt.lease_token || "");
    if (!reservation.created) {
      if (new Date(attempt.lease_expires_at).getTime() > Date.now()) throw new MediaServiceError(409, "MEDIA_UPLOAD_IN_PROGRESS", "upload attempt is still in progress");
      const claimed = await repository.claimUploadAttempt(scope, attempt.attempt_id, leaseToken, new Date().toISOString(), expiresAt);
      if (!claimed) throw new MediaServiceError(409, "MEDIA_UPLOAD_IN_PROGRESS", "upload attempt recovery is already in progress");
      attempt = claimed; ownerToken = leaseToken;
    }
    const heartbeat = startAttemptHeartbeat(scope, attempt, ownerToken);
    try {
      heartbeat.assert();
      progress.currentOperation = "UPLOAD_COMPLETION";
      return await completeAttempt(scope, attempt, ownerToken, decoded.buffer, progress);
    } catch (error) {
      if (!progress.failedOperation) {
        progress.failedOperation = progress.currentOperation || "UPLOAD_COMPLETION";
        progress.lastFailedCompletedPhase = progress.lastCompletedPhase || null;
        progress.failureError = error;
      }
      try {
        const current = await uploadBoundary(progress, {
          operation: "RECONCILIATION_ATTEMPT_READ",
        }, () => repository.getUploadAttempt(scope, attempt.attempt_id));
        if (current?.phase === "CLEANED") {
          throw error;
        }
        if (current && String(current.lease_token || "") === ownerToken && !["READY_COMMITTED", "CLEANED"].includes(String(current.phase))) {
          Object.assign(attempt, current);
          const readyAsset = await uploadBoundary(progress, {
            operation: "RECONCILIATION_ASSET_READ",
          }, () => exactAsset(scope, attempt));
          if (readyAsset?.status === "ready") {
            return await completeAttempt(scope, attempt, ownerToken, decoded.buffer, progress);
          }
          if (error?.status === 400 || error?.status === 403 || error?.code === "MEDIA_IDEMPOTENCY_KEY_REUSE") {
            return await cleanAttempt(scope, attempt, ownerToken, progress).then(() => { throw error; });
          }
          const observed = await verifyAttemptObjectForUpload(scope, attempt, progress, "RECONCILIATION_STORAGE_VERIFY");
          if (observed.state === "absent" && error?.code !== "MEDIA_UPLOAD_STORAGE_STATE_UNKNOWN" && (error?.status === 409 || error?.status === 400 || error?.status === 403 || !storageErrorIsAmbiguous(error))) {
            await cleanAttempt(scope, attempt, ownerToken, progress);
            throw error;
          }
        }
      } catch (recoveryError) {
        if (recoveryError === error) throw error;
        if (error?.code === "MEDIA_UPLOAD_LEASE_LOST") throw error;
        throw new MediaServiceError(503, "MEDIA_UPLOAD_CLEANUP_INDETERMINATE", "upload recovery is pending durable reconciliation");
      }
      if (error?.code === "MEDIA_UPLOAD_LEASE_LOST") throw error;
      throw new MediaServiceError(503, "MEDIA_UPLOAD_CLEANUP_INDETERMINATE", "upload recovery is pending durable reconciliation");
    } finally { heartbeat.stop(); }
    } catch (error) {
      if (!progress.failedOperation) {
        progress.failedOperation = progress.currentOperation || "UPLOAD_REQUEST";
        progress.lastFailedCompletedPhase = progress.lastCompletedPhase || null;
        progress.failureError = error;
      }
      throw error;
    }
  }

  async function verifyReadyAttempt(scope, attempt) {
    assertAttemptBoundToScope(scope, attempt);
    const asset = await exactAsset(scope, attempt);
    if (!asset || asset.status !== "ready" || asset.metadata?.uploadAttemptId !== attempt.attempt_id) throw new MediaServiceError(410, "MEDIA_IDEMPOTENT_RESULT_UNAVAILABLE", "canonical upload result is no longer available");
    const storage = await verifyAttemptObject(scope, attempt);
    if (storage.state !== "valid") throw new MediaServiceError(503, "MEDIA_IDEMPOTENT_RESULT_INDETERMINATE", "canonical upload result could not be verified");
    const objects = await repository.listAssetObjects(scope, attempt.asset_id);
    if (objects.length !== 1 || String(objects[0].object_key) !== String(attempt.expected_object_key) || String(objects[0].checksum) !== String(attempt.content_sha256)) throw new MediaServiceError(503, "MEDIA_IDEMPOTENT_RESULT_INDETERMINATE", "canonical upload metadata could not be verified");
    const links = await repository.listAssetLinks(scope, attempt.asset_id);
    if (attempt.entity_id == null ? links.length !== 0 : links.length !== 1 || String(links[0]?.entity_id) !== String(attempt.entity_id)) throw new MediaServiceError(503, "MEDIA_IDEMPOTENT_RESULT_INDETERMINATE", "canonical upload link state could not be verified");
    return resultForAttempt(attempt);
  }

  async function recoverExpiredUploadAttempts({ limit = UPLOAD_RECOVERY_LIMIT } = {}) {
    const candidates = await repository.listRecoverableUploadAttempts(new Date().toISOString(), limit);
    const results = [];
    for (const candidate of candidates) {
      const leaseToken = crypto.randomUUID(); const expiresAt = new Date(Date.now() + UPLOAD_LEASE_MS).toISOString();
      try {
        const scope = { userId: candidate.owner_user_id, tenantId: candidate.tenant_id, workspaceId: candidate.workspace_id, storeId: candidate.store_id };
        const claimed = await repository.claimUploadAttempt(scope, candidate.attempt_id, leaseToken, new Date().toISOString(), expiresAt);
        if (!claimed) { results.push({ attemptId: candidate.attempt_id, outcome: "CLAIMED_ELSEWHERE" }); continue; }
        assertAttemptBoundToScope(scope, claimed);
        if (claimed.phase === "CLEANUP_REQUIRED") await cleanAttempt(scope, claimed, leaseToken);
        else await completeAttempt(scope, claimed, leaseToken, null);
        results.push({ attemptId: claimed.attempt_id, outcome: claimed.terminal_state || claimed.phase });
      } catch (error) {
        results.push({ attemptId: candidate.attempt_id, outcome: "INDETERMINATE", errorClass: error.code || "RECOVERY_FAILED" });
      }
    }
    return results;
  }

  function startRecoveryWorker({ intervalMs = 30_000 } = {}) {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const results = await recoverExpiredUploadAttempts();
        for (const result of results) emit("media_upload_recovery", { attemptId: result.attemptId, outcome: result.outcome, errorClass: result.errorClass || null });
      } catch (error) { emit("media_upload_recovery", { outcome: "INDETERMINATE", errorClass: error.code || "RECOVERY_SCAN_FAILED" }); }
      finally { running = false; }
    };
    const timer = setInterval(run, Math.max(10_000, Number(intervalMs) || 30_000));
    timer.unref?.();
    void run();
    return () => clearInterval(timer);
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

  return { upload, read, remove, recoverDeletion, recoverExpiredUploadAttempts, startRecoveryWorker, canonicalObjectKey };
}

module.exports = { createMediaService, canonicalObjectKey, assertAssetTransition, MediaServiceError, PURPOSES, VARIANT_SET };
