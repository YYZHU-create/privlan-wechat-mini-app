const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ServiceError } = require("./saas-service");

const FORMATS = [
  { extensions: [".jpg", ".jpeg"], mimes: ["image/jpeg"], kind: "image", match: value => value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff },
  { extensions: [".png"], mimes: ["image/png"], kind: "image", match: value => value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  { extensions: [".gif"], mimes: ["image/gif"], kind: "image", match: value => ["GIF87a","GIF89a"].includes(value.subarray(0, 6).toString("ascii")) },
  { extensions: [".webp"], mimes: ["image/webp"], kind: "image", match: value => value.length >= 12 && value.subarray(0, 4).toString("ascii") === "RIFF" && value.subarray(8, 12).toString("ascii") === "WEBP" },
  { extensions: [".mp4"], mimes: ["video/mp4"], kind: "video", match: value => value.length >= 12 && value.subarray(4, 8).toString("ascii") === "ftyp" },
  { extensions: [".mov"], mimes: ["video/quicktime"], kind: "video", match: value => value.length >= 12 && value.subarray(4, 8).toString("ascii") === "ftyp" },
  { extensions: [".webm"], mimes: ["video/webm"], kind: "video", match: value => value.length >= 4 && value.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) }
];

function decode(name, data) {
  const match = String(data || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || match[2].length % 4) throw new ServiceError(400, "INVALID_MEDIA_DATA", "媒体数据必须是有效的 Base64 Data URL");
  const mime = match[1].toLowerCase(); const encoded = match[2]; const buffer = Buffer.from(encoded, "base64");
  const extension = path.extname(String(name || "")).toLowerCase();
  const format = FORMATS.find(item => item.extensions.includes(extension) && item.mimes.includes(mime));
  if (!format) throw new ServiceError(400, "MEDIA_TYPE_MISMATCH", "文件扩展名与 MIME 类型不一致");
  if (!buffer.length || buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "") || !format.match(buffer)) throw new ServiceError(400, "MEDIA_CONTENT_MISMATCH", "文件内容与声明的媒体格式不一致");
  if (buffer.length > 80 * 1024 * 1024) throw new ServiceError(413, "MEDIA_TOO_LARGE", "单个素材不能超过 80MB");
  return { buffer, mime, kind: format.kind, extension };
}

