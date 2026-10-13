const test = require('node:test');
const assert = require('node:assert/strict');
const { readManagedAuthConfig } = require(process.env.MANAGED_KEY_TEST_MODULE || '../managed-auth-runtime');
function env(key) {
  return { ATELIER_AUTH_PROVIDER:'supabase', MEOO_PROJECT_URL_ID:'g8o5cv1om41o', ATELIER_ENVIRONMENT:'production',
    ATELIER_RUNTIME_CONFIG_LOAD_STATUS:'LOADED_VALIDATED', ATELIER_AUTO_MIGRATE:'0', ATELIER_DB_BACKEND:'native',
    SUPABASE_URL:'https://provider.example.test', SUPABASE_ANON_KEY:'synthetic-public', ATELIER_MASTER_KEY:key };
}
test('managed session consumer accepts existing equivalent master key encodings without changing input', () => {
  const bytes=Buffer.alloc(32,251), canonical=bytes.toString('base64');
  for(const key of [canonical, canonical.replace(/=+$/,''), ` ${canonical}\n`, bytes.toString('base64url')]) {
    const source=env(key);
    assert.deepEqual(readManagedAuthConfig(source).sessionKey,bytes);
    assert.equal(source.ATELIER_MASTER_KEY,key);
  }
});
test('managed session consumer rejects missing, short and long decoded master keys', () => {
  for(const key of ['',Buffer.alloc(31).toString('base64'),Buffer.alloc(33).toString('base64')]) {
    assert.throws(()=>readManagedAuthConfig(env(key)),{code:'MANAGED_SESSION_ATELIER_MASTER_KEY_REQUIRED'});
  }
});
