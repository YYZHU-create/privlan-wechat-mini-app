const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.CONFIG_RECOVERY_SOURCE || path.join(__dirname, '../public/app.js'), 'utf8');

function harness(responses) {
  const body = source.match(/    async function loadConfig\(\) \{[\s\S]*?(?=\n    async function loadPlatform\()/)[0];
  const state = Object.fromEntries(['loading', 'loadError', 'configVersion', 'cfg', 'selectedId', 'savedSnapshot', 'history', 'historyIndex', 'saveMode'].map(key => [key, { value: null }]));
  Object.assign(state, { sections: { value: [] }, normalizeConfig: x => x, loadSystemFonts() {}, fetch: async url => { assert.equal(url, '/api/config'); return responses.shift(); } });
  vm.createContext(state);
  vm.runInContext(body + '\nthis.run = loadConfig;', state);
  return state;
}
const ok = () => ({ ok: true, headers: { get: () => '3' }, json: async () => ({ pages: [] }) });

test('recovery button invokes exposed loader and is disabled during loading', () => {
  assert.match(source, /<button[^>]*:disabled="loading"[^>]*@click="loadConfig"/);
  const exposed = source.slice(source.indexOf('    return {', source.indexOf('    async function loadConfig')));
  assert.match(exposed, /loadConfig,/);
});
test('503 then successful reload clears error and restores saved state', async () => {
  const s = harness([{ ok: false, status: 503 }, ok()]);
  await s.run();
  assert.equal(s.loadError.value, '读取配置失败（503）');
  assert.equal(s.saveMode.value, 'error');
  await s.run();
  assert.equal(s.loadError.value, '');
  assert.equal(s.saveMode.value, 'saved');
  assert.equal(s.loading.value, false);
  assert.equal(s.configVersion.value, 3);
  assert.equal(s.savedSnapshot.value, JSON.stringify(s.cfg.value));
});
test('repeated failure retains error and ends loading', async () => {
  const s = harness([{ ok: false, status: 503 }, { ok: false, status: 503 }]);
  await s.run(); await s.run();
  assert.equal(s.loadError.value, '读取配置失败（503）');
  assert.equal(s.saveMode.value, 'error');
  assert.equal(s.loading.value, false);
});
test('invalid JSON does not report successful recovery', async () => {
  const s = harness([{ ok: true, json: async () => { throw new Error('Invalid JSON'); } }]);
  await s.run();
  assert.equal(s.loadError.value, 'Invalid JSON');
  assert.equal(s.saveMode.value, 'error');
  assert.equal(s.loading.value, false);
});
