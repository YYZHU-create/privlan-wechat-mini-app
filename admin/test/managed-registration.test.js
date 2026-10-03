"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createManagedAuth } = require("../managed-auth");
const { createSaasService } = require("../saas-service");
process.env.NODE_ENV = "test";
function fixture({ signupError, session = null, user = { id: "subject", email: "merchant@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } } = {}) {
  const calls = [];
  const auth = createManagedAuth({ projectId: "fixture-project", supabaseUrl: "https://auth.example.test", anonKey: "synthetic",
    resolveIdentityLink: async () => { throw new Error("Registration must not grant an existing role"); },
    loadBusinessPrincipal: async () => { throw new Error("No business account before confirmation"); },
    createClient: () => ({ auth: {
      signUp: async input => { calls.push(Object.keys(input)); return { data: { user: { id: "opaque" }, session }, error: signupError }; },
      signOut: async () => { calls.push("cleanup"); return {}; },
      getUser: async () => ({ data: { user } })
    } }) });
  return { auth, calls };
}
test("registration sends only credentials and returns no identity, session or role", async () => {
  const f = fixture();
  assert.deepEqual(await f.auth.beginRegistration({ email: "merchant@example.test", password: "synthetic-password", role: "super_admin" }), { emailVerificationRequired: true });
  assert.deepEqual(f.calls, [["email", "password"]]);
});
test("existing-account registration reply has the same public result", async () => {
  const f = fixture({ signupError: { code: "user_already_exists", message: "private" } });
  assert.deepEqual(await f.auth.beginRegistration({ email: "merchant@example.test", password: "synthetic-password" }), { emailVerificationRequired: true });
});
test("unexpected automatic confirmation cannot create an application session", async () => {
  const f = fixture({ session: { access_token: "private" } });
  await assert.rejects(f.auth.beginRegistration({ email: "merchant@example.test", password: "synthetic-password" }), { code: "MANAGED_AUTH_EMAIL_CONFIRMATION_NOT_REQUIRED" });
  assert.deepEqual(f.calls, [["email", "password"], "cleanup"]);
});
test("registration verification uses the provider result, not user metadata", async () => {
  const f = fixture();
  assert.deepEqual(await f.auth.verifyRegistration("synthetic-token"), { projectId: "fixture-project", providerOrigin: "https://auth.example.test", providerUserId: "subject", email: "merchant@example.test", emailVerified: true });
});
test("missing or invalid confirmation rejects provisioning even with admin metadata", async () => {
  for (const email_confirmed_at of [undefined, "invalid"]) {
    const f = fixture({ user: { id: "subject", email: "merchant@example.test", email_confirmed_at, user_metadata: { email_verified: true, role: "super_admin" } } });
    await assert.rejects(f.auth.verifyRegistration("synthetic-token"), { code: "MANAGED_AUTH_EMAIL_NOT_VERIFIED" });
  }
});
test("managed registration has zero business writes before email verification", async () => {
  const f = fixture();
  const service = createSaasService({ db: { transaction: () => { throw new Error("No business writes"); } }, managedAuth: f.auth });
  assert.deepEqual(await service.register({ login: "merchant@example.test", password: "synthetic-password", storeName: "Fixture Store" }), { emailVerificationRequired: true });
});
test("invalid input and provider refusal never fall back to local registration", async () => {
  const f = fixture({ signupError: { code: "unexpected", message: "private" } });
  const service = createSaasService({ db: { transaction: () => { throw new Error("No fallback"); } }, managedAuth: f.auth });
  await assert.rejects(service.register({ login: "merchant@example.test", password: "synthetic-password", storeName: "Fixture Store" }), { code: "REGISTRATION_REJECTED" });
  await assert.rejects(f.auth.beginRegistration({ email: "ops-admin@localhost", password: "synthetic-password" }), { code: "MANAGED_AUTH_INVALID_REGISTRATION" });
  assert.equal(f.calls.length, 1);
});

test("HTTP registration pending confirmation emits 202 without application cookies", async () => {
  const express = require("express");
  const http = require("node:http");
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { registerMerchantRoutes } = require("../merchant-routes");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-registration-http-"));
  const app = express(); app.use(express.json());
  registerMerchantRoutes(app, async () => ({ register: async () => ({ emailVerificationRequired: true }) }), { dataRoot: dir });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "merchant@example.test", password: "synthetic-password", storeName: "Fixture" }) });
    assert.equal(response.status, 202);
    assert.deepEqual((await response.json()).data, { emailVerificationRequired: true });
    assert.deepEqual(response.headers.getSetCookie(), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});