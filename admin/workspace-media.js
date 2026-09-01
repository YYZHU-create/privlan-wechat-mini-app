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

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1]; offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function readImageDimensions(buffer, mime) {
  if (mime === "image/png" && buffer.length >= 24 && buffer.subarray(12, 16).toString("ascii") === "IHDR") return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (mime === "image/gif" && buffer.length >= 10) return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (mime === "image/webp" && buffer.length >= 30 && buffer.subarray(12, 16).toString("ascii") === "VP8X") {
    const width = 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16);
    const height = 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16);
    return { width, height };
  }
  if (mime === "image/jpeg" && buffer.length >= 4) return readJpegDimensions(buffer);
  return null;
}

function decode(name, data) {
  const match = String(data || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || match[2].length % 4) throw new ServiceError(400, "INVALID_MEDIA_DATA", "媒体数据必须是有效的 Base64 Data URL");
  const mime = match[1].toLowerCase(); const encoded = match[2]; const buffer = Buffer.from(encoded, "base64");
  const extension = path.extname(String(name || "")).toLowerCase();
  const format = FORMATS.find(item => item.extensions.includes(extension) && item.mimes.includes(mime));
  if (!format) throw new ServiceError(400, "MEDIA_TYPE_MISMATCH", "文件扩展名与 MIME 类型不一致");
  if (!buffer.length || buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "") || !format.match(buffer)) throw new ServiceError(400, "MEDIA_CONTENT_MISMATCH", "文件内容与声明的媒体格式不一致");
  if (buffer.length > 80 * 1024 * 1024) throw new ServiceError(413, "MEDIA_TOO_LARGE", "单个素材不能超过 80MB");
  const dimensions = format.kind === "image" ? readImageDimensions(buffer, mime) : null;
  if (dimensions && (dimensions.width < 1 || dimensions.height < 1)) throw new ServiceError(400, "MEDIA_DIMENSIONS_INVALID", "图片尺寸必须大于 0");
  return { buffer, mime, kind: format.kind, extension, dimensions };
}

function safeName(name) { return path.basename(String(name || "")).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160) || "asset"; }
function metadata(row) { try { return typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (error) { return {}; } }

function createFilesystemStorageProvider({ dataRoot }) {
  const rootFor = scope => path.resolve(dataRoot, "workspaces", scope.workspaceId, "media");
  const keyPath = (scope, objectKey) => {
    const root = rootFor(scope); const resolved = path.resolve(root, objectKey);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new ServiceError(400, "INVALID_OBJECT_KEY", "素材对象路径无效");
    return resolved;
  };
  return {
    name: "filesystem",
    async put(scope, { objectKey, buffer }) {
      const filePath = keyPath(scope, objectKey); fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, buffer, { flag: "wx" });
      return { objectKey, bytes: buffer.length };
    },
    async get(scope, objectKey) { return keyPath(scope, objectKey); },
    async signedAccess(scope, objectKey) { return this.get(scope, objectKey); },
    async delete(scope, objectKey) { fs.rmSync(keyPath(scope, objectKey), { force: true }); return true; },
    async restore(scope, objectKey, restoredKey = objectKey) { const source = keyPath(scope, objectKey); const target = keyPath(scope, restoredKey); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(source, target); return restoredKey; },
    async metadata(scope, objectKey) { const stat = await fs.promises.stat(keyPath(scope, objectKey)); return { bytes: stat.size, modifiedAt: stat.mtime.toISOString() }; },
    async exists(scope, objectKey) { return fs.existsSync(keyPath(scope, objectKey)); }
  };
}

