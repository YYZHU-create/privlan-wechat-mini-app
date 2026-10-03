"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createManagedAuth } = require("../managed-auth");

function fixture(overrides = {}) {
  const calls = [];
  const config = {
    projectId: "staging-fixture", supabaseUrl: "https://auth.example.test", anonKey: "public-fixture",
    createClient(_url, _key, options) {
      assert.equal(options.auth.persistSession, false);
      assert.equal(options.auth.autoRefreshToken, false);
      return { auth: {
        async signInWithPassword(input) {
          calls.push(input.email);
          return { data: { session: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_at: 123 } } };
        },
        async getUser() {
          return { data: { user: { id: "provider-fixture", email: "different@example.test", user_metadata: { role: "super_admin" } } } };
        }
      } };
    },
    async resolveIdentityLink(input) { return { ...input, businessUserId: "permanent-fixture" }; },
    async loadBusinessPrincipal() { return { id: "permanent-fixture", status: "active", role: "owner", workspaceId: "original-workspace" }; },
    ...overrides
  };
  return { auth: createManagedAuth(config), calls };
}

test("merchant login preserves original business identity and ignores provider role", async () => {
  const { auth } = fixture();
  const result = await auth.login({ email: "merchant@example.test", password: "synthetic-only", surface: "merchant" });
  assert.equal(result.identity.businessUserId, "permanent-fixture");
  assert.equal(result.identity.principal.role, "owner");
  assert.equal(result.identity.principal.workspaceId, "original-workspace");
});
test("operator identifier is sent unchanged to provider; provider acceptance is not assumed", async () => {
  const { auth, calls } = fixture();
  await auth.login({ email: "ops-admin@localhost", password: "synthetic-only", surface: "operator" });
  assert.deepEqual(calls, ["ops-admin@localhost"]);
});
test("matching email never auto-links an unprovisioned identity", async () => {
  const { auth } = fixture({ resolveIdentityLink: async () => null });
  await assert.rejects(auth.resolve("synthetic-access", "merchant"), { code: "MANAGED_AUTH_IDENTITY_NOT_LINKED" });
});
for (const field of ["projectId", "surface", "providerUserId"]) {
  test(`rejects mismatched identity ${field}`, async () => {
    const { auth } = fixture({ resolveIdentityLink: async input => ({ ...input, [field]: "other", businessUserId: "permanent-fixture" }) });
    await assert.rejects(auth.resolve("synthetic-access", "operator"), { code: "MANAGED_AUTH_IDENTITY_NOT_LINKED" });
  });
}
test("disabled original account remains disabled", async () => {
  const { auth } = fixture({ loadBusinessPrincipal: async () => ({ id: "permanent-fixture", status: "disabled" }) });
  await assert.rejects(auth.resolve("synthetic-access", "merchant"), { code: "MANAGED_AUTH_BUSINESS_ACCOUNT_INACTIVE" });
});
test("provider error is sanitized and never falls back to old password verifier", async () => {
  const { auth } = fixture({ createClient: () => ({ auth: { signInWithPassword: async () => ({ error: { message: "secret-fixture" } }) } }) });
  await assert.rejects(auth.login({ email: "ops-admin@localhost", password: "synthetic-only", surface: "operator" }), error => error.code === "MANAGED_AUTH_INVALID_CREDENTIALS" && !error.message.includes("secret-fixture"));
});
test("untrusted provider response cannot establish a session", async () => {
  const { auth } = fixture({ createClient: () => ({ auth: { getUser: async () => ({ error: {} }) } }) });
  await assert.rejects(auth.resolve("synthetic-access", "merchant"), { code: "MANAGED_AUTH_INVALID_SESSION" });
});
