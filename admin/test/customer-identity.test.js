const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { inspectLegacyOrders } = require("../customer-order-report");
const { createHandler: createCustomerTouchHandler } = require("../../cloudfunctions/customerTouch/index");

process.env.NODE_ENV = "test";
const KEY = "customer-identity-test-key-with-at-least-32-bytes";

async function fixture() {
  process.env.ATELIER_OPENID_HASH_KEY = KEY;
  const db = await createPortableTestDatabase();
  const saas = createSaasService({ db, licensePepper: "license-pepper-for-customer-tests" });
  const registration = await saas.register({ login: `customer-${Date.now()}-${Math.random()}@example.com`, password: "customer-pass-123", storeName: "客户测试店", template: "blank" });
  const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, requestId: "customer-test", subscription: { status: "active" } };
  return { db, service: saas.customerService, scope };
}

test("trusted customer touch is idempotent, anonymous-capable and workspace scoped", async () => {
  const first = await fixture(); const second = await fixture();
  try {
    const a = await first.service.touchMiniProgramCustomer(first.scope, { openid: "same-openid" });
    const b = await first.service.touchMiniProgramCustomer(first.scope, { openid: "same-openid", displayName: "新昵称" });
    const c = await second.service.touchMiniProgramCustomer(second.scope, { openid: "same-openid" });
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id);
    assert.equal((await first.db.query("select count(*)::int count from customers where workspace_id=$1", [first.scope.workspaceId])).rows[0].count, 1);
    const profile = (await first.db.query("select phone,display_name from customers where id=$1", [a.id])).rows[0];
    assert.equal(profile.phone, null); assert.equal(profile.display_name, "新昵称");
    assert.equal((await first.db.query("select count(*)::int count from customer_events where customer_id=$1", [a.id])).rows[0].count, 2);
  } finally { await first.db.close(); await second.db.close(); }
});

test("customer list pagination and points ledger are scoped and idempotent", async () => {
  const base = await fixture();
  try {
    const customer = await base.service.touchMiniProgramCustomer(base.scope, { openid: "points-openid" });
    const listed = await base.service.list(base.scope, { page: 1, pageSize: 1 });
    assert.equal(listed.items.length, 1); assert.equal(listed.total, 1); assert.match(listed.items[0].name, /^微信用户 /);
    const first = await base.service.adjustPoints(base.scope, customer.id, { points: 100, idempotencyKey: "manual-1", reason: "测试" });
    const duplicate = await base.service.adjustPoints(base.scope, customer.id, { points: 100, idempotencyKey: "manual-1", reason: "测试" });
    assert.equal(first.balance, 100); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.balance, 100);
    await assert.rejects(() => base.service.adjustPoints(base.scope, customer.id, { points: -101, idempotencyKey: "manual-2" }), error => error.code === "POINTS_INSUFFICIENT");
  } finally { await base.db.close(); }
});

test("membership, tags and order migration use scoped stable identifiers", async () => {
  const base = await fixture();
  try {
    const customer = await base.service.touchMiniProgramCustomer(base.scope, { openid: "member-openid" });
    const tag = await base.service.createTag(base.scope, { name: "高意向" });
    await base.service.linkTag(base.scope, customer.id, tag.id);
    const membership = await base.service.joinMembership(base.scope, customer.id);
    assert.equal(membership.status, "active");
    assert.equal((await base.service.get(base.scope, customer.id)).tags[0].name, "高意向");
    await assert.rejects(() => base.db.query("insert into orders(tenant_id,store_id,order_no,status,payment_status,amount_fen,customer_id) values($1,$2,'ORDER-SCOPE-FAIL','created','unpaid',1000,$3)", [base.scope.tenantId, base.scope.storeId, customer.id]));
    await base.db.query("insert into orders(tenant_id,store_id,order_no,status,payment_status,amount_fen,customer_ref) values($1,$2,'ORDER-1','created','unpaid',1000,$3)", [base.scope.tenantId, base.scope.storeId, customer.id]);
    const dryRun = await inspectLegacyOrders(base.db);
    assert.equal(dryRun.linkableOrders, 1); assert.equal(dryRun.appliedOrders, 0);
    const applied = await inspectLegacyOrders(base.db, { apply: true });
    assert.equal(applied.appliedOrders, 1);
    assert.equal((await base.db.query("select customer_id from orders where order_no='ORDER-1'")).rows[0].customer_id, customer.id);
  } finally { await base.db.close(); }
});

test("customer touch cloud adapter ignores client OpenID and forwards trusted context identity", async () => {
  let payload;
  const result = await createCustomerTouchHandler({ cloud: { getWXContext: () => ({ OPENID: "trusted-openid" }) }, requestId: () => "touch-test", fail: (code,message,id) => ({ ok:false,code,message,requestId:id }), callApi: async (_path, body) => { payload = body; return { ok:true,data:{id:"customer"} }; } })({ publicStoreId: "public-store", openid: "forged-openid" });
  assert.equal(result.ok, true); assert.equal(payload.openid, "trusted-openid"); assert.notEqual(payload.openid, "forged-openid");
});

test("cross-workspace customer reads, tags, memberships and points are hidden", async () => {
  const owner = await fixture(); const attacker = await fixture();
  try {
    const customer = await owner.service.touchMiniProgramCustomer(owner.scope, { openid: "private-customer" });
    const tag = await attacker.service.createTag(attacker.scope, { name: "攻击标签" });
    await assert.rejects(() => attacker.service.get(attacker.scope, customer.id), error => error.code === "CUSTOMER_NOT_FOUND");
    await assert.rejects(() => attacker.service.linkTag(attacker.scope, customer.id, tag.id), error => error.code === "CUSTOMER_NOT_FOUND");
    await assert.rejects(() => attacker.service.joinMembership(attacker.scope, customer.id), error => error.code === "CUSTOMER_NOT_FOUND");
    await assert.rejects(() => attacker.service.adjustPoints(attacker.scope, customer.id, { points: 10, idempotencyKey: "attack" }), error => error.code === "CUSTOMER_NOT_FOUND");
  } finally { await owner.db.close(); await attacker.db.close(); }
});

test("customer identity migration is safe to execute repeatedly", async () => {
  const db = await createPortableTestDatabase();
  try {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../platform/migrations/005_customer_identity_membership.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query("select count(*)::int count from information_schema.tables where table_name in ('customer_events','customer_memberships','customer_points_ledger')")).rows[0].count, 3);
  } finally { await db.close(); }
});
