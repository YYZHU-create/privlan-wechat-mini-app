"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createManagedSessionLifetime, FIXED_LIFETIME_MS } = require("../managed-session-lifetime");
function fixture(surface = "merchant") {
  let clock = Date.parse("2026-10-04T00:00:00Z"), row, refreshes = 0, resolves = 0, tail = Promise.resolve();
  const identity = { surface, businessUserId: "original-business", providerUserId: "provider-subject", principal: { id: "original-business", status: "active" } };
  const session = () => ({ accessToken: "private-access", refreshToken: "private-refresh", expiresAt: (clock + 3600000) / 1000 });
  const repository = {
    insert: async r => { row = { ...r }; },
    withLockedSession: async (binding, callback) => {
      const before = tail; let release; tail = new Promise(r => { release = r; }); await before;
      try { return await callback({ row, updateEncryptedState: async value => { row.encryptedState = value; } }); }
      finally { release(); }
    }
  };
  const managedAuth = {
    resolve: async () => { resolves++; return identity; },
    refresh: async () => { refreshes++; return { identity, session: session() }; }
  };
  const input = { projectId: "asmhysidbg5g", providerOrigin: "https://provider.example.test", key: Buffer.alloc(32, 7), repository, managedAuth, now: () => clock };
  const coordinator = createManagedSessionLifetime(input);
  const request = { sessionId: "app-session", surface, businessUserId: "original-business" };
  return { coordinator, request, input, identity, repository, managedAuth, session, row: () => row,
    advance: ms => { clock += ms; }, counts: () => ({ refreshes, resolves }) };
}
for (const surface of ["merchant", "operator"]) test(`${surface} keeps exactly seven days across provider refresh`, async () => {
  const f = fixture(surface);
  const issued = await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  const before = JSON.stringify(f.row()); assert.doesNotMatch(before, /private-access|private-refresh/);
  f.advance(3600000);
  const accepted = await f.coordinator.resolve(f.request);
  assert.equal(+accepted.expiresAt, +issued.expiresAt); assert.equal(f.counts().refreshes, 1);
  f.advance(FIXED_LIFETIME_MS - 3600000);
  assert.equal(await f.coordinator.resolve(f.request), null); assert.equal(f.counts().refreshes, 1);
});
test("simultaneous requests use rotated state only once under repository lock", async () => {
  const f = fixture(); await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  f.advance(3600000); await Promise.all([f.coordinator.resolve(f.request), f.coordinator.resolve(f.request)]);
  assert.deepEqual(f.counts(), { refreshes: 1, resolves: 1 });
});
test("encrypted state cannot be moved to another surface or business identity", async () => {
  const f = fixture(); await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  f.row().businessUserId = "another";
  await assert.rejects(f.coordinator.resolve({ ...f.request, businessUserId: "another" }), { code: "MANAGED_SESSION_STATE_NOT_VERIFIED" });
  assert.deepEqual(f.counts(), { refreshes: 0, resolves: 0 });
});
test("provider outage does not extend deadline or accept cached identity", async () => {
  const f = fixture(); await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  const before = JSON.stringify(f.row()); f.advance(3600000);
  f.managedAuth.refresh = async () => { throw Object.assign(new Error("provider unavailable"), { code: "MANAGED_AUTH_PROVIDER_UNAVAILABLE" }); };
  await assert.rejects(f.coordinator.resolve(f.request), { code: "MANAGED_AUTH_PROVIDER_UNAVAILABLE" });
  assert.equal(JSON.stringify(f.row()), before);
});
test("refresh identity change never persists new tokens", async () => {
  const f = fixture(); await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  const state = f.row().encryptedState; f.advance(3600000);
  f.managedAuth.refresh = async () => ({ identity: { ...f.identity, providerUserId: "other-subject" }, session: f.session() });
  await assert.rejects(f.coordinator.resolve(f.request), { code: "MANAGED_SESSION_IDENTITY_CHANGED" });
  assert.equal(f.row().encryptedState, state);
});
test("storage failure rejects request after refresh rather than using unpersisted rotation", async () => {
  const f = fixture(); await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  f.advance(3600000); f.repository.withLockedSession = async (_, cb) => cb({ row: f.row(), updateEncryptedState: async () => { throw new Error("storage unavailable"); } });
  await assert.rejects(f.coordinator.resolve(f.request), /storage unavailable/);
});
test("revoked sessions never reach provider", async () => {
  const f = fixture(); await f.coordinator.issue({ ...f.request, providerResult: { identity: f.identity, session: f.session() } });
  f.row().revoked = true; assert.equal(await f.coordinator.resolve(f.request), null);
  assert.deepEqual(f.counts(), { refreshes: 0, resolves: 0 });
});
