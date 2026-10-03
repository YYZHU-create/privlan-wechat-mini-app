"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createMeooManagedAuthRepository } = require("../managed-auth-repository");
const { createSaasService } = require("../saas-service");
const { createWorkspaceConfig } = require("../workspace-templates");
process.env.NODE_ENV = "test";
const proof = { projectId: "fixture", providerOrigin: "https://auth.example.test", providerUserId: "00000000-0000-4000-8000-000000000001", email: "verified@example.test", emailVerified: true };
const params = [proof.projectId,proof.providerOrigin,proof.providerUserId,proof.email,"Test Store","Contact",JSON.stringify(createWorkspaceConfig({ storeName: "Test Store", template: "retail" })),"retail","fixture-request"];
const sql = "select provision_managed_merchant($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) result";

test("provisioning RPC creates all business defaults once and exposes no Operator grant", async () => {
  const db = await createPortableTestDatabase();
  try {
    const result = (await db.query(sql, params)).rows[0].result;
    assert.equal(result.user.login, proof.email);
    assert.equal(result.subscription.status, "inactive");
    assert.equal((await db.query("select count(*)::int n from appointment_business_hours")).rows[0].n, 7);
    assert.equal((await db.query("select count(*)::int n from staff_schedules")).rows[0].n, 7);
    assert.equal((await db.query("select count(*)::int n from membership_levels")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from operator_users")).rows[0].n, 0);
    assert.equal((await db.query("select role from memberships")).rows[0].role, "owner");
    assert.deepEqual((await db.query(sql, params)).rows[0].result, { alreadyProvisioned: true });
    assert.equal((await db.query("select count(*)::int n from tenants")).rows[0].n, 1);
    await assert.rejects(db.query(sql, [params[0],params[1],"00000000-0000-4000-8000-000000000002",...params.slice(3)]), { code: "23505" });
    assert.equal((await db.query("select count(*)::int n from tenants")).rows[0].n, 1);
    await db.exec("create role anon; create role authenticated; set role anon;");
    await assert.rejects(db.query(sql, params), { code: "42501" });
    await db.exec("reset role; set role authenticated;");
    await assert.rejects(db.query(sql, params), { code: "42501" });
    await db.exec("reset role;");
  } finally { await db.close(); }
});

test("late RPC failure atomically restores the pre-request business state", async () => {
  const db = await createPortableTestDatabase();
  try {
    await db.exec("create function fail_managed_fixture() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$; create trigger fail_managed_fixture before insert on audit_events for each row execute function fail_managed_fixture();");
    await assert.rejects(db.query(sql, params), /synthetic audit failure/);
    for (const table of ["users","tenants","workspaces","stores","subscriptions","managed_auth_identity_links","staff_members","membership_programs"]) {
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0, table);
    }
  } finally { await db.close(); }
});

test("Meoo service sends one server-only RPC without SQL transaction fallback", async () => {
  const calls = [];
  const repository = createMeooManagedAuthRepository({ url: "https://db.example.test", serviceRoleKey: "synthetic-server-key",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ alreadyProvisioned: true, secret: "discard" }) }; } });
  const service = createSaasService({ db: { kind: "meoo", transaction: () => { throw new Error("No SQL fallback"); } },
    managedAuth: { verifyRegistration: async () => proof }, managedAuthRepository: repository });
  assert.deepEqual(await service.completeRegistration({ accessToken: "synthetic-provider-proof", storeName: "Test Store", role: "super_admin" }), { alreadyProvisioned: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://db.example.test/rest/v1/rpc/provision_managed_merchant");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(JSON.stringify(JSON.parse(calls[0].options.body)).includes("synthetic-provider-proof"), false);
  assert.equal(JSON.parse(calls[0].options.body).p_subject, proof.providerUserId);
});

test("unknown RPC outcome is reported separately and is not automatically retried", async () => {
  let count = 0;
  const repository = createMeooManagedAuthRepository({ url: "https://db.example.test", serviceRoleKey: "synthetic",
    fetchImpl: async () => { count++; throw new Error("synthetic disconnect"); } });
  const service = createSaasService({ db: { kind: "meoo" }, managedAuth: { verifyRegistration: async () => proof }, managedAuthRepository: repository });
  await assert.rejects(service.completeRegistration({ accessToken: "synthetic", storeName: "Test Store" }), { code: "AUTH_PROVISIONING_UNAVAILABLE", status: 503 });
  assert.equal(count, 1);
});
