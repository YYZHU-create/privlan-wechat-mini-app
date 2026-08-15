const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");

process.env.NODE_ENV = "test";

test("registers a complete merchant workspace and enforces credentials and session revocation", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, licensePepper: "auth-test-pepper" });
  try {
    await assert.rejects(() => service.register({ login: "short@example.com", password: "seven77", storeName: "Too Short" }), error => error.code === "INVALID_PASSWORD");
    const created = await service.register({ login: "merchant@example.com", password: "passw0rd", storeName: "Example Atelier", template: "blank" });
    assert.equal(created.subscription.status, "inactive");
    assert.equal((await service.resolveSession(created.session.token)).workspace.name, "Example Atelier");
    await assert.rejects(() => service.register({ login: "merchant@example.com", password: "another-password", storeName: "Duplicate" }), error => error.code === "ACCOUNT_EXISTS");
    await assert.rejects(() => service.login({ login: "merchant@example.com", password: "wrong-password" }), error => error.code === "INVALID_CREDENTIALS");
    const loggedIn = await service.login({ login: "merchant@example.com", password: "passw0rd" });
    const scope = await service.resolveSession(loggedIn.session.token);
    await service.logout(scope.sessionId, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: scope.userId });
    assert.equal(await service.resolveSession(loggedIn.session.token), null);
    const stored = (await db.query("select password_hash from users where login_identifier='merchant@example.com'")).rows[0].password_hash;
    assert.doesNotMatch(stored, /passw0rd/);
  } finally { await db.close(); }
});
