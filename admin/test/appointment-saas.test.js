const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DateTime } = require("luxon");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createAppointmentService } = require("../appointment-service");
const { applyImport, inspectImport, sourceHash } = require("../appointment-import");
const { verifyGateway } = require("../appointment-routes");

process.env.NODE_ENV = "test";
const OPENID_KEY = "test-openid-key-which-is-at-least-32-bytes-long";

async function fixture(name = "预约测试店") {
  process.env.ATELIER_OPENID_HASH_KEY = OPENID_KEY;
  const db = await createPortableTestDatabase();
  const saas = createSaasService({ db, licensePepper: "test-license-pepper-which-is-at-least-32-bytes" });
  const registration = await saas.register({ login: `${Date.now()}-${Math.random()}@example.com`, password: "test-password", storeName: name, template: "blank" });
  await db.query("update subscriptions set status='active',expires_at=$1 where workspace_id=$2", [new Date("2031-01-01T00:00:00Z"), registration.workspace.id]);
  const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, subscription: { status: "active" } };
  const service = createAppointmentService({ db, openIdHashKey: OPENID_KEY, now: () => DateTime.fromISO("2030-01-01T00:00:00Z") });
  const store = (await db.query("select * from stores where id=$1", [scope.storeId])).rows[0];
  const resources = { services: await service.listServices(scope), advisors: await service.listAdvisors(scope) };
  return { db, service, scope, store, ...resources };
}

async function configure(base, values = {}) {
  await base.service.updateSettings(base.scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 15, defaultBufferMinutes: 15, maxAdvanceDays: 30, bookingEnabled: true, ...values });
  const svc = base.services[0];
  await base.service.saveService(base.scope, { ...svc, durationMinutes: values.durationMinutes || 120, bufferMinutesOverride: values.bufferMinutesOverride ?? null }, svc.id);
  base.services = await base.service.listServices(base.scope);
}

function booking(base, overrides = {}) {
  return { publicStoreId: base.store.public_store_id, openid: "openid-a", customerName: "测试客户", customerPhone: "13800138000", serviceId: base.services[0].id, advisorId: base.advisors[0].id, startAt: "2030-01-02T01:00:00.000Z", notes: "需要深色面料", idempotencyKey: `key-${Math.random()}`, ...overrides };
}

test("slot generation supports intervals through 300 minutes", async () => {
  const base = await fixture();
  try {
    for (const interval of [10,15,20,30,45,60,90,120,150,180,210,240,270,300]) {
      await configure(base, { slotIntervalMinutes: interval, durationMinutes: 60, defaultBufferMinutes: 1, bufferMinutesOverride: 0 });
      const result = await base.service.availableOptions({ publicStoreId: base.store.public_store_id, date: "2030-01-02", serviceId: base.services[0].id });
      assert.ok(result.slots.length > 1, `${interval} minute interval has slots`);
      const first = DateTime.fromISO(result.slots[0].startAt); const second = DateTime.fromISO(result.slots[1].startAt);
      assert.equal(second.diff(first,"minutes").minutes, interval);
    }
  } finally { await base.db.close(); }
});

test("booking rules accept interval and default buffer boundaries without lead time", async () => {
  const base = await fixture();
  const rules = { timezone: "Asia/Shanghai", slotIntervalMinutes: 300, defaultBufferMinutes: 1, maxAdvanceDays: 30, bookingEnabled: true };
  try {
    assert.deepEqual(await base.service.updateSettings(base.scope, { ...rules, minAdvanceMinutes: 525600 }), rules);
    assert.equal((await base.db.query("select min_advance_minutes from appointment_settings where store_id=$1", [base.scope.storeId])).rows[0].min_advance_minutes, 0);
    assert.equal((await base.service.availableOptions({ publicStoreId: base.store.public_store_id, date: "2030-01-01" })).slots[0].label, "09:00–10:00");
    assert.equal((await base.service.updateSettings(base.scope, { ...rules, defaultBufferMinutes: 30 })).defaultBufferMinutes, 30);
    await assert.rejects(() => base.service.updateSettings(base.scope, { ...rules, slotIntervalMinutes: 305 }), error => error.code === "APPOINTMENT_SETTINGS_INVALID");
    await assert.rejects(() => base.service.updateSettings(base.scope, { ...rules, defaultBufferMinutes: 0 }), error => error.code === "APPOINTMENT_SETTINGS_INVALID");
    await assert.rejects(() => base.service.updateSettings(base.scope, { ...rules, defaultBufferMinutes: 31 }), error => error.code === "APPOINTMENT_SETTINGS_INVALID");
  } finally { await base.db.close(); }
});

