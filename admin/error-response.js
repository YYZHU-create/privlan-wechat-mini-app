const { hasTrustedPublicMessage } = require("./public-error");

const FALLBACK_ERROR_CODES = new Set([
  "INTERNAL_ERROR", "SYNC_FAILED", "PREVIEW_FAILED", "LEGACY_API_FAILED", "MEDIA_UPLOAD_FAILED", "REQUEST_TOO_LARGE", "INVALID_REQUEST_BODY",
  "AI_TEMPLATE_ERROR", "AI_CONNECTION_INVALID", "PLATFORM_BOOTSTRAP_FAILED", "PLATFORM_AI_CONNECTION_TEST_FAILED", "DATABASE_UNAVAILABLE"
]);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;

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
  logger
} = {}) {
  const trusted = hasTrustedPublicMessage(error);
  const trustedStatusValid = trusted && isValidStatus(error?.status);
  const trustedCodeValid = trusted && ERROR_CODE_PATTERN.test(String(error?.code || ""));
  const resolvedStatus = normalizeStatus(error, fallbackStatus, trusted);
  const safeFallbackCode = fallbackCode(requestedFallbackCode);
  const resolvedCode = trusted ? safeCode(error?.code, safeFallbackCode) : safeFallbackCode;
  const responseMessage = safeClientMessage(error, fallbackMessage);
  if (!trusted || !trustedStatusValid || !trustedCodeValid || resolvedStatus >= 500) writeErrorLog({ requestId, code: resolvedCode, status: resolvedStatus, logger });
  return res.status(resolvedStatus).json({ ok: false, code: resolvedCode, message: responseMessage, error: responseMessage, data: null, requestId });
}

module.exports = { ERROR_CODE_PATTERN, FALLBACK_ERROR_CODES, normalizeStatus, respondUnexpectedError, safeClientMessage, safeCode, writeErrorLog };
