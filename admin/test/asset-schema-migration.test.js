const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPortableTestDatabase } = require("../database");

const migrationPath = path.resolve(__dirname, "../../platform/migrations/013_asset_contract_v1.sql");

test("asset contract migration declares additive tables and constraints", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /alter table assets add column purpose text/);
  assert.match(sql, /create table asset_objects/);
  assert.match(sql, /create table asset_links/);
  assert.match(sql, /unique \(storage_provider, bucket, object_key\)/);
  assert.match(sql, /unique \(asset_id, variant\)/);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\s+into?\b/i);
});

test("asset contract schema enforces metadata checks and preserves legacy reads", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    const tenant = "00000000-0000-0000-0000-000000000101";
    const workspace = "00000000-0000-0000-0000-000000000102";
    const store = "00000000-0000-0000-0000-000000000103";
    const asset = "00000000-0000-0000-0000-000000000104";
    const object = "00000000-0000-0000-0000-000000000105";
    await db.exec(`insert into tenants(id,name) values('${tenant}','Test')`);
    await db.exec(`insert into workspaces(id,tenant_id,name) values('${workspace}','${tenant}','Workspace')`);
    await db.exec(`insert into stores(id,tenant_id,workspace_id,name) values('${store}','${tenant}','${workspace}','Store')`);
    await db.exec(`insert into assets(id,tenant_id,workspace_id,store_id,object_key,original_name,mime_type,bytes) values('${asset}','${tenant}','${workspace}','${store}','legacy.png','legacy.png','image/png',1)`);
    await db.exec(`insert into asset_objects(id,asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values('${object}','${asset}','meoo','feeldao-production-media','tenant/${tenant}/workspace/${workspace}/asset/${asset}/original.png','original','image/png',1,'abc')`);
    await assert.rejects(() => db.exec(`insert into asset_objects(id,asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values('00000000-0000-0000-0000-000000000106','${asset}','meoo','feeldao-production-media','dup','original-2','image/png',-1,'abc')`), /check|constraint/i);
    await assert.rejects(() => db.exec(`insert into asset_objects(id,asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values('00000000-0000-0000-0000-000000000106','${asset}','meoo','feeldao-production-media','tenant/${tenant}/workspace/${workspace}/asset/${asset}/original.png','web','image/png',1,'abc')`), /unique|constraint/i);
    await assert.rejects(() => db.exec(`insert into asset_objects(id,asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values('00000000-0000-0000-0000-000000000107','${asset}','meoo','feeldao-production-media','different-key','original','image/png',1,'abc')`), /unique|constraint/i);
    await assert.rejects(() => db.exec(`insert into asset_objects(id,asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values('00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000199','meoo','feeldao-production-media','other','original','image/png',1,'abc')`), /foreign|constraint/i);
    await assert.rejects(() => db.exec(`update assets set visibility='PUBLIC' where id='${asset}'`), /check|constraint/i);
    await assert.rejects(() => db.exec(`update assets set status='unknown' where id='${asset}'`), /check|constraint/i);
    await assert.rejects(() => db.exec(`update assets set purpose='unknown' where id='${asset}'`), /check|constraint/i);
    await assert.rejects(() => db.exec(`insert into asset_links(tenant_id,workspace_id,asset_id,entity_type,entity_id,purpose) values('${tenant}','${workspace}','${asset}','workspace_config_product','1','invalid')`), /check|constraint/i);
    const legacy = await db.query("select object_key,original_name,bytes from assets where id=$1", [asset]);
    assert.deepEqual(legacy.rows[0], { object_key: "legacy.png", original_name: "legacy.png", bytes: 1 });
  } finally { await db.close(); }
});
