const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { createAppointmentService } = require("../appointment-service");
const { createCustomerService } = require("../customer-service");
const fs = require("node:fs");
const { DateTime } = require("luxon");
const { randomUUID } = require("node:crypto");

process.env.NODE_ENV = "test";
const OPENID_KEY = "merchant-os-sprint1-openid-key-32-bytes";

async function fixture(name = "Sprint 1 店铺") {
  process.env.ATELIER_OPENID_HASH_KEY = OPENID_KEY;
  const db = await createPortableTestDatabase();
  const saas = createSaasService({ db, licensePepper: "merchant-os-sprint1-license-pepper-32" });
  const registration = await saas.register({ login: `${Date.now()}-${Math.random()}@example.com`, password: `test-${randomUUID()}`, storeName: name, template: "blank" });
  await db.query("update subscriptions set status='active',expires_at=$1 where workspace_id=$2", [new Date("2031-01-01T00:00:00Z"), registration.workspace.id]);
  const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, subscription: { status: "active" } };
  const appointmentService = createAppointmentService({ db, openIdHashKey: OPENID_KEY, now: () => DateTime.fromISO("2030-01-01T00:00:00Z") });
  const customerService = createCustomerService({ db, openIdHashKey: OPENID_KEY });
  const store = (await db.query("select * from stores where id=$1", [scope.storeId])).rows[0];
  const services = await appointmentService.listServices(scope);
  const advisors = await appointmentService.listAdvisors(scope);
  await appointmentService.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 30, defaultBufferMinutes: 15, maxAdvanceDays: 30, bookingEnabled: true });
  return { db, scope, store, appointmentService, customerService, service: services[0], advisor: advisors[0] };
}

test("Customer 360 aggregates scoped data and masks phone", async () => {
  const base = await fixture();
  try {
    const appointment = await base.appointmentService.createAppointment({
      publicStoreId: base.store.public_store_id,
      openid: "sprint1-customer",
      customerName: "Sprint 客户",
      customerPhone: "13800138000",
      serviceId: base.service.id,
      advisorId: base.advisor.id,
      startAt: "2030-01-02T01:00:00.000Z",
      idempotencyKey: "sprint1-appointment"
    });
    const appointmentRow = (await base.db.query("select id,customer_id from appointments where idempotency_key=$1", ["sprint1-appointment"])).rows[0];
    const customerId = appointmentRow.customer_id;
    const result = await base.customerService.get360(base.scope, customerId);
    assert.equal(result.customer.id, customerId);
    assert.equal(result.summary.appointmentCount, 1);
    assert.equal(result.appointments.length, 1);
    assert.equal(result.points.balance, 0);
    assert.equal(result.customer.phoneMasked, "138****8000");
    assert.doesNotMatch(JSON.stringify(result), /13800138000/);
    assert.ok(Array.isArray(result.timeline));
  } finally { await base.db.close(); }
});

test("Appointment enhancement supports availability, timeline, follow-up idempotency and tenant scope", async () => {
  const first = await fixture("Sprint 1 A");
  const second = await fixture("Sprint 1 B");
  try {
    const appointment = await first.appointmentService.createAppointment({
      publicStoreId: first.store.public_store_id,
      openid: "sprint1-appointment-customer",
      customerName: "预约客户",
      serviceId: first.service.id,
      advisorId: first.advisor.id,
      startAt: "2030-01-02T01:00:00.000Z",
      idempotencyKey: "sprint1-follow-up"
    });
    const availability = await first.appointmentService.merchantAvailability(first.scope, { storeId: first.scope.storeId, publicStoreId: first.store.public_store_id, date: "2030-01-02", serviceId: first.service.id, advisorId: first.advisor.id });
    assert.ok(Array.isArray(availability.slots));
    await assert.rejects(() => first.appointmentService.merchantAvailability(first.scope, { storeId: second.scope.storeId, date: "2030-01-02" }), error => error.code === "APPOINTMENT_SCOPE_INVALID");
    const appointmentRow = (await first.db.query("select id from appointments where idempotency_key=$1", ["sprint1-follow-up"])).rows[0];
    const appointmentId = appointmentRow.id;
    const before = await first.appointmentService.timeline(first.scope, appointmentId);
    assert.ok(before.some(item => item.resourceType === "appointment" || item.type === "appointment_created"));
    const created = await first.appointmentService.createFollowUp(first.scope, appointmentId, { note: "电话确认需求", idempotencyKey: "follow-up-1" });
    const duplicate = await first.appointmentService.createFollowUp(first.scope, appointmentId, { note: "电话确认需求", idempotencyKey: "follow-up-1" });
    assert.equal(created.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await first.appointmentService.timeline(first.scope, appointmentId)).filter(item => item.type === "follow_up_created").length, 1);
    await assert.rejects(() => second.appointmentService.getAppointment(second.scope, appointmentId), error => error.code === "APPOINTMENT_NOT_FOUND");
  } finally { await first.db.close(); await second.db.close(); }
});

test("Merchant OS navigation exposes grouped Sprint 1 entry points without parallel modules", () => {
  const source = fs.readFileSync(require("node:path").resolve(__dirname, "../public/app.js"), "utf8");
  assert.match(source, /const navGroups = computed/);
  assert.match(source, /客户中心/);
  assert.match(source, /会员中心/);
  assert.match(source, /预约中心/);
  assert.equal(source.includes("/v1/customers/${encodeURIComponent(item.id)}/360"), true);
  const routes = fs.readFileSync(require("node:path").resolve(__dirname, "../appointment-routes.js"), "utf8");
  for (const endpoint of ["/v1/customers/:id/360", "/v1/appointments/availability", "/v1/appointments/:id/timeline", "/v1/appointments/:id/follow-up"]) assert.equal(routes.includes(endpoint), true);
  for (const unavailable of ["payment", "wallet", "workflow", "notification", "compliance"]) assert.equal(source.includes(`switchView('${unavailable}')`), false);
});
