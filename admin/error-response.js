function normalizeStatus(error, requestedStatus) {
  const candidate = Number(requestedStatus ?? error?.status);
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
}

function safeCode(value, fallback) {
  const code = String(value || '').trim();
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(code) ? code : fallback;
}

function safeClientMessage(error, fallback) {
  const message = String(error?.publicMessage || error?.message || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return message && message.length <= 240 ? message : fallback;
}

function writeErrorLog({ requestId, code, status, logger = console }) {
  logger.error(JSON.stringify({ level: 'error', requestId, code, status, event: 'request_failed' }));
}

function respondUnexpectedError(res, error, {
  requestId,
  status,
  code = 'INTERNAL_ERROR',
  message = '服务暂时不可用，请稍后重试',
  allowClientMessage = false,
  logger
} = {}) {
  const resolvedStatus = normalizeStatus(error, status);
  const isClientError = resolvedStatus >= 400 && resolvedStatus < 500;
  const resolvedCode = isClientError ? safeCode(error?.code, code) : safeCode(code, 'INTERNAL_ERROR');
  const responseMessage = isClientError && allowClientMessage ? safeClientMessage(error, message) : message;
  if (!isClientError) writeErrorLog({ requestId, code: resolvedCode, status: resolvedStatus, logger });
  return res.status(resolvedStatus).json({ ok: false, code: resolvedCode, message: responseMessage, error: responseMessage, data: null, requestId });
}

module.exports = { normalizeStatus, respondUnexpectedError, safeClientMessage, writeErrorLog };
