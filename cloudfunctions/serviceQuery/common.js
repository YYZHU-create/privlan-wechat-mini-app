const cloud = require("wx-server-sdk");
const https = require("https");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;
let tenantToken = "";
let tenantTokenExpiresAt = 0;

function requestId() {
  return `req-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function ok(data = null, message = "操作成功", id = requestId()) {
  return { ok: true, code: "OK", message, data, requestId: id };
}

function fail(code, message, id = requestId(), data = null) {
  return { ok: false, code, message, data, requestId: id };
}

function createError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function escapeFilterValue(value) {
  return String(value || "").replace(/[\\"\n\r]/g, character => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r" }[character]));
}

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const request = https.request(url, {
      method: options.method || (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      },
      timeout: Number(options.timeout || 10000)
    }, response => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { raw += chunk; });
      response.on("end", () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (error) { return reject(createError("INVALID_REMOTE_RESPONSE", "飞书返回了无法解析的数据", 502)); }
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(createError("FEISHU_HTTP_ERROR", parsed.msg || `飞书请求失败（${response.statusCode}）`, 502));
        if (parsed.code !== undefined && parsed.code !== 0) return reject(createError("FEISHU_API_ERROR", parsed.msg || `飞书接口错误（${parsed.code}）`, 502));
        resolve(parsed);
      });
    });
    request.on("timeout", () => request.destroy(createError("FEISHU_TIMEOUT", "飞书响应超时，请稍后重试", 504)));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function getTenantToken() {
  if (tenantToken && tenantTokenExpiresAt > Date.now() + 60000) return tenantToken;
  const appId = env("FEISHU_APP_ID");
  const appSecret = env("FEISHU_APP_SECRET");
  if (!appId || !appSecret) throw createError("FEISHU_NOT_CONFIGURED", "飞书企业应用尚未配置", 503);
  const response = await httpJson("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { body: { app_id: appId, app_secret: appSecret } });
  tenantToken = response.tenant_access_token;
  tenantTokenExpiresAt = Date.now() + Math.max(300, Number(response.expire || 7200) - 120) * 1000;
  return tenantToken;
}

async function bitableRequest(pathname, options = {}) {
  const token = await getTenantToken();
  return httpJson(`https://open.feishu.cn/open-apis${pathname}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
}

function tableId(envName) {
  const value = env(envName);
  if (!value) throw createError("FEISHU_TABLE_NOT_CONFIGURED", `缺少云环境变量 ${envName}`, 503);
  return value;
}

function appToken() {
  const value = env("FEISHU_BITABLE_APP_TOKEN");
  if (!value) throw createError("FEISHU_BASE_NOT_CONFIGURED", "飞书多维表格 App Token 尚未配置", 503);
  return value;
}

async function searchRecords(tableEnvName, conditions = [], pageSize = 100) {
  const filterConditions = conditions.filter(item => item && item.field && item.value !== undefined && item.value !== "").map(item => ({
    field_name: item.field,
    operator: item.operator || "is",
    value: Array.isArray(item.value) ? item.value.map(String) : [String(item.value)]
  }));
  const body = { page_size: Math.min(500, Math.max(1, pageSize)) };
  if (filterConditions.length) body.filter = { conjunction: "and", conditions: filterConditions };
  const response = await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken())}/tables/${encodeURIComponent(tableId(tableEnvName))}/records/search`, { body });
  return response.data && Array.isArray(response.data.items) ? response.data.items : [];
}

async function getRecord(tableEnvName, recordId) {
  const response = await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken())}/tables/${encodeURIComponent(tableId(tableEnvName))}/records/${encodeURIComponent(recordId)}`);
  return response.data && response.data.record ? response.data.record : null;
}

async function createRecord(tableEnvName, fields) {
  const response = await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken())}/tables/${encodeURIComponent(tableId(tableEnvName))}/records`, { body: { fields } });
  return response.data && response.data.record ? response.data.record : null;
}

async function updateRecord(tableEnvName, recordId, fields) {
  const response = await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken())}/tables/${encodeURIComponent(tableId(tableEnvName))}/records/${encodeURIComponent(recordId)}`, { method: "PUT", body: { fields } });
  return response.data && response.data.record ? response.data.record : null;
}

function plainValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(plainValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.text !== undefined) return String(value.text);
    if (value.name !== undefined) return String(value.name);
    if (value.link !== undefined) return String(value.link);
    return Object.values(value).map(plainValue).filter(Boolean).join("、");
  }
  return String(value);
}

