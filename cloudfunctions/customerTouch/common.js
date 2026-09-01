const cloud = require("wx-server-sdk");
const https = require("https");
const crypto = require("crypto");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
function env(name) { return String(process.env[name] || "").trim(); }
function requestId() { return `customer-touch-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`; }
function ok(data, message, id) { return { ok: true, code: "OK", message, data, requestId: id }; }
function fail(code, message, id) { return { ok: false, code, message, data: null, requestId: id }; }
function callApi(pathname, body) {
  const base = env("ATELIER_API_BASE_URL").replace(/\/+$/, ""); const token = env("ATELIER_APPOINTMENT_GATEWAY_TOKEN");
  if (!base || !token) { const e = new Error("客户服务尚未配置"); e.code = "APPOINTMENT_GATEWAY_NOT_CONFIGURED"; throw e; }
  const url = new URL(`${base}${pathname}`);
  return new Promise((resolve, reject) => { const payload = JSON.stringify(body); const request = https.request(url, { method: "POST", timeout: 12000, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, response => { let raw = ""; response.setEncoding("utf8"); response.on("data", chunk => { raw += chunk; }); response.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (error) { reject(error); } }); }); request.on("error", reject); request.on("timeout", () => request.destroy(new Error("客户服务响应超时"))); request.write(payload); request.end(); });
}
module.exports = { cloud, env, requestId, ok, fail, callApi };
