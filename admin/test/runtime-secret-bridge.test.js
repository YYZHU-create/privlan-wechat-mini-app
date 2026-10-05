const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSecrets, NAMES } = require('../runtime-secret-bridge');
const values = Object.fromEntries(NAMES.map(name => [name, name === 'ATELIER_MASTER_KEY' ? Buffer.alloc(32, 7).toString('base64') : 'synthetic-test-value'.repeat(3)]));
const environment = () => ({ ATELIER_RUNTIME_SECRET_BRIDGE: 'staging', MEOO_PROJECT_URL_ID: 'asmhysidbg5g', ATELIER_ENVIRONMENT: 'staging', ATELIER_AUTH_PROVIDER: 'supabase', ATELIER_DB_BACKEND: 'meoo', ATELIER_AUTO_MIGRATE: '0', SUPABASE_URL: 'https://example.invalid/sb-api', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role' });
const response = (secrets = values, projectId = 'asmhysidbg5g') => new Response(JSON.stringify({ projectId, secrets }), { headers: { 'content-type': 'application/json' } });
test('disabled bridge performs zero requests', async () => { assert.deepEqual(await loadRuntimeSecrets({ env: {}, fetchImpl: () => assert.fail() }), { delivery: 'INHERITED', count: 0 }); });
test('validated server-only delivery preserves URL prefix and migration policy', async () => {
  const env = environment(); let calls = 0;
  const result = await loadRuntimeSecrets({ env, fetchImpl: async (url, options) => { calls++; assert.equal(url, 'https://example.invalid/sb-api/functions/v1/feeldao-staging-runtime-config'); assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET'); return response(); } });
  assert.equal(calls, 1); assert.equal(result.count, 4); assert.equal(env.ATELIER_AUTO_MIGRATE, '0'); for (const name of NAMES) assert.equal(env[name], values[name]);
});
test('Production, ambiguous database and migration-enabled targets fail before fetch', async () => {
  for (const change of [{ MEOO_PROJECT_URL_ID: 'g8o5cv1om41o' }, { DATABASE_URL: 'postgres://example.invalid' }, { ATELIER_AUTO_MIGRATE: '1' }]) await assert.rejects(loadRuntimeSecrets({ env: { ...environment(), ...change }, fetchImpl: () => assert.fail() }), /TARGET_MISMATCH/);
});
test('invalid payload, inherited conflicts and format failures are atomic', async () => {
  for (const [changes, secrets, project] of [[{}, { ...values, extra: 'x' }], [{ ATELIER_MASTER_KEY: 'existing' }, values], [{}, { ...values, ATELIER_MASTER_KEY: 'bad' }], [{}, values, 'g8o5cv1om41o']]) {
    const env = { ...environment(), ...changes }; const before = { ...env };
    await assert.rejects(loadRuntimeSecrets({ env, fetchImpl: async () => response(secrets, project) })); assert.deepEqual(env, before);
  }
});
test('network failure is sanitized and never retried', async () => { let calls = 0; await assert.rejects(loadRuntimeSecrets({ env: environment(), fetchImpl: async () => { calls++; throw new Error('private transport detail'); } }), /^Error: SECRET_BRIDGE_REQUEST_FAILED$/); assert.equal(calls, 1); });
test('function rejects anon, wrong key and non-GET; returns only four names to service role', async () => {
  const { createHandler } = await import('../../functions/feeldao-staging-runtime-config/handler.mjs');
  const handler = createHandler({ getEnv: name => name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'synthetic-role' : values[name] });
  for (const authorization of ['', 'Bearer anon', 'Bearer wrong']) assert.equal((await handler(new Request('https://example.invalid', { headers: { authorization } }))).status, 403);
  assert.equal((await handler(new Request('https://example.invalid', { method: 'POST' }))).status, 405);
  const result = await handler(new Request('https://example.invalid', { headers: { authorization: 'Bearer synthetic-role' } }));
  assert.equal(result.headers.get('cache-control'), 'no-store'); assert.deepEqual((await result.json()).secrets, values);
});
