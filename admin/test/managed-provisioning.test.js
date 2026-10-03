"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { verifyPassword } = require("../platform-store");
process.env.NODE_ENV = "test";
const proof = { projectId: "fixture-project", providerOrigin: "https://auth.example.test", providerUserId: "00000000-0000-4000-8000-000000000001", email: "verified@example.test", emailVerified: true };
const input = { accessToken: "synthetic-token", storeName: "Verified Store", login: "untrusted@example.test", role: "super_admin", password: "untrusted-password" };

test("verified provisioning is atomic, merchant-only and duplicate-safe", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, managedAuth: { verifyRegistration: async () => proof } });
  try {
    const result = await service.completeRegistration(input);
    assert.equal(result.session, null);
    assert.equal(result.user.login, proof.email);
    const user = (await db.query("select * from users where id=$1", [result.user.id])).rows[0];
    assert.equal(user.password_hash, "!managed-auth");
    assert.equal(verifyPassword(input.password, user.password_hash), false);
    assert.equal((await db.query("select role from memberships where user_id=$1", [result.user.id])).rows[0].role, "owner");
    assert.equal((await db.query("select * from operator_users")).rows.length, 0);
    assert.equal((await db.query("select * from merchant_sessions")).rows.length, 0);
    const links = (await db.query("select * from managed_auth_identity_links")).rows;
    assert.equal(links.length, 1);
    assert.equal(links[0].merchant_user_id, result.user.id);
    assert.equal(links[0].operator_user_id, null);
    assert.deepEqual(await service.completeRegistration(input), { alreadyProvisioned: true });
    assert.equal((await db.query("select * from tenants")).rows.length, 1);
    assert.equal((await db.query("select * from workspaces")).rows.length, 1);
    assert.equal((await db.query("select * from subscriptions")).rows.length, 1);
  } finally { await db.close(); }
});

test("existing business email is preserved rather than automatically linked or recreated", async () => {
  const db = await createPortableTestDatabase();
  try {
    const original = await createSaasService({ db }).register({ login: proof.email, password: "original-password", storeName: "Original PRIVLAN" });
    const before = (await db.query("select * from users")).rows;
    const service = createSaasService({ db, managedAuth: { verifyRegistration: async () => proof } });
    await assert.rejects(service.completeRegistration(input), { code: "ACCOUNT_EXISTS" });
    assert.deepEqual((await db.query("select * from users")).rows, before);
    assert.equal((await db.query("select * from workspaces")).rows[0].id, original.workspace.id);
    assert.equal((await db.query("select * from managed_auth_identity_links")).rows.length, 0);
  } finally { await db.close(); }
});

test("verification failure produces no business transaction", async () => {
  const db = { transaction: () => { throw new Error("Must not execute"); } };
  const service = createSaasService({ db, managedAuth: { verifyRegistration: async () => { throw new Error("Unverified"); } } });
  await assert.rejects(service.completeRegistration(input), { code: "EMAIL_VERIFICATION_REQUIRED" });
});

test("late identity-link failure rolls back all newly created business rows", async () => {
  const db = await createPortableTestDatabase();
  try {
    const failing = { kind: db.kind, transaction: fn => db.transaction(tx => fn({
      ...tx, query: async (sql, params) => {
        if (sql.startsWith("insert into managed_auth_identity_links")) throw new Error("synthetic-link-write-failure");
        return tx.query(sql, params);
      }
    })) };
    const service = createSaasService({ db: failing, managedAuth: { verifyRegistration: async () => proof } });
    await assert.rejects(service.completeRegistration(input), /synthetic-link-write-failure/);
    for (const table of ["users", "tenants", "workspaces", "stores", "memberships", "subscriptions", "managed_auth_identity_links"]) {
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0, table);
    }
  } finally { await db.close(); }
});