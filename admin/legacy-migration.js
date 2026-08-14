const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { hashPassword } = require("./platform-store");

function fileHash(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function walkFiles(root, prefix = "") {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(absolute, relative) : [{ relative, absolute, bytes: fs.statSync(absolute).size, sha256: fileHash(absolute) }];
  }).sort((a, b) => a.relative.localeCompare(b.relative));
}

function createLegacyBackup({ root, backupRoot }) {
  const adminDir = path.join(root, "admin");
  const sourceFiles = ["config.json", "saas-state.json", "media-folders.json"].map(name => path.join(adminDir, name)).filter(fs.existsSync);
  const imageFiles = walkFiles(path.join(root, "images"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.resolve(backupRoot, `privlan-saas-migration-${stamp}`);
  fs.mkdirSync(path.join(destination, "admin"), { recursive: true });
  fs.mkdirSync(path.join(destination, "images"), { recursive: true });
  for (const file of sourceFiles) fs.copyFileSync(file, path.join(destination, "admin", path.basename(file)));
  for (const item of imageFiles) {
    const target = path.join(destination, "images", item.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(item.absolute, target);
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    sourceRoot: root,
    files: [...sourceFiles.map(absolute => ({ relative: `admin/${path.basename(absolute)}`, bytes: fs.statSync(absolute).size, sha256: fileHash(absolute) })), ...imageFiles.map(item => ({ relative: `images/${item.relative}`, bytes: item.bytes, sha256: item.sha256 }))]
  };
  manifest.sourceHash = crypto.createHash("sha256").update(manifest.files.map(item => `${item.relative}:${item.bytes}:${item.sha256}`).join("\n")).digest("hex");
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  const reopened = JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"), "utf8"));
  if (reopened.sourceHash !== manifest.sourceHash || reopened.files.some(item => fileHash(path.join(destination, item.relative)) !== item.sha256)) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw new Error("Legacy backup verification failed");
  }
  return { path: destination, manifest };
}

async function importLegacyPrivlan({ db, root, backup, ownerLogin, ownerPassword, dataRoot }) {
  if (!backup?.path || !backup?.manifest?.sourceHash) throw new Error("Verified backup is required before import");
  if (!ownerLogin || !ownerPassword) throw new Error("PRIVLAN legacy owner credentials are required before import");
  if (String(ownerPassword).length < 10) throw new Error("PRIVLAN legacy owner password must be at least 10 characters");
  const prior = await db.query("select tenant_id,workspace_id from legacy_imports where source_hash=$1", [backup.manifest.sourceHash]);
  if (prior.rows.length) return { imported: false, duplicate: true, tenantId: prior.rows[0].tenant_id, workspaceId: prior.rows[0].workspace_id, sourceHash: backup.manifest.sourceHash };
  const config = JSON.parse(fs.readFileSync(path.join(root, "admin", "config.json"), "utf8"));
  const state = JSON.parse(fs.readFileSync(path.join(root, "admin", "saas-state.json"), "utf8"));
  const tenantId = crypto.randomUUID(); const workspaceId = crypto.randomUUID(); const storeId = crypto.randomUUID(); const userId = crypto.randomUUID();
  const mediaRoot = path.resolve(dataRoot, "workspaces", workspaceId, "media");
  const stagedMediaRoot = `${mediaRoot}.importing-${process.pid}`;
  fs.mkdirSync(stagedMediaRoot, { recursive: true });
  const imageFiles = walkFiles(path.join(root, "images"));
  try {
    for (const item of imageFiles) {
      const target = path.join(stagedMediaRoot, item.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(item.absolute, target);
    }
    await db.transaction(async tx => {
      const login = String(ownerLogin).trim().toLowerCase();
      if ((await tx.query("select id from users where login_identifier=$1", [login])).rows.length) throw new Error("Legacy owner login already exists");
      await tx.query("insert into tenants(id,name,status) values($1,$2,'active')", [tenantId, state.workspace?.storeName || config.brand?.name || "PRIVLAN"]);
      await tx.query("insert into users(id,login_identifier,password_hash,display_name,password_change_required) values($1,$2,$3,$4,true)", [userId, login, hashPassword(ownerPassword), "PRIVLAN Owner"]);
      await tx.query("insert into workspaces(id,tenant_id,name,plan_id) values($1,$2,$3,'PRO_LEGACY')", [workspaceId, tenantId, state.workspace?.workspaceName || "PRIVLAN Retail"]);
      await tx.query("insert into stores(id,tenant_id,workspace_id,name,channel_mode,status) values($1,$2,$3,$4,$5,'draft')", [storeId, tenantId, workspaceId, state.workspace?.storeName || "PRIVLAN", state.workspace?.channelMode === "merchant" ? "merchant" : "shared"]);
      await tx.query("insert into memberships(tenant_id,workspace_id,user_id,role) values($1,$2,$3,'owner')", [tenantId, workspaceId, userId]);
      await tx.query("insert into workspace_configs(workspace_id,tenant_id,store_id,document) values($1,$2,$3,$4::jsonb)", [workspaceId, tenantId, storeId, JSON.stringify(config)]);
      await tx.query("insert into subscriptions(id,tenant_id,workspace_id,plan_id,status,started_at,expires_at,source,metadata) values($1,$2,$3,'PRO_LEGACY','active',now(),null,'legacy_import',$4::jsonb)", [crypto.randomUUID(), tenantId, workspaceId, JSON.stringify({ originalPlanId: state.workspace?.planId || "professional" })]);
      for (const item of imageFiles) await tx.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,original_name,mime_type,bytes,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [crypto.randomUUID(), tenantId, workspaceId, storeId, item.relative, path.basename(item.relative), "application/octet-stream", item.bytes, JSON.stringify({ sha256: item.sha256, imported: true })]);
      await tx.query("insert into legacy_imports(id,source_hash,tenant_id,workspace_id,backup_path,metadata) values($1,$2,$3,$4,$5,$6::jsonb)", [crypto.randomUUID(), backup.manifest.sourceHash, tenantId, workspaceId, backup.path, JSON.stringify({ configHash: fileHash(path.join(root, "admin", "config.json")), stateHash: fileHash(path.join(root, "admin", "saas-state.json")), assetCount: imageFiles.length })]);
      await tx.query("insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values($1,$2,$3,'system','legacy_import','workspace.import','workspace',$4,$5,$6::jsonb)", [crypto.randomUUID(), tenantId, workspaceId, workspaceId, `migration_${backup.manifest.sourceHash.slice(0, 12)}`, JSON.stringify({ sourceHash: backup.manifest.sourceHash, backupPath: backup.path })]);
    });
    fs.mkdirSync(path.dirname(mediaRoot), { recursive: true });
    fs.renameSync(stagedMediaRoot, mediaRoot);
    return { imported: true, duplicate: false, tenantId, workspaceId, storeId, userId, sourceHash: backup.manifest.sourceHash, mediaRoot };
  } catch (error) {
    fs.rmSync(stagedMediaRoot, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { createLegacyBackup, importLegacyPrivlan, walkFiles, fileHash };
