const { hasTrustedPublicMessage } = require("./public-error");

const FALLBACK_ERROR_CODES = new Set([
  "INTERNAL_ERROR", "SYNC_FAILED", "PREVIEW_FAILED", "LEGACY_API_FAILED", "MEDIA_UPLOAD_FAILED", "REQUEST_TOO_LARGE", "INVALID_REQUEST_BODY",
  "AI_TEMPLATE_ERROR", "AI_CONNECTION_INVALID", "PLATFORM_BOOTSTRAP_FAILED", "PLATFORM_AI_CONNECTION_TEST_FAILED", "DATABASE_UNAVAILABLE"
]);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;
const MEDIA_DIAGNOSTIC_PHASES = new Set([
  "ATTEMPT_CREATED", "ASSET_CREATED", "DB_ASSET_CREATED", "STORAGE_OBJECT_PRESENT",
  "ASSET_OBJECT_RECORDED", "LINKS_RECORDED", "READY_COMMITTED", "ASSET_READY",
  "CLEANUP_REQUIRED", "CLEANED"
]);
const MEDIA_DIAGNOSTIC_OPERATIONS = new Set([
  "REQUEST_VALIDATION", "ATTEMPT_RESERVATION", "ASSET_REVALIDATION", "ASSET_CREATE", "ASSET_CONFIRM",
  "JOURNAL_DB_ASSET_CREATED_WRITE", "JOURNAL_DB_ASSET_CREATED_VERIFY", "JOURNAL_PHASE_TRANSITION",
  "STORAGE_EXISTS_CHECK", "STORAGE_PUT", "STORAGE_VERIFY_AFTER_PUT_ERROR", "STORAGE_VERIFY_AFTER_PUT",
  "ASSET_OBJECT_LOOKUP", "ASSET_OBJECT_WRITE", "ASSET_OBJECT_RECONCILIATION", "ASSET_LINK_LOOKUP",
  "ASSET_LINK_WRITE", "ASSET_LINK_RECONCILIATION", "READY_ASSET_REVALIDATION", "READY_FINALIZE",
  "READY_ASSET_CONFIRMATION", "READY_ASSET_VERIFIED", "RECONCILIATION_ATTEMPT_READ",
  "RECONCILIATION_ASSET_READ", "RECONCILIATION_STORAGE_VERIFY", "COMPENSATION_STORAGE_VERIFY",
  "COMPENSATION_STORAGE_DELETE", "COMPENSATION_STORAGE_DELETE_VERIFY", "COMPENSATION_ASSET_METADATA_DELETE",
  "COMPENSATION_ASSET_METADATA_VERIFY", "COMPENSATION_ASSET_REVALIDATION", "UPLOAD_COMPLETION", "UPLOAD_REQUEST"
]);
const MEDIA_DIAGNOSTIC_ERROR_CLASSES = new Set(["MediaServiceError", "StorageProviderError", "DatabaseError", "PostgrestError"]);
const MEDIA_DIAGNOSTIC_DB_CODES = new Set(["08000", "08006", "22P02", "23502", "23503", "23505", "23514", "40001", "40P01", "42501", "42703", "42P01", "57014"]);
const MEDIA_DIAGNOSTIC_PROVIDER_CODES = new Set([
  "SCOPE_REQUIRED", "INVALID_OBJECT_KEY", "INVALID_OBJECT_BYTES", "STORAGE_URL_REQUIRED",
  "STORAGE_CREDENTIAL_REQUIRED", "STORAGE_BUCKET_REQUIRED", "STORAGE_UPLOAD_FAILED",
  "STORAGE_READ_FAILED", "STORAGE_VERIFY_FAILED", "STORAGE_DELETE_FAILED"
]);

function isStagingMediaDiagnosticRequest({ environment, req } = {}) {
  return environment === "staging"
    && Boolean(req?.saasService && req?.merchantScope)
    && typeof req?.get === "function"
    && req.get("X-FEELDAO-Media-Diagnostic") === "1";
}

