const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { createMediaService } = require("../media-service-v1");
const { CANARY_MARKER, CANARY_OPERATION } = require("../asset-lifecycle-permit");

const ENABLED = process.env.ATELIER_POSTGRES17_INTEGRATION === "1";
const MIGRATIONS = path.resolve(__dirname, "../../platform/migrations");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
const uuid = () => crypto.randomUUID();

test("Migration 013-015 lifecycle RPCs execute in local PostgreSQL 17", { skip: !ENABLED && "set ATELIER_POSTGRES17_INTEGRATION=1 to start an ephemeral local Postgres container" }, async t => {
  const name = `feeldao-pg17-${crypto.randomBytes(5).toString("hex")}`;
  let client;
  let container;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-pg17-migration-"));
  t.after(async () => {
    if (client) await client.end().catch(() => {});
    if (container) {
      try { docker("rm", "--force", container); } catch {}
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });

  container = docker("run", "--rm", "--detach", "--name", name, "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--publish", "127.0.0.1::5432", "postgres:17-alpine");
  let port;
  let lastError;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      port = Number(docker("port", container, "5432/tcp").split(":").at(-1));
      client = new Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres", connectionTimeoutMillis: 1000 });
      await client.connect();
      const version = (await client.query("select version() as version")).rows[0].version;
      assert.match(version, /^PostgreSQL 17\./);
      break;
    } catch (error) {
      lastError = error;
      if (client) { await client.end().catch(() => {}); client = null; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  assert.ok(client, `local PostgreSQL 17 did not become ready: ${lastError?.message || "unknown"}`);

  await client.query(`
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE tenants (id uuid PRIMARY KEY);
    CREATE TABLE workspaces (id uuid PRIMARY KEY);
    CREATE TABLE stores (id uuid PRIMARY KEY);
    CREATE TABLE assets (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      store_id uuid REFERENCES stores(id),
      object_key text NOT NULL,
      mime_type text NOT NULL,
      bytes bigint NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_events (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      actor_type text NOT NULL,
      actor_id text NOT NULL,
      action text NOT NULL,
      resource_type text NOT NULL,
      resource_id text,
      request_id text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(fs.readFileSync(path.join(MIGRATIONS, "013_asset_contract_v1.sql"), "utf8"));
  await client.query(fs.readFileSync(path.join(MIGRATIONS, "014_asset_access_hardening.sql"), "utf8"));
  await client.query(fs.readFileSync(path.join(MIGRATIONS, "015_asset_lifecycle_v1.sql"), "utf8"));

  const tenant = uuid(); const workspace = uuid(); const store = uuid(); const actor = uuid();
  await client.query("insert into tenants(id) values($1)", [tenant]);
  await client.query("insert into workspaces(id) values($1)", [workspace]);
  await client.query("insert into stores(id) values($1)", [store]);

  const asset = uuid();
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status,metadata) values($1,$2,$3,$4,$5,'image/png',5,'content_image','deletion_requested',$6)", [asset, tenant, workspace, store, `tenant/${tenant}/workspace/${workspace}/asset/${asset}/original.png`, JSON.stringify({ lifecycleCanary: "feeldao.lifecycle-canary.v1" })]);
  await client.query("insert into asset_objects(asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values($1,'meoo','merchant-assets',$2,'original','image/png',5,$3)", [asset, `tenant/${tenant}/workspace/${workspace}/asset/${asset}/original.png`, "a".repeat(64)]);

  const finalArgs = [tenant, workspace, store, "merchant", actor, "pg17-canary-delete", asset, new Date().toISOString(), 1];
  const finalized = (await client.query("select public.atelier_asset_finalize_delete_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as result", finalArgs)).rows[0].result;
  assert.equal(finalized.ok, true);
  assert.equal(finalized.data.duplicate, false);
  assert.equal((await client.query("select status from assets where id=$1", [asset])).rows[0].status, "deleted");
  assert.equal(Number((await client.query("select count(*) as n from asset_objects where asset_id=$1", [asset])).rows[0].n), 1);
  assert.equal(Number((await client.query("select count(*) as n from audit_events where action='asset.deleted' and resource_id=$1", [asset])).rows[0].n), 1);
  const duplicate = (await client.query("select public.atelier_asset_finalize_delete_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as result", finalArgs)).rows[0].result;
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(Number((await client.query("select count(*) as n from audit_events where action='asset.deleted' and resource_id=$1", [asset])).rows[0].n), 1);

  const invalid = uuid();
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status) values($1,$2,$3,$4,'unused','image/png',0,'content_image','deletion_requested')", [invalid, tenant, workspace, store]);
  const rejected = (await client.query("select public.atelier_asset_finalize_delete_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as result", [tenant, workspace, store, "merchant", actor, "pg17-bad-count", invalid, new Date().toISOString(), 1])).rows[0].result;
  assert.equal(rejected.code, "ASSET_OBJECT_COUNT_MISMATCH");
  assert.equal((await client.query("select status from assets where id=$1", [invalid])).rows[0].status, "deletion_requested");
  const wrongScope = (await client.query("select public.atelier_asset_finalize_delete_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as result", [uuid(), workspace, store, "merchant", actor, "pg17-wrong-tenant", invalid, new Date().toISOString(), 0])).rows[0].result;
  assert.equal(wrongScope.code, "ASSET_SCOPE_INVALID");
  assert.equal((await client.query("select status from assets where id=$1", [invalid])).rows[0].status, "deletion_requested");

  const linked = uuid(); const linkId = uuid();
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status,deleted_at) values($1,$2,$3,$4,'unused-2','image/png',0,'content_image','deleted',now())", [linked, tenant, workspace, store]);
  await client.query("insert into asset_links(id,tenant_id,workspace_id,store_id,asset_id,entity_type,entity_id,purpose) values($1,$2,$3,$4,$5,'content','fixture','content_image')", [linkId, tenant, workspace, store, linked]);
  const reconciled = (await client.query("select public.atelier_asset_cleanup_deleted_links_v1($1,$2,$3,$4,$5,$6,$7) as result", [tenant, workspace, store, "system", actor, "pg17-reconcile", linked])).rows[0].result;
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.data.linksRemoved, 1);
  assert.equal(Number((await client.query("select count(*) as n from asset_links where id=$1", [linkId])).rows[0].n), 0);
  assert.equal(Number((await client.query("select count(*) as n from audit_events where action='asset.links_reconciled' and resource_id=$1", [linked])).rows[0].n), 1);

  const recoveryPolicy = uuid(); const recoveryAttempt = uuid();
  const recoveryAsset = uuid();
  const recoveryKey = `tenant/${tenant}/workspace/${workspace}/asset/${recoveryAsset}/original.png`;
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status,metadata) values($1,$2,$3,$4,$5,'image/png',5,'content_image','deletion_requested',$6)", [recoveryAsset, tenant, workspace, store, recoveryKey, JSON.stringify({ lifecycleCanary: CANARY_MARKER, lifecycleCanaryAuthorization: { policyId: recoveryPolicy, attemptId: recoveryAttempt } })]);
  await client.query("insert into asset_objects(asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values($1,'meoo','merchant-assets',$2,'original','image/png',5,$3)", [recoveryAsset, recoveryKey, "b".repeat(64)]);
  const unrelated = uuid();
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status) values($1,$2,$3,$4,'unrelated-key','image/png',5,'content_image','ready')", [unrelated, tenant, workspace, store]);
  const recoveryScope = { tenantId: tenant, workspaceId: workspace, storeId: store, userId: actor, requestId: "pg17-recovery" };
  const recoveryConfig = { enabled: true, tenantId: tenant, workspaceId: workspace, storeId: store, assetId: recoveryAsset, operation: CANARY_OPERATION, expectedStatus: "ready", expectedObjectKey: recoveryKey, marker: CANARY_MARKER, policyId: recoveryPolicy, attemptId: recoveryAttempt, expiresAt: new Date(Date.now() - 60_000).toISOString() };
  let storagePresent = false;
  let failFinalizeOnce = true;
  let loseFinalizeResponseOnce = true;
  let failDelete = false;
  let loseDeleteResponseOnce = false;
  const recoveryCalls = [];
  const recoveryRepository = {
    async getAssetByIdScoped(scope, id) { recoveryCalls.push(["read", scope.tenantId, scope.workspaceId, id]); return (await client.query("select * from assets where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id is not distinct from $4", [id, scope.tenantId, scope.workspaceId, scope.storeId])).rows[0] || null; },
    async listAssetObjects(_scope, id) { return (await client.query("select * from asset_objects where asset_id=$1 and variant='original'", [id])).rows; },
    async listAssetLinks(_scope, id) { return (await client.query("select * from asset_links where asset_id=$1", [id])).rows; },
    async listLifecycleAuditEvents(_scope, id, input) { return (await client.query("select action,request_id from audit_events where tenant_id=$1 and workspace_id=$2 and resource_type='asset' and resource_id=$3 and action=$4", [tenant, workspace, id, input.action])).rows; },
    async finalizeAssetDeletion(scope, id, input) {
      recoveryCalls.push(["finalize", id]);
      if (failFinalizeOnce) { failFinalizeOnce = false; throw Object.assign(new Error("simulated finalize response outage"), { code: "DATABASE_UNAVAILABLE" }); }
      const result = (await client.query("select public.atelier_asset_finalize_delete_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as result", [scope.tenantId, scope.workspaceId, scope.storeId, "merchant", scope.userId, scope.requestId, id, input.storageVerifiedAt, input.objectCount])).rows[0].result;
      if (!result.ok) throw Object.assign(new Error(result.code), { code: result.code });
      if (loseFinalizeResponseOnce) { loseFinalizeResponseOnce = false; throw Object.assign(new Error("simulated response lost after commit"), { code: "DATABASE_UNAVAILABLE" }); }
      return result.data;
    }
  };
  const storageProvider = {
    name: "pg17-storage-simulator",
    async verifyDeleted(_scope, key) { recoveryCalls.push(["verify", key]); return !storagePresent; },
    async deleteObject(_scope, key) {
      recoveryCalls.push(["delete", key]);
      if (failDelete) throw Object.assign(new Error("simulated delete failure"), { code: "STORAGE_DELETE_FAILED", status: 503 });
      storagePresent = false;
      if (loseDeleteResponseOnce) { loseDeleteResponseOnce = false; throw Object.assign(new Error("simulated response lost after object removal"), { code: "NETWORK_ERROR", status: 502 }); }
    }
  };
  const recoveryService = createMediaService({ provider: storageProvider, repository: recoveryRepository, lifecycleMutationsEnabled: false, lifecycleCanaryConfig: recoveryConfig, runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g" });
  const wrongAttempt = { policyId: uuid(), attemptId: uuid() };
  const recoveryReadsBeforeMismatch = recoveryCalls.length;
  await assert.rejects(() => recoveryService.recoverDeletion(recoveryScope, recoveryAsset, { operation: CANARY_OPERATION, ...wrongAttempt }), error => error.code === "ASSET_LIFECYCLE_RECOVERY_SCOPE_DENIED");
  assert.equal(recoveryCalls.length, recoveryReadsBeforeMismatch);
  await assert.rejects(() => recoveryService.recoverDeletion(recoveryScope, recoveryAsset, { operation: CANARY_OPERATION, policyId: recoveryPolicy, attemptId: recoveryAttempt }), error => error.code === "DATABASE_UNAVAILABLE");
  assert.equal((await recoveryRepository.getAssetByIdScoped(recoveryScope, recoveryAsset)).status, "deletion_requested");
  const ambiguousCommitted = await recoveryService.recoverDeletion(recoveryScope, recoveryAsset, { operation: CANARY_OPERATION, policyId: recoveryPolicy, attemptId: recoveryAttempt });
  assert.equal(ambiguousCommitted.state, "CONSISTENT_DELETED");
  assert.equal((await recoveryRepository.getAssetByIdScoped(recoveryScope, recoveryAsset)).status, "deleted");
  const recovered = await recoveryService.recoverDeletion(recoveryScope, recoveryAsset, { operation: CANARY_OPERATION, policyId: recoveryPolicy, attemptId: recoveryAttempt });
  assert.equal(recovered.state, "CONSISTENT_DELETED");
  assert.equal((await recoveryRepository.getAssetByIdScoped(recoveryScope, recoveryAsset)).status, "deleted");
  assert.equal((await recoveryRepository.listLifecycleAuditEvents(recoveryScope, recoveryAsset, { action: "asset.deleted" })).length, 1);
  assert.equal((await recoveryService.recoverDeletion(recoveryScope, recoveryAsset, { operation: CANARY_OPERATION, policyId: recoveryPolicy, attemptId: recoveryAttempt })).state, "CONSISTENT_DELETED");
  assert.equal((await recoveryRepository.getAssetByIdScoped(recoveryScope, unrelated)).status, "ready");

  const failurePolicy = uuid(); const failureAttempt = uuid();
  const failureAsset = uuid();
  const failureKey = `tenant/${tenant}/workspace/${workspace}/asset/${failureAsset}/original.png`;
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status,metadata) values($1,$2,$3,$4,$5,'image/png',5,'content_image','deletion_requested',$6)", [failureAsset, tenant, workspace, store, failureKey, JSON.stringify({ lifecycleCanary: CANARY_MARKER, lifecycleCanaryAuthorization: { policyId: failurePolicy, attemptId: failureAttempt } })]);
  await client.query("insert into asset_objects(asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values($1,'meoo','merchant-assets',$2,'original','image/png',5,$3)", [failureAsset, failureKey, "c".repeat(64)]);
  const failureConfig = { ...recoveryConfig, assetId: failureAsset, expectedObjectKey: failureKey, policyId: failurePolicy, attemptId: failureAttempt };
  const failureScope = { ...recoveryScope, requestId: "pg17-storage-recovery" };
  storagePresent = true; failDelete = true;
  const storageFailureService = createMediaService({ provider: storageProvider, repository: recoveryRepository, lifecycleMutationsEnabled: false, lifecycleCanaryConfig: failureConfig, runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g" });
  await assert.rejects(() => storageFailureService.recoverDeletion(failureScope, failureAsset, { operation: CANARY_OPERATION, policyId: failurePolicy, attemptId: failureAttempt }), error => error.code === "ASSET_LIFECYCLE_RECOVERY_STORAGE_STILL_PRESENT");
  assert.equal((await recoveryRepository.getAssetByIdScoped(failureScope, failureAsset)).status, "deletion_requested");
  failDelete = false;
  assert.equal((await storageFailureService.recoverDeletion(failureScope, failureAsset, { operation: CANARY_OPERATION, policyId: failurePolicy, attemptId: failureAttempt })).state, "CONSISTENT_DELETED");
  assert.equal((await recoveryRepository.getAssetByIdScoped(failureScope, failureAsset)).status, "deleted");

  const ambiguousPolicy = uuid(); const ambiguousAttempt = uuid();
  const ambiguousStorageAsset = uuid();
  const ambiguousStorageKey = `tenant/${tenant}/workspace/${workspace}/asset/${ambiguousStorageAsset}/original.png`;
  await client.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,purpose,status,metadata) values($1,$2,$3,$4,$5,'image/png',5,'content_image','deletion_requested',$6)", [ambiguousStorageAsset, tenant, workspace, store, ambiguousStorageKey, JSON.stringify({ lifecycleCanary: CANARY_MARKER, lifecycleCanaryAuthorization: { policyId: ambiguousPolicy, attemptId: ambiguousAttempt } })]);
  await client.query("insert into asset_objects(asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values($1,'meoo','merchant-assets',$2,'original','image/png',5,$3)", [ambiguousStorageAsset, ambiguousStorageKey, "d".repeat(64)]);
  const ambiguousStorageConfig = { ...recoveryConfig, assetId: ambiguousStorageAsset, expectedObjectKey: ambiguousStorageKey, policyId: ambiguousPolicy, attemptId: ambiguousAttempt };
  const ambiguousStorageScope = { ...recoveryScope, requestId: "pg17-storage-response-lost" };
  storagePresent = true; loseDeleteResponseOnce = true;
  const ambiguousStorageService = createMediaService({ provider: storageProvider, repository: recoveryRepository, lifecycleMutationsEnabled: false, lifecycleCanaryConfig: ambiguousStorageConfig, runtimeEnvironment: "staging", runtimeProjectId: "asmhysidbg5g" });
  assert.equal((await ambiguousStorageService.recoverDeletion(ambiguousStorageScope, ambiguousStorageAsset, { operation: CANARY_OPERATION, policyId: ambiguousPolicy, attemptId: ambiguousAttempt })).state, "CONSISTENT_DELETED");
  assert.equal((await recoveryRepository.getAssetByIdScoped(ambiguousStorageScope, ambiguousStorageAsset)).status, "deleted");
  assert.equal((await recoveryRepository.listLifecycleAuditEvents(ambiguousStorageScope, ambiguousStorageAsset, { action: "asset.deleted" })).length, 1);

  const callCountBeforeScopeDenial = recoveryCalls.length;
  await assert.rejects(() => recoveryService.recoverDeletion({ ...recoveryScope, tenantId: uuid() }, recoveryAsset), error => error.code === "ASSET_LIFECYCLE_RECOVERY_SCOPE_DENIED");
  assert.equal(recoveryCalls.length, callCountBeforeScopeDenial);
  assert.equal((await recoveryRepository.getAssetByIdScoped(recoveryScope, unrelated)).status, "ready");
});