function createWorkspaceMedia({ db, dataRoot, storageProvider, repository = null }) {
  const storage = storageProvider || createFilesystemStorageProvider({ dataRoot });
  const publicItem = row => { const meta = metadata(row); return { id: row.id, name: row.original_name, path: `/api/media/content/${row.id}`, mpPath: `/images/${row.object_key}`, sizeKB: Math.round(Number(row.bytes) / 1024), size: Number(row.bytes) || 0, mtime: row.created_at || row.updated_at || "", usageCount: Number(row.usage_count) || 0, kind: meta.kind || (String(row.mime_type).startsWith("video/") ? "video" : "image"), dimensions: meta.dimensions || null, folderId: meta.folderId || "", large: Number(row.bytes) > 5 * 1024 * 1024, deletedAt: meta.deletedAt || null, expiresAt: meta.expiresAt || null }; };
  const useRepository = Boolean(repository);
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const assetRows = scope => useRepository ? repository.listAssets(scope) : rows("select * from assets where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by created_at desc", [scope.tenantId, scope.workspaceId, scope.storeId]);
  const assetRow = async (scope, id) => useRepository ? repository.getAsset(scope, id) : (await rows("select * from assets where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [id, scope.tenantId, scope.workspaceId, scope.storeId]))[0] || null;
  const updateAsset = (scope, id, meta) => useRepository ? repository.updateAssetMetadata(scope, id, meta) : db.query("update assets set metadata=$1::jsonb where id=$2 and tenant_id=$3 and workspace_id=$4", [JSON.stringify(meta), id, scope.tenantId, scope.workspaceId]);
  async function list(scope, deleted = false) { return (await assetRows(scope)).map(publicItem).filter(item => Boolean(item.deletedAt) === deleted); }
  async function upload(scope, input) { const decoded = decode(input.name, input.data); const assetId = crypto.randomUUID(); const original = safeName(input.name); const objectKey = `${assetId}${decoded.extension}`; await storage.put(scope, { objectKey, buffer: decoded.buffer }); try { const payload = { id: assetId, objectKey, originalName: original, mimeType: decoded.mime, bytes: decoded.buffer.length, metadata: { kind: decoded.kind, folderId: String(input.folderId || ""), dimensions: decoded.dimensions } }; const stored = useRepository ? await repository.createAsset(scope, payload) : (await db.query("insert into assets(id,tenant_id,workspace_id,store_id,object_key,original_name,mime_type,bytes,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [assetId, scope.tenantId, scope.workspaceId, scope.storeId, objectKey, original, decoded.mime, decoded.buffer.length, JSON.stringify(payload.metadata)]), await assetRow(scope, assetId)); if (!stored) throw new ServiceError(503, "MEDIA_RECORD_UNAVAILABLE", "素材记录暂时不可用"); return publicItem(stored); } catch (error) { await storage.delete(scope, objectKey); throw error; } }
  async function get(scope, assetId, includeDeleted = false) { const row = await assetRow(scope, assetId); if (!row || (!includeDeleted && metadata(row).deletedAt)) throw new ServiceError(404, "ASSET_NOT_FOUND", "素材不存在"); return { row, filePath: await storage.get(scope, row.object_key), item: publicItem(row) }; }
  async function remove(scope, ids) { const removed=[]; for (const id of [...new Set(ids)].slice(0,500)) { const current=await get(scope,id); await updateAsset(scope,id,{...metadata(current.row),deletedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString()}); removed.push(id); } return removed; }
  async function restore(scope, ids) { const restored=[]; for (const id of [...new Set(ids)].slice(0,500)) { const current=await get(scope,id,true); const meta={...metadata(current.row)}; delete meta.deletedAt; delete meta.expiresAt; await updateAsset(scope,id,meta); restored.push(id); } return restored; }
  async function folders(scope) { const result=useRepository ? await repository.listFolders(scope) : await rows("select id,name,created_at from workspace_media_folders where tenant_id=$1 and workspace_id=$2 order by created_at", [scope.tenantId, scope.workspaceId]); return result.map(row=>({id:row.id,name:row.name,createdAt:row.created_at})); }
  async function addFolder(scope,name) { const value=String(name||"").trim(); if(!value||value.length>40) throw new ServiceError(400,"INVALID_FOLDER","文件夹名称长度需为 1 至 40 位"); const folder={id:crypto.randomUUID(),name:value}; if(useRepository) await repository.createFolder(scope,folder); else await db.query("insert into workspace_media_folders(id,tenant_id,workspace_id,name) values($1,$2,$3,$4)",[folder.id,scope.tenantId,scope.workspaceId,value]); return folder; }
  async function renameFolder(scope,id,name) { const value=String(name||"").trim(); if(!value||value.length>40) throw new ServiceError(400,"INVALID_FOLDER","文件夹名称长度需为 1 至 40 位"); const row=useRepository ? await repository.renameFolder(scope,id,value) : (await rows("update workspace_media_folders set name=$1 where id=$2 and tenant_id=$3 and workspace_id=$4 returning id,name",[value,id,scope.tenantId,scope.workspaceId]))[0]; if(!row) throw new ServiceError(404,"FOLDER_NOT_FOUND","文件夹不存在"); return row; }
  async function deleteFolder(scope,id) { const exists=useRepository ? await repository.deleteFolder(scope,id) : (await rows("delete from workspace_media_folders where id=$1 and tenant_id=$2 and workspace_id=$3 returning id",[id,scope.tenantId,scope.workspaceId]))[0]; if(!exists) throw new ServiceError(404,"FOLDER_NOT_FOUND","文件夹不存在"); for(const row of await assetRows(scope)){ const meta=metadata(row); if(meta.folderId===id) await updateAsset(scope,row.id,{...meta,folderId:""}); } return {id}; }
  async function move(scope,ids,folderId) { if(folderId && !(useRepository ? await repository.hasFolder(scope,folderId) : (await rows("select 1 from workspace_media_folders where id=$1 and tenant_id=$2 and workspace_id=$3",[folderId,scope.tenantId,scope.workspaceId])).length)) throw new ServiceError(404,"FOLDER_NOT_FOUND","文件夹不存在"); for(const id of ids){const current=await get(scope,id,true); await updateAsset(scope,id,{...metadata(current.row),folderId:folderId||""});} return ids; }
  async function resolveIds(scope,values){const all=await list(scope,false); return [...new Set(values.map(value=>all.find(item=>item.id===value||item.name===value)?.id).filter(Boolean))];}
  return { list, upload, get, remove, restore, folders, addFolder, renameFolder, deleteFolder, move, resolveIds, publicItem, storageProvider: storage };
}
module.exports = { createWorkspaceMedia, createFilesystemStorageProvider, decode, safeName, readImageDimensions };
