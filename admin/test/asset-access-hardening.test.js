const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPortableTestDatabase } = require("../database");

const migrationPath = path.resolve(__dirname, "../../platform/migrations/014_asset_access_hardening.sql");

test("asset access hardening revokes client roles and keeps server DML", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /alter table asset_objects enable row level security/i);
  assert.match(sql, /alter table asset_links enable row level security/i);
  assert.match(sql, /revoke all on table asset_objects from public/i);
  assert.match(sql, /revoke all on table asset_links from public/i);
  assert.match(sql, /rolname = 'anon'/i);
  assert.match(sql, /rolname = 'authenticated'/i);
  assert.match(sql, /grant select, insert, update, delete on table asset_objects to service_role/i);
  assert.match(sql, /grant select, insert, update, delete on table asset_links to service_role/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /alter table assets enable row level security/i);
});

test("portable PostgreSQL enforces client denial and service-role access", async () => {
  process.env.NODE_ENV = "test";
  const db = await createPortableTestDatabase();
  try {
    await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
    await db.exec(fs.readFileSync(migrationPath, "utf8"));
    await db.exec(`
      insert into tenants(id,name) values('00000000-0000-0000-0000-000000000001','T');
      insert into workspaces(id,tenant_id,name) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','W');
      insert into stores(id,tenant_id,workspace_id,name) values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','S');
      insert into assets(id,tenant_id,workspace_id,store_id,object_key,mime_type,bytes)
      values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','x','image/png',1);
    `);

    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      const denied = [
        () => db.query("select * from asset_objects"),
        () => db.query("select * from asset_links"),
        () => db.exec("insert into asset_objects(asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum) values('00000000-0000-0000-0000-000000000004','meoo','b','denied','original','image/png',1,'x')"),
        () => db.exec("insert into asset_links(tenant_id,workspace_id,asset_id,entity_type,entity_id,purpose) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','workspace','1','workspace_branding')"),
        () => db.exec("update asset_objects set variant='denied'"),
        () => db.exec("update asset_links set entity_id='denied'"),
        () => db.exec("delete from asset_objects"),
        () => db.exec("delete from asset_links"),
      ];
      for (const attempt of denied) await assert.rejects(attempt, /permission denied|not permitted/i);
      await db.exec("reset role");
    }

    await db.exec("set role service_role");
    assert.deepEqual((await db.query("select count(*)::int as count from asset_objects")).rows, [{ count: 0 }]);
    await db.exec(`
      insert into asset_objects(asset_id,storage_provider,bucket,object_key,variant,mime_type,size_bytes,checksum)
      values('00000000-0000-0000-0000-000000000004','meoo','b','k','original','image/png',1,'x');
    `);
    assert.deepEqual((await db.query("select count(*)::int as count from asset_objects")).rows, [{ count: 1 }]);
    await db.exec("reset role");

    const rls = await db.query("select relname,relrowsecurity from pg_class where relname in ('assets','asset_objects','asset_links') order by relname");
    assert.deepEqual(rls.rows, [
      { relname: "asset_links", relrowsecurity: true },
      { relname: "asset_objects", relrowsecurity: true },
      { relname: "assets", relrowsecurity: false },
    ]);
  } finally {
    await db.close();
  }
});
