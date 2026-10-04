"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { hashPassword } = require("../platform-store");
const { createMeooMigrationRepository } = require("../managed-meoo-migration-repository");
process.env.NODE_ENV = "test";
async function fixture(t) {
  const db = await createPortableTestDatabase(); t.after(() => db.close());
  const merchant = await createSaasService({ db }).register({ login: "test@example.test", password: "synthetic-password", storeName: "Original" });
  const operator = "00000000-0000-4000-8000-000000000003", subject = "00000000-0000-4000-8000-000000000004";
  await db.query("insert into operator_users(id,email,password_hash,display_name,role,status) values($1,'ops-admin@localhost',$2,'Original','super_admin','active')", [operator, hashPassword("synthetic-password")]);
  const name = (await db.query("select current_database() name")).rows[0].name;
  let writes = 0;
  const repository = createMeooMigrationRepository({ projectId: "asmhysidbg5g", expectedDatabase: name, queryOnce: async ({ projectId, sql }) => {
    assert.equal(projectId, "asmhysidbg5g");
    if (sql.startsWith("DO ")) writes++;
    return (await db.query(sql)).rows;
  } });
  const original = await repository.loadOriginalAccounts("test@example.test");
  const plan = { projectId: "asmhysidbg5g", providerOrigin: "https://provider.example.test", identities: [
    { surface: "merchant", businessUserId: original.merchant.id }, { surface: "operator", businessUserId: operator }] };
  return { db, repository, original, plan, subject, writes: () => writes, name, merchant };
}
test("Meoo single-statement transaction links both original identities and readbacks exact bindings", async t => {
  const f = await fixture(t);
  const before = (await f.db.query("select id,password_hash,status from users")).rows;
  assert.deepEqual(await f.repository.commitIdentityLinks({ plan: f.plan, providerUserId: f.subject, original: f.original }), { identityLinkCount: 2 });
  assert.equal(f.writes(), 1);
  assert.deepEqual((await f.db.query("select id,password_hash,status from users")).rows, before);
  await f.repository.commitIdentityLinks({ plan: f.plan, providerUserId: f.subject, original: f.original });
  assert.equal((await f.db.query("select count(*)::int n from managed_auth_identity_links")).rows[0].n, 2);
});
test("dollar-digit legacy hash data is not expanded as a SQL placeholder", async t => {
  const f = await fixture(t);
  const syntheticHash = "$scrypt$N=16384,r=8,p=1$123synthetic-salt$456synthetic-key";
  await f.db.query("update operator_users set password_hash=$1 where id=$2", [syntheticHash, f.original.operator.id]);
  f.original.operator.password_hash = syntheticHash;
  assert.deepEqual(await f.repository.commitIdentityLinks({ plan: f.plan, providerUserId: f.subject, original: f.original }), { identityLinkCount: 2 });
  assert.equal(f.writes(), 1);
  assert.equal((await f.db.query("select password_hash from operator_users where id=$1", [f.original.operator.id])).rows[0].password_hash, syntheticHash);
});
test("changed proof and late insert failure leave no partial mapping", async t => {
  const f = await fixture(t);
  await f.db.exec("create function deny_operator_link() returns trigger language plpgsql as $$ begin if new.surface='operator' then raise exception 'synthetic failure'; end if; return new; end $$; create trigger deny_link before insert on managed_auth_identity_links for each row execute function deny_operator_link();");
  await assert.rejects(f.repository.commitIdentityLinks({ plan: f.plan, providerUserId: f.subject, original: f.original }), /QUERY_NOT_CONFIRMED/);
  assert.equal((await f.db.query("select count(*)::int n from managed_auth_identity_links")).rows[0].n, 0);
  await f.db.query("update operator_users set status='disabled' where id=$1", [f.original.operator.id]);
  await assert.rejects(f.repository.commitIdentityLinks({ plan: f.plan, providerUserId: f.subject, original: f.original }), /QUERY_NOT_CONFIRMED/);
});
test("project mismatch blocks SQL and quote/dollar input is data not executable text", async t => {
  const f = await fixture(t);
  await assert.rejects(f.repository.commitIdentityLinks({ plan: { ...f.plan, projectId: "g8o5cv1om41o" }, providerUserId: f.subject, original: f.original }), /BINDING_MISMATCH/);
  assert.equal(f.writes(), 0);
  await assert.rejects(f.repository.commitIdentityLinks({ plan: f.plan, providerUserId: f.subject,
    original: { ...f.original, operator: { ...f.original.operator, password_hash: "x'$migration$; select 1;--\\" } } }), /QUERY_NOT_CONFIRMED/);
  assert.equal((await f.db.query("select count(*)::int n from managed_auth_identity_links")).rows[0].n, 0);
});
