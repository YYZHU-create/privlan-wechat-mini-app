const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { resolveDatabaseBackend, createNativeDatabaseAdapter, DatabaseBackendError } = require("../database-adapter");
const { validateDatabaseBackend } = require("../runtime-config");
const { createAppointmentService } = require("../appointment-service");
const { createMeooAppointmentRepository } = require("../meoo-appointment-repository");
const { createSupabaseAdapter } = require("../meoo-supabase-adapter");
const { createCustomerService } = require("../customer-service");
const { createAppointmentFixture, createCustomerFixture, cleanupFixture, scopedDatabase } = require("./meoo-live-fixtures");

test("native remains the default and invalid backends fail closed", () => {
  assert.equal(resolveDatabaseBackend({}), "native");
  assert.equal(resolveDatabaseBackend({ ATELIER_DB_BACKEND: "NATIVE" }), "native");
  assert.throws(() => resolveDatabaseBackend({ ATELIER_DB_BACKEND: "invalid" }), error => error instanceof DatabaseBackendError && error.code === "DATABASE_BACKEND_INVALID");
});

test("Meoo backend validates server-only configuration", () => {
  assert.throws(() => validateDatabaseBackend({ ATELIER_DB_BACKEND: "meoo" }), /DATABASE_URL/);
  assert.throws(() => validateDatabaseBackend({ ATELIER_DB_BACKEND: "meoo", DATABASE_URL: "postgresql://native/app" }), /SUPABASE_URL/);
  assert.throws(() => validateDatabaseBackend({ ATELIER_DB_BACKEND: "meoo", DATABASE_URL: "postgresql://native/app", SUPABASE_URL: "https://probe.example" }), /SERVICE_ROLE_KEY/);
  assert.equal(validateDatabaseBackend({ ATELIER_DB_BACKEND: "meoo", DATABASE_URL: "postgresql://native/app", SUPABASE_URL: "https://probe.example", SUPABASE_SERVICE_ROLE_KEY: "server-only" }), "meoo");
});

test("native adapter delegates lifecycle without changing transaction behavior", async () => {
  const calls = [];
  const db = { query: async (...args) => { calls.push(["query", ...args]); return { rows: [] }; }, transaction: async fn => { calls.push(["begin"]); const result = await fn({ query: db.query }); calls.push(["commit"]); return result; }, close: async () => calls.push(["close"]), health: async () => { calls.push(["health"]); return true; } };
  const adapter = createNativeDatabaseAdapter(db);
  await adapter.query("select 1");
  await adapter.transaction(tx => tx.query("select 2"));
  await adapter.health();
  await adapter.close();
  assert.deepEqual(calls.map(call => call[0]), ["query", "begin", "query", "commit", "health", "close"]);
});

test("real AppointmentService dispatches to the Meoo repository path", async () => {
  let received;
  const db = { query: async () => ({ rows: [{ store_id: "store-a", tenant_id: "tenant-a", workspace_id: "workspace-a", store_name: "B1 店", public_store_id: "public-a", subscription_status: "active", expires_at: null, timezone: "Asia/Shanghai", slot_interval_minutes: 15, default_buffer_minutes: 0, max_advance_days: 30, booking_enabled: true }] }) };
  const repository = { createAppointment: async (input, context) => { received = { input, context }; return { number: "AT-B1", status: "待确认" }; } };
  const service = createAppointmentService({ db, openIdHashKey: "b1-test-openid-hash-key-32-bytes!!", appointmentRepository: repository, customerService: { findOrCreateCustomer() {}, appendEvent() {} } });
  const result = await service.createAppointment({ publicStoreId: "public-a", customerName: "客户", customerPhone: "13800138000", openid: "openid", idempotencyKey: "b1-key", serviceId: "service-a", advisorId: "advisor-a", startAt: "2030-01-01T01:00:00.000Z" }, { requestId: "b1-request" });
  assert.deepEqual(result, { number: "AT-B1", status: "待确认" });
  assert.equal(received.input.scope.tenantId, "tenant-a");
  assert.equal(received.input.scope.workspaceId, "workspace-a");
  assert.equal(received.input.scope.storeId, "store-a");
  assert.equal(received.input.openidHash.length, 64);
  assert.equal(received.context.requestId, "b1-request");
});

