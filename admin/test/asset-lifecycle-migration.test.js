const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");

const TENANT = "00000000-0000-0000-0000-000000000201";
const WORKSPACE = "00000000-0000-0000-0000-000000000202";
const STORE = "00000000-0000-0000-0000-000000000203";
const ACTOR = "merchant-lifecycle-test";

function id(value) { return `00000000-0000-0000-0000-${String(value).padStart(12, "0")}`; }

async function call(db, name, args) {
  const values = Object.values(args).map(value => value == null ? "null" : `'${String(value).replace(/'/g, "''")}'`).join(",");
  return (await db.query(`select ${name}(${values}) as result`)).rows[0].result;
}

async function seedScope(db) {
  await db.exec(`insert into tenants(id,name) values('${TENANT}','Lifecycle Tenant')`);
  await db.exec(`insert into workspaces(id,tenant_id,name) values('${WORKSPACE}','${TENANT}','Lifecycle Workspace')`);
  await db.exec(`insert into stores(id,tenant_id,workspace_id,name) values('${STORE}','${TENANT}','${WORKSPACE}','Lifecycle Store')`);
}

async function seedAsset(db, numericId, { status = "deleted", deletedAt = "2025-01-01T00:00:00.000Z", objects = 1, links = 0, deleteAudit = false } = {}) {
  const assetId = id(numericId);
  await db.exec(`insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes,status,deleted_at)
    values('${assetId}','${TENANT}','${WORKSPACE}','${STORE}','tenant/${assetId}/original.png','image/png',1,'${status}',${deletedAt ? `'${deletedAt}'` : "null"})`);
  for (let index = 0; index < objects; index += 1) {
    await db.exec(`insert into asset_objects(id,asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum)
      values('${id(Number(numericId) * 10 + index)}','${assetId}','meoo','test-bucket','tenant/${assetId}/v${index}.png','v${index}','image/png',1,'hash-${numericId}-${index}')`);
  }
  for (let index = 0; index < links; index += 1) {
    await db.exec(`insert into asset_links(id,tenant_id,workspace_id,store_id,asset_id,entity_type,entity_id,purpose)
      values('${id(Number(numericId) * 100 + index)}','${TENANT}','${WORKSPACE}','${STORE}','${assetId}','workspace','link-${numericId}-${index}','workspace_branding')`);
  }
  if (deleteAudit) {
    await db.exec(`insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata)
      values('${id(Number(numericId) * 1000)}','${TENANT}','${WORKSPACE}','system','seed','asset.deleted','asset','${assetId}','seed-${numericId}','{}')`);
  }
  return assetId;
}

function finalizationArgs(assetId, requestId, objectCount) {
  return [TENANT, WORKSPACE, STORE, "merchant", ACTOR, requestId, assetId, new Date().toISOString(), objectCount];
}

function purgeArgs(assetId, requestId, objectCount, cutoff, storageVerifiedAt = new Date().toISOString()) {
  return [TENANT, WORKSPACE, STORE, "system", ACTOR, requestId, assetId, cutoff, storageVerifiedAt, objectCount];
}

test("lifecycle finalization removes scoped links, records asset.deleted, and rejects object-count mismatch", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    await seedScope(db);
    const assetId = await seedAsset(db, 204, { status: "deletion_requested", deletedAt: null, objects: 2, links: 1 });
    const mismatch = await call(db, "atelier_asset_finalize_delete_v1", finalizationArgs(assetId, "delete-mismatch", 1));
    assert.equal(mismatch.code, "ASSET_OBJECT_COUNT_MISMATCH");
    const result = await call(db, "atelier_asset_finalize_delete_v1", finalizationArgs(assetId, "delete-success", 2));
    assert.equal(result.data.deleted, true);
    assert.equal(result.data.linksRemoved, 1);
    assert.deepEqual((await db.query("select status, deleted_at is not null as deleted from assets where id=$1", [assetId])).rows, [{ status: "deleted", deleted: true }]);
    assert.deepEqual((await db.query("select count(*)::int as count from asset_links where asset_id=$1", [assetId])).rows, [{ count: 0 }]);
    assert.deepEqual((await db.query("select action, metadata->>'objectCount' as object_count from audit_events where resource_id=$1", [assetId])).rows, [{ action: "asset.deleted", object_count: "2" }]);
    const duplicate = await call(db, "atelier_asset_finalize_delete_v1", finalizationArgs(assetId, "delete-success", 2));
    assert.equal(duplicate.data.duplicate, true);
    assert.deepEqual((await db.query("select count(*)::int as count from audit_events where resource_id=$1 and action='asset.deleted'", [assetId])).rows, [{ count: 1 }]);
  } finally { await db.close(); }
});