function safeName(name) { return path.basename(String(name || "")).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160) || "asset"; }
function metadata(row) { try { return typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (error) { return {}; } }

function createWorkspaceMedia({ db, dataRoot }) {
  const rootFor = scope => path.resolve(dataRoot, "workspaces", scope.workspaceId, "media");
  const publicItem = row => {
    const meta = metadata(row);
    return { id: row.id, name: row.original_name, path: `/api/media/content/${row.id}`, mpPath: `/images/${row.object_key}`, sizeKB: Math.round(Number(row.bytes) / 1024), kind: meta.kind || (String(row.mime_type).startsWith("video/") ? "video" : "image"), folderId: meta.folderId || "", large: Number(row.bytes) > 5 * 1024 * 1024, deletedAt: meta.deletedAt || null, expiresAt: meta.expiresAt || null };
  };

  async function list(scope, deleted = false) {
    const rows = (await db.query("select * from assets where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by created_at desc", [scope.tenantId, scope.workspaceId, scope.storeId])).rows;
    return rows.map(publicItem).filter(item => Boolean(item.deletedAt) === deleted);
  }
  async function upload(scope, input) {
    const decoded = decode(input.name, input.data); const assetId = crypto.randomUUID();
    const original = safeName(input.name); const objectKey = `${assetId}${decoded.extension}`; const directory = rootFor(scope); const filePath = path.join(directory, objectKey);
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(filePath, decoded.buffer, { flag: "wx" });
    try {
      await db.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,original_name,mime_type,bytes,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [assetId, scope.tenantId, scope.workspaceId, scope.storeId, objectKey, original, decoded.mime, decoded.buffer.length, JSON.stringify({ kind: decoded.kind, folderId: String(input.folderId || "") })]);
      return publicItem((await db.query("select * from assets where id=$1", [assetId])).rows[0]);
    } catch (error) { fs.rmSync(filePath, { force: true }); throw error; }
  }
  async function get(scope, assetId, includeDeleted = false) {
    const row = (await db.query("select * from assets where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [assetId, scope.tenantId, scope.workspaceId, scope.storeId])).rows[0];
    if (!row || (!includeDeleted && metadata(row).deletedAt)) throw new ServiceError(404, "ASSET_NOT_FOUND", "素材不存在");
    return { row, filePath: path.join(rootFor(scope), row.object_key), item: publicItem(row) };
  }
  async function remove(scope, ids) {
    const removed = [];
    for (const assetId of [...new Set(ids)].slice(0, 500)) {
      const current = await get(scope, assetId);
      const meta = { ...metadata(current.row), deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() };
      await db.query("update assets set metadata=$1::jsonb where id=$2 and tenant_id=$3 and workspace_id=$4", [JSON.stringify(meta), assetId, scope.tenantId, scope.workspaceId]);
      removed.push(assetId);
    }
    return removed;
  }
  async function restore(scope, ids) {
    const restored = [];
    for (const assetId of [...new Set(ids)].slice(0, 500)) {
      const current = await get(scope, assetId, true); const meta = { ...metadata(current.row) }; delete meta.deletedAt; delete meta.expiresAt;
      await db.query("update assets set metadata=$1::jsonb where id=$2 and tenant_id=$3 and workspace_id=$4", [JSON.stringify(meta), assetId, scope.tenantId, scope.workspaceId]); restored.push(assetId);
    }
    return restored;
  }
  async function folders(scope) { return (await db.query("select id,name,created_at from workspace_media_folders where tenant_id=$1 and workspace_id=$2 order by created_at", [scope.tenantId, scope.workspaceId])).rows.map(row => ({ id: row.id, name: row.name, createdAt: row.created_at })); }
  async function addFolder(scope, name) { const value = String(name || "").trim(); if (!value || value.length > 40) throw new ServiceError(400, "INVALID_FOLDER", "文件夹名称长度需为 1 至 40 位"); const folder = { id: crypto.randomUUID(), name: value }; await db.query("insert into workspace_media_folders(id,tenant_id,workspace_id,name) values($1,$2,$3,$4)", [folder.id, scope.tenantId, scope.workspaceId, value]); return folder; }
  async function renameFolder(scope, folderId, name) { const value = String(name || "").trim(); if (!value || value.length > 40) throw new ServiceError(400, "INVALID_FOLDER", "文件夹名称长度需为 1 至 40 位"); const row = (await db.query("update workspace_media_folders set name=$1 where id=$2 and tenant_id=$3 and workspace_id=$4 returning id,name", [value, folderId, scope.tenantId, scope.workspaceId])).rows[0]; if (!row) throw new ServiceError(404, "FOLDER_NOT_FOUND", "文件夹不存在"); return row; }
  async function deleteFolder(scope, folderId) { const exists = (await db.query("delete from workspace_media_folders where id=$1 and tenant_id=$2 and workspace_id=$3 returning id", [folderId, scope.tenantId, scope.workspaceId])).rows[0]; if (!exists) throw new ServiceError(404, "FOLDER_NOT_FOUND", "文件夹不存在"); const rows = (await db.query("select * from assets where workspace_id=$1", [scope.workspaceId])).rows; for (const row of rows) { const meta = metadata(row); if (meta.folderId === folderId) await db.query("update assets set metadata=$1::jsonb where id=$2 and workspace_id=$3", [JSON.stringify({ ...meta, folderId: "" }), row.id, scope.workspaceId]); } return { id: folderId }; }
  async function move(scope, ids, folderId) { if (folderId && !(await db.query("select 1 from workspace_media_folders where id=$1 and tenant_id=$2 and workspace_id=$3", [folderId, scope.tenantId, scope.workspaceId])).rows.length) throw new ServiceError(404, "FOLDER_NOT_FOUND", "文件夹不存在"); for (const assetId of ids) { const current = await get(scope, assetId, true); await db.query("update assets set metadata=$1::jsonb where id=$2 and workspace_id=$3", [JSON.stringify({ ...metadata(current.row), folderId: folderId || "" }), assetId, scope.workspaceId]); } return ids; }
  async function resolveIds(scope, values) { const all = await list(scope, false); return [...new Set(values.map(value => all.find(item => item.id === value || item.name === value)?.id).filter(Boolean))]; }
  return { list, upload, get, remove, restore, folders, addFolder, renameFolder, deleteFolder, move, resolveIds, publicItem };
}

module.exports = { createWorkspaceMedia, decode, safeName };