test("buffer uses half-open overlap boundaries and cancellation releases the slot", async () => {
  const base = await fixture();
  try {
    await configure(base);
    const first = await base.service.createAppointment(booking(base,{idempotencyKey:"first"}));
    assert.equal(first.durationMinutes,120);
    await assert.rejects(() => base.service.createAppointment(booking(base,{openid:"openid-b",customerPhone:"13900139000",startAt:"2030-01-02T03:00:00.000Z",idempotencyKey:"at-1100"})), error => error.code === "APPOINTMENT_CONFLICT");
    await assert.rejects(() => base.service.createAppointment(booking(base,{openid:"openid-c",customerPhone:"13700137000",startAt:"2030-01-02T03:14:00.000Z",idempotencyKey:"at-1114"})), error => ["APPOINTMENT_CONFLICT","SLOT_UNAVAILABLE"].includes(error.code));
    const boundary = await base.service.createAppointment(booking(base,{openid:"openid-d",customerPhone:"13600136000",startAt:"2030-01-02T03:15:00.000Z",idempotencyKey:"at-1115"}));
    assert.equal(boundary.status,"待确认");
    const rows = await base.service.listAppointments(base.scope);
    const firstRow = rows.find(item=>item.number===first.number);
    await base.service.updateStatus(base.scope,firstRow.id,"cancelled");
    const reopened = await base.service.createAppointment(booking(base,{openid:"openid-e",customerPhone:"13500135000",idempotencyKey:"after-cancel"}));
    assert.equal(reopened.status,"待确认");
  } finally { await base.db.close(); }
});

test("idempotency, customer identity, advisor isolation and snapshots remain stable", async () => {
  const base = await fixture();
  try {
    await configure(base);
    const input = booking(base,{idempotencyKey:"same-request"});
    const first = await base.service.createAppointment(input); const retry = await base.service.createAppointment(input);
    assert.equal(retry.number,first.number); assert.equal(retry.idempotent,true);
    const secondAdvisor = await base.service.saveAdvisor(base.scope,{name:"第二位顾问",enabled:true});
    await base.service.createAppointment(booking(base,{openid:"openid-b",customerPhone:"13900139000",advisorId:secondAdvisor.id,idempotencyKey:"other-advisor"}));
    await base.service.createAppointment(booking(base,{startAt:"2030-01-03T01:00:00.000Z",idempotencyKey:"same-customer-next-day"}));
    assert.equal(Number((await base.db.query("select count(*)::int n from customers where workspace_id=$1",[base.scope.workspaceId])).rows[0].n),2);
    assert.equal(Number((await base.db.query("select count(*)::int n from appointments where workspace_id=$1",[base.scope.workspaceId])).rows[0].n),3);
    const original = (await base.db.query("select * from appointments where appointment_number=$1",[first.number])).rows[0];
    await base.service.saveService(base.scope,{...base.services[0],durationMinutes:90,bufferMinutesOverride:0},base.services[0].id);
    const historical = (await base.db.query("select * from appointments where id=$1",[original.id])).rows[0];
    assert.equal(Number(historical.duration_minutes_snapshot),120); assert.equal(Number(historical.buffer_minutes_snapshot),15);
  } finally { await base.db.close(); }
});

test("same OpenID is isolated by workspace and merchant reads are tenant scoped", async () => {
  const first = await fixture("工作区 A"); const second = await fixture("工作区 B");
  try {
    await configure(first,{durationMinutes:60,defaultBufferMinutes:1,bufferMinutesOverride:0}); await configure(second,{durationMinutes:60,defaultBufferMinutes:1,bufferMinutesOverride:0});
    await first.service.createAppointment(booking(first,{openid:"shared-openid",idempotencyKey:"workspace-a"}));
    await second.service.createAppointment(booking(second,{openid:"shared-openid",idempotencyKey:"workspace-b"}));
    assert.equal((await first.service.listPublicAppointments({publicStoreId:first.store.public_store_id,openid:"shared-openid"})).length,1);
    assert.equal((await second.service.listPublicAppointments({publicStoreId:second.store.public_store_id,openid:"shared-openid"})).length,1);
    const foreignId=(await first.service.listAppointments(first.scope))[0].id;
    await assert.rejects(()=>second.service.getAppointment(second.scope,foreignId),error=>error.code==="APPOINTMENT_NOT_FOUND");
  } finally { await first.db.close(); await second.db.close(); }
});

test("expired subscription blocks options and create but preserves appointment history", async () => {
  const base=await fixture();
  try{await configure(base,{durationMinutes:60,defaultBufferMinutes:1,bufferMinutesOverride:0});await base.service.createAppointment(booking(base,{idempotencyKey:"before-expiry"}));await base.db.query("update subscriptions set status='inactive' where workspace_id=$1",[base.scope.workspaceId]);await assert.rejects(()=>base.service.availableOptions({publicStoreId:base.store.public_store_id,date:"2030-01-02"}),error=>error.code==="STORE_BOOKING_UNAVAILABLE");assert.equal((await base.service.listPublicAppointments({publicStoreId:base.store.public_store_id,openid:"openid-a"})).length,1);}finally{await base.db.close();}
});

