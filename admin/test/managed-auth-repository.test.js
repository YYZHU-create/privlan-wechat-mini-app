"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createManagedAuthRepository, createMeooManagedAuthRepository } = require("../managed-auth-repository");
const provider = "00000000-0000-4000-8000-000000000001";
const business = "00000000-0000-4000-8000-000000000002";
const operator = "00000000-0000-4000-8000-000000000003";
const input = { projectId: "fixture-staging", providerOrigin: "https://auth.example.test", surface: "merchant", providerUserId: provider };

test("additive mapping enforces identities and keeps original business records", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`create table users(id uuid primary key, login_identifier text, display_name text, status text);
      create table operator_users(id uuid primary key, email text, display_name text, role text, status text);
      create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges grant all on tables to anon,authenticated;`);
    await db.query("insert into users values($1,'merchant@example.test','PRIVLAN','active')", [business]);
    await db.query("insert into operator_users values($1,'ops-admin@localhost','Operator','super_admin','active')", [operator]);
    const before = (await db.query("select * from users")).rows;
    await db.exec(fs.readFileSync(path.resolve(__dirname, "../../platform/migrations/017_managed_auth_identity_links.sql"), "utf8"));
    await db.query(`insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id)
      values($1,$2,$3,$4,$5)`, [input.projectId, input.providerOrigin, input.surface, provider, business]);
    const repository = createManagedAuthRepository({ db });
    assert.equal((await repository.resolveIdentityLink(input)).businessUserId, business);
    assert.equal((await repository.loadBusinessPrincipal({ surface: "merchant", businessUserId: business })).display_name, "PRIVLAN");
    assert.equal(await repository.resolveIdentityLink({ ...input, surface: "operator" }), null);
    await db.query(`insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,operator_user_id)
      values($1,$2,'operator',$3,$4)`, [input.projectId, input.providerOrigin, provider, operator]);
    assert.equal((await repository.resolveIdentityLink({ ...input, surface: "operator" })).businessUserId, operator);
    assert.equal((await repository.resolveIdentityLink(input)).businessUserId, business);
    assert.equal((await repository.loadBusinessPrincipal({ surface: "operator", businessUserId: operator })).role, "super_admin");
    assert.equal(Object.hasOwn(await repository.loadBusinessPrincipal({ surface: "merchant", businessUserId: business }), "role"), false);
    assert.equal(await repository.resolveIdentityLink({ ...input, projectId: "fixture-production" }), null);
    assert.equal(await repository.resolveIdentityLink({ ...input, providerOrigin: "https://other.example.test" }), null);
    assert.deepEqual((await db.query("select * from users")).rows, before);
    await assert.rejects(db.query(`insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id)
      values($1,$2,'operator',$3,$4)`, [input.projectId, input.providerOrigin, provider, business]), { code: "23514" });
    await assert.rejects(db.query(`insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id)
      values($1,$2,'merchant',$3,$4)`, [input.projectId, input.providerOrigin, operator, business]), { code: "23505" });
    await assert.rejects(db.query(`insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id)
      values($1,$2,'merchant',$3,$4)`, [input.projectId, input.providerOrigin, operator, provider]), { code: "23503" });
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query("select has_table_privilege($1,'managed_auth_identity_links','SELECT') as can_read, has_table_privilege($1,'managed_auth_identity_links','INSERT') as can_write", [role]);
      assert.deepEqual(result.rows[0], { can_read: false, can_write: false });
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from managed_auth_identity_links"), { code: "42501" });
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from managed_auth_identity_links")).rows.length, 2);
    await db.exec("reset role");
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='managed_auth_identity_links'")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});

test("Meoo repository issues only scoped GET requests and omits password columns", async () => {
  const requests = [];
  const repository = createMeooManagedAuthRepository({ url: input.providerOrigin, serviceRoleKey: "synthetic-only",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return { ok: true, json: async () => url.includes("managed_auth_identity_links")
        ? [{ project_id: input.projectId, provider_origin: input.providerOrigin, surface: "merchant", provider_user_id: provider, merchant_user_id: business }]
        : [{ id: business, status: "active" }] };
    } });
  assert.equal((await repository.resolveIdentityLink(input)).businessUserId, business);
  await repository.loadBusinessPrincipal({ surface: "merchant", businessUserId: business });
  assert.equal(requests[0].url.searchParams.get("project_id"), `eq.${input.projectId}`);
  assert.equal(requests[0].url.searchParams.get("provider_origin"), `eq.${input.providerOrigin}`);
  assert.equal(requests[0].url.searchParams.get("surface"), "eq.merchant");
  assert.equal(requests[0].url.searchParams.get("provider_user_id"), `eq.${provider}`);
  assert.equal(requests.every(r => r.options.method === "GET" && r.options.redirect === "error"), true);
  assert.equal(requests.some(r => r.url.searchParams.get("select").includes("password")), false);
});

test("Meoo repository rejects ambiguous results and sanitizes upstream errors", async () => {
  for (const response of [{ ok: true, json: async () => [{}, {}] }, { ok: false, json: async () => ({ secret: "fixture" }) }]) {
    const repository = createMeooManagedAuthRepository({ url: input.providerOrigin, serviceRoleKey: "synthetic-only", fetchImpl: async () => response });
    await assert.rejects(repository.resolveIdentityLink(input), error => /^MANAGED_AUTH_(AMBIGUOUS_IDENTITY|REPOSITORY_UNAVAILABLE)$/.test(error.code) && !error.message.includes("fixture"));
  }
});

test("invalid surfaces and provider IDs are rejected before a database request", async () => {
  let calls = 0;
  const repository = createManagedAuthRepository({ db: { query: async () => { calls++; return { rows: [] }; } } });
  await assert.rejects(repository.resolveIdentityLink({ ...input, surface: "administrator" }));
  await assert.rejects(repository.resolveIdentityLink({ ...input, providerUserId: "not-a-uuid" }));
  assert.equal(calls, 0);
});