test("historical link reconciliation only accepts deleted tombstones and audits actual cleanup", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    await seedScope(db);
    const activeId = await seedAsset(db, 205, { status: "ready", deletedAt: null, links: 1 });
    const deletedId = await seedAsset(db, 206, { links: 1 });
    const active = await call(db, "atelier_asset_cleanup_deleted_links_v1", [TENANT, WORKSPACE, STORE, "system", ACTOR, "reconcile-active", activeId]);
    assert.equal(active.code, "ASSET_NOT_DELETED");
    const result = await call(db, "atelier_asset_cleanup_deleted_links_v1", [TENANT, WORKSPACE, STORE, "system", ACTOR, "reconcile-deleted", deletedId]);
    assert.equal(result.data.linksRemoved, 1);
    assert.deepEqual((await db.query("select action from audit_events where resource_id=$1", [deletedId])).rows, [{ action: "asset.links_reconciled" }]);
  } finally { await db.close(); }
});

test("purge rejects unverified candidates and removes children before the tombstone after the retention gate", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    await seedScope(db);
    const databaseNow = new Date((await db.query("select now() as now")).rows[0].now);
    const cutoff = new Date(databaseNow.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const youngDeletedAt = new Date(databaseNow.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const young = await seedAsset(db, 207, { deletedAt: youngDeletedAt, deleteAudit: true });
    const linked = await seedAsset(db, 208, { links: 1, deleteAudit: true });
    const unaudited = await seedAsset(db, 209);
    const mismatch = await seedAsset(db, 210, { objects: 2, deleteAudit: true });
    const eligible = await seedAsset(db, 211, { objects: 2, deleteAudit: true });
    const active = await seedAsset(db, 212, { status: "ready", deletedAt: null, deleteAudit: true });
    const stale = await seedAsset(db, 213, { deleteAudit: true });
    assert.equal((await call(db, "atelier_asset_purge_v1", purgeArgs(young, "purge-young", 1, cutoff))).code, "ASSET_RETENTION_NOT_MET");
    assert.equal((await call(db, "atelier_asset_purge_v1", purgeArgs(linked, "purge-linked", 1, cutoff))).code, "ASSET_LINKS_PRESENT");
    assert.equal((await call(db, "atelier_asset_purge_v1", purgeArgs(unaudited, "purge-unaudited", 1, cutoff))).code, "ASSET_DELETE_AUDIT_MISSING");
    assert.equal((await call(db, "atelier_asset_purge_v1", purgeArgs(mismatch, "purge-mismatch", 1, cutoff))).code, "ASSET_OBJECT_COUNT_MISMATCH");
    assert.equal((await call(db, "atelier_asset_purge_v1", purgeArgs(active, "purge-active", 1, cutoff))).code, "ASSET_RETENTION_NOT_MET");
    assert.equal((await call(db, "atelier_asset_purge_v1", purgeArgs(stale, "purge-stale", 1, cutoff, "2020-01-01T00:00:00.000Z"))).code, "STORAGE_VERIFICATION_STALE");
    const result = await call(db, "atelier_asset_purge_v1", purgeArgs(eligible, "purge-success", 2, cutoff));
    assert.equal(result.data.purged, true);
    assert.deepEqual((await db.query("select count(*)::int as count from assets where id=$1", [eligible])).rows, [{ count: 0 }]);
    assert.deepEqual((await db.query("select count(*)::int as count from asset_objects where asset_id=$1", [eligible])).rows, [{ count: 0 }]);
    assert.deepEqual((await db.query("select action from audit_events where resource_id=$1", [eligible])).rows, [{ action: "asset.deleted" }, { action: "asset.purged" }]);
    const duplicate = await call(db, "atelier_asset_purge_v1", purgeArgs(eligible, "purge-success", 2, cutoff));
    assert.equal(duplicate.data.duplicate, true);
    assert.deepEqual((await db.query("select count(*)::int as count from audit_events where resource_id=$1 and action='asset.purged'", [eligible])).rows, [{ count: 1 }]);
  } finally { await db.close(); }
});