function fieldName(envName, fallback) {
  return env(envName, fallback);
}

function fieldValue(record, envName, fallback) {
  return plainValue(record && record.fields ? record.fields[fieldName(envName, fallback)] : "");
}

function currentOpenId() {
  return cloud.getWXContext().OPENID || "";
}

async function enforceRateLimit(openId, action, limit = 10, windowMs = 60000) {
  const bucket = Math.floor(Date.now() / windowMs);
  const collection = db.collection("privlan_rate_limits");
  const existing = await collection.where({ openId, action, bucket }).limit(1).get();
  if (existing.data.length) {
    if (Number(existing.data[0].count || 0) >= limit) throw createError("RATE_LIMITED", "操作过于频繁，请稍后再试", 429);
    await collection.doc(existing.data[0]._id).update({ data: { count: command.inc(1), updatedAt: db.serverDate() } });
  } else {
    await collection.add({ data: { openId, action, bucket, count: 1, createdAt: db.serverDate() } });
  }
}

async function createSession(openId, customerRecordId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await db.collection("privlan_customer_sessions").add({ data: {
    tokenHash: hash(rawToken), openId, customerRecordId, expiresAt, createdAt: db.serverDate()
  } });
  return { sessionToken: rawToken, expiresAt: expiresAt.toISOString() };
}

async function requireSession(rawToken, openId = currentOpenId()) {
  if (!rawToken) throw createError("AUTH_REQUIRED", "请先完成客户身份验证", 401);
  const result = await db.collection("privlan_customer_sessions").where({ tokenHash: hash(rawToken), openId, expiresAt: command.gt(new Date()) }).limit(1).get();
  if (!result.data.length) throw createError("SESSION_EXPIRED", "身份验证已过期，请重新验证", 401);
  return result.data[0];
}

async function audit(event, openId, details = {}) {
  const safeDetails = {};
  Object.entries(details || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") safeDetails[key] = /phone|member|customer/i.test(key) ? hash(value) : String(value).slice(0, 120);
  });
  try {
    await db.collection("privlan_audit_logs").add({ data: { event, actorHash: hash(openId), details: safeDetails, createdAt: db.serverDate() } });
  } catch (error) {}
}

async function reserveSlot(slotId, capacity) {
  const documentId = hash(slotId).slice(0, 32);
  await db.runTransaction(async transaction => {
    const reference = transaction.collection("privlan_slot_locks").doc(documentId);
    let state = null;
    try { state = (await reference.get()).data; } catch (error) {}
    const booked = Number(state && state.booked || 0);
    if (booked >= capacity) throw createError("SLOT_UNAVAILABLE", "该时段刚刚约满，请选择其他时间", 409);
    await reference.set({ data: { slotId, capacity, booked: booked + 1, updatedAt: db.serverDate() } });
  });
}

async function releaseSlot(slotId) {
  const documentId = hash(slotId).slice(0, 32);
  try { await db.collection("privlan_slot_locks").doc(documentId).update({ data: { booked: command.inc(-1), updatedAt: db.serverDate() } }); } catch (error) {}
}

function handleError(error, id = requestId()) {
  console.error(id, error);
  const publicCodes = new Set(["AUTH_REQUIRED", "SESSION_EXPIRED", "RATE_LIMITED", "INVALID_INPUT", "CUSTOMER_NOT_FOUND", "INVALID_CODE", "SLOT_UNAVAILABLE", "DUPLICATE_APPOINTMENT", "FEISHU_NOT_CONFIGURED", "FEISHU_TABLE_NOT_CONFIGURED", "FEISHU_BASE_NOT_CONFIGURED", "WECHAT_PHONE_UNAVAILABLE"]);
  const code = publicCodes.has(error.code) ? error.code : "SERVICE_UNAVAILABLE";
  const message = publicCodes.has(error.code) ? error.message : "服务暂时不可用，请稍后重试";
  return fail(code, message, id);
}

module.exports = {
  cloud, db, command, ok, fail, createError, env, hash, requestId, escapeFilterValue, httpJson,
  searchRecords, getRecord, createRecord, updateRecord, plainValue, fieldName, fieldValue,
  currentOpenId, enforceRateLimit, createSession, requireSession, audit, reserveSlot, releaseSlot, handleError
};
