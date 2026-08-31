const test = require("node:test");
const assert = require("node:assert/strict");
const { createMeooCustomerRepository, createMeooAppointmentReadRepository } = require("../meoo-center-repositories");
const { createCustomerService } = require("../customer-service");
const { createAppointmentService } = require("../appointment-service");

const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a" };

function fixtureAdapter(data) {
  const calls = [];
  return {
    calls,
    readResource: async (table, query) => {
      calls.push({ table, query });
      return data[table] || [];
    }
  };
}

test("Meoo customer repository lists and stats only within trusted scope", async () => {
  const adapter = fixtureAdapter({
    customers: [
      { id: "c-1", display_name: "Alice", phone: "13800138000", source: "mini_program", order_count: 2, total_spend_fen: 300, appointment_count: 1, created_at: "2026-08-30T00:00:00Z", last_seen_at: "2026-08-31T00:00:00Z" },
      { id: "c-2", display_name: "Bob", phone: "13900139000", source: "import", order_count: 0, total_spend_fen: 0, appointment_count: 0, created_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-01T00:00:00Z" }
    ],
    customer_memberships: [{ customer_id: "c-1", status: "active" }]
  });
  const repo = createMeooCustomerRepository({ adapter });
  assert.deepEqual((await repo.list(scope, { identity: "member" })).items.map(item => item.id), ["c-1"]);
  assert.deepEqual(await repo.stats(scope), { total: 2, customers: 1, members: 1, new30Days: 1 });
  for (const call of adapter.calls) {
    assert.match(call.query, /tenant_id=eq\.tenant-a/);
    assert.match(call.query, /workspace_id=eq\.workspace-a/);
    assert.match(call.query, /store_id=eq\.store-a/);
  }
});

test("Meoo customer 360 composes current UI sections and denies missing customer", async () => {
  const adapter = fixtureAdapter({
    customers: [{ id: "c-1", name: "Alice", phone: "13800138000", source: "mini_program", order_count: 1, total_spend_fen: 100, appointment_count: 1, created_at: "2026-08-30T00:00:00Z", first_seen_at: "2026-08-30T00:00:00Z", last_seen_at: "2026-08-31T00:00:00Z" }],
    appointments: [{ id: "a-1", customer_id: "c-1", appointment_number: "A1", start_at: "2026-09-01T00:00:00Z", service_name_snapshot: "剪裁", advisor_name_snapshot: "顾问", status: "confirmed" }],
    orders: [], customer_events: [], customer_tag_links: [], customer_tags: [], customer_notes: [], customer_memberships: [], customer_points_accounts: [{ customer_id: "c-1", balance: 20 }], customer_points_ledger: [], membership_levels: []
  });
  const repo = createMeooCustomerRepository({ adapter });
  const view = await repo.get360(scope, "c-1");
  assert.equal(view.customer.id, "c-1");
  assert.equal(view.appointments[0].statusLabel, "已确认");
  assert.equal(view.points, 20);
  await assert.rejects(() => repo.get360(scope, "missing"), error => error.code === "CUSTOMER_NOT_FOUND" && error.status === 404);
});

test("Meoo appointment read repository matches list/detail contracts", async () => {
  const adapter = fixtureAdapter({
    appointments: [{ id: "a-1", appointment_number: "A1", customer_id: "c-1", customer_name_snapshot: "Alice", customer_phone_snapshot: "13800138000", service_name_snapshot: "剪裁", advisor_name_snapshot: "顾问", start_at: "2026-09-01T10:00:00Z", status: "pending", source: "merchant" }],
    customers: [{ id: "c-1" }], appointment_services: [{ id: "s-1", name: "剪裁", duration_minutes: 60, enabled: true, sort_order: 1 }], appointment_advisors: [{ id: "ad-1", name: "顾问", enabled: true, sort_order: 1 }]
  });
  const repo = createMeooAppointmentReadRepository({ adapter });
  assert.equal((await repo.listAppointments(scope, { q: "Alice" }))[0].number, "A1");
  assert.equal((await repo.getAppointment(scope, "a-1")).customerName, "Alice");
  assert.equal((await repo.listServices(scope))[0].id, "s-1");
  assert.equal((await repo.listAdvisors(scope))[0].id, "ad-1");
  assert.equal((await repo.stats(scope)).pending, 1);
});

test("services dispatch center reads to Meoo repositories while native remains injectable", async () => {
  const customerService = createCustomerService({ db: { query: async () => { throw new Error("native query should not run"); } }, customerRepository: { list: async () => ({ items: [], page: 1, pageSize: 25, total: 0 }), stats: async () => ({ total: 0, customers: 0, members: 0, new30Days: 0 }), get360: async () => ({ id: "c-1" }) } });
  assert.equal((await customerService.list(scope)).total, 0);
  assert.equal((await customerService.stats(scope)).total, 0);
  assert.equal((await customerService.get360(scope, "c-1")).id, "c-1");
  const appointmentService = createAppointmentService({ db: { query: async () => { throw new Error("native query should not run"); } }, appointmentReadRepository: { stats: async () => ({ today: 0, week: 0, pending: 0, customers: 0 }), listAppointments: async () => [], getAppointment: async () => ({ id: "a-1" }), timeline: async () => [] }, customerService: {} });
  assert.equal((await appointmentService.stats(scope)).today, 0);
  assert.deepEqual(await appointmentService.listAppointments(scope), []);
  assert.equal((await appointmentService.getAppointment(scope, "a-1")).id, "a-1");
});