test("Meoo appointment repository sends one RPC request and normalizes conflict", async () => {
  let call;
  const repo = createMeooAppointmentRepository({ adapter: { callRpc: async (...args) => { call = args; return { ok: true, data: { number: "AT-1" } }; } } });
  const result = await repo.createAppointment({ scope: { tenantId: "t", workspaceId: "w", storeId: "s", publicStoreId: "p" }, customerName: "客户", openidHash: "h", idempotencyKey: "k" }, { requestId: "r" });
  assert.deepEqual(result, { number: "AT-1" });
  assert.equal(call[0], "atelier_create_appointment");
  assert.equal(call[1].p_tenant_id, "t");
  assert.equal(call[1].p_workspace_id, "w");
  assert.equal(call[1].p_store_id, "s");
  const conflict = createMeooAppointmentRepository({ adapter: { callRpc: async () => ({ code: "APPOINTMENT_CONFLICT" }) } });
  await assert.rejects(() => conflict.createAppointment({ scope: { tenantId: "t", workspaceId: "w", storeId: "s" }, openidHash: "h", idempotencyKey: "k" }), error => error.code === "APPOINTMENT_CONFLICT" && error.status === 409);
});

test("Meoo appointment repository preserves provider business error semantics", async () => {
  for (const [code, status] of [["APPOINTMENT_SCOPE_INVALID", 400], ["CUSTOMER_SCOPE_CONFLICT", 409], ["SLOT_UNAVAILABLE", 409], ["INVALID_INPUT", 400]]) {
    const repo = createMeooAppointmentRepository({ adapter: { callRpc: async () => ({ code }) } });
    await assert.rejects(() => repo.createAppointment({ scope: { tenantId: "t", workspaceId: "w", storeId: "s" }, openidHash: "h", idempotencyKey: "k" }), error => error.code === code && error.status === status);
  }
});

test("Meoo adapter emits provider-neutral operation metrics without payloads", async () => {
  const events = [];
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "server-only", onEvent: event => events.push(event), fetchImpl: async () => ({ ok: true, status: 200, text: async () => "[]" }) });
  await adapter.listTags({ tenantId: "t", workspaceId: "w", storeId: "s" });
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ["backend", "durationMs", "errorCategory", "operation", "success"]);
  assert.equal(events[0].backend, "meoo");
  assert.equal(events[0].success, true);
});

test("synthetic merchant session adapter preserves hashed fields and scope filters", async () => {
  const calls = [];
  const adapter = createSupabaseAdapter({ url: "https://probe.example", serviceRoleKey: "server-only", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return { ok: true, status: 201, text: async () => JSON.stringify([{ id: "session-a", user_id: "user-a", tenant_id: "tenant-a", workspace_id: "workspace-a", token_hash: "hash", csrf_token_hash: "csrf" }]) };
    if (options.method === "DELETE") return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "session-a" }]) };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "session-a", user_id: "user-a", token_hash: "hash", csrf_token_hash: "csrf" }]) };
  } });
  const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a" };
  const created = await adapter.createSession(scope, { userId: "user-a", tokenHash: "hash", csrfTokenHash: "csrf", expiresAt: "2030-01-01T00:00:00Z" });
  assert.equal(created.id, "session-a");
  assert.equal((await adapter.findSession(scope, "session-a")).user_id, "user-a");
  assert.deepEqual(await adapter.revokeSession(scope, "session-a"), { id: "session-a", revoked: true });
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /tenant_id=eq\.tenant-a/);
  assert.match(calls[1].url, /workspace_id=eq\.workspace-a/);
  assert.match(calls[2].url, /workspace_id=eq\.workspace-a/);
});

