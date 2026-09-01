const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createHandler: createAppointmentHandler, createPostgresHandler: createPostgresAppointmentHandler } = require("../../cloudfunctions/appointmentCreate/index");
const { createHandler: createOptionsHandler, createPostgresHandler: createPostgresOptionsHandler } = require("../../cloudfunctions/appointmentOptions/index");
const { createHandler: createListHandler, createPostgresHandler: createPostgresListHandler } = require("../../cloudfunctions/appointmentList/index");
const lockDomain = require("../../cloudfunctions/appointmentCreate/lock-domain");

function record(id, fields) { return { record_id: id, fields }; }

function createCore(overrides = {}) {
  const slots = {
    "slot-1400": record("slot-record-1400", { 时段ID: "slot-1400", 门店ID: "store-a", 日期: "2099-08-20", 时间: "14:00", 容量: 3, 已预约: 0, 顾问ID: "advisor-a,advisor-b", 状态: "开放" }),
    "slot-1415": record("slot-record-1415", { 时段ID: "slot-1415", 门店ID: "store-a", 日期: "2099-08-20", 时间: "14:15", 容量: 3, 已预约: 0, 顾问ID: "advisor-a,advisor-b", 状态: "开放" })
  };
  const advisors = {
    "advisor-a": record("advisor-record-a", { 顾问ID: "advisor-a", 门店ID: "store-a", 姓名: "顾问 A" }),
    "advisor-b": record("advisor-record-b", { 顾问ID: "advisor-b", 门店ID: "store-a", 姓名: "顾问 B" }),
    "advisor-other": record("advisor-record-other", { 顾问ID: "advisor-other", 门店ID: "store-b", 姓名: "其他门店顾问" })
  };
  const audits = [];
  const appointments = [];
  const intervalLocks = [];
  let capacityBooked = 0;
  const core = {
    requestId: () => `req-${Math.random().toString(36).slice(2)}`,
    currentOpenId: () => overrides.openId || "openid-a",
    hash: value => `hash-${value}`,
    env: (name, fallback = "") => overrides.env?.[name] ?? fallback,
    fieldName: (_name, fallback) => fallback,
    fieldValue: (item, _name, fallback) => item?.fields?.[fallback],
    createError(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; },
    enforceRateLimit: async () => {},
    async searchRecords(table, conditions) {
      const values = Object.fromEntries((conditions || []).map(condition => [condition.field, String(condition.value)]));
      if (table === "FEISHU_SLOTS_TABLE_ID") return slots[values["时段ID"]] ? [slots[values["时段ID"]]] : Object.values(slots);
      if (table === "FEISHU_ADVISORS_TABLE_ID") {
        if (values["顾问ID"]) return advisors[values["顾问ID"]] ? [advisors[values["顾问ID"]]] : [];
        return Object.values(advisors).filter(item => !values["门店ID"] || item.fields["门店ID"] === values["门店ID"]);
      }
      if (table === "FEISHU_STORES_TABLE_ID") return [record("store-record-a", { 门店ID: "store-a", 门店名称: "上海会所", 启用: "是" })];
      if (table === "FEISHU_APPOINTMENTS_TABLE_ID") return appointments.filter(item => {
        if (values["手机号"] && item.fields["手机号"] !== values["手机号"]) return false;
        if (values["时段ID"] && item.fields["时段ID"] !== values["时段ID"]) return false;
        if (values["门店ID"] && item.fields["门店ID"] !== values["门店ID"]) return false;
        if (values["日期"] && item.fields["日期"] !== values["日期"]) return false;
        return true;
      });
      return [];
    },
    getRecord: async (_table, id) => slots[id] || null,
    async reserveAppointmentRequest({ openId, phone, slotId }) {
      const key = `${openId}|${phone}|${slotId}`;
      if (core.requestKeys.has(key)) throw core.createError("DUPLICATE_APPOINTMENT", "duplicate", 409);
      core.requestKeys.add(key); return key;
    },
    async releaseAppointmentRequest(id) { core.requestKeys.delete(id); },
    requestKeys: new Set(),
    async reserveAppointmentInterval(payload) {
      const start = new Date(payload.startAt).getTime(); const end = new Date(payload.endAt).getTime();
      if (intervalLocks.some(lock => lock.advisorId === payload.advisorId && start < lock.end && end > lock.start)) throw core.createError("SLOT_UNAVAILABLE", "conflict", 409);
      intervalLocks.push({ ...payload, start, end }); return [payload.appointmentNumber];
    },
    async releaseAppointmentInterval(_ids, number) { const index = intervalLocks.findIndex(item => item.appointmentNumber === number); if (index >= 0) intervalLocks.splice(index, 1); },
    async reserveSlot(_slotId, capacity) { if (capacityBooked >= capacity) throw core.createError("SLOT_UNAVAILABLE", "full", 409); capacityBooked += 1; },
    async releaseSlot() { capacityBooked = Math.max(0, capacityBooked - 1); },
    async createRecord(_table, fields) { const item = record(`appointment-${appointments.length + 1}`, fields); appointments.push(item); return item; },
    async updateRecord() { if (overrides.failBookedUpdate) throw new Error("booked update failed"); },
    async audit(event, _openId, details) { audits.push({ event, details }); },
    db: { collection: () => ({ doc: () => ({ set: async () => {} }) }), serverDate: () => new Date() },
    ok: (data, message, requestId) => ({ ok: true, code: "OK", message, data, requestId }),
    handleError: (error, requestId) => ({ ok: false, code: error.code || "SERVICE_UNAVAILABLE", message: error.message, data: null, requestId }),
    audits, appointments, intervalLocks, slots, advisors
  };
  return Object.assign(core, overrides.methods || {});
}

