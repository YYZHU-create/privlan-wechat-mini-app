const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSecrets, NAMES } = require(process.env.BRIDGE_TEST_MODULE || '../runtime-secret-bridge');
const secrets = Object.fromEntries(NAMES.map(n => [n, n === 'ATELIER_MASTER_KEY' ? Buffer.alloc(32, 9).toString('base64') : 'synthetic'.repeat(8)]));
const environment = () => ({ ATELIER_RUNTIME_SECRET_BRIDGE: 'production', MEOO_PROJECT_URL_ID: 'g8o5cv1om41o', ATELIER_ENVIRONMENT: 'production', ATELIER_AUTH_PROVIDER: 'supabase', ATELIER_DB_BACKEND: 'meoo', ATELIER_AUTO_MIGRATE: '0', SUPABASE_URL: 'https://production.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-production-role' });
const response = (projectId = 'g8o5cv1om41o', payload = secrets) => new Response(JSON.stringify({ projectId, secrets: payload }), { headers: { 'content-type': 'application/json' } });
test('Production explicitly selects its own endpoint and preserves migration guard', async () => {
  const env = environment(); let calls = 0;
  const r = await loadRuntimeSecrets({ env, fetchImpl: async (url, opts) => { calls++; assert.equal(url, 'https://production.invalid/functions/v1/feeldao-production-runtime-config'); assert.equal(opts.method, 'GET'); assert.equal(opts.redirect, 'error'); return response(); } });
  assert.equal(calls, 1); assert.equal(r.delivery, 'PRODUCTION_EDGE_FUNCTION'); assert.equal(env.ATELIER_AUTO_MIGRATE, '0');
  for (const n of NAMES) assert.equal(env[n], secrets[n]);
});
test('cross-environment targets and unsafe database/migration modes fail before fetch', async () => {
  for (const patch of [{ MEOO_PROJECT_URL_ID: 'asmhysidbg5g' }, { ATELIER_ENVIRONMENT: 'staging' }, { ATELIER_AUTO_MIGRATE: '1' }, { ATELIER_AUTO_MIGRATE: undefined }, { DATABASE_URL: 'synthetic' }, { ATELIER_RUNTIME_SECRET_BRIDGE: 'typo' }, { ATELIER_AUTH_PROVIDER: 'legacy' }]) {
    await assert.rejects(loadRuntimeSecrets({ env: { ...environment(), ...patch }, fetchImpl: () => assert.fail('must not fetch') }), /TARGET_MISMATCH/);
  }
});
test('wrong project, conflicting versions and malformed fields never partially apply', async () => {
  for (const [patch, project, payload] of [[{}, 'asmhysidbg5g', secrets], [{ ATELIER_MASTER_KEY: 'previous-version' }, 'g8o5cv1om41o', secrets], [{}, 'g8o5cv1om41o', { ...secrets, ATELIER_MASTER_KEY: 'invalid' }]]) {
    const env = { ...environment(), ...patch }, before = { ...env };
    await assert.rejects(loadRuntimeSecrets({ env, fetchImpl: async () => response(project, payload) })); assert.deepEqual(env, before);
  }
});
test('failed Production delivery is sanitized and does not retry', async () => {
  let calls = 0; await assert.rejects(loadRuntimeSecrets({ env: environment(), fetchImpl: async () => { calls++; throw Error('private'); } }), /^Error: SECRET_BRIDGE_REQUEST_FAILED$/); assert.equal(calls, 1);
});
test('Production function authenticates service credential and returns Production identity only', async () => {
  const { createHandler } = await import('../../functions/feeldao-production-runtime-config/handler.mjs');
  const handler = createHandler({ getEnv: n => n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'synthetic-role' : secrets[n] });
  assert.equal((await handler(new Request('https://production.invalid'))).status, 403);
  assert.equal((await handler(new Request('https://production.invalid', { headers: { authorization: 'Bearer other-environment' } }))).status, 403);
  assert.equal((await handler(new Request('https://production.invalid', { method: 'POST' }))).status, 405);
  const r = await handler(new Request('https://production.invalid', { headers: { authorization: 'Bearer synthetic-role' } }));
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal((await r.json()).projectId, 'g8o5cv1om41o');
});
