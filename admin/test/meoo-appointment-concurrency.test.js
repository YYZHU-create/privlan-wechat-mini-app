const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

async function call(url, key, path, options = {}) {
  const response = await fetch(`${url.replace(/\/$/, "")}${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`probe request failed: ${response.status}`);
  return body;
}

if (process.env.MEOO_B1_LIVE) test("live Meoo booking RPC commits one winner under concurrent requests", async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key);
  const scope = { tenant: crypto.randomUUID(), workspace: crypto.randomUUID(), store: crypto.randomUUID() };
  const slot = `b1-${crypto.randomUUID()}`;
  const customerA = crypto.randomUUID();
  const customerB = crypto.randomUUID();
  const rpc = "/rest/v1/rpc/b1_try_book";
  const payload = customer => ({ p_id: crypto.randomUUID(), p_tenant_id: scope.tenant, p_workspace_id: scope.workspace, p_store_id: scope.store, p_slot_key: slot, p_customer_id: customer });
  try {
    const results = await Promise.all([payload(customerA), payload(customerB)].map(body => call(url, key, rpc, { method: "POST", body: JSON.stringify(body) })));
    assert.equal(results.filter(result => result.ok === true).length, 1);
    assert.equal(results.filter(result => result.code === "APPOINTMENT_CONFLICT").length, 1);
    const rows = await call(url, key, `/rest/v1/b1_appointment_bookings?select=id,slot_key&tenant_id=eq.${scope.tenant}&workspace_id=eq.${scope.workspace}&store_id=eq.${scope.store}&slot_key=eq.${encodeURIComponent(slot)}`);
    assert.equal(rows.length, 1);
  } finally {
    await call(url, key, `/rest/v1/b1_appointment_bookings?tenant_id=eq.${scope.tenant}&workspace_id=eq.${scope.workspace}&store_id=eq.${scope.store}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
});