function validForm(overrides = {}) {
  return { name: "测试客户", phone: "13800138000", serviceId: "service-1", storeId: "store-a", date: "2099-08-20", slotId: "slot-1400", advisorId: "advisor-a", notes: "", ...overrides };
}

test("appointment creation rejects client-side relation tampering", async t => {
  for (const [name, change] of [
    ["store", { storeId: "store-b" }],
    ["date", { date: "2099-08-21" }],
    ["advisor store", { advisorId: "advisor-other" }],
    ["advisor slot", { advisorId: "advisor-not-allowed" }],
    ["service", { serviceId: "service-invalid" }]
  ]) {
    await t.test(name, async () => {
      const result = await createAppointmentHandler(createCore())(validForm(change));
      assert.equal(result.ok, false);
      assert.equal(result.code, "INVALID_INPUT");
    });
  }
});

test("advisor interval locks allow parallel advisors but reject an overlapping booking for the same advisor", async () => {
  const core = createCore();
  const handler = createAppointmentHandler(core);
  assert.equal((await handler(validForm())).ok, true);
  assert.equal((await handler(validForm({ phone: "13900139000", advisorId: "advisor-b" }))).ok, true);
  const conflict = await handler(validForm({ phone: "13700137000", slotId: "slot-1415", advisorId: "advisor-a" }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "SLOT_UNAVAILABLE");
});

test("booked update failure returns a traceable reconciliation state without releasing the confirmed appointment", async () => {
  const core = createCore({ failBookedUpdate: true });
  const result = await createAppointmentHandler(core)(validForm());
  assert.equal(result.ok, true);
  assert.equal(result.data.syncPending, true);
  assert.equal(core.intervalLocks.length, 1);
  assert.ok(core.audits.some(item => item.event === "appointment_reconciliation_required" && item.details.appointmentNumber));
});

test("appointment options evaluate conflicts per advisor and preserve store capacity", async () => {
  const core = createCore();
  core.appointments.push(record("existing", {
    门店ID: "store-a", 日期: "2099-08-20", 时段ID: "slot-1400", 顾问ID: "advisor-a",
    开始时间: new Date("2099-08-20T14:00:00+08:00").getTime(), 结束时间: new Date("2099-08-20T16:15:00+08:00").getTime(), 状态: "待确认"
  }));
  const handler = createOptionsHandler(core);
  const anyAdvisor = await handler({ storeId: "store-a", date: "2099-08-20" });
  assert.equal(anyAdvisor.data.slots.find(item => item.id === "slot-1400").available, true);
  const advisorA = await handler({ storeId: "store-a", date: "2099-08-20", advisorId: "advisor-a" });
  assert.equal(advisorA.data.slots.find(item => item.id === "slot-1400").available, false);
  const advisorB = await handler({ storeId: "store-a", date: "2099-08-20", advisorId: "advisor-b" });
  assert.equal(advisorB.data.slots.find(item => item.id === "slot-1400").available, true);
});

test("lock domain prevents negative counters and isolates advisors and lock ownership", () => {
  assert.equal(lockDomain.releasedBooked(0), 0);
  assert.equal(lockDomain.releasedBooked(1), 0);
  const start = "2099-08-20T14:00:00+08:00";
  const end = "2099-08-20T16:15:00+08:00";
  assert.notDeepEqual(lockDomain.intervalBucketIds("store-a", "advisor-a", start, end), lockDomain.intervalBucketIds("store-a", "advisor-b", start, end));
  assert.equal(lockDomain.ownsLock({ appointmentNumber: "PV1" }, "PV1"), true);
  assert.equal(lockDomain.ownsLock({ appointmentNumber: "PV2" }, "PV1"), false);
});

test("appointment list derives identity from cloud context and returns only that user's records", async () => {
  let where;
  const core = {
    requestId: () => "req-list",
    currentOpenId: () => "openid-current",
    db: { collection: () => ({ where(value) { where = value; return this; }, limit() { return this; }, async get() { return { data: [{ number: "PV1", storeName: "上海会所", advisorName: "顾问 A", date: "2099-08-20", slotLabel: "14:00–16:15", startAt: "2099-08-20T06:00:00.000Z", status: "待确认" }] }; } }) },
    ok: (data, message, requestId) => ({ ok: true, data, message, requestId }),
    fail: (code, message, requestId) => ({ ok: false, code, message, requestId }),
    handleError: error => ({ ok: false, code: error.code || "SERVICE_UNAVAILABLE" })
  };
  const result = await createListHandler(core)({ openId: "attacker-controlled" });
  assert.deepEqual(where, { openId: "openid-current" });
  assert.equal(result.ok, true);
  assert.equal(result.data[0].number, "PV1");
});

test("cloud authentication defaults are production-safe", () => {
  const root = path.resolve(__dirname, "../..");
  const bootstrap = fs.readFileSync(path.join(root, "cloudfunctions", "serviceBootstrap", "index.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "cloudfunctions", "customerAuth", "index.js"), "utf8");
  assert.match(bootstrap, /env\("AUTH_MODE",\s*"wechat"\)/);
  assert.match(auth, /env\("AUTH_MODE",\s*"wechat"\)\s*!==\s*"test"/);
  assert.match(auth, /env\("TEST_AUTH_CODE"\)/);
});

test("PostgreSQL cloud adapters use cloud identity and keep successful bookings when Feishu mirroring fails", async () => {
  const calls = []; const audits = [];
  const core = {
    requestId: () => "req-postgres",
    currentOpenId: () => "openid-from-cloud",
    env: (name, fallback = "") => name === "ATELIER_FEISHU_APPOINTMENT_MIRROR" ? "1" : fallback,
    appointmentApi: async (pathname, body) => {
      calls.push({ pathname, body });
      if (pathname.endsWith("appointment-options")) return { ok: true, data: { slots: [] } };
      if (pathname.endsWith("/list")) return { ok: true, data: [] };
      return { ok: true, data: { number: "AT1", startAt: "2030-01-02T01:00:00.000Z", endAt: "2030-01-02T02:00:00.000Z", status: "待确认" } };
    },
    db: { collection: () => ({ doc: () => ({ set: async () => {} }) }), serverDate: () => new Date() },
    hash: value => `hash-${value}`,
    createRecord: async () => { throw new Error("Feishu unavailable"); },
    fieldName: (_name, fallback) => fallback,
    audit: async (event, _openid, details) => audits.push({ event, details }),
    fail: (code, message, requestId) => ({ ok: false, code, message, requestId }),
    handleError: (error, requestId) => ({ ok: false, code: error.code || "SERVICE_UNAVAILABLE", requestId })
  };
  await createPostgresOptionsHandler(core)({ publicStoreId: "store_public_a", serviceId: "svc-a", openid: "attacker" });
  const created = await createPostgresAppointmentHandler(core)({ publicStoreId: "store_public_a", name: "客户", phone: "13800138000", serviceId: "svc-a", advisorId: "adv-a", startAt: "2030-01-02T01:00:00.000Z", idempotencyKey: "key-a", openid: "attacker" });
  await createPostgresListHandler(core)({ publicStoreId: "store_public_a", openid: "attacker" });
  assert.equal(created.ok, true);
  assert.equal(calls.find(item => item.pathname.endsWith("/appointments") && !item.pathname.endsWith("/list")).body.openid, "openid-from-cloud");
  assert.equal(calls.find(item => item.pathname.endsWith("/list")).body.openid, "openid-from-cloud");
  assert.ok(audits.some(item => item.event === "appointment_integration_failed"));
  assert.equal(calls.length, 3);
});
