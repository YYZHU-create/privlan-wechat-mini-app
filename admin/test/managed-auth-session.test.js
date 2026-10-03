"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createManagedAuth } = require("../managed-auth");
function fixture({ businessUserId = "original-business", updateError = false, logoutError = false } = {}) {
  const calls = [];
  const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const auth = createManagedAuth({ projectId: "synthetic-project", supabaseUrl: "https://auth.example.test", anonKey: "synthetic-public",
    createClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id: "synthetic-subject" } } }),
      refreshSession: async () => { calls.push("refresh"); return { data: { session } }; },
      signInWithPassword: async () => { calls.push("password-proof"); return { data: { session } }; },
      setSession: async () => ({ data: { session } }),
      updateUser: async () => { calls.push("update"); return updateError ? { error: { message: "private-fixture" } } : { data: { user: {} } }; },
      signOut: async options => { calls.push(options.scope); return logoutError ? { error: {} } : { error: null }; }
    } }),
    resolveIdentityLink: async input => ({ ...input, businessUserId }),
    loadBusinessPrincipal: async () => ({ id: businessUserId, status: "active" }) });
  return { auth, calls };
}
const identity = { surface: "merchant", businessUserId: "original-business" };
test("refresh revalidates the surface-specific business identity", async () => {
  const f = fixture(); const r = await f.auth.refresh({ ...identity, refreshToken: "synthetic-refresh" });
  assert.equal(r.identity.businessUserId, identity.businessUserId);
  assert.deepEqual(f.calls, ["refresh"]);
});
test("refresh cannot change the original business identity", async () => {
  const f = fixture({ businessUserId: "other-business" });
  await assert.rejects(f.auth.refresh({ ...identity, refreshToken: "synthetic-refresh" }), { code: "MANAGED_AUTH_IDENTITY_NOT_LINKED" });
});
test("logout revokes only this provider session", async () => {
  const f = fixture(); assert.deepEqual(await f.auth.logout({ ...identity, accessToken: "synthetic-access", refreshToken: "synthetic-refresh" }), { signedOut: true });
  assert.deepEqual(f.calls, ["local"]);
});
test("password update reauthenticates and revokes the temporary proof session", async () => {
  const f = fixture();
  const result = await f.auth.changePassword({ ...identity, email: "merchant@example.test", currentPassword: "old-synthetic", newPassword: "new-synthetic" });
  assert.deepEqual(result, { passwordChanged: true, proofSessionRevoked: true });
  assert.deepEqual(f.calls, ["password-proof", "update", "local"]);
});
test("password proof for another identity cannot update a password", async () => {
  const f = fixture({ businessUserId: "other-business" });
  await assert.rejects(f.auth.changePassword({ ...identity, email: "merchant@example.test", currentPassword: "old-synthetic", newPassword: "new-synthetic" }), { code: "MANAGED_AUTH_IDENTITY_NOT_LINKED" });
  assert.deepEqual(f.calls, ["password-proof", "local"]);
});
test("cleanup failure does not misreport an already changed password", async () => {
  const f = fixture({ logoutError: true });
  assert.deepEqual(await f.auth.changePassword({ ...identity, email: "merchant@example.test", currentPassword: "old-synthetic", newPassword: "new-synthetic" }), { passwordChanged: true, proofSessionRevoked: false });
});
test("password update rejection preserves its error while revoking the proof session", async () => {
  const f = fixture({ updateError: true });
  await assert.rejects(f.auth.changePassword({ ...identity, email: "merchant@example.test", currentPassword: "old-synthetic", newPassword: "new-synthetic" }), { code: "MANAGED_AUTH_PASSWORD_CHANGE_FAILED" });
  assert.deepEqual(f.calls, ["password-proof", "update", "local"]);
});
