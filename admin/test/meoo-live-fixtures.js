const crypto = require("node:crypto");
const { hashPassword } = require("../platform-store");

function uuid() { return crypto.randomUUID(); }

function createLiveClient({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  if (!url || !key) throw new Error("live Meoo configuration is required");
  const base = String(url).replace(/\/$/, "");
  async function request(path, options = {}) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(base + path, {
        ...options,
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.headers || {}) }
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (response.ok) return body;
      if ([429, 502, 503].includes(response.status) && attempt < 3) { await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); continue; }
      const code = body && typeof body === "object" ? (body.code || body.message || body.hint || "provider-error") : "provider-error";
      throw new Error(`live Meoo request failed: HTTP ${response.status} ${String(code).slice(0, 120)}`);
    }
  }
  async function insert(table, row) {
    const rows = await request(`/rest/v1/${table}`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async function remove(table, filters) {
    const query = Object.entries(filters).map(([key, value]) => `${key}=eq.${encodeURIComponent(String(value))}`).join("&");
    await request(`/rest/v1/${table}?${query}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  return { request, insert, remove };
}

async function createAppointmentFixture(client = createLiveClient()) {
  const tenantId = uuid();
  const workspaceId = uuid();
  const storeId = uuid();
  const serviceId = uuid();
  const advisorId = uuid();
  const subscriptionId = uuid();
  const publicStoreId = `b1-synthetic-${storeId.slice(0, 8)}`;
  const fixture = { tenantId, workspaceId, storeId, serviceId, advisorId, publicStoreId, client };
  try {
    await client.insert("tenants", { id: tenantId, name: `B1 synthetic tenant ${tenantId.slice(0, 8)}`, status: "trial" });
    await client.insert("workspaces", { id: workspaceId, tenant_id: tenantId, name: `B1 synthetic workspace ${workspaceId.slice(0, 8)}`, plan_id: "TRIAL" });
    await client.insert("stores", { id: storeId, tenant_id: tenantId, workspace_id: workspaceId, name: "B1 synthetic store", public_store_id: publicStoreId, status: "published" });
    await client.insert("subscriptions", { id: subscriptionId, tenant_id: tenantId, workspace_id: workspaceId, plan_id: "TRIAL", status: "active", started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() });
    await client.insert("appointment_settings", { tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, timezone: "Asia/Shanghai", slot_interval_minutes: 15, default_buffer_minutes: 1, min_advance_minutes: 0, max_advance_days: 30, booking_enabled: true });
    await client.insert("appointment_services", { id: serviceId, tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, name: "B1 synthetic service", duration_minutes: 30, enabled: true, sort_order: 0 });
    await client.insert("appointment_advisors", { id: advisorId, tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, name: "B1 synthetic advisor", enabled: true, sort_order: 0 });
    await client.insert("appointment_advisor_services", { tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, advisor_id: advisorId, service_id: serviceId });
    for (let weekday = 0; weekday < 7; weekday += 1) await client.insert("appointment_business_hours", { id: uuid(), tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, weekday, start_time: "00:00", end_time: "23:59", enabled: true });
    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

async function createCustomerFixture(client = createLiveClient()) {
  const appointment = await createAppointmentFixture(client);
  const customerId = uuid();
  await client.insert("customers", { id: customerId, tenant_id: appointment.tenantId, workspace_id: appointment.workspaceId, store_id: appointment.storeId, source: "merchant_manual", name: "B1 synthetic customer", phone: "13800138000", display_name: "B1 synthetic customer", first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
  return { ...appointment, customerId };
}

async function createAuthFixture(client = createLiveClient()) {
  const appointment = await createAppointmentFixture(client);
  const userId = uuid();
  const login = `b1-auth-${userId.slice(0, 12)}@example.test`;
  const password = `B1-auth-${userId.slice(0, 12)}!`;
  try {
    await client.insert("users", { id: userId, login_identifier: login, password_hash: hashPassword(password), display_name: "B1 synthetic auth", status: "active" });
    await client.insert("memberships", { tenant_id: appointment.tenantId, workspace_id: appointment.workspaceId, user_id: userId, role: "owner" });
    return { ...appointment, userId, login, password };
  } catch (error) {
    await cleanupFixture({ ...appointment, userId });
    throw error;
  }
}

async function cleanupFixture(fixture) {
  const { client, tenantId, workspaceId, storeId, customerId, userId } = fixture;
  const removals = [
    ["customer_tag_links", customerId ? { customer_id: customerId } : { tenant_id: tenantId }],
    ["customer_tags", { tenant_id: tenantId }],
    ["customer_events", { tenant_id: tenantId }],
    ["customer_notes", { tenant_id: tenantId }],
    ["customer_points_ledger", { tenant_id: tenantId }],
    ["customer_points_accounts", { tenant_id: tenantId }],
    ["customer_memberships", { tenant_id: tenantId }],
    ["appointments", { tenant_id: tenantId }],
    ["customers", { tenant_id: tenantId }],
    ["appointment_advisor_services", { tenant_id: tenantId }],
    ["appointment_business_hours", { tenant_id: tenantId }],
    ["staff_schedules", { tenant_id: tenantId }],
    ["staff_leaves", { tenant_id: tenantId }],
    ["staff_store_assignments", { tenant_id: tenantId }],
    ["appointment_services", { tenant_id: tenantId }],
    ["appointment_advisors", { tenant_id: tenantId }],
    ["appointment_settings", { tenant_id: tenantId }],
    ["audit_events", { tenant_id: tenantId }],
    ["subscriptions", { tenant_id: tenantId }],
    ["stores", { tenant_id: tenantId }],
    ["merchant_sessions", userId ? { user_id: userId } : { workspace_id: workspaceId }],
    ["memberships", userId ? { user_id: userId } : { workspace_id: workspaceId }],
    ["workspaces", { id: workspaceId }],
    ["users", userId ? { id: userId } : { login_identifier: "__no_match__" }],
    ["tenants", { id: tenantId }]
  ];
  for (const [table, filters] of removals) await client.remove(table, filters);
}

function scopedDatabase(fixture, override = {}) {
  const scope = override.scopeOverride || fixture;
  const row = { store_id: scope.storeId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_name: "B1 synthetic store", public_store_id: fixture.publicStoreId, subscription_status: "active", expires_at: new Date(Date.now() + 86400000).toISOString(), timezone: "Asia/Shanghai", slot_interval_minutes: 15, default_buffer_minutes: 1, max_advance_days: 30, booking_enabled: true };
  return { query: async sql => ({ rows: /from stores st join appointment_settings/i.test(sql) ? [row] : [] }), ...override };
}

module.exports = { createLiveClient, createAppointmentFixture, createCustomerFixture, createAuthFixture, cleanupFixture, scopedDatabase };
