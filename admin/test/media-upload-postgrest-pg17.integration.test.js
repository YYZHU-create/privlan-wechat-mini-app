const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Client } = require("pg");
const { createAssetRepository } = require("../asset-repository");
const { createMediaService } = require("../media-service-v1");

const ENABLED = process.env.FEELDAO_MEDIA_POSTGREST_PG17 === "1";
const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "platform/migrations");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
const uuid = () => crypto.randomUUID();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JWT_SECRET = "local-only-feeldao-postgrest-integration-secret-32";
const DB_PASSWORD = "local-only-pg17-integration-password";

function jwt(payload) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const message = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  return `${message}.${crypto.createHmac("sha256", JWT_SECRET).update(message).digest("base64url")}`;
}

function localProvider() {
  const objects = new Map(); const calls = []; let failUpload = false; let holdUpload = null;
  return {
    objects, calls,
    setFailUpload(value) { failUpload = value; },
    setHoldUpload(value) { holdUpload = value; },
    name: "local-postgrest-integration-storage", bucket: "test-media",
    async uploadObject(_scope, key, bytes, mimeType) {
      calls.push(["upload", key]);
      if (holdUpload) { const gate = holdUpload; gate.enter(); await gate.wait; }
      if (failUpload) { const error = new Error("controlled explicit failure"); error.status = 400; throw error; }
      objects.set(key, { bytes: Buffer.from(bytes), mimeType });
    },
    async verifyObject(_scope, key, expected) {
      const object = objects.get(key);
      if (!object) { const error = new Error("not found"); error.status = 404; throw error; }
      const digest = crypto.createHash("sha256").update(object.bytes).digest("hex");
      if (object.bytes.length !== expected.sizeBytes || digest !== expected.checksum || object.mimeType !== expected.mimeType) throw new Error("object mismatch");
      return { sizeBytes: object.bytes.length, checksum: digest, mimeType: object.mimeType };
    },
    async readObject(_scope, key) {
      const object = objects.get(key);
      if (!object) { const error = new Error("not found"); error.status = 404; throw error; }
      return { bytes: new Uint8Array(object.bytes), sizeBytes: object.bytes.length, mimeType: object.mimeType };
    },
    async deleteObject(_scope, key) { calls.push(["delete", key]); objects.delete(key); },
    async verifyDeleted(_scope, key) { return !objects.has(key); }
  };
}

async function waitFor(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    try { const value = await predicate(); if (value) return value; }
    catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`local integration service did not become ready${last ? `: ${last.message}` : ""}`);
}

