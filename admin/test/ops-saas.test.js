const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");

process.env.NODE_ENV = "test";

test("operator sessions, license management and manual extension are database-backed and audited", async () => {
  const previousEmail = process.env.ATELIER_OPS_EMAIL; const previousPassword = process.env.ATELIER_OPS_PASSWORD;
  process.env.ATELIER_OPS_EMAIL = "operator@example.com"; process.env.ATELIER_OPS_PASSWORD = "operator-secure-password";
  const db = await createPortableTestDatabase(); const service = createSaasService({ db, licensePepper: "ops-pepper" });
  try {
    const account = await service.register({ login: "managed@example.com", password: "managed-password", storeName: "Managed Store", template: "blank" });
    const operator = await service.operatorLogin("operator@example.com", "operator-secure-password", { requestId: "ops_login" });
    assert.equal(await service.operatorAuthConfigured(), true);
    assert.equal((await service.resolveOperatorSession(operator.token)).role, "super_admin");
    const health = await service.operatorHealth();
    assert.equal(health.database, "ok");
    assert.equal(health.databaseKind, "pglite-test");
    assert.match(health.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
    const bootstrap = await service.opsBootstrap();
    assert.equal(bootstrap.tenants[0].workspaceName, "Managed Store");
    assert.equal(bootstrap.subscriptions[0].tenantName, "Managed Store");
    assert.equal(bootstrap.subscriptions[0].workspaceName, "Managed Store");
    assert.equal(Object.hasOwn(bootstrap, "publishJobs"), false);
    assert.equal(Object.hasOwn(bootstrap, "featureFlags"), false);
    const [license] = await service.generateLicenses({ planId: "PRO", durationHours: 720, count: 1, channel: "test" }, { id: operator.user.userId, requestId: "generate" });
    assert.equal((await service.listLicenses())[0].codeMasked, license.codeMasked);
    await service.disableLicense(license.id, { id: operator.user.userId, requestId: "disable" });
    assert.equal((await service.listLicenses())[0].status, "disabled");
    const extended = await service.extendSubscription(account.workspace.id, 30, { id: operator.user.userId, requestId: "extend" });
    assert.equal(extended.status, "active");
    const audit = JSON.stringify((await db.query("select action,metadata from audit_events order by created_at")).rows);
    assert.match(audit, /license\.generate/); assert.match(audit, /license\.disable/); assert.match(audit, /subscription\.extend/);
    assert.doesNotMatch(audit, new RegExp(license.code));
    await service.operatorLogout((await service.resolveOperatorSession(operator.token)).sessionId);
    assert.equal(await service.resolveOperatorSession(operator.token), null);
  } finally {
    await db.close();
    if (previousEmail === undefined) delete process.env.ATELIER_OPS_EMAIL; else process.env.ATELIER_OPS_EMAIL = previousEmail;
    if (previousPassword === undefined) delete process.env.ATELIER_OPS_PASSWORD; else process.env.ATELIER_OPS_PASSWORD = previousPassword;
  }
});
