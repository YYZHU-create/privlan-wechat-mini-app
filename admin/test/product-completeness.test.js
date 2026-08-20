const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTabBar, listBusinessTemplates, applyBusinessTemplate } = require("../workspace-templates");
const { createSaasService, ServiceError } = require("../saas-service");
const { createPortableTestDatabase } = require("../database");
const { getTabBarItems, generateTabBarList } = require("../sync");
process.env.NODE_ENV = "test";

test("business template catalog and legacy navigation normalize to a safe v2 schema", () => {
  const templates = listBusinessTemplates();
  assert.deepEqual(templates.map(item => item.id), ["retail", "service", "restaurant", "education", "studio", "blank"]);
  const normalized = normalizeTabBar({ items: [{ text: "首页", page: "home" }, { text: "中心", center: true, page: "custom" }, { text: "我的", page: "mine" }] });
  assert.equal(normalized.schemaVersion, 2); assert.equal(normalized.items.length, 3); assert.equal(normalized.items.filter(item => item.visible).length >= 2, true);
  assert.ok(normalized.items.every(item => item.id && item.iconOn && item.page));
  const applied = applyBusinessTemplate({ brand: { name: "保留店铺" }, products: [{ id: 1 }], customPages: [{ id: "keep" }] }, "service");
  assert.equal(applied.brand.name, "保留店铺"); assert.equal(applied.products.length, 1); assert.equal(applied.businessMode, "service");
});

test("SaaS AI policy explicitly rejects platform mode", async () => {
  const db = await createPortableTestDatabase();
  try {
    const service = createSaasService({ db, licensePepper: "uat-license-pepper" });
    const registration = await service.register({ login: `policy-${Date.now()}@example.com`, password: "PolicyPass123", storeName: "Policy Workspace", template: "blank" });
    const scope = { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id, subscription: { status: "active" } };
    await assert.rejects(() => service.setAiPolicy(scope, { mode: "platform" }), error => error instanceof ServiceError && error.code === "AI_MODE_UNSUPPORTED");
  } finally { await db.close(); }
});

test("generator consumes 2–5 visible v2 navigation items and featured id", () => {
  const cfg = { tabBar: { featuredItemId: "b", items: [
    { id: "a", text: "首页", page: "home", icon: "a.png", iconOn: "a-on.png", visible: true, order: 0 },
    { id: "b", text: "预约", page: "appointment", icon: "b.png", iconOn: "b-on.png", visible: true, order: 1 },
    { id: "c", text: "我的", page: "mine", icon: "c.png", iconOn: "c-on.png", visible: false, order: 2 }
  ] } };
  assert.equal(getTabBarItems(cfg).length, 2);
  const list = generateTabBarList(cfg);
  assert.equal(list[1].center, true); assert.equal(list[1].path, "/pages/appointment/index");
  assert.throws(() => getTabBarItems({ tabBar: { items: [{ id: "x", text: "1", page: "home", visible: true }, { id: "x", text: "2", page: "mine", visible: true }] } }), /唯一/);
});