test("service-role credentials are not referenced by frontend assets", () => {
  const publicRoot = path.resolve(__dirname, "../public");
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else files.push(full); } };
  walk(publicRoot);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /SUPABASE_SERVICE_ROLE_KEY|MEOO_PROJECT_API_KEY/);
});

if (process.env.MEOO_B1_LIVE) test("real AppointmentService reaches current Meoo RPC through a valid synthetic graph", async () => {
  const adapter = createSupabaseAdapter();
  const fixture = await createAppointmentFixture();
  const service = createAppointmentService({ db: scopedDatabase(fixture), openIdHashKey: "b1-live-openid-hash-key-32-bytes!!", appointmentRepository: createMeooAppointmentRepository({ adapter }) });
  const start = new Date(Date.now() + 86400000); start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 15) * 15, 0, 0);
  const makeInput = (phone, idempotencyKey = crypto.randomUUID()) => ({ publicStoreId: fixture.publicStoreId, customerName: "B1 synthetic customer", customerPhone: phone, openid: `b1-openid-${phone}`, idempotencyKey, serviceId: fixture.serviceId, advisorId: fixture.advisorId, startAt: start.toISOString() });
  try {
    const first = makeInput("13800138000");
    const created = await service.createAppointment(first);
    assert.ok(created.number);
    assert.equal((await service.createAppointment(first)).idempotent, true);
    const concurrentStart = new Date(start.getTime() + 3600000).toISOString();
    const inputs = [makeInput("13900139000"), makeInput("13700137000")].map(input => ({ ...input, startAt: concurrentStart }));
    const results = await Promise.all(inputs.map(input => service.createAppointment(input).catch(error => error)));
    assert.equal(results.filter(result => result.number).length, 1);
    assert.equal(results.filter(result => result.code === "APPOINTMENT_CONFLICT").length, 1);
    const forgedDb = scopedDatabase(fixture, { scopeOverride: { tenantId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), storeId: crypto.randomUUID() } });
    const forgedService = createAppointmentService({ db: forgedDb, openIdHashKey: "b1-live-openid-hash-key-32-bytes!!", appointmentRepository: createMeooAppointmentRepository({ adapter }) });
    await assert.rejects(() => forgedService.createAppointment(makeInput("13600136000")), error => error.code === "APPOINTMENT_SCOPE_INVALID");
  } finally {
    await cleanupFixture(fixture);
  }
});

if (process.env.MEOO_B1_LIVE) test("real CustomerService uses Meoo tag repository with trusted scope", async () => {
  const adapter = createSupabaseAdapter({ table: process.env.MEOO_B1_TABLE || "customer_tags" });
  const service = createCustomerService({ db: {}, tagRepository: adapter });
  const fixtureA = await createCustomerFixture();
  const fixtureB = await createCustomerFixture(fixtureA.client);
  const scopeA = { tenantId: fixtureA.tenantId, workspaceId: fixtureA.workspaceId, storeId: fixtureA.storeId };
  const scopeB = { tenantId: fixtureB.tenantId, workspaceId: fixtureB.workspaceId, storeId: fixtureB.storeId };
  const tag = await service.createTag(scopeA, { name: `B1-service-${crypto.randomUUID().slice(0, 8)}`, tenantId: scopeB.tenantId, workspaceId: scopeB.workspaceId, storeId: scopeB.storeId });
  try {
    assert.equal((await service.listTags(scopeA)).some(row => row.id === tag.id), true);
    assert.equal((await service.listTags(scopeB)).some(row => row.id === tag.id), false);
    await adapter.deleteTag(scopeA, tag.id);
  } finally {
    try { await adapter.deleteTag(scopeA, tag.id); } catch {}
    await cleanupFixture(fixtureB);
    await cleanupFixture(fixtureA);
  }
});
