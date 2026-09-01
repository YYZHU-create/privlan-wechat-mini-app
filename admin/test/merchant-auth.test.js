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

test("changes only the signed-in merchant password and revokes every merchant session", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, licensePepper: "password-test-pepper" });
  try {
    const accountA = await service.register({ login: "password-a@example.com", password: "current-a1", storeName: "Password A", template: "blank" });
    const accountB = await service.register({ login: "password-b@example.com", password: "current-b1", storeName: "Password B", template: "blank" });
    const secondA = await service.login({ login: "password-a@example.com", password: "current-a1" });
    const scopeA = await service.resolveSession(accountA.session.token);

    await assert.rejects(() => service.changePassword(scopeA, { currentPassword: "wrong-password", newPassword: "changed-a1" }), error => error.code === "CURRENT_PASSWORD_INVALID");
    await assert.rejects(() => service.changePassword(scopeA, { currentPassword: "current-a1", newPassword: "seven77" }), error => error.code === "INVALID_PASSWORD");
    await assert.rejects(() => service.changePassword(scopeA, { currentPassword: "current-a1", newPassword: "current-a1" }), error => error.code === "PASSWORD_REUSE_NOT_ALLOWED");

    const beforeB = (await db.query("select password_hash from users where id=$1", [accountB.user.id])).rows[0].password_hash;
    await service.changePassword(scopeA, { currentPassword: "current-a1", newPassword: "changed-a1", userId: accountB.user.id }, { requestId: "password_change_test" });
    const afterB = (await db.query("select password_hash from users where id=$1", [accountB.user.id])).rows[0].password_hash;
    assert.equal(afterB, beforeB);
    assert.equal(await service.resolveSession(accountA.session.token), null);
    assert.equal(await service.resolveSession(secondA.session.token), null);
    assert.ok(await service.resolveSession(accountB.session.token));
    await assert.rejects(() => service.login({ login: "password-a@example.com", password: "current-a1" }), error => error.code === "INVALID_CREDENTIALS");
    assert.ok(await service.login({ login: "password-a@example.com", password: "changed-a1" }));
    const audit = (await db.query("select * from audit_events where action='merchant.password_changed' and actor_id=$1", [accountA.user.id])).rows[0];
    assert.equal(audit.workspace_id, accountA.workspace.id);
    assert.equal(audit.request_id, "password_change_test");
    assert.doesNotMatch(JSON.stringify(audit), /current-a1|changed-a1/);
  } finally { await db.close(); }
});

test("rolls back password and session changes when the security audit cannot be written", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, licensePepper: "password-rollback-pepper" });
  try {
    const account = await service.register({ login: "password-rollback@example.com", password: "current-r1", storeName: "Password Rollback", template: "blank" });
    const scope = await service.resolveSession(account.session.token);
    const failingDb = {
      ...db,
      async transaction(fn) {
        return db.transaction(tx => fn({
          ...tx,
          async query(sql, params) {
            if (/insert into audit_events/i.test(sql)) throw new Error("simulated audit failure");
            return tx.query(sql, params);
          }
        }));
      }
    };
    const failingService = createSaasService({ db: failingDb, licensePepper: "password-rollback-pepper" });
    await assert.rejects(() => failingService.changePassword(scope, { currentPassword: "current-r1", newPassword: "changed-r1" }), /simulated audit failure/);
    assert.ok(await service.resolveSession(account.session.token));
    assert.ok(await service.login({ login: "password-rollback@example.com", password: "current-r1" }));
    await assert.rejects(() => service.login({ login: "password-rollback@example.com", password: "changed-r1" }), error => error.code === "INVALID_CREDENTIALS");
    assert.equal((await db.query("select count(*)::int count from audit_events where action='merchant.password_changed' and actor_id=$1", [account.user.id])).rows[0].count, 0);
  } finally { await db.close(); }
});
