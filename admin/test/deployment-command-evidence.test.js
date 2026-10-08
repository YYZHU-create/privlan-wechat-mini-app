const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { captureDeploymentCommand } = require(process.env.DEPLOY_EVIDENCE_SOURCE || '../../scripts/deployment-command-evidence');
test('real side-effect-free child failure retains exit and structured status', () => {
  const result = spawnSync(process.execPath, ['-e', 'process.stderr.write(JSON.stringify({code:"upstream_error",status:502,detail:"synthetic-private-value"}));process.exitCode=7'], { encoding: 'utf8' });
  const evidence = captureDeploymentCommand(result);
  assert.equal(evidence.EXIT_STATUS, 7); assert.equal(evidence.HTTP_STATUS, 502); assert.equal(evidence.CLI_ERROR_CODE, 'upstream_error');
  assert.ok(!JSON.stringify(evidence).includes('synthetic-private-value')); assert.equal(evidence.REMOTE_SUBMIT_COUNT, 'UNKNOWN');
});
test('success is process success only, never inferred remote deployment', () => {
  const evidence = captureDeploymentCommand({ status: 0, stdout: '{"success":true,"data":{"secret":"private"}}' });
  assert.equal(evidence.EXIT_STATUS, 0); assert.equal(evidence.REMOTE_SUBMIT_COUNT, 'UNKNOWN'); assert.ok(!JSON.stringify(evidence).includes('private'));
});
test('timeout and signal retained without error message', () => {
  const evidence = captureDeploymentCommand({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'private' } });
  assert.equal(evidence.TIMED_OUT, true); assert.equal(evidence.SIGNAL, 'SIGTERM'); assert.equal(evidence.EXIT_STATUS, null); assert.ok(!JSON.stringify(evidence).includes('private'));
});
test('unstructured stderr is counted but never persisted', () => {
  const evidence = captureDeploymentCommand({ status: 1, stderr: 'Authorization: Bearer synthetic-private\nsecret=value\n' });
  assert.equal(evidence.STDERR_LINE_COUNT, 2); assert.equal(evidence.STDERR_SAFE_SUMMARY, 'UNSTRUCTURED_TEXT_NOT_RETAINED'); assert.ok(!JSON.stringify(evidence).includes('synthetic-private'));
});
test('untrusted error code, trace and signal cannot smuggle arbitrary values', () => {
  const evidence = captureDeploymentCommand({ status: 1, signal: 'private', stderr: JSON.stringify({ code: 'private-secret', trace_id: 'private-secret' }) });
  assert.equal(evidence.CLI_ERROR_CODE, null); assert.equal(evidence.TRACE_ID, null); assert.equal(evidence.SIGNAL, null);
});
test('known CLI stdout error and UUID trace retained', () => {
  const evidence = captureDeploymentCommand({ status: 1, stdout: JSON.stringify({ code: 'DEPLOY_FAILED', trace_id: '12345678-1234-1234-1234-123456789abc' }) });
  assert.equal(evidence.CLI_ERROR_CODE, 'DEPLOY_FAILED'); assert.equal(evidence.TRACE_ID, '12345678-1234-1234-1234-123456789abc');
});

test('installed CLI nested upload failure retains explicit phase and request ID', () => {
  const id = 'cli_req_12345678-1234-1234-1234-123456789abc';
  const e = captureDeploymentCommand({ status: 1, stdout: JSON.stringify({ success: false, error: { code: 'UPLOAD_FAILED', message: 'synthetic-secret', details: { phase: 'upload', requestId: id, status: 502, traceId: 'abcdef0123456789abcdef0123456789' } } }) });
  assert.equal(e.CLI_ERROR_CODE, 'UPLOAD_FAILED'); assert.equal(e.PHASE, 'upload');
  assert.equal(e.REQUEST_ID, id); assert.equal(e.HTTP_STATUS, 502);
  assert.equal(e.TRACE_ID, 'abcdef0123456789abcdef0123456789');
  assert.ok(!JSON.stringify(e).includes('synthetic-secret'));
});
test('mixed diagnostic text and pretty JSON retain only allowlisted fields', () => {
  const e = captureDeploymentCommand({ status: 1, stdout: 'diagnostic secret=value\n' + JSON.stringify({ error: { code: 'SOURCE_TOO_LARGE', details: { stage: 'archive' } } }, null, 2) + '\n' });
  assert.equal(e.CLI_ERROR_CODE, 'SOURCE_TOO_LARGE'); assert.equal(e.PHASE, 'archive');
  assert.equal(e.STRUCTURED_RECORD_COUNT, 1); assert.ok(!JSON.stringify(e).includes('secret=value'));
});
test('newline JSON records and braces inside private strings parse correctly', () => {
  const e = captureDeploymentCommand({ status: 1, stdout: JSON.stringify({ message: 'private { \\" }' }) + '\n' + JSON.stringify({ error: { code: 'PREPARE_FAILED' }, phase: 'prepare' }) });
  assert.equal(e.CLI_ERROR_CODE, 'PREPARE_FAILED'); assert.equal(e.PHASE, 'prepare');
  assert.equal(e.STRUCTURED_RECORD_COUNT, 2); assert.ok(!JSON.stringify(e).includes('private'));
});
test('phase and request IDs cannot contain arbitrary secret strings', () => {
  const e = captureDeploymentCommand({ status: 1, stdout: JSON.stringify({ code: 'secret_value', phase: 'secret-value', requestId: 'token-secret-value' }) });
  assert.equal(e.CLI_ERROR_CODE, null); assert.equal(e.PHASE, null); assert.equal(e.REQUEST_ID, null);
  assert.equal(e.UNRECOGNIZED_CODE_PRESENT, true);
  assert.ok(!JSON.stringify(e).includes('secret_value'));
});
test('absent phase is not inferred from upload code; large output is bounded', () => {
  const e = captureDeploymentCommand({ status: 1, stdout: JSON.stringify({ code: 'UPLOAD_FAILED' }) });
  assert.equal(e.PHASE, null); assert.equal(e.REQUEST_ID, null);
  const large = captureDeploymentCommand({ status: 1, stdout: 'x'.repeat(1048577) });
  assert.equal(large.OUTPUT_SIZE_LIMIT_EXCEEDED, true); assert.equal(large.STRUCTURED_RECORD_COUNT, 0);
});