test("Media V1 service persists through PostgREST on PostgreSQL 17 after migrations 001-016", { skip: !ENABLED && "set FEELDAO_MEDIA_POSTGREST_PG17=1 to run disposable Docker integration" }, async t => {
  const suffix = crypto.randomBytes(5).toString("hex");
  const network = `feeldao-media-${suffix}`; const pgName = `feeldao-media-pg-${suffix}`; const restName = `feeldao-media-rest-${suffix}`;
  let client; let networkCreated = false; let pgCreated = false; let restCreated = false;
  t.after(async () => {
    if (client) await client.end().catch(() => {});
    if (restCreated) try { docker("rm", "--force", restName); } catch {}
    if (pgCreated) try { docker("rm", "--force", pgName); } catch {}
    if (networkCreated) try { docker("network", "rm", network); } catch {}
  });

  docker("network", "create", network); networkCreated = true;
  docker("run", "--detach", "--name", pgName, "--network", network, "--network-alias", "pg17", "--env", `POSTGRES_PASSWORD=${DB_PASSWORD}`, "--publish", "127.0.0.1::5432", "postgres:17-alpine"); pgCreated = true;
  const pgPort = Number(docker("port", pgName, "5432/tcp").split(":").at(-1));
  client = new Client({ host: "127.0.0.1", port: pgPort, user: "postgres", password: DB_PASSWORD, database: "postgres", connectionTimeoutMillis: 1000 });
  await waitFor(async () => { try { await client.connect(); return true; } catch (error) { if (client._connected) await client.end().catch(() => {}); client = new Client({ host: "127.0.0.1", port: pgPort, user: "postgres", password: DB_PASSWORD, database: "postgres", connectionTimeoutMillis: 1000 }); throw error; } });
  assert.match((await client.query("select version() as version")).rows[0].version, /^PostgreSQL 17\./);

  await client.query(`
    create role authenticator login noinherit password '${DB_PASSWORD}';
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant anon, authenticated, service_role to authenticator;
    create extension if not exists pgcrypto;
  `);
  const migrationFiles = fs.readdirSync(MIGRATIONS).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort();
  assert.deepEqual(migrationFiles.length, 16);
  for (const migration of migrationFiles) await client.query(fs.readFileSync(path.join(MIGRATIONS, migration), "utf8"));

  const tenant = uuid(); const workspace = uuid(); const store = uuid(); const user = uuid(); const secondTenant = uuid(); const secondWorkspace = uuid();
  await client.query("insert into tenants(id,name,status) values($1,'integration tenant','active'),($2,'other tenant','active')", [tenant, secondTenant]);
  const secondUser = uuid();
  await client.query("insert into users(id,login_identifier,password_hash,display_name) values($1,$2,'test-only-hash','integration user'),($3,$4,'test-only-hash','second integration user')", [user, `integration-${suffix}`, secondUser, `integration-second-${suffix}`]);
  await client.query("insert into workspaces(id,tenant_id,name) values($1,$2,'integration workspace'),($3,$4,'other workspace')", [workspace, tenant, secondWorkspace, secondTenant]);
  await client.query("insert into stores(id,tenant_id,workspace_id,name,status) values($1,$2,$3,'integration store','draft')", [store, tenant, workspace]);
  await client.query("insert into workspace_configs(workspace_id,tenant_id,store_id,document) values($1,$2,$3,$4::jsonb)", [workspace, tenant, store, JSON.stringify({ products: [{ id: "product-integration" }] })]);
  await client.query(`grant usage on schema public to anon, authenticated, service_role, authenticator;
    grant select,insert,update,delete on assets,asset_objects,asset_links,media_upload_attempts,workspace_configs,tenants,workspaces,stores,users to service_role;
    grant usage,select on all sequences in schema public to service_role;`);

  docker("run", "--detach", "--name", restName, "--network", network,
    "--env", "PGRST_DB_URI=postgres://authenticator:" + DB_PASSWORD + "@pg17:5432/postgres",
    "--env", "PGRST_DB_SCHEMAS=public", "--env", "PGRST_DB_ANON_ROLE=anon", "--env", `PGRST_JWT_SECRET=${JWT_SECRET}`,
    "--publish", "127.0.0.1::3000", "postgrest/postgrest:v12.2.3"); restCreated = true;
  const apiPort = Number(docker("port", restName, "3000/tcp").split(":").at(-1));
  const origin = `http://127.0.0.1:${apiPort}`;
  await waitFor(async () => {
    const response = await fetch(`${origin}/`);
    return response.ok;
  });

  const serviceKey = jwt({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 600 });
  let lastRestError = null;
  const repository = createAssetRepository({
    url: "https://media-postgrest.integration",
    serviceRoleKey: serviceKey,
    fetchImpl: async (url, options) => {
      const localUrl = String(url).replace("https://media-postgrest.integration/rest/v1", origin);
      const response = await fetch(localUrl, options);
      if (!response.ok) lastRestError = `${response.status} ${String(url)} ${await response.clone().text()}`;
      return response;
    },
    timeoutMs: 5000
  });
  const provider = localProvider();
  const service = createMediaService({ provider, repository });
  const scope = { tenantId: tenant, workspaceId: workspace, storeId: store, userId: user };

  const first = await service.upload(scope, { name: "first.png", data: PNG, purpose: "product_gallery", entityId: "product-integration", position: 0, folderId: "folder-one" }, { idempotencyKey: "postgrest-ready-key" }).catch(error => { error.restResponse = lastRestError; throw error; });
  assert.equal(first.status, "ready");
  const persisted = (await client.query("select attempt_id,asset_id,expected_object_key,phase,terminal_state,result,asset_metadata from media_upload_attempts where attempt_id=$1", [first.uploadAttemptId])).rows[0];
  assert.equal(persisted.phase, "READY_COMMITTED"); assert.equal(persisted.terminal_state, "CONSISTENT_READY");
  assert.equal(persisted.asset_id, first.id); assert.match(persisted.expected_object_key, new RegExp(`^tenant/${tenant}/workspace/${workspace}/asset/${first.id}/original\\.png$`));
  assert.equal(persisted.asset_metadata.folderId, "folder-one");
  assert.equal(Number((await client.query("select count(*) as n from assets where id=$1", [first.id])).rows[0].n), 1);
  assert.equal(Number((await client.query("select count(*) as n from asset_objects where asset_id=$1", [first.id])).rows[0].n), 1);
  const replay = await service.upload(scope, { name: "first.png", data: PNG, purpose: "product_gallery", entityId: "product-integration", position: 0, folderId: "folder-one" }, { idempotencyKey: "postgrest-ready-key" });
  assert.equal(replay.id, first.id); assert.equal(replay.uploadAttemptId, first.uploadAttemptId); assert.equal(replay.duplicate, true);
  await assert.rejects(() => service.upload(scope, { name: "first.png", data: PNG, purpose: "product_gallery", entityId: "product-integration", position: 0, folderId: "folder-two" }, { idempotencyKey: "postgrest-ready-key" }), error => error.code === "MEDIA_IDEMPOTENCY_KEY_REUSE");
  assert.equal(provider.calls.filter(call => call[0] === "upload").length, 1);

  const wrongScope = { ...scope, tenantId: secondTenant, workspaceId: secondWorkspace };
  assert.equal(await repository.getUploadAttempt(wrongScope, first.uploadAttemptId), null);
  const isolated = await service.upload(wrongScope, { name: "first.png", data: PNG }, { idempotencyKey: "postgrest-ready-key" });
  assert.notEqual(isolated.id, first.id);
  const wrongActor = { ...scope, userId: secondUser };
  assert.equal(await repository.getUploadAttempt(wrongActor, first.uploadAttemptId), null);
  const actorIsolated = await service.upload(wrongActor, { name: "first.png", data: PNG }, { idempotencyKey: "postgrest-ready-key" });
  assert.notEqual(actorIsolated.id, first.id);
  const siblingStore = uuid();
  await client.query("insert into stores(id,tenant_id,workspace_id,name,status) values($1,$2,$3,'sibling store','draft')", [siblingStore, tenant, workspace]);
  const wrongStore = { ...scope, storeId: siblingStore };
  assert.equal(await repository.getUploadAttempt(wrongStore, first.uploadAttemptId), null);
  const storeIsolated = await service.upload(wrongStore, { name: "first.png", data: PNG }, { idempotencyKey: "postgrest-ready-key" });
  assert.notEqual(storeIsolated.id, first.id);

  const unrelatedStorageKey = "unrelated/business-object.png";
  provider.objects.set(unrelatedStorageKey, { bytes: Buffer.from("unrelated"), mimeType: "image/png" });
  const protectedAssetIds = [first.id, isolated.id, actorIsolated.id, storeIsolated.id].sort();
  const snapshot = async () => ({
    assets: (await client.query("select id,tenant_id,workspace_id,store_id,status,deleted_at,metadata from assets where id=any($1::uuid[]) order by id", [protectedAssetIds])).rows,
    objects: (await client.query("select asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum from asset_objects where asset_id=any($1::uuid[]) order by asset_id,variant", [protectedAssetIds])).rows,
    links: (await client.query("select tenant_id,workspace_id,store_id,asset_id,entity_type,entity_id,purpose,position from asset_links where asset_id=any($1::uuid[]) order by asset_id,entity_type,entity_id,purpose,position", [protectedAssetIds])).rows
  });
  const protectedBeforeFaults = await snapshot();

  provider.setFailUpload(true);
  await assert.rejects(() => service.upload(scope, { name: "failed.png", data: PNG }, { idempotencyKey: "postgrest-cleaned-key" }));
  provider.setFailUpload(false);
  const cleanedAttempt = (await client.query("select attempt_id,asset_id,phase,terminal_state from media_upload_attempts where owner_user_id=$1 and idempotency_key_hash=$2", [user, crypto.createHash("sha256").update("postgrest-cleaned-key").digest("hex")])).rows[0];
  assert.equal(cleanedAttempt.phase, "CLEANED"); assert.equal(cleanedAttempt.terminal_state, "CONSISTENT_CLEANED");
  const cleanedReplay = await service.upload(scope, { name: "failed.png", data: PNG }, { idempotencyKey: "postgrest-cleaned-key" });
  assert.equal(cleanedReplay.terminalState, "CONSISTENT_CLEANED"); assert.equal(cleanedReplay.duplicate, true);
  assert.equal(Number((await client.query("select count(*) as n from assets where id=$1", [cleanedAttempt.asset_id])).rows[0].n), 0);

  const hold = { enter() { this.entered(); }, entered() {}, wait: null };
  let release; let entered;
  hold.wait = new Promise(resolve => { release = resolve; }); hold.entered = () => { entered?.(); };
  const enteredPromise = new Promise(resolve => { entered = resolve; }); provider.setHoldUpload(hold);
  const inFlight = service.upload(scope, { name: "leased.png", data: PNG }, { idempotencyKey: "postgrest-active-lease" });
  await enteredPromise;
  await assert.rejects(() => service.upload(scope, { name: "leased.png", data: PNG }, { idempotencyKey: "postgrest-active-lease" }), error => error.code === "MEDIA_UPLOAD_IN_PROGRESS");
  release(); provider.setHoldUpload(null); const leasedResult = await inFlight;
  assert.equal(leasedResult.status, "ready");

  const makeAttempt = async ({ owner = user, tenantId = tenant, workspaceId = workspace, phase = "ATTEMPT_CREATED", expiry = new Date(Date.now() - 60_000).toISOString(), key = uuid(), op = "POST /api/media/v1/upload" } = {}) => {
    const attemptId = uuid(); const assetId = uuid();
    const values = [attemptId, tenantId, workspaceId, store, owner, op, crypto.createHash("sha256").update(key).digest("hex"), "a".repeat(64), assetId, `tenant/${tenantId}/workspace/${workspaceId}/asset/${assetId}/original.png`, "b".repeat(64), 68, "image/png", "seed.png", "content_image", "original", null, null, false, "{}", phase, phase === "READY_COMMITTED" ? "CONSISTENT_READY" : phase === "CLEANED" ? "CONSISTENT_CLEANED" : null, uuid(), expiry, phase === "READY_COMMITTED" ? '{"status":"ready"}' : phase === "CLEANED" ? '{"status":"cleaned"}' : null];
    await client.query(`insert into media_upload_attempts(attempt_id,tenant_id,workspace_id,store_id,owner_user_id,operation,idempotency_key_hash,request_fingerprint,asset_id,expected_object_key,content_sha256,content_length,content_type,original_name,purpose,variant,entity_id,position,synthetic_canary,asset_metadata,phase,terminal_state,lease_token,lease_expires_at,result) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25::jsonb)`, values);
    return { attemptId, assetId, key };
  };

  await makeAttempt({ phase: "READY_COMMITTED", expiry: new Date(Date.now() - 60_000).toISOString() });
  await makeAttempt({ phase: "CLEANED", expiry: new Date(Date.now() - 60_000).toISOString() });
  const active = await makeAttempt({ phase: "ATTEMPT_CREATED", expiry: new Date(Date.now() + 60_000).toISOString() });
  const eligibleA = await makeAttempt({ phase: "ATTEMPT_CREATED" });
  const eligibleB = await makeAttempt({ phase: "DB_ASSET_CREATED", tenantId: secondTenant, workspaceId: secondWorkspace });
  const unrelatedAttemptBefore = (await client.query("select to_jsonb(a) as record from media_upload_attempts a where attempt_id=$1", [eligibleB.attemptId])).rows[0].record;
  const discovery = await repository.listRecoverableUploadAttempts(new Date().toISOString(), 200);
  const foundIds = discovery.map(item => item.attempt_id);
  assert.ok(foundIds.includes(eligibleA.attemptId)); assert.ok(foundIds.includes(eligibleB.attemptId));
  assert.ok(!foundIds.includes(active.attemptId));
  assert.ok(discovery.every(item => item.operation === "POST /api/media/v1/upload" && new Date(item.lease_expires_at) <= new Date()));
  assert.ok(discovery.every((item, index) => index === 0 || new Date(discovery[index - 1].lease_expires_at) <= new Date(item.lease_expires_at)));
  assert.ok((await repository.listRecoverableUploadAttempts(new Date().toISOString(), 1)).length <= 1);

  const race = await makeAttempt({ phase: "ATTEMPT_CREATED" });
  const now = new Date().toISOString();
  const claims = await Promise.all([
    repository.claimUploadAttempt(scope, race.attemptId, uuid(), now, new Date(Date.now() + 60_000).toISOString()),
    repository.claimUploadAttempt(scope, race.attemptId, uuid(), now, new Date(Date.now() + 60_000).toISOString())
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = claims.find(Boolean); const loserToken = null;
  const lost = await repository.transitionUploadAttempt(scope, race.attemptId, uuid(), "ATTEMPT_CREATED", { phase: "DB_ASSET_CREATED" });
  assert.equal(lost, null);
  const expiredRace = await makeAttempt({ phase: "ATTEMPT_CREATED", expiry: new Date(Date.now() - 60_000).toISOString() });
  const takeoverNow = new Date().toISOString();
  const tokens = [uuid(), uuid()];
  const takeovers = await Promise.all(tokens.map(token => repository.claimUploadAttempt(scope, expiredRace.attemptId, token, takeoverNow, new Date(Date.now() + 60_000).toISOString())));
  assert.equal(takeovers.filter(Boolean).length, 1);
  const winningToken = takeovers.find(Boolean).lease_token;
  assert.equal(await repository.transitionUploadAttempt(scope, expiredRace.attemptId, tokens.find(token => token !== winningToken), "ATTEMPT_CREATED", { phase: "DB_ASSET_CREATED" }), null);
  assert.ok(await repository.transitionUploadAttempt(scope, expiredRace.attemptId, winningToken, "ATTEMPT_CREATED", { phase: "DB_ASSET_CREATED" }));
  assert.ok(winner);

  const pgVersion = (await client.query("select current_setting('server_version_num')::integer as n")).rows[0].n;
  assert.ok(pgVersion >= 170000 && pgVersion < 180000);
  assert.deepEqual(await snapshot(), protectedBeforeFaults);
  assert.deepEqual((await client.query("select to_jsonb(a) as record from media_upload_attempts a where attempt_id=$1", [eligibleB.attemptId])).rows[0].record, unrelatedAttemptBefore);
  assert.equal(provider.objects.has(unrelatedStorageKey), true);
  const schemaEvidence = (await client.query(`select
    (select relrowsecurity from pg_class where oid='public.media_upload_attempts'::regclass) as rls,
    (select count(*) from pg_constraint where conrelid='public.media_upload_attempts'::regclass) as constraints,
    has_table_privilege('service_role','public.media_upload_attempts','select,insert,update,delete') as service_dml,
    has_table_privilege('authenticated','public.media_upload_attempts','select') as authenticated_read`)).rows[0];
  assert.equal(schemaEvidence.rls, true); assert.ok(Number(schemaEvidence.constraints) >= 4);
  assert.equal(schemaEvidence.service_dml, true); assert.equal(schemaEvidence.authenticated_read, false);
  const attemptCount = (await client.query("select count(*)::integer as n from media_upload_attempts")).rows[0].n;
  await client.query("drop table public.media_upload_attempts");
  assert.equal((await client.query("select to_regclass('public.media_upload_attempts') as relation")).rows[0].relation, null);
  assert.equal((await client.query("select count(*)::integer as n from assets where id=any($1::uuid[])", [protectedAssetIds])).rows[0].n, 4);
  t.diagnostic(`migrations=${migrationFiles.length}; pg_version_num=${pgVersion}; postgrest=${origin}; attempt_rows_before_rollback=${attemptCount}; rollback=016 table removed`);
});
