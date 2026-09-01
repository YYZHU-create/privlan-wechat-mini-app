const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");

process.env.NODE_ENV = "test";

test("keeps workspace configuration, product document and subscription rows isolated", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, licensePepper: "isolation-pepper" });
  try {
    const a = await service.register({ login: "a@example.com", password: "password-a1", storeName: "Workspace A", template: "blank" });
    const b = await service.register({ login: "b@example.com", password: "password-b1", storeName: "Workspace B", template: "blank" });
    const scopeA = await service.resolveSession(a.session.token);
    const scopeB = await service.resolveSession(b.session.token);
    await db.query("update subscriptions set status='active',expires_at=now()+interval '1 day' where workspace_id in ($1,$2)", [scopeA.workspaceId, scopeB.workspaceId]);
    scopeA.subscription.status = "active"; scopeB.subscription.status = "active";
    const configA = (await service.readConfig(scopeA)).document;
    configA.products = [{ id: 1, name: "A only" }];
    await service.writeConfig(scopeA, configA);
    assert.equal((await service.readConfig(scopeA)).document.products[0].name, "A only");
    assert.equal((await service.readConfig(scopeB)).document.products.length, 0);
    assert.notEqual(scopeA.tenantId, scopeB.tenantId);
    assert.notEqual((await service.getSubscription(scopeA)).id, (await service.getSubscription(scopeB)).id);
    assert.equal((await db.query("select count(*)::int count from workspace_configs where tenant_id=$1", [scopeA.tenantId])).rows[0].count, 1);
  } finally { await db.close(); }
});
