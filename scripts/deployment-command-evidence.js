'use strict';

const CODES = new Set(['DEPLOY_FAILED', 'ZIP_FAILED', 'DIR_NOT_FOUND', 'ENTRY_NOT_FOUND', 'INVALID_NAME', 'MISSING_NAME', 'PROJECT_SCOPE_DENIED', 'NOT_LOGGED_IN', 'invalid_token', 'insufficient_scope', 'forbidden', 'quota_exceeded', 'upstream_error', 'artifact_too_large', 'invalid_request', 'UPSTREAM_ERROR', 'INSUFFICIENT_SCOPE', 'FORBIDDEN', 'QUOTA_EXCEEDED', 'ARTIFACT_TOO_LARGE', 'INVALID_REQUEST', 'ETIMEDOUT', 'ENOENT', 'EACCES', 'ENOBUFS']);
function structured(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}
// Installed CLI outputError codes; arbitrary codes are never persisted.
for (const code of ['INVALID_RUNTIME', 'CLOUD_NOT_ENABLED', 'CLOUD_SYNC_INCOMPATIBLE', 'AGENT_RUNNING', 'NO_PACKAGE_JSON', 'BUILD_FAILED', 'NO_DIST', 'NO_INDEX_HTML', 'DEPLOY_QUOTA_EXCEEDED', 'PREPARE_FAILED', 'REQUEST_TIMEOUT', 'UPLOAD_FAILED', 'SOURCE_PUSH_REQUIRED', 'SOURCE_STATE_UNCONFIRMED', 'SOURCE_COMMIT_CHANGED', 'NO_SETUP_SH', 'NO_START_SH', 'SOURCE_TOO_LARGE', 'INSECURE_API_URL']) CODES.add(code);
const PHASES = new Set(['prepare', 'archive', 'upload', 'build', 'deploy', 'acceptance', 'preflight', 'complete-image']);
const UUID = /^(?:cli_req_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OUTPUT = 1048576;
function recordsFrom(text) {
  if (text.length > MAX_OUTPUT) return [];
  const whole = structured(text);
  if (whole && typeof whole === 'object' && !Array.isArray(whole)) return [whole];
  const records = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length && records.length < 100; i++) {
    const char = text[i];
    if (start < 0) { if (char === '{') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      const value = structured(text.slice(start, i + 1));
      if (value && typeof value === 'object') records.push(value);
      start = -1;
    }
  }
  return records;
}
function captureDeploymentCommand(result) {
  const stdout = String(result.stdout || ''), stderr = String(result.stderr || '');
  const records = [...recordsFrom(stdout), ...recordsFrom(stderr)];
  const fields = records.flatMap(value => [value, value.error, value.details, value.error?.details]).filter(value => value && typeof value === 'object');
  const codes = fields.flatMap(value => [value.code, value.errCode]);
  const code = codes.find(value => typeof value === 'string' && (CODES.has(value) || /^HTTP_[45]\d\d$/.test(value)));
  const statuses = fields.flatMap(value => [value.status, value.httpStatus, value.statusCode]);
  const http = statuses.find(value => Number.isInteger(value) && value >= 100 && value <= 599);
  const traces = fields.flatMap(value => [value.trace_id, value.traceId]);
  const trace = traces.find(value => typeof value === 'string' && (UUID.test(value) || /^[0-9a-f]{32}$/i.test(value)));
  const requestId = fields.flatMap(value => [value.requestId, value.request_id]).find(value => typeof value === 'string' && UUID.test(value));
  const phase = fields.flatMap(value => [value.phase, value.stage]).find(value => PHASES.has(value));
  const processCode = CODES.has(result.error?.code) ? result.error.code : null;
  return {
    EXIT_STATUS: Number.isInteger(result.status) ? result.status : null,
    SIGNAL: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(result.signal) ? result.signal : null,
    TIMED_OUT: processCode === 'ETIMEDOUT',
    PROCESS_ERROR_CODE: processCode,
    CLI_ERROR_CODE: code || null,
    HTTP_STATUS: http ?? null,
    TRACE_ID: trace || null,
    REQUEST_ID: requestId || null,
    PHASE: phase || null,
    STRUCTURED_RECORD_COUNT: records.length,
    UNRECOGNIZED_CODE_PRESENT: codes.some(value => typeof value === 'string' && !CODES.has(value) && !/^HTTP_[45]\d\d$/.test(value)),
    OUTPUT_SIZE_LIMIT_EXCEEDED: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT,
    STDOUT_PRESENT: stdout.length > 0,
    STDERR_PRESENT: stderr.length > 0,
    STDERR_LINE_COUNT: stderr ? stderr.trimEnd().split(/\r?\n/).length : 0,
    STDERR_SAFE_SUMMARY: code || (stderr ? 'UNSTRUCTURED_TEXT_NOT_RETAINED' : 'EMPTY'),
    RAW_OUTPUT_SAVED: false,
    REMOTE_SUBMIT_COUNT: 'UNKNOWN'
  };
}
module.exports = { captureDeploymentCommand };
