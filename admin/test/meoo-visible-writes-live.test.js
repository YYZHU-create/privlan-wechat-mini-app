const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createAppointmentService } = require("../appointment-service");
const { createCustomerService } = require("../customer-service");
const { createMeooAppointmentRepository } = require("../meoo-appointment-repository");
const { createMeooAppointmentReadRepository, createMeooCustomerRepository } = require("../meoo-center-repositories");
const { createMeooAppointmentWriteRepository, createMeooCustomerWriteRepository } = require("../meoo-write-repositories");
const { createSupabaseAdapter } = require("../meoo-supabase-adapter");
const { createCustomerFixture, cleanupFixture, scopedDatabase } = require("./meoo-live-fixtures");

function liveScope(fixture) {
  return { tenantId: fixture.tenantId, workspaceId: fixture.workspaceId, storeId: fixture.storeId, userId: crypto.randomUUID(), requestId: crypto.randomUUID(), subscription: { status: "active" } };
}

if (process.env.MEOO_B1_LIVE) test("live Meoo visible Customer and Appointment writes return production readback without native fallback", async () => {
  const fixture = await createCustomerFixture();
  const adapter = createSupabaseAdapter();
  const customerReadRepository = createMeooCustomerRepository({ adapter });
  const customerWriteRepository = createMeooCustomerWriteRepository({ adapter });
  const appointmentReadRepository = createMeooAppointmentReadRepository({ adapter });
  const appointmentWriteRepository = createMeooAppointmentWriteRepository({ adapter });
  const customerService = createCustomerService({
    db: { query: async () => { throw new Error("MEOO_QUERY_UNSUPPORTED_OUTSIDE_REPOSITORY"); }, transaction: async () => { throw new Error("MEOO_TRANSACTION_UNSUPPORTED_OUTSIDE_REPOSITORY"); } },
    customerRepository: customerReadRepository,
    customerWriteRepository,
    tagRepository: adapter
  });
  const sourceDb = scopedDatabase(fixture);
  let visibleNativeQueries = 0;
  const appointmentDb = {
    query: async (...args) => {
      visibleNativeQueries += 1;
      return sourceDb.query(...args);
    },
    transaction: async () => { throw new Error("MEOO_TRANSACTION_UNSUPPORTED_OUTSIDE_REPOSITORY"); }
  };
  const appointmentService = createAppointmentService({
    db: appointmentDb,
    openIdHashKey: "b1-visible-writes-openid-hash-key-32!!",
    customerService,
    appointmentRepository: createMeooAppointmentRepository({ adapter }),
    appointmentReadRepository,
    appointmentWriteRepository
  });
  const scope = liveScope(fixture);
  const start = new Date(Date.now() + 86400000);
  start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 15) * 15, 0, 0);
  const booking = {
    publicStoreId: fixture.publicStoreId,
    customerName: "B1 synthetic customer",
    customerPhone: "13600136000",
    openid: `b1-visible-${fixture.customerId}`,
    serviceId: fixture.serviceId,
    advisorId: fixture.advisorId,
    startAt: start.toISOString(),
    idempotencyKey: crypto.randomUUID()
  };
  try {
    await fixture.client.insert("membership_programs", { id: crypto.randomUUID(), tenant_id: fixture.tenantId, workspace_id: fixture.workspaceId, store_id: fixture.storeId, enabled: false, points_enabled: false });
    const created = await appointmentService.createAppointment(booking);
    assert.ok(created.number);
    assert.equal((await appointmentService.createAppointment(booking)).idempotent, true);
    let createdAppointment = null;
    for (let attempt = 0; attempt < 6 && !createdAppointment; attempt += 1) {
      createdAppointment = (await appointmentReadRepository.listAppointments(scope)).find(row => row.number === created.number) || null;
      if (!createdAppointment) await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
    }
    assert.ok(createdAppointment?.id);
    visibleNativeQueries = 0;

    const note = await customerService.addNote(scope, fixture.customerId, { content: "B1 synthetic note" });
    assert.equal(note.customer_id, fixture.customerId);
    const pointsKey = crypto.randomUUID();
    assert.deepEqual(await customerService.adjustPoints(scope, fixture.customerId, { points: 25, reason: "B1 adjustment", idempotencyKey: pointsKey }), { duplicate: false, balance: 25 });
    assert.deepEqual(await customerService.adjustPoints(scope, fixture.customerId, { points: 25, reason: "B1 replay", idempotencyKey: pointsKey }), { duplicate: true, balance: 25 });
    await assert.rejects(() => customerService.adjustPoints(scope, fixture.customerId, { points: -26, reason: "B1 rollback", idempotencyKey: crypto.randomUUID() }), error => error.code === "POINTS_INSUFFICIENT");
    assert.equal((await customerService.points(scope, fixture.customerId)).balance, 25);
    assert.equal((await customerService.updateProgram(scope, { enabled: true, pointsEnabled: true })).enabled, true);
    const level = await customerService.saveLevel(scope, { name: "B1 Gold", levelOrder: 2, growthThreshold: 100, enabled: true, benefits: { booking: true } });
    assert.equal((await customerService.levels(scope)).some(row => row.id === level.id), true);

    assert.equal((await appointmentService.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 15, defaultBufferMinutes: 1, maxAdvanceDays: 20, bookingEnabled: true })).slotIntervalMinutes, 15);
    const hours = await appointmentService.replaceHours(scope, { hours: [{ weekday: 0, startTime: "09:00", endTime: "18:00", enabled: true }] });
    assert.deepEqual(hours.map(row => row.startTime), ["09:00"]);
    const savedService = await appointmentService.saveService(scope, { name: "B1 visible service", description: "", durationMinutes: 30, bufferMinutesOverride: null, enabled: true, sortOrder: 1 });
    assert.equal((await appointmentService.listServices(scope)).some(row => row.id === savedService.id), true);
    const advisor = await appointmentService.saveAdvisor(scope, { name: "B1 visible advisor", enabled: true, sortOrder: 1 });
    assert.equal((await appointmentService.listAdvisors(scope)).some(row => row.id === advisor.id), true);
    const staff = await appointmentService.saveStaff(scope, { displayName: "B1 visible staff", title: "顾问", status: "active", publicVisible: true });
    assert.ok(staff.advisorId);
    assert.equal(staff.schedules.length, 1);
    const capabilityReadback = await appointmentService.setStaffCapabilities(scope, staff.id, { serviceIds: [savedService.id] });
    assert.deepEqual(capabilityReadback.services.map(row => row.id), [savedService.id]);
    const schedules = await appointmentService.replaceStaffSchedules(scope, staff.id, { schedules: [{ weekday: 0, startTime: "10:00", endTime: "17:00", enabled: true }] });
    assert.equal(schedules[0].startTime, "10:00");
    await assert.rejects(() => appointmentWriteRepository.replaceStaffSchedules(scope, staff.id, [{ weekday: 0, startTime: "25:00", endTime: "17:00", enabled: true }]), error => error.code === "STAFF_SCHEDULE_INVALID");
    assert.equal((await appointmentService.listStaffSchedules(scope, staff.id))[0].startTime, "10:00");
    const leave = await appointmentService.saveStaffLeave(scope, staff.id, { startAt: "2030-01-01T01:00:00.000Z", endAt: "2030-01-01T02:00:00.000Z", reason: "B1 leave" });
    assert.equal(leave.reason, "B1 leave");
    assert.deepEqual(await appointmentService.removeStaffLeave(scope, staff.id, leave.id), { id: leave.id, deleted: true });
    assert.equal((await appointmentService.updateStatus(scope, createdAppointment.id, "confirmed")).statusLabel, "已确认");
    await assert.rejects(() => appointmentService.updateStatus(scope, createdAppointment.id, "pending"), error => error.code === "APPOINTMENT_STATUS_INVALID");
    assert.equal((await appointmentReadRepository.getAppointment(scope, createdAppointment.id)).status, "confirmed");
    assert.equal((await appointmentService.createFollowUp(scope, createdAppointment.id, { note: "B1 follow-up", idempotencyKey: "b1-follow-up" })).duplicate, false);
    assert.equal((await appointmentService.createFollowUp(scope, createdAppointment.id, { note: "B1 follow-up", idempotencyKey: "b1-follow-up" })).duplicate, true);
    const forgedScope = { ...scope, tenantId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), storeId: crypto.randomUUID() };
    await assert.rejects(() => customerService.addNote(forgedScope, fixture.customerId, { content: "forged" }), error => error.code === "CUSTOMER_SCOPE_INVALID");
    assert.equal((await customerReadRepository.get360(scope, fixture.customerId)).notes.some(row => row.id === note.id), true);
    assert.equal(visibleNativeQueries, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});
