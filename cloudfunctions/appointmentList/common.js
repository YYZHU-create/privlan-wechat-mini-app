const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function requestId() { return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function currentOpenId() { return cloud.getWXContext().OPENID || ""; }
function ok(data, message, id) { return { ok: true, code: "OK", message, data, requestId: id }; }
function fail(code, message, id) { return { ok: false, code, message, data: null, requestId: id }; }
function handleError(error, id) {
  console.error(id, error);
  return fail("SERVICE_UNAVAILABLE", "预约记录暂时无法读取，请稍后重试", id);
}

module.exports = { db, requestId, currentOpenId, ok, fail, handleError };
