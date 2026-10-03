"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { verifyExistingAccountMigration } = require("./managed-auth-migration-preflight");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(code) { const error = new Error(code); error.code = code; return error; }

function createNativeMigrationRepository({ db, projectId, expectedDatabase }) {
  if (!db?.query || !db?.transaction || !["asmhysidbg5g", "g8o5cv1om41o"].includes(projectId) ||
      typeof expectedDatabase !== "string" || !expectedDatabase) throw failure("AUTH_MIGRATION_REPOSITORY_REQUIRED");
  async function verifyTarget() {
    const rows = (await db.query("select current_database() database_name")).rows;
    if (rows.length !== 1 || rows[0].database_name !== expectedDatabase) throw failure("AUTH_MIGRATION_DATABASE_IDENTITY_MISMATCH");
  }
  async function loadOriginalAccounts(email) {
    const merchant = (await db.query("select id,login_identifier,status,password_hash from users where lower(login_identifier)=$1", [email])).rows;
    const operator = (await db.query("select id,email,status,role,password_hash from operator_users where lower(email)='ops-admin@localhost'")).rows;
    if (merchant.length !== 1 || operator.length !== 1) throw failure("AUTH_MIGRATION_ORIGINAL_ACCOUNT_NOT_UNIQUE");
    return { merchant: merchant[0], operator: operator[0] };
  }
  async function providerAccountExists(email) {
    const rows = (await db.query("select count(*)::int count from auth.users where lower(email)=$1", [email])).rows;
    if (rows.length !== 1 || !Number.isInteger(rows[0].count) || rows[0].count < 0) throw failure("AUTH_MIGRATION_PROVIDER_ACCOUNT_NOT_CLEAR");
    return rows[0].count !== 0;
  }
  async function links(plan, subject, client = db) {
    const [merchant, operator] = plan.identities.map(identity => identity.businessUserId);
    return (await client.query(`select surface,provider_user_id,merchant_user_id,operator_user_id
      from managed_auth_identity_links where project_id=$1 and provider_origin=$2
      and (provider_user_id=$3 or merchant_user_id=$4 or operator_user_id=$5)`,
    [plan.projectId, plan.providerOrigin, subject, merchant, operator])).rows;
  }
  async function assertLinksAvailable(plan) {
    const privileges = (await db.query("select has_table_privilege(current_user,'managed_auth_identity_links','INSERT') permitted")).rows;
    if (privileges.length !== 1 || privileges[0].permitted !== true) throw failure("AUTH_MIGRATION_IDENTITY_WRITE_NOT_PERMITTED");
    if ((await links(plan, "00000000-0000-4000-8000-000000000000")).length) throw failure("AUTH_MIGRATION_IDENTITY_ALREADY_LINKED");
  }
  async function commitIdentityLinks({ plan, providerUserId, original }) {
    return db.transaction(async tx => {
      const merchant = (await tx.query("select id,login_identifier,status,password_hash from users where id=$1 for update", [original.merchant.id])).rows[0];
      const operator = (await tx.query("select id,email,status,role,password_hash from operator_users where id=$1 for update", [original.operator.id])).rows[0];
      for (const [current, prior, fields] of [[merchant, original.merchant, ["id", "login_identifier", "status", "password_hash"]],
        [operator, original.operator, ["id", "email", "status", "role", "password_hash"]]]) {
        if (!current || fields.some(field => current[field] !== prior[field])) throw failure("AUTH_MIGRATION_ORIGINAL_ACCOUNT_CHANGED");
      }
      const existing = await links(plan, providerUserId, tx);
      if (existing.length) {
        const exact = existing.length === 2 && plan.identities.every(identity => existing.some(row =>
          row.surface === identity.surface && row.provider_user_id === providerUserId &&
          (identity.surface === "merchant" ? row.merchant_user_id : row.operator_user_id) === identity.businessUserId));
        if (!exact) throw failure("AUTH_MIGRATION_IDENTITY_LINK_CONFLICT");
        return { identityLinkCount: 2 };
      }
      await tx.query(`insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id)
        values($1,$2,'merchant',$3,$4,null),($1,$2,'operator',$3,null,$5)`,
      [plan.projectId, plan.providerOrigin, providerUserId, original.merchant.id, original.operator.id]);
      return { identityLinkCount: 2 };
    });
  }
  return { projectId, verifyTarget, loadOriginalAccounts, providerAccountExists, assertLinksAvailable, commitIdentityLinks };
}

