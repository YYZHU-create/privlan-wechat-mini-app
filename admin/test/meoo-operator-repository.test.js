const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeooOperatorRepository } = require('../meoo-operator-repository');
const { hashPassword } = require('../platform-store');
function response(status, body) { return { ok: status >= 200 && status < 300, status, text: async () => body == null ? '' : JSON.stringify(body) }; }

test('Meoo operator repository reads, writes sessions, diagnostics and flags through REST', async () => {
  const calls = [];
  const op = { id: 'op-1', email: 'ops@example.com', display_name: 'Ops', password_hash: hashPassword('secret-pass'), role: 'super_admin', status: 'active' };
  const flag = { id: 'flag-1', key: 'marketing.enabled', default_enabled: false };
  const repo = createMeooOperatorRepository({ url: 'https://probe.example', serviceRoleKey: 'test-key', fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/operator_users?select=id&')) return response(200, [{ id: op.id }]);
    if (url.includes('/operator_users?select=id,email')) return response(200, [op]);
    if (url.includes('/operator_users?select=id,email,display_name')) return response(200, [op]);
    if (url.includes('/operator_sessions?select=id,operator_id')) return response(200, [{ id: 'session-1', operator_id: op.id, token_hash: 'hash', expires_at: '2999-01-01T00:00:00Z' }]);
    if (url.includes('/operator_feature_flags?select=id,key&')) return response(200, [flag]);
    if (url.includes('/operator_feature_flags?select=id,key,default_enabled')) return response(200, [flag]);
    if (url.includes('/tenants?select=id,name,status')) return response(200, [{ id: 'tenant-1', name: 'Tenant', status: 'active', created_at: '2026-01-01T00:00:00Z' }]);
    if (url.includes('/workspaces?select=id,tenant_id')) return response(200, [{ id: 'workspace-1', tenant_id: 'tenant-1', name: 'Workspace', plan_id: 'PRO', created_at: '2026-01-01T00:00:00Z' }]);
    if (url.includes('/stores?select=id,tenant_id')) return response(200, [{ id: 'store-1', tenant_id: 'tenant-1', workspace_id: 'workspace-1', name: 'Store' }]);
    if (url.includes('/subscriptions?select=id')) return response(200, [{ id: 'sub-1', tenant_id: 'tenant-1', workspace_id: 'workspace-1', plan_id: 'PRO', status: 'active', expires_at: null }]);
    if (url.includes('/plan_catalog?select=')) return response(200, [{ id: 'PRO', display_name: 'PRO', price_fen: 29900, duration_hours: 720, public: true, entitlements: {} }]);
    if (url.includes('/audit_events?select=')) return response(200, []);
    if (options.method === 'PATCH') return response(200, [{ id: 'tenant-1', name: 'Tenant', status: 'suspended' }]);
    if (options.method === 'POST') return response(201, [{ id: 'new-1', ...JSON.parse(options.body || '{}') }]);
    return response(200, []);
  } });
  assert.equal(await repo.operatorAuthConfigured(), true);
  assert.equal((await repo.findOperatorByEmail(op.email)).id, op.id);
  assert.equal((await repo.createSession({ id: 'session-1', operator_id: op.id, token_hash: 'hash', expires_at: '2999-01-01T00:00:00Z' })).id, 'session-1');
  assert.equal((await repo.resolveSession('hash')).user_id, op.id);
  await repo.revokeSession('session-1');
  assert.equal((await repo.health()).database, 'ok');
  assert.equal((await repo.setTenantStatus({ id: op.id }, 'tenant-1', 'suspended')).status, 'suspended');
  assert.equal((await repo.upsertFlag({ id: op.id }, { key: flag.key, defaultEnabled: true })).id, 'new-1');
  assert.equal((await repo.setOverride({ id: op.id }, flag.key, 'tenant-1', 'workspace-1', true)).enabled, true);
  assert.equal((await repo.resolveFlag({ tenantId: 'tenant-1', workspaceId: 'workspace-1' }, flag.key)), false);
  const bootstrap = await repo.bootstrap();
  assert.equal(bootstrap.tenants[0].workspaceName, 'Workspace');
  assert.equal(calls.some(call => call.options.headers.Authorization === 'Bearer test-key'), true);
});