function createStagingMediaDiagnostic({ environment, authenticated, headerValue, requestId, progress, error } = {}) {
  if (environment !== "staging" || authenticated !== true || headerValue !== "1") return null;
  const errorStatus = Number(error?.status ?? error?.statusCode ?? 500);
  if (!Number.isInteger(errorStatus) || errorStatus < 500 || errorStatus > 599) return null;
  const requestIdValue = String(requestId || "");
  const safeRequestId = /^[A-Za-z][A-Za-z0-9_-]{1,100}$/.test(requestIdValue) ? requestIdValue : null;
  const phase = progress?.lastFailedCompletedPhase ?? progress?.lastCompletedPhase;
  const operation = progress?.failedOperation ?? progress?.currentOperation;
  const errorClass = MEDIA_DIAGNOSTIC_ERROR_CLASSES.has(String(error?.name || "")) ? String(error.name) : "UNKNOWN_INTERNAL";
  const diagnostic = {
    requestId: safeRequestId,
    lastCompletedPhase: MEDIA_DIAGNOSTIC_PHASES.has(String(phase || "")) ? phase : null,
    failedOperation: MEDIA_DIAGNOSTIC_OPERATIONS.has(String(operation || "")) ? operation : "UPLOAD_REQUEST",
    errorClass
  };
  const rawDbCode = errorClass === "DatabaseError" ? String(error?.code || error?.sqlState || "") : "";
  if (MEDIA_DIAGNOSTIC_DB_CODES.has(rawDbCode)) diagnostic.dbCode = rawDbCode;
  if (errorClass === "StorageProviderError") {
    const providerStatus = Number(error?.status ?? error?.statusCode);
    if (Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599) diagnostic.providerStatus = providerStatus;
    const providerCode = String(error?.code || "");
    if (MEDIA_DIAGNOSTIC_PROVIDER_CODES.has(providerCode)) diagnostic.providerCode = providerCode;
  }
  return diagnostic;
}

function isValidStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

function normalizeStatus(error, fallbackStatus, trusted = hasTrustedPublicMessage(error)) {
  if (trusted && isValidStatus(error?.status)) return Number(error.status);
  return isValidStatus(fallbackStatus) ? Number(fallbackStatus) : 500;
}

function safeCode(value, fallback) {
  const code = String(value || "");
  if (!ERROR_CODE_PATTERN.test(code)) return fallback;
  return code;
}

function fallbackCode(value) {
  const code = String(value || "");
  return FALLBACK_ERROR_CODES.has(code) ? code : "INTERNAL_ERROR";
}

function safeClientMessage(error, fallback) {
  if (!hasTrustedPublicMessage(error)) return fallback;
  const message = String(error.publicMessage || "");
  if (!message || message.length > 240 || /[\u0000-\u001f\u007f]/.test(message)) return fallback;
  return message.trim() || fallback;
}

function writeErrorLog({ requestId, code, status, logger = console }) {
  logger.error(JSON.stringify({ level: "error", requestId, code, status, event: "request_failed" }));
}

function respondUnexpectedError(res, error, {
  requestId,
  fallbackStatus,
  fallbackCode: requestedFallbackCode = "INTERNAL_ERROR",
  fallbackMessage = "服务暂时不可用，请稍后重试",
  logger,
  stagingDiagnostic = null
} = {}) {
  const trusted = hasTrustedPublicMessage(error);
  const trustedStatusValid = trusted && isValidStatus(error?.status);
  const trustedCodeValid = trusted && ERROR_CODE_PATTERN.test(String(error?.code || ""));
  const resolvedStatus = normalizeStatus(error, fallbackStatus, trusted);
  const safeFallbackCode = fallbackCode(requestedFallbackCode);
  const resolvedCode = trusted ? safeCode(error?.code, safeFallbackCode) : safeFallbackCode;
  const responseMessage = safeClientMessage(error, fallbackMessage);
  if (!trusted || !trustedStatusValid || !trustedCodeValid || resolvedStatus >= 500) writeErrorLog({ requestId, code: resolvedCode, status: resolvedStatus, logger });
  const body = { ok: false, code: resolvedCode, message: responseMessage, error: responseMessage, data: null, requestId };
  if (resolvedStatus >= 500 && stagingDiagnostic) body.diagnostic = stagingDiagnostic;
  return res.status(resolvedStatus).json(body);
}

module.exports = { ERROR_CODE_PATTERN, FALLBACK_ERROR_CODES, normalizeStatus, respondUnexpectedError, safeClientMessage, safeCode, writeErrorLog, isStagingMediaDiagnosticRequest, createStagingMediaDiagnostic };