function createMigrationProviderAdmin({ providerOrigin, serviceRoleKey, createClient, fetchImpl = globalThis.fetch }) {
  let origin;
  try { origin = new URL(providerOrigin); } catch { throw failure("AUTH_MIGRATION_PROVIDER_ADMIN_REQUIRED"); }
  const key = typeof serviceRoleKey === "string" ? serviceRoleKey.trim() : "";
  if (origin.protocol !== "https:" || origin.origin !== providerOrigin || origin.username || origin.password || !key) {
    throw failure("AUTH_MIGRATION_PROVIDER_ADMIN_REQUIRED");
  }
  const factory = createClient || require("@supabase/supabase-js").createClient;
  const providerFetch = (resource, options = {}) => {
    const target = new URL(typeof resource === "string" ? resource : resource.url);
    if (target.origin !== providerOrigin) throw failure("AUTH_MIGRATION_PROVIDER_TARGET_MISMATCH");
    return fetchImpl(resource, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
  };
  const client = factory(providerOrigin, key, { global: { fetch: providerFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return { providerOrigin, createUser: input => client.auth.admin.createUser(input), getUserById: id => client.auth.admin.getUserById(id) };
}

// Journal contains operational IDs/status only. Passwords, hashes and provider
// sessions never enter this durable record. Its caller controls the local path.
function createFileMigrationJournal(filename) {
  if (!path.isAbsolute(filename)) throw failure("AUTH_MIGRATION_JOURNAL_PATH_REQUIRED");
  const lock = `${filename}.lock`;
  function validate(record) {
    const allowed = ["phase", "providerSubmitCount", "identityLinkCount", "projectId", "providerOrigin", "merchantId", "operatorId", "providerUserId"];
    const phases = ["PREPARED", "SUBMITTING", "CREATE_OUTCOME_UNKNOWN", "PROVIDER_CREATED", "LINKING", "LINKS_PENDING_RECONCILIATION", "COMPLETED"];
    let origin; try { origin = new URL(record?.providerOrigin); } catch { throw failure("AUTH_MIGRATION_JOURNAL_INVALID"); }
    if (!record || Object.keys(record).some(key => !allowed.includes(key)) || !phases.includes(record.phase) ||
        !["asmhysidbg5g", "g8o5cv1om41o"].includes(record.projectId) || origin.protocol !== "https:" || origin.origin !== record.providerOrigin ||
        !UUID.test(record.merchantId || "") || !UUID.test(record.operatorId || "") || record.merchantId === record.operatorId ||
        record.providerSubmitCount !== (record.phase === "PREPARED" ? 0 : 1) ||
        record.identityLinkCount !== (record.phase === "COMPLETED" ? 2 : 0) ||
        (["PROVIDER_CREATED", "LINKING", "LINKS_PENDING_RECONCILIATION", "COMPLETED"].includes(record.phase)
          ? !UUID.test(record.providerUserId || "") : record.providerUserId !== undefined)) throw failure("AUTH_MIGRATION_JOURNAL_INVALID");
    return record;
  }
  return {
    async runExclusive(action) {
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      let handle;
      try { handle = fs.openSync(lock, "wx", 0o600); }
      catch { throw failure("AUTH_MIGRATION_JOURNAL_LOCKED"); }
      try { return await action(); }
      finally { fs.closeSync(handle); fs.unlinkSync(lock); }
    },
    async read() {
      try { return validate(JSON.parse(fs.readFileSync(filename, "utf8"))); }
      catch (error) { if (error.code === "ENOENT") return null; throw failure("AUTH_MIGRATION_JOURNAL_INVALID"); }
    },
    async write(record) {
      validate(record);
      const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, filename);
    }
  };
}

async function migrateExistingAccounts({ projectId, providerOrigin, targetEmail, password,
  repository, providerAdmin, journal, resumeLinksOnly = false }) {
  if (!["asmhysidbg5g", "g8o5cv1om41o"].includes(projectId) ||
      repository?.projectId !== projectId || !repository?.verifyTarget || providerAdmin?.providerOrigin !== providerOrigin ||
      !providerAdmin?.createUser || !providerAdmin?.getUserById ||
      !journal?.runExclusive || !journal?.read || !journal?.write) throw failure("AUTH_MIGRATION_EXECUTOR_NOT_CONFIGURED");
  const email = typeof targetEmail === "string" ? targetEmail.trim().toLowerCase() : "";
  return journal.runExclusive(async () => {
    const prior = await journal.read();
    if (prior && !resumeLinksOnly) throw failure("AUTH_MIGRATION_SUBMIT_ALREADY_CONSUMED");
    if (resumeLinksOnly && (!prior || !["PROVIDER_CREATED", "LINKING", "LINKS_PENDING_RECONCILIATION"].includes(prior.phase) ||
        prior.providerSubmitCount !== 1 || !UUID.test(prior.providerUserId || ""))) throw failure("AUTH_MIGRATION_RESUME_NOT_VERIFIED");
    await repository.verifyTarget();
    const original = await repository.loadOriginalAccounts(email);
    if (!UUID.test(original.merchant?.id || "") || !UUID.test(original.operator?.id || "")) throw failure("AUTH_MIGRATION_BUSINESS_IDENTITIES_INVALID");
    const plan = verifyExistingAccountMigration({ projectId, providerOrigin, targetEmail: email, password, ...original,
      providerAccountExists: resumeLinksOnly ? false : await repository.providerAccountExists(email) });
    const record = { phase: "PREPARED", providerSubmitCount: 0, identityLinkCount: 0, projectId, providerOrigin,
      merchantId: original.merchant.id, operatorId: original.operator.id };
    if (prior && ["projectId", "providerOrigin", "merchantId", "operatorId"].some(key => prior[key] !== record[key])) throw failure("AUTH_MIGRATION_RESUME_BINDING_MISMATCH");
    let subject = prior?.providerUserId;
    if (!resumeLinksOnly) {
      await repository.assertLinksAvailable(plan);
      await journal.write(record);
      record.phase = "SUBMITTING"; record.providerSubmitCount = 1;
      await journal.write(record);
      let response;
      try { response = await providerAdmin.createUser({ email, password, email_confirm: true }); }
      catch {
        record.phase = "CREATE_OUTCOME_UNKNOWN"; await journal.write(record);
        throw failure("AUTH_MIGRATION_PROVIDER_OUTCOME_UNKNOWN");
      }
      if (response?.error || !UUID.test(response?.data?.user?.id || "") || response.data.user.email?.toLowerCase() !== email) {
        record.phase = "CREATE_OUTCOME_UNKNOWN"; await journal.write(record);
        throw failure("AUTH_MIGRATION_PROVIDER_OUTCOME_UNKNOWN");
      }
      subject = response.data.user.id;
      record.providerUserId = subject; record.phase = "PROVIDER_CREATED";
      await journal.write(record);
    } else { Object.assign(record, { providerSubmitCount: 1, providerUserId: subject, phase: "PROVIDER_CREATED" }); }
    let provider;
    try { provider = await providerAdmin.getUserById(subject); }
    catch { throw failure("AUTH_MIGRATION_CREATED_IDENTITY_NOT_VERIFIED"); }
    const user = provider?.data?.user;
    if (provider?.error || user?.id !== subject || user.email?.toLowerCase() !== email ||
        !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) {
      throw failure("AUTH_MIGRATION_CREATED_IDENTITY_NOT_VERIFIED");
    }
    record.phase = "LINKING"; await journal.write(record);
    try {
      const result = await repository.commitIdentityLinks({ plan, providerUserId: subject, original });
      if (result?.identityLinkCount !== 2) throw new Error();
    } catch {
      record.phase = "LINKS_PENDING_RECONCILIATION"; await journal.write(record);
      throw failure("AUTH_MIGRATION_LINKS_NOT_CONFIRMED");
    }
    record.phase = "COMPLETED"; record.identityLinkCount = 2;
    await journal.write(record);
    return { phase: "COMPLETED", providerSubmitCount: 1, identityLinkCount: 2, originalBusinessIdentitiesPreserved: true };
  });
}
module.exports = { createNativeMigrationRepository, createMigrationProviderAdmin, createFileMigrationJournal, migrateExistingAccounts };
