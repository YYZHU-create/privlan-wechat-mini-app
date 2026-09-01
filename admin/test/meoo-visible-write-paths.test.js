const test = require("node:test");
const assert = require("node:assert/strict");
const { createMeooCustomerWriteRepository, createMeooAppointmentWriteRepository } = require("../meoo-write-repositories");
const { createCustomerService } = require("../customer-service");
const { createAppointmentService } = require("../appointment-service");

const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a", userId: "actor-a", requestId: "request-a", subscription: { status: "active" } };

test("visible write repositories send scoped explicit RPC payloads", async () => {
  const calls = [];
  const adapter = { callRpc: async (name, body) => { calls.push({ name, body }); return { ok: true, data: { name } }; } };
  const customer = createMeooCustomerWriteRepository({ adapter });
  const appointment = createMeooAppointmentWriteRepository({ adapter });
  await customer.addNote(scope, "customer-a", { content: "hello" });
  await customer.adjustPoints(scope, "customer-a", { points: 5, reason: "manual", idempotencyKey: "points-a" });
  await customer.updateProgram(scope, { enabled: true, pointsEnabled: true });
  await customer.saveLevel(scope, { name: "Gold", levelOrder: 2, growthThreshold: 100 }, "level-a");
  await appointment.updateStatus(scope, "appointment-a", "confirmed");
  await appointment.createFollowUp(scope, "appointment-a", { note: "called", idempotencyKey: "follow-a" });
  assert.deepEqual(calls.map(call => call.name), [
    "atelier_customer_add_note", "atelier_customer_adjust_points", "atelier_membership_program_update", "atelier_membership_level_save",
    "atelier_appointment_status_update", "atelier_appointment_follow_up"
  ]);
  for (const call of calls) {
    assert.equal(call.body.p_tenant_id, scope.tenantId);
    assert.equal(call.body.p_workspace_id, scope.workspaceId);
    assert.equal(call.body.p_store_id, scope.storeId);
  }
  assert.equal(calls[1].body.p_idempotency_key, "points-a");
});

test("customer service uses Meoo customer write repository while native remains fallback", async () => {
  const calls = [];
  const customerWriteRepository = { addNote: async (...args) => { calls.push(["note", ...args]); return { ok: true }; }, adjustPoints: async (...args) => { calls.push(["points", ...args]); return { ok: true }; }, updateProgram: async (...args) => { calls.push(["program", ...args]); return { ok: true }; }, saveLevel: async (...args) => { calls.push(["level", ...args]); return { ok: true }; } };
  const service = createCustomerService({ db: {}, customerWriteRepository });
  await service.addNote(scope, "customer-a", { content: "note" });
  await service.adjustPoints(scope, "customer-a", { points: 1, idempotencyKey: "key" });
  await service.updateProgram(scope, { enabled: true });
  await service.saveLevel(scope, { name: "Gold", levelOrder: 2, growthThreshold: 1 });
  assert.deepEqual(calls.map(call => call[0]), ["note", "points", "program", "level"]);
});

test("appointment service dispatches approved writes without changing native default", async () => {
  const calls = [];
  const appointmentWriteRepository = {
    updateStatus: async (...args) => { calls.push("status"); return { ok: true }; },
    createFollowUp: async (...args) => { calls.push("followUp"); return { ok: true }; },
    updateSettings: async (...args) => { calls.push("settings"); return { ok: true }; },
    replaceHours: async (...args) => { calls.push("hours"); return { ok: true }; },
    saveService: async (...args) => { calls.push("service"); return { ok: true }; },
    saveAdvisor: async (...args) => { calls.push("advisor"); return { ok: true }; }
  };
  const service = createAppointmentService({ db: {}, appointmentWriteRepository });
  await service.updateStatus(scope, "appointment-a", "confirmed");
  await service.createFollowUp(scope, "appointment-a", { note: "note", idempotencyKey: "follow" });
  await service.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 30, defaultBufferMinutes: 1, maxAdvanceDays: 30, bookingEnabled: true });
  await service.replaceHours(scope, { hours: [{ weekday: 1, startTime: "09:00", endTime: "18:00", enabled: true }] });
  await service.saveService(scope, { name: "Consult", durationMinutes: 30, bufferMinutesOverride: null });
  await service.saveAdvisor(scope, { name: "Advisor" });
  assert.deepEqual(calls, ["status", "followUp", "settings", "hours", "service", "advisor"]);
});


