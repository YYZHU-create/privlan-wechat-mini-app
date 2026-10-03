"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSaasService } = require("../saas-service");
process.env.NODE_ENV = "test";
function fixture(loginOverride) {
  const sessions = [], audits = [], requests = [];
  const expiresAt = Math.floor(Date.now() / 1000) + 1200;
  const managedAuth = { async login(input) {
    requests.push({ email: input.email, surface: input.surface });
    if (loginOverride) return loginOverride(input);
    const principal = input.surface === "operator"
      ? { id: "original-operator", status: "active", role: "super_admin", email: "ops-admin@localhost", display_name: "Operator" }
      : { id: "original-merchant", status: "active", login_identifier: "merchant@example.test", display_name: "PRIVLAN" };
    return { identity: { surface: input.surface, businessUserId: principal.id, principal }, session: { expiresAt, accessToken: "provider-secret-fixture", refreshToken: "provider-refresh-fixture" } };
  } };
  const unavailable = () => { throw new Error("Old credential lookup must not execute"); };
  const authRepository = {
    findUserByLogin: unavailable,
    async findMembership(id) { assert.equal(id, "original-merchant"); return { workspace_id: "original-workspace", tenant_id: "original-tenant" }; },
    async createSession(row) { sessions.push(row); }, async recordAudit(row) { audits.push(row); }
  };
  const operatorRepository = { findOperatorByEmail: unavailable,
    async createSession(row) { sessions.push(row); }, async audit(row) { audits.push(row); } };
  return { service: createSaasService({ db: {}, managedAuth, authRepository, operatorRepository }), sessions, audits, requests, expiresAt };
}
test("both login surfaces use provider authentication and original IDs, without exposing provider tokens", async () => {
  const f = fixture();
  const merchant = await f.service.login({ login: "merchant@example.test", password: "synthetic" });
  const operator = await f.service.operatorLogin("merchant@example.test", "synthetic");
  assert.equal(merchant.user.id, "original-merchant");
  assert.equal(operator.user.userId, "original-operator");
  assert.equal(operator.user.email, "merchant@example.test");
  assert.equal(operator.user.role, "super_admin");
  assert.deepEqual(f.requests.map(r => r.surface), ["merchant", "operator"]);
  assert.equal(f.sessions[0].workspace_id, "original-workspace");
  assert.equal(f.sessions[1].operator_id, "original-operator");
  assert.equal(new Date(f.sessions[0].expires_at).getTime(), f.expiresAt * 1000);
  assert.equal(new Date(f.sessions[1].expires_at).getTime(), f.expiresAt * 1000);
  assert.equal(JSON.stringify([merchant, operator, f.sessions, f.audits]).includes("provider-secret-fixture"), false);
  assert.equal(JSON.stringify([merchant, operator, f.sessions, f.audits]).includes("provider-refresh-fixture"), false);
});
test("provider rejection creates no business session and never checks old password", async () => {
  const f = fixture(() => { throw Object.assign(new Error("private-provider-detail"), { code: "MANAGED_AUTH_INVALID_CREDENTIALS" }); });
  await assert.rejects(f.service.login({ login: "merchant@example.test", password: "synthetic" }), { status: 401 });
  await assert.rejects(f.service.operatorLogin("merchant@example.test", "synthetic"), { code: "OPS_INVALID_CREDENTIALS" });
  assert.equal(f.sessions.length, 0);
});
test("provider outage remains service failure rather than wrong-password diagnosis", async () => {
  const f = fixture(() => { throw Object.assign(new Error("private-provider-detail"), { code: "MANAGED_AUTH_PROVIDER_UNAVAILABLE" }); });
  await assert.rejects(f.service.operatorLogin("merchant@example.test", "synthetic"), { status: 503, code: "AUTH_PROVIDER_UNAVAILABLE" });
});
test("wrong surface or expired provider session cannot issue an app session", async () => {
  const f = fixture(() => ({ identity: { surface: "merchant", businessUserId: "original-merchant", principal: { id: "original-merchant", status: "active" } }, session: { expiresAt: 1 } }));
  await assert.rejects(f.service.operatorLogin("merchant@example.test", "synthetic"), { code: "INVALID_AUTH_IDENTITY" });
  assert.equal(f.sessions.length, 0);
});
