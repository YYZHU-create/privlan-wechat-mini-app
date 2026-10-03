"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSaasService } = require("../saas-service");
const { createMeooAuthRepository } = require("../meoo-supabase-adapter");
process.env.NODE_ENV = "test";
const scope = { userId: "original-business", tenantId: "original-tenant", workspaceId: "original-workspace", user: { login: "merchant@example.test" } };
const input = { currentPassword: "old-synthetic", newPassword: "new-synthetic" };
function fixture({ providerReject = false, databaseReject = false } = {}) {
  const queries = [], proof = [];
  const db = { transaction: async fn => {
    if (databaseReject) throw new Error("synthetic-database-outage");
    return fn({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } });
  } };
  const managedAuth = { changePassword: async request => {
    proof.push(request.businessUserId);
    assert.equal(request.email, scope.user.login);
    if (providerReject) throw Object.assign(new Error("private-fixture"), { code: "MANAGED_AUTH_PASSWORD_CHANGE_FAILED" });
    return { passwordChanged: true, proofSessionRevoked: true };
  } };
  return { service: createSaasService({ db, managedAuth }), queries, proof };
}
test("managed password change never reads or rewrites legacy password hashes", async () => {
  const f = fixture(); const result = await f.service.changePassword(scope, input);
  assert.deepEqual(result, { passwordChanged: true, sessionsRevoked: true, auditRecorded: true, proofSessionRevoked: true });
  assert.equal(f.queries.some(q => q.sql.includes("password_hash")), false);
  assert.equal(f.queries[0].sql.includes("update merchant_sessions"), true);
  assert.deepEqual(f.proof, [scope.userId]);
  assert.equal(JSON.stringify(f.queries).includes(input.newPassword), false);
});
test("completed provider update is preserved when business cleanup fails", async () => {
  const f = fixture({ databaseReject: true });
  assert.deepEqual(await f.service.changePassword(scope, input), { passwordChanged: true, sessionsRevoked: false, auditRecorded: false, proofSessionRevoked: true });
});
test("provider rejection does not execute business mutations", async () => {
  const f = fixture({ providerReject: true });
  await assert.rejects(f.service.changePassword(scope, input), { code: "PASSWORD_CHANGE_REJECTED" });
  assert.equal(f.queries.length, 0);
});
test("Meoo session revocation patches only the authenticated business user", async () => {
  const calls = [];
  const userId = "00000000-0000-4000-8000-000000000001";
  const repository = createMeooAuthRepository({ url: "https://db.example.test", serviceRoleKey: "synthetic-only", fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, text: async () => JSON.stringify([{ id: "synthetic-session" }]) };
  } });
  await repository.revokeUserSessions(userId);
  assert.equal(calls[0].url.searchParams.get("user_id"), `eq.${userId}`);
  assert.equal(calls[0].url.searchParams.get("revoked_at"), "is.null");
  assert.equal(calls[0].options.method, "PATCH");
  await assert.rejects(repository.revokeUserSessions(""));
  assert.equal(calls.length, 1);
});
test("HTTP reports password success and incomplete cleanup separately", async () => {
  const express = require("express");
  const http = require("node:http");
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { registerMerchantRoutes } = require("../merchant-routes");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-password-http-"));
  const app = express(); app.use(express.json());
  registerMerchantRoutes(app, async () => ({ resolveSession: async () => scope, verifyCsrf: () => true,
    changePassword: async () => ({ passwordChanged: true, sessionsRevoked: false, auditRecorded: false, proofSessionRevoked: true }) }), { dataRoot: dir });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/change-password`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-atelier-csrf": "synthetic-only" }, body: JSON.stringify(input) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.data, { passwordChanged: true, sessionsRevoked: false, auditRecorded: false, proofSessionRevoked: true });
    assert.equal(JSON.stringify(result).includes(input.newPassword), false);
    assert.equal(response.headers.getSetCookie().some(cookie => cookie.startsWith("atelier_merchant_session=")), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
