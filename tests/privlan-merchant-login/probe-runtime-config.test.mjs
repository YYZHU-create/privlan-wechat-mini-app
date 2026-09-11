/** V13 runtime configuration contract for temporary Storage probe routes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);
const API = "https://mock.invalid/functions/v1/privlan-merchant-api";
const USER_ID = "aaaaaaaa-9999-4999-8999-999999999999";
const STORE_ID = "bbbbbbbb-9999-4999-8999-999999999999";
const TOKEN = "v13-runtime-config-session-token-0123456789abcdef";
const SERVICE_ROLE_KEY = "mock-v13-service-role-key";
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const sha256hex = (value) => createHash("sha256").update(value).digest("hex");

const ENV = {
  SUPABASE_URL: "https://mock.invalid",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
};
globalThis.__DenoEnv = { get: (key) => ENV[key] };
globalThis.__DenoServe = () => {};
const { dbState, resetDb, storageState, resetStorage } = await import(
  new URL("fake-supabase.js", BUILT).href,
);
globalThis.__nodeCrypto = await import("node:crypto");

function setProbeConfig(tenantId, workspaceId) {
  if (tenantId && workspaceId) {
    ENV.MERCHANT_STORAGE_PROBE_TENANT_ID = tenantId;
    ENV.MERCHANT_STORAGE_PROBE_WORKSPACE_ID = workspaceId;
  } else {
    delete ENV.MERCHANT_STORAGE_PROBE_TENANT_ID;
    delete ENV.MERCHANT_STORAGE_PROBE_WORKSPACE_ID;
  }
}

async function loadFunction(tag) {
  let served = null;
  globalThis.__DenoServe = (callback) => {
    served = callback;
  };
  const href = new URL("index.js", BUILT).href;
  const mod = await import(`${href}?v13-runtime-config=${tag}`);
  const handler = (req) => mod.handle(req).catch((error) => mod.failure(error, mod.newRequestId("test")));
  assert.equal(typeof served, "function", "Deno.serve must receive the runtime handler");
  return { mod, handler };
}

function loadFixture(tenantId, workspaceId) {
  resetDb();
  resetStorage();
  dbState.rows = {
    users: [{ id: USER_ID, login_identifier: "runtime-config@example.invalid", password_hash: "x", display_name: "V13", avatar_url: null, status: "active" }],
    memberships: [{ user_id: USER_ID, tenant_id: tenantId, workspace_id: workspaceId, role: "owner", created_at: "2026-01-01T00:00:00Z" }],
    workspaces: [{ id: workspaceId, tenant_id: tenantId, name: "V13 合成工作区", plan_id: "PRO" }],
    tenants: [{ id: tenantId, status: "active" }],
    stores: [{ id: STORE_ID, workspace_id: workspaceId, name: "V13 合成门店", public_store_id: "pub-v13" }],
    subscriptions: [{ id: "sub-v13", workspace_id: workspaceId, plan_id: "PRO", status: "active", started_at: "2026-01-01T00:00:00Z", expires_at: null }],
    workspace_configs: [{ workspace_id: workspaceId, tenant_id: tenantId, document: {}, version: 1 }],
    merchant_sessions: [{ id: "sess-v13", user_id: USER_ID, workspace_id: workspaceId, token_hash: sha256hex(TOKEN), csrf_token_hash: "csrf-v13", expires_at: FUTURE, revoked_at: null }],
    audit_events: [],
    merchant_ai_policies: [],
  };
}

function post(handler, path) {
  return handler(new Request(API + path, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }));
}

test("V13.1 unconfigured probe routes are closed before Storage", async () => {
  setProbeConfig(null, null);
  const { mod, handler } = await loadFunction("disabled");
  loadFixture("33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444");
  for (const route of [mod.PROBE_ROUTE, mod.EXECUTE_ROUTE, mod.PROXY_ROUTE, mod.CAPACITY_ROUTE]) {
    const response = await post(handler, route);
    assert.equal(response.status, 404, route);
    assert.equal((await response.json()).code, "ROUTE_NOT_FOUND");
  }
  assert.equal(storageState.listCalls.length, 0);
  assert.equal(storageState.signCalls.length, 0);
  assert.equal(storageState.uploadCalls.length, 0);
});

test("V13.2 configured canonical scope preserves signed probe success", async () => {
  setProbeConfig("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  const { mod, handler } = await loadFunction("canonical");
  loadFixture(mod.PROBE_TENANT_ID, mod.PROBE_WORKSPACE_ID);
  const response = await post(handler, mod.PROBE_ROUTE);
  assert.equal(response.status, 200);
  assert.equal(storageState.signCalls.length, 1);
});

test("V13.3 configured foreign scope remains denied, audited, and Storage-free", async () => {
  setProbeConfig("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  const { mod, handler } = await loadFunction("foreign");
  loadFixture("99999999-9999-4999-8999-999999999999", "88888888-8888-4888-8888-888888888888");
  const response = await post(handler, mod.PROBE_ROUTE);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "PROBE_SCOPE_MISMATCH");
  assert.equal(storageState.listCalls.length, 0);
  assert.equal(storageState.signCalls.length, 0);
  assert.equal(storageState.uploadCalls.length, 0);
  const auditRows = dbState.written.audit_events || [];
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, "merchant.authorization_denied");
  assert.equal(auditRows[0].metadata.reason, "scope_identity_mismatch");
});