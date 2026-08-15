const cloud = require("wx-server-sdk");
const https = require("https");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function requestId() { return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function currentOpenId() { return cloud.getWXContext().OPENID || ""; }
function env(name) { return String(process.env[name] || "").trim(); }
function createError(code,message,status=500){const error=new Error(message);error.code=code;error.status=status;return error;}
function appointmentApi(pathname, body) {
  const baseUrl=env("ATELIER_API_BASE_URL").replace(/\/+$/,"");const token=env("ATELIER_APPOINTMENT_GATEWAY_TOKEN");
  if(!baseUrl||!token)return Promise.reject(createError("APPOINTMENT_GATEWAY_NOT_CONFIGURED","预约服务尚未配置",503));
  let url;try{url=new URL(`${baseUrl}${pathname}`);}catch(error){return Promise.reject(createError("APPOINTMENT_GATEWAY_NOT_CONFIGURED","预约服务地址无效",503));}
  if(url.protocol!=="https:")return Promise.reject(createError("APPOINTMENT_GATEWAY_NOT_CONFIGURED","预约服务必须使用 HTTPS",503));
  return new Promise((resolve,reject)=>{const payload=JSON.stringify(body||{});const request=https.request(url,{method:"POST",timeout:12000,headers:{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(payload),Authorization:`Bearer ${token}`}},response=>{let raw="";response.setEncoding("utf8");response.on("data",chunk=>{raw+=chunk;});response.on("end",()=>{try{resolve(JSON.parse(raw||"{}"));}catch(error){reject(createError("INVALID_REMOTE_RESPONSE","预约服务返回了无效数据",502));}});});request.on("error",reject);request.on("timeout",()=>request.destroy(createError("APPOINTMENT_GATEWAY_TIMEOUT","预约服务响应超时",504)));request.write(payload);request.end();});
}
function ok(data, message, id) { return { ok: true, code: "OK", message, data, requestId: id }; }
function fail(code, message, id) { return { ok: false, code, message, data: null, requestId: id }; }
function handleError(error, id) {
  console.error(id, error);
  return fail("SERVICE_UNAVAILABLE", "预约记录暂时无法读取，请稍后重试", id);
}

module.exports = { db, requestId, currentOpenId, appointmentApi, ok, fail, handleError };
