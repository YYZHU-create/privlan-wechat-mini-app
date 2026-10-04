"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");
const { hashPassword } = require("../platform-store");
const { createNativeMigrationRepository, createFileMigrationJournal, createMigrationProviderAdmin, migrateExistingAccounts } = require("../managed-existing-account-migration");
process.env.NODE_ENV = "test";
const subject = "00000000-0000-4000-8000-000000000001", operatorId = "00000000-0000-4000-8000-000000000003";
const password = "original-synthetic-password", email = "merchant@example.test", projectId = "asmhysidbg5g", providerOrigin = "https://provider.example.test";
async function fixture(t, extra = {}) {
  const db = await createPortableTestDatabase();
  t.after(() => db.close());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "existing-auth-migration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "journal.json"), journal = createFileMigrationJournal(filename);
  const original = await createSaasService({ db }).register({ login: email, password, storeName: "Original Store" });
  await db.query("insert into operator_users(id,email,display_name,password_hash,role,status) values($1,'ops-admin@localhost','Original Operator',$2,'super_admin','active')", [operatorId, hashPassword(password)]);
  await db.exec("create schema auth; create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb); create table profiles(id uuid primary key,username text unique not null);");
  if (extra.strictProfile) await db.exec("create function handle_new_user() returns trigger language plpgsql as $$ begin insert into profiles(id,username) values(NEW.id,NEW.raw_user_meta_data->>'username') on conflict(id) do nothing; return NEW; end $$; create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();");
  const databaseName = (await db.query("select current_database() name")).rows[0].name;
  const repository = createNativeMigrationRepository({ db, projectId, expectedDatabase: databaseName });
  let submits = 0, reads = 0;
  const providerAdmin = { providerOrigin,
    createUser: async input => {
      submits++; assert.deepEqual(Object.keys(input).sort(), input.user_metadata ? ["email", "email_confirm", "password", "user_metadata"] : ["email", "email_confirm", "password"]);
      assert.equal(input.password, password); assert.equal(input.email_confirm, true);
      if (extra.beforeCreate) await extra.beforeCreate(db);
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [subject, email, input.user_metadata || null]);
      if (extra.unknownOutcome) throw new Error("private provider detail");
      return { data: { user: { id: subject, email } } };
    },
    getUserById: async id => { reads++; assert.equal(id, subject); return { data: { user: { id, email, email_confirmed_at: "2026-01-01T00:00:00Z" } } }; }
  };
  const input = { projectId, providerOrigin, targetEmail: email, password, repository, providerAdmin, journal };
  return { db, original, journal, filename, input, submits: () => submits, reads: () => reads };
}
async function businessSnapshot(db) {
  const result = {};
  for (const table of ["users", "operator_users", "tenants", "workspaces", "memberships", "subscriptions", "stores"]) {
    result[table] = (await db.query(`select * from ${table}`)).rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}
test("one provider user links both original business accounts without changing seven business tables", async t => {
  const f = await fixture(t); const before = await businessSnapshot(f.db);
  const result = await migrateExistingAccounts(f.input);
  assert.deepEqual(result, { phase: "COMPLETED", providerSubmitCount: 1, identityLinkCount: 2, originalBusinessIdentitiesPreserved: true });
  assert.deepEqual(await businessSnapshot(f.db), before);
  const links = (await f.db.query("select surface,provider_user_id,merchant_user_id,operator_user_id from managed_auth_identity_links order by surface")).rows;
  assert.equal(links.length, 2); assert.ok(links.every(link => link.provider_user_id === subject));
  assert.equal(links[0].merchant_user_id, f.original.user.id); assert.equal(links[1].operator_user_id, operatorId);
  const durable = fs.readFileSync(f.filename, "utf8");
  assert.doesNotMatch(durable, /password|password_hash|access_token|refresh_token|original-synthetic-password|merchant@example/);
  assert.equal(f.submits(), 1); assert.equal(f.reads(), 1);
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_SUBMIT_ALREADY_CONSUMED" });
  assert.equal(f.submits(), 1);
});
test("live-style profile trigger receives a non-sensitive username and preserves business identities", async t => {
  const f = await fixture(t, { strictProfile: true }); const before = await businessSnapshot(f.db);
  await migrateExistingAccounts(f.input);
  assert.deepEqual((await f.db.query("select id,username from profiles")).rows,
    [{ id: subject, username: `managed_${f.original.user.id.toLowerCase().replace(/-/g, "")}` }]);
  assert.deepEqual(await businessSnapshot(f.db), before);
  assert.equal(f.submits(), 1);
});
test("profile username collision stops before journal latch and provider creation", async t => {
  const f = await fixture(t, { strictProfile: true });
  await f.db.query("insert into profiles(id,username) values($1,$2)", [operatorId, `managed_${f.original.user.id.toLowerCase().replace(/-/g, "")}`]);
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_PROFILE_USERNAME_NOT_CLEAR" });
  assert.equal(f.submits(), 0); assert.equal(await f.journal.read(), null);
});
test("independent operator password mismatch aborts before latch or provider submission", async t => {
  const f = await fixture(t);
  await f.db.query("update operator_users set password_hash=$1 where id=$2", [hashPassword("different-synthetic"), operatorId]);
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_ORIGINAL_PASSWORD_INVALID" });
  assert.equal(f.submits(), 0); assert.equal(await f.journal.read(), null);
});
test("existing provider email is never silently claimed or overwritten", async t => {
  const f = await fixture(t); await f.db.query("insert into auth.users(id,email) values($1,$2)", [subject, email]);
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_PROVIDER_ACCOUNT_NOT_CLEAR" });
  assert.equal(f.submits(), 0); assert.equal((await f.db.query("select * from managed_auth_identity_links")).rows.length, 0);
});
test("unknown create outcome consumes the single submit and allows no automatic recreation", async t => {
  const f = await fixture(t, { unknownOutcome: true });
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_PROVIDER_OUTCOME_UNKNOWN" });
  assert.equal((await f.journal.read()).phase, "CREATE_OUTCOME_UNKNOWN");
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_SUBMIT_ALREADY_CONSUMED" });
  await assert.rejects(migrateExistingAccounts({ ...f.input, resumeLinksOnly: true }), { code: "AUTH_MIGRATION_RESUME_NOT_VERIFIED" });
  assert.equal(f.submits(), 1); assert.equal((await f.db.query("select * from auth.users")).rows.length, 1);
});
test("late link failure leaves no half-grant and explicit link-only resume never creates a second provider account", async t => {
  const f = await fixture(t);
  await f.db.exec("create function reject_operator_link() returns trigger language plpgsql as $$ begin if NEW.surface='operator' then raise exception 'fixture'; end if; return NEW; end $$; create trigger fixture_link_fail before insert on managed_auth_identity_links for each row execute function reject_operator_link();");
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_LINKS_NOT_CONFIRMED" });
  assert.equal((await f.journal.read()).phase, "LINKS_PENDING_RECONCILIATION");
  assert.equal((await f.db.query("select * from managed_auth_identity_links")).rows.length, 0);
  assert.equal((await f.db.query("select * from auth.users")).rows.length, 1);
  await f.db.exec("drop trigger fixture_link_fail on managed_auth_identity_links;");
  assert.equal((await migrateExistingAccounts({ ...f.input, resumeLinksOnly: true })).identityLinkCount, 2);
  assert.equal(f.submits(), 1);
});
test("account changes during provider creation prevent linking the stale privileged proof", async t => {
  const f = await fixture(t, { beforeCreate: db => db.query("update operator_users set status='disabled' where id=$1", [operatorId]) });
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_LINKS_NOT_CONFIRMED" });
  assert.equal((await f.db.query("select * from managed_auth_identity_links")).rows.length, 0);
  assert.equal(f.submits(), 1);
});
test("database/project/provider mismatch aborts before any credential or provider operation", async t => {
  const f = await fixture(t);
  await assert.rejects(migrateExistingAccounts({ ...f.input, projectId: "g8o5cv1om41o" }), { code: "AUTH_MIGRATION_EXECUTOR_NOT_CONFIGURED" });
  await assert.rejects(migrateExistingAccounts({ ...f.input, providerOrigin: "https://other-provider.test" }), { code: "AUTH_MIGRATION_EXECUTOR_NOT_CONFIGURED" });
  const wrong = createNativeMigrationRepository({ db: f.db, projectId, expectedDatabase: "wrong-database" });
  await assert.rejects(migrateExistingAccounts({ ...f.input, repository: wrong }), { code: "AUTH_MIGRATION_DATABASE_IDENTITY_MISMATCH" });
  assert.equal(f.submits(), 0);
});
test("filesystem lease prevents concurrent migration submissions", async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeCreate: async () => { entered(); await wait; } });
  const first = migrateExistingAccounts(f.input); await ready;
  await assert.rejects(migrateExistingAccounts(f.input), { code: "AUTH_MIGRATION_JOURNAL_LOCKED" });
  release(); await first; assert.equal(f.submits(), 1);
});
test("durable SUBMITTING write failure prevents provider invocation", async t => {
  const f = await fixture(t); const base = f.journal;
  const journal = { ...base, write: async record => { if (record.phase === "SUBMITTING") throw new Error("synthetic disk failure"); return base.write(record); } };
  await assert.rejects(migrateExistingAccounts({ ...f.input, journal }));
  assert.equal(f.submits(), 0); assert.equal((await base.read()).phase, "PREPARED");
});
test("private provider-admin wrapper binds origin and keeps provider persistence disabled", () => {
  let options;
  const admin = createMigrationProviderAdmin({ providerOrigin, serviceRoleKey: "synthetic-server", createClient: (url, key, config) => {
    assert.equal(url, providerOrigin); assert.equal(key, "synthetic-server"); options = config;
    return { auth: { admin: { createUser: async () => ({}), getUserById: async () => ({}) } } };
  } });
  assert.equal(admin.providerOrigin, providerOrigin); assert.equal(options.auth.persistSession, false);
  assert.equal(options.auth.autoRefreshToken, false); assert.equal(options.auth.detectSessionInUrl, false);
  assert.doesNotMatch(JSON.stringify(admin), /synthetic-server/);
});

