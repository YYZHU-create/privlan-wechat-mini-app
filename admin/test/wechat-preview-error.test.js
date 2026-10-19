const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyWechatPreviewError } = require('../wechat-preview-error');
test('recognizes login expiry without exposing raw CLI output', () => {
  const result = classifyWechatPreviewError({ message: 'preview failed', stdout: Buffer.from('需要重新登录 (code 10) private details') });
  assert.equal(result.code, 'WECHAT_DEVTOOLS_LOGIN_REQUIRED');
  assert.equal(result.status, 409);
  assert.ok(!JSON.stringify(result).includes('private details'));
});
test('unknown failures retain generic error handling', () => {
  assert.equal(classifyWechatPreviewError({ message: 'private path or compile error' }), null);
  assert.equal(classifyWechatPreviewError(null), null);
});
test('isolated launcher seeds generated service config required by sync', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../scripts/local-editor.cjs'), 'utf8');
  assert.match(source, /seed\('cloudfunctions\/serviceQuery\/store-config.js'\)/);
});