test("appointment service returns Meoo production readback for visible writes without native queries", async () => {
  const calls = [];
  const reads = {
    getAppointment: async () => ({ id: "appointment-a", status: "confirmed", statusLabel: "已确认" }),
    getSettings: async () => ({ timezone: "Asia/Shanghai", slotIntervalMinutes: 30, defaultBufferMinutes: 1, maxAdvanceDays: 30, bookingEnabled: true }),
    listHours: async () => [{ id: "hour-a", weekday: 1, startTime: "09:00", endTime: "18:00", enabled: true }],
    listServices: async () => [{ id: "service-a", name: "咨询", durationMinutes: 30, bufferMinutesOverride: null, enabled: true, sortOrder: 0 }],
    listAdvisors: async () => [{ id: "advisor-a", staffId: "staff-a", name: "顾问", enabled: true, sortOrder: 0 }],
    listStaff: async () => [{ id: "staff-a", displayName: "顾问" }],
    getStaff: async () => ({ id: "staff-a", displayName: "顾问", services: [], schedules: [], leaves: [] }),
    listStaffSchedules: async () => [{ id: "schedule-a", staffId: "staff-a", weekday: 1, startTime: "09:00", endTime: "18:00", enabled: true }],
    listStaffLeaves: async () => [{ id: "leave-a", staffId: "staff-a", startAt: "2026-09-01T01:00:00Z", endAt: "2026-09-01T02:00:00Z", reason: "培训" }]
  };
  const writes = new Proxy({}, { get: (_, method) => async () => { calls.push(String(method)); return { id: method === "saveStaff" ? "staff-a" : method === "saveStaffLeave" ? "leave-a" : "saved-a", duration_minutes: 30, buffer_minutes_override: null, enabled: true, sort_order: 0, name: "咨询", staff_id: "staff-a" }; } });
  const service = createAppointmentService({ db: { query: async () => { throw new Error("native query should not run"); } }, appointmentReadRepository: reads, appointmentWriteRepository: writes, customerService: {} });
  assert.equal((await service.updateStatus(scope, "appointment-a", "confirmed")).statusLabel, "已确认");
  assert.equal((await service.updateSettings(scope, { timezone: "Asia/Shanghai", slotIntervalMinutes: 30, defaultBufferMinutes: 1, maxAdvanceDays: 30 })).timezone, "Asia/Shanghai");
  assert.equal((await service.replaceHours(scope, { hours: [{ weekday: 1, startTime: "09:00", endTime: "18:00", enabled: true }] }))[0].id, "hour-a");
  assert.equal((await service.saveService(scope, { name: "咨询", durationMinutes: 30, bufferMinutesOverride: null })).durationMinutes, 30);
  assert.equal((await service.saveAdvisor(scope, { name: "顾问" })).staffId, "staff-a");
  assert.equal((await service.saveStaff(scope, { displayName: "顾问" })).id, "staff-a");
  assert.equal((await service.setStaffCapabilities(scope, "staff-a", { serviceIds: [] })).id, "staff-a");
  assert.equal((await service.replaceStaffSchedules(scope, "staff-a", { schedules: [] }))[0].id, "schedule-a");
  assert.equal((await service.saveStaffLeave(scope, "staff-a", { startAt: "2026-09-01T01:00:00Z", endAt: "2026-09-01T02:00:00Z", reason: "培训" })).id, "leave-a");
  assert.deepEqual(calls, ["updateStatus", "updateSettings", "replaceHours", "saveService", "saveAdvisor", "saveStaff", "setStaffCapabilities", "replaceStaffSchedules", "saveStaffLeave"]);
});
