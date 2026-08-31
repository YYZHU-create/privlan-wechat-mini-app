const test = require("node:test");
const assert = require("node:assert/strict");
const { canonical, semanticRows, dataFingerprint, buildImportPolicy, topologicalOrder, normalizePrimaryKeyColumns, cleanupSnapshot, createTargetClient } = require("../meoo-data-rehearsal");

test("canonicalization sorts JSON keys and fingerprints are order independent", () => {
  assert.deepEqual(canonical({ z: 1, a: { y: 2, b: 3 } }), { a: { b: 3, y: 2 }, z: 1 });
  const a = { rows: { users: [{ id: "B", password_hash: "h2" }, { id: "A", password_hash: "h1" }] } };
  const b = { rows: { users: [...a.rows.users].reverse() } };
  assert.deepEqual(dataFingerprint(a), dataFingerprint(b));
});

test("canonicalization preserves JSON transport scalar types", () => {
  const row = { count: 3, active: true, recorded_at: "2026-08-31T00:00:00+00:00" };
  assert.deepEqual(canonical(row), row);
});

test("topological order rejects cycles and preserves parent-before-child insertion", () => {
  assert.deepEqual(topologicalOrder(["tenants", "workspaces", "stores"], [{ parent: "tenants", child: "workspaces" }, { parent: "workspaces", child: "stores" }]), ["tenants", "workspaces", "stores"]);
  assert.throws(() => topologicalOrder(["a", "b"], [{ parent: "a", child: "b" }, { parent: "b", child: "a" }]), /foreign-key cycle/);
});

test("import policy declares every table and reconciles seeded plan catalog", () => {
  const snapshot = { tableOrder: ["plan_catalog", "users"], rows: { plan_catalog: [{ id: "TRIAL" }], users: [] } };
  const policy = buildImportPolicy(snapshot, { plan_catalog: 3, users: 0 });
  assert.equal(Object.keys(policy).length, 2);
  assert.equal(policy.plan_catalog.importPolicy, "RECONCILE_SEEDED_METADATA");
  assert.equal(policy.users.importPolicy, "COPY_EXACT");
});

test("plan catalog semantic comparison ignores database numeric serialization only", () => {
  const source = [{ id: "PRO", display_name: "PRO", price_fen: "29900", duration_hours: "720", public: true, entitlements: { media: true } }];
  const target = [{ id: "PRO", display_name: "PRO", price_fen: 29900, duration_hours: 720, public: true, entitlements: { media: true } }];
  assert.deepEqual(semanticRows("plan_catalog", source), semanticRows("plan_catalog", target));
  assert.equal(dataFingerprint({ rows: { plan_catalog: source } }).criticalDigest, dataFingerprint({ rows: { plan_catalog: target } }).criticalDigest);
});

test("cleanup uses real primary-key metadata for relationship tables", async () => {
  const requests = [];
  const target = { request: async (table, options) => { requests.push({ table, options }); return null; } };
  await cleanupSnapshot({
    tableOrder: ["customers", "customer_tag_links"],
    primaryKeys: { customers: ["id"], customer_tag_links: ["customer_id", "tag_id"] },
    rows: { customers: [{ id: "customer-1" }], customer_tag_links: [{ customer_id: "customer-1", tag_id: "tag-1" }] }
  }, target, { policy: { customers: { importPolicy: "COPY_EXACT" }, customer_tag_links: { importPolicy: "COPY_EXACT" } } });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].table, "customer_tag_links");
  assert.equal(requests[0].options.query, "?customer_id=not.is.null");
  assert.equal(requests[1].options.query, "?id=not.is.null");
});

test("cleanup fails closed when primary-key metadata is missing", async () => {
  await assert.rejects(() => cleanupSnapshot({ tableOrder: ["relationship_table"], rows: { relationship_table: [{ value: 1 }] } }, { request: async () => null }, { policy: { relationship_table: { importPolicy: "COPY_EXACT" } } }), /missing primary key metadata/);
});

test("cleanup preserves reconciled seeded metadata", async () => {
  const requests = [];
  await cleanupSnapshot({
    tableOrder: ["plan_catalog", "users"],
    primaryKeys: { plan_catalog: ["id"], users: ["id"] },
    rows: { plan_catalog: [{ id: "TRIAL" }], users: [{ id: "user-1" }] }
  }, { request: async (table, options) => { requests.push({ table, options }); return null; } }, {
    policy: { plan_catalog: { importPolicy: "RECONCILE_SEEDED_METADATA" }, users: { importPolicy: "COPY_EXACT" } }
  });
  assert.deepEqual(requests.map(request => request.table), ["users"]);
});

test("target client accepts omitted options and reads environment defaults", () => {
  const client = createTargetClient({ url: "https://target.example", serviceRoleKey: "service-role", fetchImpl: async () => ({ ok: true, text: async () => "[]" }) });
  assert.equal(typeof client.request, "function");
});

test("primary-key metadata normalizes PostgreSQL array text", () => {
  assert.deepEqual(normalizePrimaryKeyColumns("{customer_id,tag_id}"), ["customer_id", "tag_id"]);
  assert.throws(() => normalizePrimaryKeyColumns("{customer-id}"), /invalid primary key metadata/);
});
