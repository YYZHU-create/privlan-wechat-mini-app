const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preflight } = require('../../scripts/image-startup-preflight');
const { TARGETS, canonicalizeRuntimeConfig } = require('../target-runtime-config');

test('bundled bridge mode accepts only its non-sensitive staging enum', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.runtime.env'), 'ATELIER_RUNTIME_SECRET_BRIDGE=staging\n');
  assert.equal(preflight(f).autoMigrate, '0');
  for (const value of ['unexpected', 'staging-secret-value', '']) {
    fs.writeFileSync(path.join(f.root, '.runtime.env'), `ATELIER_RUNTIME_SECRET_BRIDGE=${value}\n`);
    assert.throws(() => preflight(f), /must not be bundled/);
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feeldao-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'runtime-config.json'), canonicalizeRuntimeConfig(TARGETS.staging));
  return { root, env: {
    NODE_ENV: 'production', ATELIER_ENVIRONMENT: 'staging', MEOO_PROJECT_URL_ID: 'asmhysidbg5g',
    ATELIER_DB_BACKEND: 'meoo', ATELIER_AUTO_MIGRATE: '1',
    SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
    ATELIER_LICENSE_PEPPER: 'p'.repeat(32), ATELIER_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    ATELIER_OPS_EMAIL: 'fixture@example.invalid', ATELIER_OPS_PASSWORD: 'synthetic-password',
    ATELIER_APPOINTMENT_GATEWAY_TOKEN: 'g'.repeat(32), ATELIER_OPENID_HASH_KEY: 'h'.repeat(32)
  } };
}

test('image preflight validates supplied configuration and preserves caller input', t => {
  const f = fixture(t);
  const result = preflight(f);
  assert.equal(result.autoMigrate, '0');
  assert.equal(result.backend, 'meoo');
  assert.equal(result.runtimeSecretInjection, 'NOT_VERIFIED');
  assert.equal(f.env.ATELIER_AUTO_MIGRATE, '1');
  assert.ok(!JSON.stringify(result).includes(f.env.ATELIER_OPS_PASSWORD));
});

test('image preflight rejects each absent required application configuration', t => {
  const f = fixture(t);
  for (const key of ['ATELIER_LICENSE_PEPPER', 'ATELIER_MASTER_KEY', 'ATELIER_OPS_EMAIL',
    'ATELIER_OPS_PASSWORD', 'ATELIER_APPOINTMENT_GATEWAY_TOKEN', 'ATELIER_OPENID_HASH_KEY']) {
    const env = { ...f.env };
    delete env[key];
    assert.throws(() => preflight({ root: f.root, env }), /生产环境缺少或错误配置/);
  }
});

test('image preflight rejects missing Meoo connection credential', t => {
  const f = fixture(t);
  delete f.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(() => preflight(f), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('hosted image preflight cannot bypass required settings with absent or development NODE_ENV', t => {
  const f = fixture(t);
  delete f.env.ATELIER_LICENSE_PEPPER;
  for (const mode of [undefined, 'development']) {
    const env = { ...f.env, NODE_ENV: mode };
    assert.throws(() => preflight({ root: f.root, env }), /生产环境缺少或错误配置/);
  }
});

test('bundled sensitive overrides are rejected before configuration validation', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.runtime.env'), 'ATELIER_OPS_PASSWORD=\n');
  assert.throws(() => preflight(f), /must not be bundled/);
});

test('bundled target overrides participate in local validation', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.runtime.env'), 'MEOO_PROJECT_URL_ID=g8o5cv1om41o\n');
  assert.throws(() => preflight(f));
});

test('generated runtime config path and final migration guard are supported', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.runtime.env'),
    'ATELIER_RUNTIME_CONFIG_PATH="$ROOT/runtime-config.json"\nATELIER_AUTO_MIGRATE=1\n');
  assert.equal(preflight(f).autoMigrate, '0');
});

test('preflight never executes shell configuration', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.runtime.env'), 'HOST=$(echo invalid)\n');
  assert.throws(() => preflight(f), /Unsupported/);
});

test('managed image preflight keeps migration guard and requires provider configuration rather than bootstrap passwords', t => {
  const f = fixture(t);
  f.env.ATELIER_AUTH_PROVIDER = 'supabase';
  f.env.SUPABASE_ANON_KEY = 'synthetic-public';
  delete f.env.ATELIER_OPS_EMAIL; delete f.env.ATELIER_OPS_PASSWORD;
  const result = preflight(f);
  assert.equal(result.autoMigrate, '0');
  assert.equal(result.runtimeSecretInjection, 'NOT_VERIFIED');
  delete f.env.SUPABASE_ANON_KEY;
  assert.throws(() => preflight(f), /MANAGED_AUTH_PUBLIC_KEY_REQUIRED/);
});

test('service-role credential cannot be included in bundled image environment', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.runtime.env'), 'SUPABASE_SERVICE_ROLE_KEY=synthetic-only\n');
  assert.throws(() => preflight(f), /must not be bundled/);
});
