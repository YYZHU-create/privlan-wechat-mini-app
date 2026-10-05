'use strict';

const CODES = new Set(['DEPLOY_FAILED', 'ZIP_FAILED', 'DIR_NOT_FOUND', 'ENTRY_NOT_FOUND', 'INVALID_NAME', 'MISSING_NAME', 'PROJECT_SCOPE_DENIED', 'NOT_LOGGED_IN', 'invalid_token', 'insufficient_scope', 'forbidden', 'quota_exceeded', 'upstream_error', 'artifact_too_large', 'invalid_request', 'UPSTREAM_ERROR', 'INSUFFICIENT_SCOPE', 'FORBIDDEN', 'QUOTA_EXCEEDED', 'ARTIFACT_TOO_LARGE', 'INVALID_REQUEST', 'ETIMEDOUT', 'ENOENT', 'EACCES', 'ENOBUFS']);
function structured(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}
function captureDeploymentCommand(result) {
  const stdout = String(result.stdout || ''), stderr = String(result.stderr || '');
  const records = [structured(stdout), structured(stderr)].filter(value => value && typeof value === 'object');
  const codes = records.flatMap(value => [value.code, value.errCode, value.error?.code]);
  const code = codes.find(value => typeof value === 'string' && (CODES.has(value) || /^HTTP_[45]\d\d$/.test(value)));
  const statuses = records.flatMap(value => [value.status, value.httpStatus, value.statusCode, value.error?.status, value.error?.details?.status]);
  const http = statuses.find(value => Number.isInteger(value) && value >= 100 && value <= 599);
  const traces = records.flatMap(value => [value.trace_id, value.details?.traceId, value.error?.trace_id, value.error?.details?.traceId]);
  const trace = traces.find(value => typeof value === 'string' && /^(?:cli_req_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  const processCode = CODES.has(result.error?.code) ? result.error.code : null;
  return {
    EXIT_STATUS: Number.isInteger(result.status) ? result.status : null,
    SIGNAL: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(result.signal) ? result.signal : null,
    TIMED_OUT: processCode === 'ETIMEDOUT',
    PROCESS_ERROR_CODE: processCode,
    CLI_ERROR_CODE: code || null,
    HTTP_STATUS: http ?? null,
    TRACE_ID: trace || null,
    STDOUT_PRESENT: stdout.length > 0,
    STDERR_PRESENT: stderr.length > 0,
    STDERR_LINE_COUNT: stderr ? stderr.trimEnd().split(/\r?\n/).length : 0,
    STDERR_SAFE_SUMMARY: code || (stderr ? 'UNSTRUCTURED_TEXT_NOT_RETAINED' : 'EMPTY'),
    RAW_OUTPUT_SAVED: false,
    REMOTE_SUBMIT_COUNT: 'UNKNOWN'
  };
}
module.exports = { captureDeploymentCommand };
