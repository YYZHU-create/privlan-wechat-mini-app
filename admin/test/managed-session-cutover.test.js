"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSaasService } = require("../saas-service");
process.env.NODE_ENV = "test";

test("managed cutover rejects legacy and missing session provenance on both repository surfaces", async () => {
  for (const auth_provider of [undefined, "legacy", "unknown", "supabase"]) {
    const row = { auth_provider, session_id: "session", user_id: "original", role: "super_admin", expires_at: new Date(Date.now() + 60000) };
    const lookup = async (hash, options) => { assert.equal(options.managed, true); return row; };
    const service = createSaasService({ db: {}, managedAuth: {},
      authRepository: { loadSession: lookup }, operatorRepository: { resolveSession: lookup } });
    assert.equal(Boolean(await service.resolveSession("synthetic")), auth_provider === "supabase");
    assert.equal(Boolean(await service.resolveOperatorSession("synthetic")), auth_provider === "supabase");
  }
});

test("native session lookups enforce provenance only after managed cutover", async () => {
  for (const managed of [false, true]) {
    for (const auth_provider of [undefined, "legacy", "supabase"]) {
      const db = { query: async sql => {
        assert.equal(sql.includes("s.auth_provider"), managed);
        return { rows: [{ auth_provider, session_id: "session", user_id: "original", role: "super_admin" }] };
      } };
      const service = createSaasService({ db, managedAuth: managed ? {} : null });
      assert.equal(Boolean(await service.resolveSession("synthetic")), !managed || auth_provider === "supabase");
      assert.equal(Boolean(await service.resolveOperatorSession("synthetic")), !managed || auth_provider === "supabase");
    }
  }
});

test("additive provenance migration preserves old session identities and distinguishes new sessions", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("create table merchant_sessions(id text primary key); create table operator_sessions(id text primary key); insert into merchant_sessions values('old-merchant'); insert into operator_sessions values('old-operator');");
    await db.exec(fs.readFileSync(path.resolve(__dirname, "../../platform/migrations/018_managed_auth_session_provenance.sql"), "utf8"));
    for (const table of ["merchant_sessions", "operator_sessions"]) {
      const old = (await db.query(`select * from ${table}`)).rows;
      assert.equal(old.length, 1);
      assert.equal(old[0].auth_provider, "legacy");
      assert.equal(old[0].id, table === "merchant_sessions" ? "old-merchant" : "old-operator");
      await db.query(`insert into ${table}(id,auth_provider) values('new','supabase')`);
      assert.equal((await db.query(`select auth_provider from ${table} where id='new'`)).rows[0].auth_provider, "supabase");
      await assert.rejects(db.query(`insert into ${table}(id,auth_provider) values('invalid','untrusted')`), { code: "23514" });
    }
  } finally { await db.close(); }
});
