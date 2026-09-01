const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createSupabaseAdapter, SupabaseAdapterError } = require("../meoo-supabase-adapter");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createCustomerFixture, cleanupFixture } = require("./meoo-live-fixtures");

const SCOPE_A = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a" };
const SCOPE_B = { tenantId: "tenant-b", workspaceId: "workspace-b", storeId: "store-b" };

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body == null ? "" : JSON.stringify(body) };
}

test("lists with all trusted scope predicates and stable ordering", async () => {
  const calls = [];
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(200, [{ id: "tag-a", name: "A" }]);
  } });
  assert.deepEqual(await adapter.listTags(SCOPE_A), [{ id: "tag-a", name: "A" }]);
  assert.match(calls[0].url, /tenant_id=eq\.tenant-a/);
  assert.match(calls[0].url, /workspace_id=eq\.workspace-a/);
  assert.match(calls[0].url, /store_id=eq\.store-a/);
  assert.match(calls[0].url, /order=name\.asc/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
});

test("create uses server scope even when input carries forged scope fields", async () => {
  let request;
  const adapter = createSupabaseAdapter({ url: "https://probe.example/", serviceRoleKey: "test-key", fetchImpl: async (url, options) => {
    request = { url, options };
    return response(201, [{ id: "tag-a", name: "VIP" }]);
  } });
  await adapter.createTag(SCOPE_A, { name: "  VIP  ", tenantId: SCOPE_B.tenantId, workspaceId: SCOPE_B.workspaceId, storeId: SCOPE_B.storeId });
  const body = JSON.parse(request.options.body);
  assert.equal(body.tenant_id, SCOPE_A.tenantId);
  assert.equal(body.workspace_id, SCOPE_A.workspaceId);
  assert.equal(body.store_id, SCOPE_A.storeId);
  assert.equal(body.name, "VIP");
  assert.equal(request.options.method, "POST");
});

test("delete is scoped and returns a stable result", async () => {
  let request;
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async (url, options) => {
    request = { url, options };
    return response(200, [{ id: "tag-a" }]);
  } });
  assert.deepEqual(await adapter.deleteTag(SCOPE_A, "tag-a"), { id: "tag-a", deleted: true });
  assert.match(request.url, /tenant_id=eq\.tenant-a/);
  assert.match(request.url, /id=eq\.tag-a/);
  assert.equal(request.options.method, "DELETE");
});

test("normalizes duplicate, validation, missing and availability failures", async t => {
  for (const [status, body, code, expectedStatus] of [
    [409, { code: "23505" }, "TAG_EXISTS", 409],
    [400, { code: "23514" }, "TAG_INVALID", 400],
    [404, {}, "NOT_FOUND", 404],
    [500, { message: "opaque" }, "DATABASE_UNAVAILABLE", 503]
  ]) {
    await t.test(code, async () => {
      const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async () => response(status, body) });
      await assert.rejects(() => adapter.listTags(SCOPE_A), error => error instanceof SupabaseAdapterError && error.code === code && error.status === expectedStatus);
    });
  }
});

test("keeps non-tag conflicts distinguishable from duplicate tags", async () => {
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async () => response(409, { code: "23503", message: "foreign key violation" }) });
  await assert.rejects(() => adapter.readResource("customer_memberships", "tenant_id=eq.tenant-a"), error => error.code === "RESOURCE_CONFLICT_FOREIGN_KEY" && error.status === 409);
});

test("rejects missing scope before making a request", async () => {
  let called = false;
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async () => { called = true; return response(200, []); } });
  await assert.rejects(() => adapter.listTags({ tenantId: "tenant-a", workspaceId: "workspace-a" }), error => error.code === "SCOPE_REQUIRED");
  assert.equal(called, false);
});

test("reads and writes workspace config through the trusted scope", async () => {
  const calls = [];
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options?.method === "PATCH") return response(200, [{ document: { theme: "updated" }, version: 2, updated_at: "2026-08-31T00:00:00.000Z" }]);
    return response(200, [{ document: { theme: "initial" }, version: 1, updated_at: "2026-08-30T00:00:00.000Z" }]);
  } });
  assert.deepEqual(await adapter.readConfig(SCOPE_A), { document: { theme: "initial" }, version: 1, updatedAt: "2026-08-30T00:00:00.000Z" });
  assert.deepEqual(await adapter.writeConfig(SCOPE_A, { theme: "updated" }), { document: { theme: "updated" }, version: 2, updatedAt: "2026-08-31T00:00:00.000Z" });
  assert.match(calls[0].url, /workspace_configs\?select=.*workspace_id=eq\.workspace-a/);
  assert.match(calls[0].url, /tenant_id=eq\.tenant-a/);
  assert.match(calls[0].url, /store_id=eq\.store-a/);
  assert.equal(calls[2].options.method, "PATCH");
  assert.match(calls[2].url, /version=eq\.1/);
  const patchBody = JSON.parse(calls[2].options.body);
  assert.deepEqual({ document: patchBody.document, version: patchBody.version }, { document: { theme: "updated" }, version: 2 });
  assert.doesNotThrow(() => new Date(patchBody.updated_at).toISOString());
});

