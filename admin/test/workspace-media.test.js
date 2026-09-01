const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFilesystemStorageProvider, createWorkspaceMedia, decode } = require("../workspace-media");

function png(width = 2, height = 3) {
  const value = Buffer.alloc(33);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(value, 0);
  value.write("IHDR", 12, "ascii"); value.writeUInt32BE(width, 16); value.writeUInt32BE(height, 20);
  return value;
}

function fakeDb(rows = [], failInsert = false) {
  return {
    rows,
    async query(sql, params = []) {
      if (/^select \* from assets where tenant_id/.test(sql)) return { rows: this.rows.filter(row => row.tenant_id === params[0] && row.workspace_id === params[1] && row.store_id === params[2]) };
      if (/^select \* from assets where id=\$1 and tenant_id=/.test(sql)) return { rows: this.rows.filter(row => row.id === params[0] && row.tenant_id === params[1] && row.workspace_id === params[2] && row.store_id === params[3]) };
      if (/^select \* from assets where id=\$1$/.test(sql)) return { rows: this.rows.filter(row => row.id === params[0]) };
      if (/^insert into assets/.test(sql)) {
        if (failInsert) throw new Error("insert failed");
        this.rows.push({ id: params[0], tenant_id: params[1], workspace_id: params[2], store_id: params[3], object_key: params[4], original_name: params[5], mime_type: params[6], bytes: params[7], metadata: JSON.parse(params[8]) });
        return { rows: [] };
      }
      if (/^update assets set metadata/.test(sql)) {
        const row = this.rows.find(item => item.id === params[1]); if (row) row.metadata = params[0]; return { rows: [] };
      }
      throw new Error(`unsupported query: ${sql}`);
    }
  };
}

const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a" };

test("decode validates image dimensions when present", () => {
  const result = decode("hero.png", `data:image/png;base64,${png().toString("base64")}`);
  assert.deepEqual(result.dimensions, { width: 2, height: 3 });
  assert.throws(() => decode("zero.png", `data:image/png;base64,${png(0, 3).toString("base64")}`), error => error.code === "MEDIA_DIMENSIONS_INVALID");
});

test("filesystem provider implements provider contract", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-provider-"));
  const provider = createFilesystemStorageProvider({ dataRoot: root });
  const key = "asset.png";
  await provider.put(scope, { objectKey: key, buffer: Buffer.from("asset") });
  assert.equal(provider.name, "filesystem");
  assert.equal(await provider.exists(scope, key), true);
  assert.deepEqual(await provider.metadata(scope, key), { bytes: 5, modifiedAt: (await fs.promises.stat(path.join(root, "workspaces", scope.workspaceId, "media", key))).mtime.toISOString() });
  assert.equal(await provider.get(scope, key), path.join(root, "workspaces", scope.workspaceId, "media", key));
  await provider.delete(scope, key);
  assert.equal(await provider.exists(scope, key), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("workspace media upload records dimensions and cleans provider object on DB failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-media-"));
  const db = fakeDb();
  const media = createWorkspaceMedia({ db, dataRoot: root });
  const item = await media.upload(scope, { name: "hero.png", data: `data:image/png;base64,${png().toString("base64")}` });
  assert.deepEqual(item.dimensions, { width: 2, height: 3 });
  assert.equal(await media.storageProvider.exists(scope, db.rows[0].object_key), true);

  const failedDb = fakeDb([], true);
  const failedMedia = createWorkspaceMedia({ db: failedDb, dataRoot: root });
  await assert.rejects(() => failedMedia.upload(scope, { name: "failed.png", data: `data:image/png;base64,${png().toString("base64")}` }));
  const failedDir = path.join(root, "workspaces", scope.workspaceId, "media");
  assert.equal(fs.readdirSync(failedDir).filter(name => name.endsWith(".png")).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});




test("merchant upload UI exposes progress, failed state, retry and duplicate guard", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(source, /xhr\.upload\.onprogress/);
  assert.match(source, /upload\.status = "failed"/);
  assert.match(source, /retryMediaUpload/);
  assert.match(source, /已跳过重复素材/);
});

