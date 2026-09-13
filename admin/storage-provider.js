const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

class StorageProviderError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "StorageProviderError";
    this.code = code;
    this.status = status;
  }
}

function requiredScope(scope) {
  const values = [scope?.tenantId, scope?.workspaceId].map(value => String(value || "").trim());
  if (values.some(value => !value)) throw new StorageProviderError("SCOPE_REQUIRED", "tenant/workspace scope is required", 400);
  return values;
}

function assertObjectKey(objectKey) {
  const key = String(objectKey || "");
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\") || /[\u0000-\u001f]/.test(key)) {
    throw new StorageProviderError("INVALID_OBJECT_KEY", "object key is invalid", 400);
  }
  return key;
}

function bodyBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new StorageProviderError("INVALID_OBJECT_BYTES", "object bytes are required", 400);
}

function sha256Hex(bytes) { return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex"); }

/** Server-only Meoo/Supabase Storage adapter. Business code never receives SDK types. */
function createMeooStorageProvider({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, bucket = process.env.MEDIA_STORAGE_BUCKET, client = null } = {}) {
  if (!url || !/^https:\/\//i.test(String(url))) throw new StorageProviderError("STORAGE_URL_REQUIRED", "storage URL is required", 503);
  if (!serviceRoleKey && !client) throw new StorageProviderError("STORAGE_CREDENTIAL_REQUIRED", "storage credential is required", 503);
  if (!bucket || !String(bucket).trim()) throw new StorageProviderError("STORAGE_BUCKET_REQUIRED", "an explicit production storage bucket is required", 503);
  const supabase = client || createClient(String(url), String(serviceRoleKey), { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = supabase.storage.from(String(bucket));

  async function uploadObject(scope, objectKey, bytes, mimeType) {
    requiredScope(scope); const key = assertObjectKey(objectKey); const data = bodyBytes(bytes);
    const { error } = await storage.upload(key, data, { contentType: String(mimeType || "application/octet-stream"), upsert: false });
    if (error) throw new StorageProviderError("STORAGE_UPLOAD_FAILED", "storage upload failed", 503);
    return { objectKey: key, bytes: data.byteLength, checksum: sha256Hex(data), provider: "meoo", bucket: String(bucket) };
  }

  async function readObject(scope, objectKey) {
    requiredScope(scope); const key = assertObjectKey(objectKey);
    const { data, error } = await storage.download(key);
    if (error || !data) throw new StorageProviderError("STORAGE_READ_FAILED", "storage read failed", error?.statusCode >= 400 ? error.statusCode : 503);
    const bytes = new Uint8Array(await data.arrayBuffer());
    return { objectKey: key, bytes, mimeType: typeof data.type === "string" && data.type ? data.type : null, sizeBytes: bytes.byteLength, checksum: sha256Hex(bytes) };
  }

  async function verifyObject(scope, objectKey, expected = {}) {
    const result = await readObject(scope, objectKey);
    if (expected.sizeBytes != null && Number(expected.sizeBytes) !== result.sizeBytes) throw new StorageProviderError("STORAGE_VERIFY_FAILED", "stored size does not match", 502);
    if (expected.checksum && String(expected.checksum).toLowerCase() !== result.checksum) throw new StorageProviderError("STORAGE_VERIFY_FAILED", "stored checksum does not match", 502);
    if (expected.mimeType && result.mimeType && result.mimeType !== expected.mimeType) throw new StorageProviderError("STORAGE_VERIFY_FAILED", "stored MIME does not match", 502);
    return result;
  }

  async function deleteObject(scope, objectKey) {
    requiredScope(scope); const key = assertObjectKey(objectKey);
    const { error } = await storage.remove([key]);
    if (error) throw new StorageProviderError("STORAGE_DELETE_FAILED", "storage delete failed", 503);
    return { objectKey: key, deleted: true };
  }

  async function verifyDeleted(scope, objectKey) {
    try {
      await readObject(scope, objectKey);
      return false;
    } catch (error) {
      if (error instanceof StorageProviderError && error.code === "STORAGE_READ_FAILED" && Number(error.status) === 404) return true;
      throw error;
    }
  }

  return { name: "meoo", bucket: String(bucket), uploadObject, verifyObject, readObject, deleteObject, verifyDeleted };
}

module.exports = { createMeooStorageProvider, StorageProviderError, assertObjectKey, sha256Hex };