test("journal rejects secret-shaped fields and malformed durable state before any submission", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "migration-journal-validation-"));
  const filename = path.join(directory, "state.json"), journal = createFileMigrationJournal(filename);
  try {
    const record = { phase: "PREPARED", providerSubmitCount: 0, identityLinkCount: 0, projectId, providerOrigin,
      merchantId: subject, operatorId };
    await assert.rejects(journal.write({ ...record, password_hash: "synthetic-private" }), { code: "AUTH_MIGRATION_JOURNAL_INVALID" });
    await assert.rejects(journal.write({ ...record, phase: password }), { code: "AUTH_MIGRATION_JOURNAL_INVALID" });
    assert.equal(fs.existsSync(filename), false);
    fs.writeFileSync(filename, JSON.stringify({ ...record, phase: "SUBMITTING", providerSubmitCount: 0 }));
    await assert.rejects(journal.read(), { code: "AUTH_MIGRATION_JOURNAL_INVALID" });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("installed provider SDK uses one bounded non-redirecting create call and does not retry network errors", async () => {
  let calls = 0;
  const admin = createMigrationProviderAdmin({ providerOrigin, serviceRoleKey: "synthetic-server", fetchImpl: async (url, options) => {
    calls++; assert.equal(new URL(url).origin, providerOrigin); assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    throw new Error("synthetic transport failure");
  } });
  const response = await admin.createUser({ email, password, email_confirm: true });
  assert.ok(response.error); assert.equal(calls, 1);
});