test("reports a config conflict when the optimistic version update affects no row", async () => {
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async (url, options) => options?.method === "PATCH"
    ? response(200, [])
    : response(200, [{ document: {}, version: 4, updated_at: "2026-08-30T00:00:00.000Z" }]) });
  await assert.rejects(() => adapter.writeConfig(SCOPE_A, { changed: true }), error => error.code === "CONFIG_CONFLICT" && error.status === 409);
});

test("reads subscription and AI policy through scoped Meoo resources", async () => {
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "test-key", fetchImpl: async (url) => {
    if (url.includes("/subscriptions?")) return response(200, [{ id: "sub-a", plan_id: "TRIAL", status: "active" }]);
    return response(200, [{ tenant_id: SCOPE_A.tenantId, workspace_id: SCOPE_A.workspaceId, store_id: SCOPE_A.storeId, mode: "rules", connection_id: null, fallback_to_rules: true }]);
  } });
  assert.equal((await adapter.getSubscription(SCOPE_A)).id, "sub-a");
  assert.equal((await adapter.getAiPolicy(SCOPE_A)).mode, "rules");
});

test("portable PostgreSQL customer tag service matches adapter contract", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    const saas = createSaasService({ db, licensePepper: "b1-parity-license-pepper" });
    const owner = await saas.register({ login: `b1-owner-${crypto.randomUUID()}@example.com`, password: "password-a1", storeName: "B1 Owner", template: "blank" });
    const other = await saas.register({ login: `b1-other-${crypto.randomUUID()}@example.com`, password: "password-b1", storeName: "B1 Other", template: "blank" });
    const scopeA = { tenantId: owner.workspace.tenantId, workspaceId: owner.workspace.id, storeId: owner.workspace.storeId, userId: owner.user.id };
    const scopeB = { tenantId: other.workspace.tenantId, workspaceId: other.workspace.id, storeId: other.workspace.storeId, userId: other.user.id };
    const tag = await saas.customerService.createTag(scopeA, { name: "B1 parity" });
    assert.deepEqual((await saas.customerService.listTags(scopeA)).map(row => row.name), ["B1 parity"]);
    assert.deepEqual(await saas.customerService.listTags(scopeB), []);
    await assert.rejects(() => saas.customerService.createTag(scopeA, { name: "B1 parity" }), error => error.code === "TAG_EXISTS" && error.status === 409);
    const stored = (await db.query("select tenant_id,workspace_id,store_id from customer_tags where id=$1", [tag.id])).rows[0];
    assert.equal(stored.tenant_id, scopeA.tenantId);
    assert.equal(stored.workspace_id, scopeA.workspaceId);
    assert.equal(stored.store_id, scopeA.storeId);
  } finally {
    await db.close();
  }
});

if (process.env.MEOO_B1_LIVE) test("live Meoo CRUD proves tenant isolation and cleanup when explicitly enabled", async () => {
  const adapter = createSupabaseAdapter({ table: process.env.MEOO_B1_TABLE || "customer_tags" });
  const fixtureA = await createCustomerFixture();
  const fixtureB = await createCustomerFixture(fixtureA.client);
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  const scopeA = { tenantId: fixtureA.tenantId, workspaceId: fixtureA.workspaceId, storeId: fixtureA.storeId };
  const scopeB = { tenantId: fixtureB.tenantId, workspaceId: fixtureB.workspaceId, storeId: fixtureB.storeId };
  try {
    const tagA = await adapter.createTag(scopeA, { id: idA, name: `B1-A-${idA.slice(0, 8)}` });
    const tagB = await adapter.createTag(scopeB, { id: idB, name: `B1-B-${idB.slice(0, 8)}` });
    assert.equal((await adapter.listTags(scopeA)).some(row => row.id === tagA.id), true);
    assert.equal((await adapter.listTags(scopeA)).some(row => row.id === tagB.id), false);
    await assert.rejects(() => adapter.deleteTag(scopeA, tagB.id), error => error.code === "NOT_FOUND");
    await adapter.deleteTag(scopeA, tagA.id);
    await adapter.deleteTag(scopeB, tagB.id);
  } finally {
    try { await adapter.deleteTag(scopeA, idA); } catch {}
    try { await adapter.deleteTag(scopeB, idB); } catch {}
    await cleanupFixture(fixtureB);
    await cleanupFixture(fixtureA);
  }
});
