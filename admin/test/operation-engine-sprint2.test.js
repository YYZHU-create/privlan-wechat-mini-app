const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DateTime } = require("luxon");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createAppointmentService } = require("../appointment-service");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
const OPENID_KEY = "sprint2-operation-openid-key-at-least-32-bytes";

async function fixture(name = "Operation Engine 店") {
  const db = await createPortableTestDatabase();
  const saas = createSaasService({ db, licensePepper: "sprint2-operation-license-key-at-least-32" });
  const registration = await saas.register({ login: `${Date.now()}-${Math.random()}@example.test`, password: `test-${crypto.randomUUID()}`, storeName: name, template: "blank" });
  await db.query("update subscriptions set status='active',expires_at=$1 where workspace_id=$2", [new Date("2031-01-01T00:00:00Z"), registration.workspace.id]);
  const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, subscription: { status: "active" } };
  const service = createAppointmentService({ db, openIdHashKey: OPENID_KEY, now: () => DateTime.fromISO("2030-01-01T00:00:00Z") });
  await service.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 30, defaultBufferMinutes: 1, maxAdvanceDays: 30, bookingEnabled: true });
  const services = await service.listServices(scope);
  await service.saveService(scope, { ...services[0], durationMinutes: 60, bufferMinutesOverride: 0 }, services[0].id);
  const store = (await db.query("select * from stores where id=$1", [scope.storeId])).rows[0];
  return { db, saas, service, scope, store, serviceRow: (await service.listServices(scope))[0] };
}
function booking(base, overrides = {}) { return { publicStoreId: base.store.public_store_id, openid: "sprint2-openid-a", customerName: "Operation 客户", customerPhone: "13800138000", serviceId: base.serviceRow.id, startAt: "2030-01-02T01:00:00.000Z", idempotencyKey: `sprint2-${crypto.randomUUID()}`, ...overrides }; }

test("Operation Engine maps legacy advisors, applies schedule, leave, capability and scoped Staff APIs", async () => {
  const base = await fixture();
  try {
    const legacy = (await base.service.listAdvisors(base.scope))[0];
    assert.ok(legacy.staffId);
    const initialStaff = await base.service.listStaff(base.scope);
    assert.equal(initialStaff.length, 1);
    assert.equal(initialStaff[0].id, legacy.staffId);
    const staff = await base.service.saveStaff(base.scope, { displayName: "第二位员工", title: "造型顾问" });
    assert.ok(staff.advisorId);
    await base.service.setStaffCapabilities(base.scope, staff.id, { serviceIds: [] });
    const unavailable = await base.service.merchantAvailability(base.scope, { storeId: base.scope.storeId, serviceId: base.serviceRow.id, staffId: staff.id, date: "2030-01-02" });
    assert.equal(unavailable.slots.some(slot => slot.available), false);
    await base.service.setStaffCapabilities(base.scope, staff.id, { serviceIds: [base.serviceRow.id] });
    await base.service.replaceStaffSchedules(base.scope, staff.id, { schedules: [{ weekday: 3, startTime: "10:00", endTime: "12:00", enabled: true }] });
    const scheduled = await base.service.merchantAvailability(base.scope, { storeId: base.scope.storeId, serviceId: base.serviceRow.id, staffId: staff.id, date: "2030-01-02" });
    assert.equal(scheduled.slots.find(slot => slot.startAt === "2030-01-02T01:00:00.000Z").available, false);
    assert.equal(scheduled.slots.find(slot => slot.startAt === "2030-01-02T02:00:00.000Z").available, true);
    const leave = await base.service.saveStaffLeave(base.scope, staff.id, { startAt: "2030-01-02T02:00:00.000Z", endAt: "2030-01-02T03:00:00.000Z", reason: "培训" });
    assert.ok(leave.id);
    const leaveAvailability = await base.service.merchantAvailability(base.scope, { storeId: base.scope.storeId, serviceId: base.serviceRow.id, staffId: staff.id, date: "2030-01-02" });
    assert.equal(leaveAvailability.slots.find(slot => slot.startAt === "2030-01-02T02:00:00.000Z").available, false);
    await base.service.removeStaffLeave(base.scope, staff.id, leave.id);
    assert.equal((await base.service.listStaffLeaves(base.scope, staff.id)).length, 0);
    const leaveAudit = (await base.db.query("select action,tenant_id,workspace_id,resource_id,metadata from audit_events where action='leave.delete' and resource_id=$1", [leave.id])).rows[0];
    assert.equal(leaveAudit.action, "leave.delete");
    assert.equal(leaveAudit.tenant_id, base.scope.tenantId);
    assert.equal(leaveAudit.workspace_id, base.scope.workspaceId);
    assert.equal(leaveAudit.resource_id, leave.id);
    assert.equal(leaveAudit.metadata.staffId, staff.id);
    await assert.rejects(() => base.service.removeStaffLeave({ ...base.scope, tenantId: crypto.randomUUID() }, staff.id, leave.id), error => error.code === "STAFF_NOT_FOUND");
    await assert.rejects(() => base.service.removeStaffLeave(base.scope, staff.id, leave.id), error => error.code === "STAFF_LEAVE_NOT_FOUND");
    await assert.rejects(() => base.service.getStaff({ ...base.scope, tenantId: crypto.randomUUID() }, staff.id), error => error.code === "STAFF_NOT_FOUND");
  } finally { await base.db.close(); }
});

