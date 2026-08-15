const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPortableTestDatabase } = require("../database");
const { createLegacyBackup, importLegacyPrivlan } = require("../legacy-migration");

process.env.NODE_ENV = "test";

test("backs up, verifies and imports legacy PRIVLAN exactly once", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-migration-"));
  const root = path.join(temp, "repo");
  fs.mkdirSync(path.join(root, "admin"), { recursive: true });
  fs.mkdirSync(path.join(root, "images"), { recursive: true });
  fs.writeFileSync(path.join(root, "admin", "config.json"), JSON.stringify({ brand: { name: "PRIVLAN" }, products: [{ id: 1, name: "Original" }], categories: [], pageLayouts: {} }));
  fs.writeFileSync(path.join(root, "admin", "saas-state.json"), JSON.stringify({ workspace: { workspaceName: "PRIVLAN Retail", storeName: "PRIVLAN", planId: "professional" } }));
  fs.writeFileSync(path.join(root, "admin", "media-folders.json"), JSON.stringify({ folders: [], assignments: {} }));
  fs.writeFileSync(path.join(root, "images", "original.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const db = await createPortableTestDatabase();
  try {
    const backup = createLegacyBackup({ root, backupRoot: path.join(temp, "backups") });
    assert.ok(fs.existsSync(path.join(backup.path, "manifest.json")));
    await assert.rejects(() => importLegacyPrivlan({ db, root, backup, dataRoot: path.join(temp, "data"), ownerLogin: "short@privlan.test", ownerPassword: "seven77" }), /at least 8 characters/);
    const first = await importLegacyPrivlan({ db, root, backup, dataRoot: path.join(temp, "data"), ownerLogin: "owner@privlan.test", ownerPassword: "Owner123" });
    const second = await importLegacyPrivlan({ db, root, backup, dataRoot: path.join(temp, "data"), ownerLogin: "owner@privlan.test", ownerPassword: "Owner123" });
    assert.equal(first.imported, true);
    assert.equal(second.duplicate, true);
    assert.equal((await db.query("select count(*)::int count from legacy_imports")).rows[0].count, 1);
    assert.equal((await db.query("select document from workspace_configs where workspace_id=$1", [first.workspaceId])).rows[0].document.products[0].name, "Original");
    assert.ok(fs.existsSync(path.join(first.mediaRoot, "original.png")));
  } finally { await db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("refuses legacy import before credentials and verified backup are present", async () => {
  const db = await createPortableTestDatabase();
  try {
    await assert.rejects(() => importLegacyPrivlan({ db, root: os.tmpdir(), backup: null }), /Verified backup/);
    assert.equal((await db.query("select count(*)::int count from legacy_imports")).rows[0].count, 0);
  } finally { await db.close(); }
});