test("explicit invalid services and non-aligned instants are rejected", async () => {
  const base = await fixture();
  try {
    await configure(base, { durationMinutes: 60, defaultBufferMinutes: 1, bufferMinutesOverride: 0 });
    await assert.rejects(() => base.service.availableOptions({ publicStoreId: base.store.public_store_id, date: "2030-01-02", serviceId: crypto.randomUUID() }), error => error.code === "INVALID_INPUT");
    await assert.rejects(() => base.service.createAppointment(booking(base, { startAt: "2030-01-02T01:00:30.000Z", idempotencyKey: "seconds-not-aligned" })), error => error.code === "SLOT_UNAVAILABLE");
  } finally { await base.db.close(); }
});

test("gateway credentials distinguish missing configuration from invalid authorization", () => {
  const previous = process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN;
  try {
    delete process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN;
    assert.throws(() => verifyGateway({ get: () => "" }), error => error.status === 503 && error.code === "APPOINTMENT_GATEWAY_NOT_CONFIGURED");
    process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN = "gateway-test-token-at-least-32-bytes";
    assert.throws(() => verifyGateway({ get: () => "Bearer wrong" }), error => error.status === 401 && error.code === "GATEWAY_AUTH_INVALID");
    assert.doesNotThrow(() => verifyGateway({ get: () => `Bearer ${process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN}` }));
  } finally {
    if (previous === undefined) delete process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN; else process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN = previous;
  }
});

test("legacy appointment import is dry-run by default and idempotent by source hash", async () => {
  const base = await fixture("导入目标店");
  const document = {
    version: 1,
    sourceKind: "normalized_json",
    services: [{ sourceId: "svc-legacy", name: "历史量体", durationMinutes: 135, bufferMinutesOverride: 0 }],
    advisors: [{ sourceId: "advisor-legacy", name: "历史顾问", serviceSourceIds: [] }],
    businessHours: [{ weekday: 3, startTime: "09:00", endTime: "18:00", enabled: true }],
    appointments: [{ sourceId: "appt-1", customerName: "历史客户", customerPhone: "13800138000", serviceSourceId: "svc-legacy", advisorSourceId: "advisor-legacy", startAt: "2029-12-20T02:00:00.000Z", status: "completed", notes: "历史备注" }]
  };
  const hash = sourceHash(Buffer.from(JSON.stringify(document)));
  try {
    const dryRun = (await inspectImport({ db: base.db, publicStoreId: base.store.public_store_id, document, hash })).report;
    assert.equal(dryRun.status, "ready");
    assert.equal(Number((await base.db.query("select count(*)::int n from appointment_import_runs")).rows[0].n), 0);
    const applied = await applyImport({ db: base.db, publicStoreId: base.store.public_store_id, document, hash });
    assert.equal(applied.importedAppointments, 1);
    const repeated = await applyImport({ db: base.db, publicStoreId: base.store.public_store_id, document, hash });
    assert.equal(repeated.status, "already_imported");
    assert.equal(Number((await base.db.query("select count(*)::int n from appointments where source='import'")).rows[0].n), 1);
    assert.equal((await base.db.query("select wechat_openid_hash from customers where source='import'")).rows[0].wechat_openid_hash, null);
    const audit = JSON.stringify((await base.db.query("select metadata from audit_events where action='appointment.legacy_import'")).rows[0].metadata);
    assert.doesNotMatch(audit, /13800138000|历史备注/);
  } finally { await base.db.close(); }
});

test("service and advisor deletes preserve resources referenced by appointment history", async () => {
  const base = await fixture();
  try {
    await configure(base, { durationMinutes: 60, defaultBufferMinutes: 1, bufferMinutesOverride: 0 });
    const disposableService = await base.service.saveService(base.scope, { name: "临时服务", durationMinutes: 30, bufferMinutesOverride: null, enabled: true });
    const disposableAdvisor = await base.service.saveAdvisor(base.scope, { name: "临时顾问", enabled: true });
    assert.deepEqual(await base.service.removeService(base.scope, disposableService.id), { id: disposableService.id, deleted: true });
    assert.deepEqual(await base.service.removeAdvisor(base.scope, disposableAdvisor.id), { id: disposableAdvisor.id, deleted: true });
    await base.service.createAppointment(booking(base, { idempotencyKey: "resource-history" }));
    await assert.rejects(() => base.service.removeService(base.scope, base.services[0].id), error => error.code === "APPOINTMENT_RESOURCE_IN_USE" && error.status === 409);
    await assert.rejects(() => base.service.removeAdvisor(base.scope, base.advisors[0].id), error => error.code === "APPOINTMENT_RESOURCE_IN_USE" && error.status === 409);
  } finally { await base.db.close(); }
});