test("Operation Engine supports multi-store staff assignment and optional resource conflicts", async () => {
  const base = await fixture();
  try {
    const primary = (await base.service.listStaff(base.scope))[0];
    const otherStoreId = crypto.randomUUID();
    await base.db.query("insert into stores(id,tenant_id,workspace_id,name,channel_mode,status,public_store_id) values($1,$2,$3,'第二门店','shared','draft',$4)", [otherStoreId, base.scope.tenantId, base.scope.workspaceId, `store_public_${crypto.randomBytes(12).toString("hex")}`]);
    await base.db.transaction(tx => base.service.ensureDefaults(tx, { ...base.scope, storeId: otherStoreId }, 60));
    const assignments = await base.service.replaceStaffAssignments(base.scope, primary.id, { storeIds: [base.scope.storeId, otherStoreId] });
    assert.equal(assignments.filter(item => item.status === "active").length, 2);
    const secondScope = { ...base.scope, storeId: otherStoreId };
    assert.equal((await base.service.listStaff(secondScope)).some(item => item.id === primary.id), true);
    const staffTwo = await base.service.saveStaff(base.scope, { displayName: "资源并发员工" });
    const resource = await base.service.saveResource(base.scope, { name: "试衣间 A", kind: "fitting_room" });
    const first = await base.service.createAppointment(booking(base, { openid: "resource-a", customerPhone: "13900139000", staffId: primary.id, resourceId: resource.id, idempotencyKey: "resource-first" }));
    assert.equal(first.status, "待确认");
    await assert.rejects(() => base.service.createAppointment(booking(base, { openid: "resource-b", customerPhone: "13700137000", staffId: staffTwo.id, resourceId: resource.id, idempotencyKey: "resource-conflict" })), error => error.code === "APPOINTMENT_CONFLICT");
    const options = await base.service.merchantAvailability(base.scope, { storeId: base.scope.storeId, serviceId: base.serviceRow.id, resourceId: resource.id, date: "2030-01-02" });
    assert.equal(options.slots.find(slot => slot.startAt === "2030-01-02T01:00:00.000Z").available, false);
  } finally { await base.db.close(); }
});

test("Merchant staff scheduling UI and scoped operation endpoints are connected", () => {
  const ui = fs.readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8");
  const routes = fs.readFileSync(path.resolve(__dirname, "../appointment-routes.js"), "utf8");
  assert.match(ui, /员工与排班/);
  assert.match(ui, /员工 → 服务 → 门店 → 工作时间 → 请假/);
  assert.match(ui, /openStaffEditor/);
  assert.match(ui, /saveStaffLeave/);
  for (const endpoint of ["/v1/staff", "/v1/staff/:id/capabilities", "/v1/staff/:id/schedules", "/v1/staff/:id/leaves", "/v1/appointment-resources"]) assert.equal(routes.includes(endpoint), true);
});
