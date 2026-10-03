"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readManagedAuthConfig, createManagedAuthRuntime, REQUIRED_MIGRATIONS } = require("../managed-auth-runtime");
const { validateProductionEnvironment } = require("../runtime-config");
const { createSaasService } = require("../saas-service");
process.env.NODE_ENV = "test";
function environment(extra = {}) {
  return { ATELIER_AUTH_PROVIDER: "supabase", MEOO_PROJECT_URL_ID: "asmhysidbg5g", ATELIER_ENVIRONMENT: "staging",
    ATELIER_RUNTIME_CONFIG_LOAD_STATUS: "LOADED_VALIDATED", ATELIER_AUTO_MIGRATE: "0", ATELIER_DB_BACKEND: "native",
    SUPABASE_URL: "https://provider.example.test", SUPABASE_ANON_KEY: "synthetic-public", ...extra };
}
test("legacy startup constructs no managed provider or schema queries", async () => {
  assert.equal(readManagedAuthConfig({}), null);
  assert.equal(await createManagedAuthRuntime({ env: {}, db: { query: () => { throw new Error(); } } }), null);
  assert.throws(() => readManagedAuthConfig({ ATELIER_AUTH_PROVIDER: "unknown" }), { code: "MANAGED_AUTH_PROVIDER_INVALID" });
});
test("managed activation validates target, loaded config, migration guard and provider before database access", () => {
  for (const extra of [{ MEOO_PROJECT_URL_ID: "unknown" }, { ATELIER_ENVIRONMENT: "production" },
    { ATELIER_RUNTIME_CONFIG_LOAD_STATUS: "NOT_FOUND_FAIL_CLOSED" }, { ATELIER_AUTO_MIGRATE: "1" },
    { SUPABASE_URL: "https://user:password@provider.test" }, { SUPABASE_URL: "http://provider.test" },
    { SUPABASE_URL: "https://provider.test/path" }, { SUPABASE_ANON_KEY: "" },
    { SUPABASE_ANON_KEY: "sb_secret_synthetic" },
    { SUPABASE_SERVICE_ROLE_KEY: "synthetic-public" },
    { SUPABASE_ANON_KEY: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature` },
    { ATELIER_DB_BACKEND: "meoo", DATABASE_URL: "postgresql://fixture/db" }]) {
    assert.throws(() => readManagedAuthConfig(environment(extra)));
  }
  assert.equal(readManagedAuthConfig(environment()).applicationOrigin, "https://asmhysidbg5g.meoo.pub");
  assert.equal(readManagedAuthConfig(environment({ MEOO_PROJECT_URL_ID: "g8o5cv1om41o", ATELIER_ENVIRONMENT: "production" })).applicationOrigin, "https://g8o5cv1om41o.meoo.pub");
});

test("actual bootstrap and Express entrypoint wire managed login on both surfaces", { timeout: 30000 }, async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), net = require("node:net");
  const { spawn } = require("node:child_process");
  const root = path.resolve(__dirname, "../..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "managed-real-entry-"));
  const listener = net.createServer(); await new Promise(r => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const preload = path.join(directory, "preload.cjs");
  const runtimeConfig = path.join(directory, "runtime-config.json");
  const { TARGETS, MEDIA_KEYS } = require("../target-runtime-config");
  fs.writeFileSync(runtimeConfig, JSON.stringify({ ...TARGETS.staging, media: {
    ...TARGETS.staging.media, storageProvider: "legacy", assetV1Enabled: false, storageBucket: ""
  } }));
  // Synthetic provider and isolated portable database; application bootstrap,
  // runtime schema probes, service construction and HTTP routes remain real.
  fs.writeFileSync(preload, `
    const root=${JSON.stringify(root)};
    const path=require('node:path');
    const database=require(path.join(root,'admin/database'));
    const {createSaasService}=require(path.join(root,'admin/saas-service'));
    const subject='00000000-0000-4000-8000-000000000001';
    database.createDatabaseFromEnv=async()=>{
      const db=await database.createPortableTestDatabase();
      const original=await createSaasService({db}).register({login:'merchant@example.test',password:'original-synthetic-password',storeName:'Fixture Store'});
      const operator='00000000-0000-4000-8000-000000000003';
      await db.query("insert into operator_users(id,email,display_name,password_hash,role,status) values($1,'ops-admin@localhost','Fixture Operator','unusable','super_admin','active')",[operator]);
      for(const [surface,merchant,ops] of [['merchant',original.user.id,null],['operator',null,operator]])
        await db.query('insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id) values($1,$2,$3,$4,$5,$6)',['asmhysidbg5g','https://provider.example.test',surface,subject,merchant,ops]);
      return db;
    };
    const sdk=require.resolve('@supabase/supabase-js',{paths:[path.join(root,'admin')]});
    require.cache[sdk]={id:sdk,filename:sdk,loaded:true,exports:{createClient:()=>({auth:{
      signInWithPassword:async({password})=>password==='original-synthetic-password'?{data:{session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600}}}:{error:{code:'invalid_credentials'}},
      getUser:async()=>({data:{user:{id:subject,email:'merchant@example.test'}}})
    }})}};
  `);
  const env = { ...process.env, ...environment(), NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
    ATELIER_RUNTIME_CONFIG_PATH: runtimeConfig,
    ATELIER_LICENSE_PEPPER: "p".repeat(32), ATELIER_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
    ATELIER_OPS_EMAIL: "", ATELIER_OPS_PASSWORD: "", DATABASE_URL: "", MEDIA_ASSET_V1_ENABLED: "false",
    ATELIER_DATA_ROOT: path.join(directory, "data"), PRIVLAN_CONFIG_BACKUP_DIR: path.join(directory, "backups"),
    PRIVLAN_MEDIA_TRASH_DIR: path.join(directory, "trash"), PRIVLAN_IMAGES_DIR: path.join(directory, "images"),
    PRIVLAN_FONTS_DIR: path.join(directory, "fonts"), PRIVLAN_DISABLE_GIT_SYNC: "1", ATELIER_WORKFLOW_INTEGRATION_WORKER: "0" };
  for (const key of MEDIA_KEYS) delete env[key];
  const child = spawn(process.execPath, ["--require", preload, path.join(root, "scripts/runtime-bootstrap.js")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let diagnostics = ""; child.stderr.on("data", chunk => { diagnostics = (diagnostics+chunk.toString()).slice(-2000); });
  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i=0; i<100; i++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(origin+"/health")).status === 200) { ready=true; break; } } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, `Isolated application failed to start: ${diagnostics.match(/(?:Error|SyntaxError|TypeError): [^\r\n]+/)?.[0] || "No error classification"}`);
    for (const [login, session] of [["/auth/login", "/auth/session"], ["/ops/v1/auth/login", "/ops/v1/auth/session"]]) {
      const response = await fetch(origin+login, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "merchant@example.test", email: "merchant@example.test", password: "original-synthetic-password" }) });
      assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /synthetic-access|synthetic-refresh/);
      const cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
      const sessionResponse = await fetch(origin+session, { headers: { Cookie: cookie } });
      assert.equal(sessionResponse.status, 200); assert.equal((await sessionResponse.json()).ok, true);
    }
  } finally {
    if (child.exitCode === null) { const exited = new Promise(r => child.once("exit", r)); child.kill(); await exited; }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("managed Production configuration replaces only obsolete password bootstrap prerequisites", () => {
  const env = environment({ NODE_ENV: "production", MEOO_PROJECT_URL_ID: "g8o5cv1om41o", ATELIER_ENVIRONMENT: "production",
    DATABASE_URL: "postgresql://fixture/db", ATELIER_LICENSE_PEPPER: "p".repeat(32),
    ATELIER_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"), ATELIER_APPOINTMENT_GATEWAY_TOKEN: "g".repeat(32), ATELIER_OPENID_HASH_KEY: "o".repeat(32) });
  assert.equal(validateProductionEnvironment(env).ok, true);
  assert.throws(() => validateProductionEnvironment({ ...env, ATELIER_MASTER_KEY: "" }), /ATELIER_MASTER_KEY/);
  assert.throws(() => validateProductionEnvironment({ ...env, ATELIER_AUTH_PROVIDER: "legacy" }), /ATELIER_OPS_EMAIL/);
});
test("native startup verifies migrations and columns with SELECT only; missing schema never falls back", async () => {
  const queries = [];
  const db = { kind: "postgres", query: async sql => { queries.push(sql); return { rows: sql.includes("schema_migrations") ? REQUIRED_MIGRATIONS.map(version => ({ version })) : [] }; } };
  const runtime = await createManagedAuthRuntime({ env: environment(), db, createClient: () => { throw new Error("No provider request during startup"); } });
  assert.ok(runtime.auth && runtime.repository);
  assert.equal(queries.length, 4); assert.ok(queries.every(q => q.startsWith("select ")));
  await assert.rejects(createManagedAuthRuntime({ env: environment(), db: { kind: "postgres", query: async () => ({ rows: [] }) } }), { code: "MANAGED_AUTH_SCHEMA_NOT_READY" });
  await assert.rejects(createManagedAuthRuntime({ env: environment(), db: { kind: "meoo" } }), { code: "MANAGED_AUTH_DATABASE_SELECTION_INVALID" });
});
test("Meoo startup uses bounded server-only schema GETs and no migration or provisioning RPC", async () => {
  const calls = [];
  const env = environment({ ATELIER_DB_BACKEND: "meoo", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server" });
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, json: async () => url.includes("schema_migrations") ? REQUIRED_MIGRATIONS.map(version => ({ version })) : [] };
  };
  const runtime = await createManagedAuthRuntime({ env, db: { kind: "meoo" }, fetchImpl, createClient: () => ({}) });
  assert.equal(typeof runtime.repository.provisionMerchant, "function");
  assert.equal(calls.length, 4);
  for (const { url, options } of calls) {
    assert.equal(url.origin, "https://provider.example.test"); assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer synthetic-server");
    assert.doesNotMatch(url.pathname, /rpc/); assert.ok(options.signal);
  }
  assert.equal(calls[1].url.searchParams.get("limit"), "0");
  await assert.rejects(createManagedAuthRuntime({ env, db: { kind: "meoo" }, fetchImpl: async () => ({ ok: false }) }), { code: "MANAGED_AUTH_SCHEMA_NOT_READY" });
});
test("managed service refuses legacy environment account bootstrap", async () => {
  let reads = 0;
  const service = createSaasService({ db: { query: async () => { reads++; throw new Error("No legacy bootstrap"); } }, managedAuth: {} });
  assert.equal(await service.ensureOperatorFromEnv(), null); assert.equal(reads, 0);
});
test("native factory and HTTP routes accept both explicit original identities using one provider subject", async () => {
  const { createPortableTestDatabase } = require("../database");
  const express = require("express"), http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { registerMerchantRoutes, registerOpsAuthRoutes } = require("../merchant-routes");
  const db = await createPortableTestDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "managed-runtime-http-"));
  let server;
  try {
    const original = await createSaasService({ db }).register({ login: "merchant@example.test", password: "original-synthetic-password", storeName: "Original Store" });
    const operatorId = "00000000-0000-4000-8000-000000000003", subject = "00000000-0000-4000-8000-000000000001";
    await db.query("insert into operator_users(id,email,display_name,password_hash,role,status) values($1,'ops-admin@localhost','Original Operator','unusable','super_admin','active')", [operatorId]);
    for (const [surface, merchant, operator] of [["merchant", original.user.id, null], ["operator", null, operatorId]]) {
      await db.query("insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id) values($1,$2,$3,$4,$5,$6)", ["asmhysidbg5g", "https://provider.example.test", surface, subject, merchant, operator]);
    }
    const createClient = () => ({ auth: {
      signInWithPassword: async ({ password }) => password === "original-synthetic-password" ? { data: { session: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now()/1000)+3600 } } } : { error: { code: "invalid_credentials" } },
      getUser: async () => ({ data: { user: { id: subject, email: "merchant@example.test" } } })
    } });
    const runtime = await createManagedAuthRuntime({ env: environment(), db, createClient });
    const service = createSaasService({ db, managedAuth: runtime.auth, managedAuthRepository: runtime.repository });
    const app = express(); app.use(express.json());
    registerMerchantRoutes(app, async () => service, { dataRoot: directory }); registerOpsAuthRoutes(app, async () => service);
    server = http.createServer(app); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const route of ["/auth/login", "/ops/v1/auth/login"]) {
      const response = await fetch(origin+route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "merchant@example.test", email: "merchant@example.test", password: "original-synthetic-password" }) });
      assert.equal(response.status, 200);
      const payload = await response.text(); assert.doesNotMatch(payload, /synthetic-access|synthetic-refresh/);
      assert.ok(response.headers.getSetCookie().some(cookie => /HttpOnly/i.test(cookie)));
    }
    const sessions = (await db.query("select auth_provider from merchant_sessions where auth_provider='supabase' union all select auth_provider from operator_sessions where auth_provider='supabase'")).rows;
    assert.equal(sessions.length, 2);
    assert.equal((await db.query("select count(*)::int count from users")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int count from operator_users")).rows[0].count, 1);
    assert.equal((await db.query("select id from workspaces")).rows[0].id, original.workspace.id);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
