const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const express = require("express");
const { registerMerchantRoutes } = require("../merchant-routes");

const ADMIN_DIR = path.resolve(__dirname, "..");
const APPOINTMENT_TOKEN = "appointment-http-gateway-token-32-bytes";
const OPENID_HASH_KEY = "appointment-http-openid-key-32-bytes";
let processHandle;
let temp;
let baseUrl;

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); }); }
async function port() { const server = net.createServer(); const value = await listen(server); await new Promise(resolve => server.close(resolve)); return value; }
function cookieValues(response) { return response.headers.getSetCookie().map(value => value.split(";", 1)[0]); }
function cookieJar(values) { return values.join("; "); }
function csrf(values) { return decodeURIComponent(values.find(value => value.startsWith("atelier_csrf="))?.slice("atelier_csrf=".length) || ""); }

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const data = await response.json().catch(() => null);
  return { response, status: response.status, data };
}

test.before(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-http-"));
  for (const name of ["images", "fonts", "trash", "backups", "data"]) fs.mkdirSync(path.join(temp, name));
  fs.copyFileSync(path.join(ADMIN_DIR, "config.json"), path.join(temp, "config.json"));
  fs.writeFileSync(path.join(temp, "media-folders.json"), JSON.stringify({ folders: [], assignments: {} }));
  const serverPort = await port();
  baseUrl = `http://127.0.0.1:${serverPort}`;
  processHandle = spawn(process.execPath, ["server.js"], {
    cwd: ADMIN_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", PORT: String(serverPort), PRIVLAN_ADMIN_HOST: "127.0.0.1", ATELIER_TEST_DATABASE: "portable", ATELIER_LICENSE_PEPPER: "http-test-pepper", ATELIER_MASTER_KEY: Buffer.alloc(32, 5).toString("base64"), ATELIER_APPOINTMENT_GATEWAY_TOKEN: APPOINTMENT_TOKEN, ATELIER_OPENID_HASH_KEY: OPENID_HASH_KEY, PRIVLAN_ROOT: temp, ATELIER_DATA_ROOT: path.join(temp, "data"), PRIVLAN_CONFIG_PATH: path.join(temp, "config.json"), PRIVLAN_CONFIG_BACKUP_DIR: path.join(temp, "backups"), PRIVLAN_IMAGES_DIR: path.join(temp, "images"), PRIVLAN_FONTS_DIR: path.join(temp, "fonts"), PRIVLAN_MEDIA_FOLDERS_PATH: path.join(temp, "media-folders.json"), PRIVLAN_MEDIA_TRASH_DIR: path.join(temp, "trash"), PRIVLAN_DISABLE_GIT_SYNC: "1", ATELIER_OPS_PASSWORD: "operator-test-password" }
  });
  for (let index = 0; index < 80; index += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).status === 200) return; } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("merchant test server did not start");
});

test.after(() => { if (processHandle && !processHandle.killed) processHandle.kill(); fs.rmSync(temp, { recursive: true, force: true }); });

test("HTTP authentication sets secure server sessions and isolates workspace hints", async () => {
  const register = body => api("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const tooShort = await register({ login: "short@example.com", password: "seven77", storeName: "Too Short", template: "blank" });
  assert.equal(tooShort.status, 400); assert.equal(tooShort.data.code, "INVALID_PASSWORD");
  const a = await register({ login: "http-a@example.com", password: "passw0rd", storeName: "HTTP A", template: "blank" });
  const b = await register({ login: "http-b@example.com", password: "http-password-b", storeName: "HTTP B", template: "blank" });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const aCookies = cookieValues(a.response); const aCookie = cookieJar(aCookies); const aCsrf = csrf(aCookies);
  const bCookies = cookieValues(b.response); const bCookie = cookieJar(bCookies); const bCsrf = csrf(bCookies);
  const session = await api("/auth/session", { headers: { Cookie: aCookie } });
  assert.equal(session.status, 200);
  assert.equal(session.data.data.workspace.name, "HTTP A");
  const ownConfig = await api("/api/config", { headers: { Cookie: aCookie } });
  assert.equal(ownConfig.status, 200);
  assert.equal(ownConfig.data.products.length, 0);
  const crossRead = await api(`/api/config?workspaceId=${encodeURIComponent(b.data.data.workspace.id)}`, { headers: { Cookie: aCookie } });
  assert.equal(crossRead.status, 403);
  assert.equal(crossRead.data.code, "WORKSPACE_ACCESS_DENIED");
  const crossWrite = await api("/api/config", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: b.data.data.workspace.id, products: [{ name: "intrusion" }] }) });
  assert.equal(crossWrite.status, 403);
  const unauthenticatedOpsHealth = await api("/ops/v1/health");
  assert.equal(unauthenticatedOpsHealth.status, 401);
  const opsLogin = await api("/ops/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ops-admin@localhost", password: "operator-test-password" }) });
  assert.equal(opsLogin.status, 200);
  const opsCookie = cookieJar(cookieValues(opsLogin.response));
  const opsHealth = await api("/ops/v1/health", { headers: { Cookie: opsCookie } });
  assert.equal(opsHealth.status, 200);
  assert.equal(opsHealth.data.data.database, "ok");
  assert.equal(opsHealth.data.data.databaseKind, "pglite-test");
  assert.doesNotMatch(JSON.stringify(opsHealth.data), /DATABASE_URL|password|token|postgresql:\/\//i);
  const opsBootstrap = await api("/ops/v1/bootstrap", { headers: { Cookie: opsCookie } });
  assert.equal(opsBootstrap.status, 200);
  assert.ok(opsBootstrap.data.data.tenants.every(item => Object.hasOwn(item, "workspaceName")));
  assert.ok(opsBootstrap.data.data.subscriptions.every(item => Object.hasOwn(item, "tenantName") && Object.hasOwn(item, "workspaceName")));
  assert.equal((await api("/ops/v1/feature-flags/not-available", { method: "PATCH", headers: { Cookie: opsCookie, "Content-Type": "application/json" }, body: "{}" })).data.code, "OPS_FEATURE_NOT_AVAILABLE");
  async function activate(merchantCookie, merchantCsrf) {
    const generated = await api("/ops/v1/license-codes", { method: "POST", headers: { Cookie: opsCookie, "Content-Type": "application/json" }, body: JSON.stringify({ planId: "PRO", durationHours: 720, count: 1 }) });
    assert.equal(generated.status, 201);
    const redeemed = await api("/v1/licenses/redeem", { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ code: generated.data.data[0].code }) });
    assert.equal(redeemed.status, 200);
  }
  await activate(aCookie, aCsrf); await activate(bCookie, bCsrf);
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]); const jpg = Buffer.from([0xff,0xd8,0xff]); const gif = Buffer.from("GIF89a", "ascii");
  const upload = (name, mime, bytes) => api("/api/media/upload", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ name, data: `data:${mime};base64,${bytes.toString("base64")}` }) });
  const uploadA = await upload("a.png", "image/png", png);
  assert.equal(uploadA.status, 200);
  const uploadJpg = await upload("a.jpg", "image/jpeg", jpg); const uploadGif = await upload("a.gif", "image/gif", gif);
  assert.equal(uploadJpg.status, 200); assert.equal(uploadGif.status, 200);
  const historicalItems = (await api("/api/media", { headers: { Cookie: aCookie } })).data;
  const historical = [[uploadA.data.id, png, "image/png"], [uploadJpg.data.id, jpg, "image/jpeg"], [uploadGif.data.id, gif, "image/gif"]].map(([id, bytes, mime]) => ({ item: historicalItems.find(value => value.id === id), bytes, mime }));
  const missingHistorical = await api(historical[0].item.path, { headers: { Cookie: aCookie } }); assert.equal(missingHistorical.status, 404); assert.equal(missingHistorical.data.code, "ASSET_CONTENT_NOT_FOUND");
  for (const { item, bytes, mime } of historical) {
    fs.writeFileSync(path.join(temp, "images", item.mpPath.slice("/images/".length)), bytes);
    const historicalRead = await fetch(`${baseUrl}${item.path}`, { headers: { Cookie: aCookie } });
    assert.equal(historicalRead.status, 200); assert.match(historicalRead.headers.get("content-type"), new RegExp(`^${mime}`)); assert.deepEqual(Buffer.from(await historicalRead.arrayBuffer()), bytes);
  }
  assert.equal((await api(`/api/media/content/${uploadA.data.id}`, { headers: { Cookie: bCookie } })).status, 404);
  assert.equal((await api("/api/media", { headers: { Cookie: bCookie } })).data.length, 0);
  const aiA = await api("/v1/ai/connections", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ providerName: "A Provider", baseUrl: "https://example.com/v1", model: "a-model", apiKey: "secret-a" }) });
  assert.equal(aiA.status, 410);
  assert.equal(aiA.data.code, "AI_MODE_UNSUPPORTED");
  const aiList = await api("/v1/ai/connections", { headers: { Cookie: bCookie } });
  assert.equal(aiList.status, 410);
  assert.equal(aiList.data.code, "AI_MODE_UNSUPPORTED");
  assert.equal((await api("/ops/v1/bootstrap", { headers: { Cookie: aCookie } })).status, 401);
  assert.equal((await api("/auth/logout", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf } })).status, 200);
  assert.equal((await api("/auth/session", { headers: { Cookie: aCookie } })).status, 401);
});

test("historical media uses a server-controlled filename MIME while V1 keeps provider MIME", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "historical-mime-http-"));
  const images = path.join(root, "images"); fs.mkdirSync(images);
  const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a", userId: "user-a", role: "merchant", workspace: {} };
  const row = (id, objectKey, overrides = {}) => ({ id, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, object_key: objectKey, original_name: objectKey, mime_type: "application/octet-stream", bytes: 3, metadata: {}, status: "pending", purpose: null, deleted_at: null, ...overrides });
  const historical = [
    ["legacy-jpg", "legacy.jpg", "image/jpeg"], ["legacy-jpeg", "legacy.JPEG", "image/jpeg"], ["legacy-png", "legacy.png", "image/png"], ["legacy-gif", "legacy.gif", "image/gif"],
    ["legacy-webp", "legacy.webp", "image/webp"], ["legacy-mp4", "legacy.mp4", "video/mp4"], ["legacy-mov", "legacy.mov", "video/quicktime"], ["legacy-webm", "legacy.webm", "video/webm"]
  ];
  const rows = [
    ...historical.map(([id, objectKey]) => row(id, objectKey)), row("missing", "missing.png"), row("unknown", "legacy.bmp"), row("deleted", "deleted.png", { deleted_at: "2026-09-18T00:00:00.000Z" }),
    row("v1-pending", "v1-pending.png", { purpose: "content_image" }), row("other-workspace", "other.png", { workspace_id: "workspace-b" }), row("traversal", "../outside.png"), row("absolute", path.join(root, "outside.png")), row("legacy-trash", "trash.png", { metadata: { deletedAt: "2026-09-18T00:00:00.000Z" } })
  ];
  for (const [, objectKey] of historical) fs.writeFileSync(path.join(images, objectKey), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(images, "legacy.bmp"), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(root, "outside.png"), Buffer.from([1, 2, 3]));
  const db = { async query(sql, params) { if (/where id=\$1/.test(sql)) return { rows: rows.filter(item => item.id === params[0] && item.tenant_id === params[1] && item.workspace_id === params[2] && item.store_id === params[3]) }; throw new Error("UNEXPECTED_QUERY"); } };
  const providerCalls = [];
  const service = { db, async resolveSession() { return scope; } };
  const mediaService = { async read(requestScope, id) { providerCalls.push([requestScope.workspaceId, id]); if (id !== "v1-ready") throw new Error("UNEXPECTED_V1_ASSET"); return { mimeType: "image/webp", sizeBytes: 3, bytes: Uint8Array.from([4, 5, 6]) }; } };
  const app = express();
  app.use((req, res, next) => { res.set("X-Content-Type-Options", "nosniff"); next(); });
  registerMerchantRoutes(app, async () => service, { dataRoot: path.join(root, "data"), imagesDir: images, mediaService });
  const server = http.createServer(app); const serverPort = await listen(server); const base = `http://127.0.0.1:${serverPort}`;
  const get = pathname => fetch(`${base}${pathname}`, { headers: { Cookie: "atelier_merchant_session=fixture" } });
  try {
    for (const [id, , mime] of historical) {
      const response = await get(`/api/media/content/${id}`);
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), new RegExp(`^${mime}`)); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]));
    }
    const unknown = await get("/api/media/content/unknown"); assert.equal(unknown.status, 415); assert.equal((await unknown.json()).code, "UNSUPPORTED_MEDIA_TYPE");
    const missing = await get("/api/media/content/missing"); assert.equal(missing.status, 404); assert.equal((await missing.json()).code, "ASSET_CONTENT_NOT_FOUND");
    for (const id of ["deleted", "v1-pending", "other-workspace", "legacy-trash"]) { const response = await get(`/api/media/content/${id}`); assert.equal(response.status, 404); assert.equal((await response.json()).code, "ASSET_NOT_FOUND"); }
    for (const id of ["traversal", "absolute"]) { const response = await get(`/api/media/content/${id}`); assert.equal(response.status, 400); assert.equal((await response.json()).code, "INVALID_OBJECT_KEY"); }
    const v1 = await get("/api/media/v1/content/v1-ready"); assert.equal(v1.status, 200); assert.match(v1.headers.get("content-type"), /^image\/webp/); assert.deepEqual(Buffer.from(await v1.arrayBuffer()), Buffer.from([4, 5, 6])); assert.deepEqual(providerCalls, [[scope.workspaceId, "v1-ready"]]);
  } finally {
    await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutation without CSRF before subscription checks", async () => {
  const registered = await api("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "csrf@example.com", password: "csrf-password-1", storeName: "CSRF Store", template: "blank" }) });
  const cookie = cookieJar(cookieValues(registered.response));
  const result = await api("/api/config", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ products: [] }) });
  assert.equal(result.status, 403);
  assert.equal(result.data.code, "CSRF_INVALID");
});

test("merchant password change enforces session, CSRF, scope, validation and global session revocation", async () => {
  const register = body => api("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const accountA = await register({ login: "change-a@example.com", password: "current-a1", storeName: "Change A", template: "blank" });
  const accountB = await register({ login: "change-b@example.com", password: "current-b1", storeName: "Change B", template: "blank" });
  const cookiesA = cookieValues(accountA.response); const cookieA = cookieJar(cookiesA); const csrfA = csrf(cookiesA);
  const secondA = await api("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "change-a@example.com", password: "current-a1" }) });
  const secondCookieA = cookieJar(cookieValues(secondA.response));

  assert.equal((await api("/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: "current-a1", newPassword: "changed-a1" }) })).status, 401);
  const noCsrf = await api("/auth/change-password", { method: "POST", headers: { Cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: "current-a1", newPassword: "changed-a1" }) });
  assert.equal(noCsrf.status, 403); assert.equal(noCsrf.data.code, "CSRF_INVALID");

  const passwordRequest = body => api("/auth/change-password", { method: "POST", headers: { Cookie: cookieA, "x-atelier-csrf": csrfA, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const wrong = await passwordRequest({ currentPassword: "wrong-password", newPassword: "changed-a1" });
  assert.equal(wrong.status, 400); assert.equal(wrong.data.code, "CURRENT_PASSWORD_INVALID");
  const short = await passwordRequest({ currentPassword: "current-a1", newPassword: "seven77" });
  assert.equal(short.status, 400); assert.equal(short.data.code, "INVALID_PASSWORD");
  const reused = await passwordRequest({ currentPassword: "current-a1", newPassword: "current-a1" });
  assert.equal(reused.status, 400); assert.equal(reused.data.code, "PASSWORD_REUSE_NOT_ALLOWED");
  const scoped = await passwordRequest({ currentPassword: "current-a1", newPassword: "changed-a1", userId: accountB.data.data.user.id });
  assert.equal(scoped.status, 400); assert.equal(scoped.data.code, "INVALID_PASSWORD_REQUEST");
  assert.equal((await api("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "change-b@example.com", password: "current-b1" }) })).status, 200);

  const changed = await passwordRequest({ currentPassword: "current-a1", newPassword: "changed-a1" });
  assert.equal(changed.status, 200); assert.equal(changed.data.message, "密码已更新，请重新登录");
  assert.equal((await api("/auth/session", { headers: { Cookie: cookieA } })).status, 401);
  assert.equal((await api("/auth/session", { headers: { Cookie: secondCookieA } })).status, 401);
  assert.equal((await api("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "change-a@example.com", password: "current-a1" }) })).status, 401);
  assert.equal((await api("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "change-a@example.com", password: "changed-a1" }) })).status, 200);
  assert.ok(changed.response.headers.getSetCookie().some(value => value.startsWith("atelier_merchant_session=") && /Expires=Thu, 01 Jan 1970/i.test(value)));
});

test("merchant password change is limited to five verified-session attempts per minute", async () => {
  const registered = await api("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "rate-password@example.com", password: "rate-current1", storeName: "Rate Password", template: "blank" }) });
  const values = cookieValues(registered.response); const cookie = cookieJar(values); const csrfToken = csrf(values);
  const request = () => api("/auth/change-password", { method: "POST", headers: { Cookie: cookie, "x-atelier-csrf": csrfToken, "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "rate-changed1" }) });
  for (let index = 0; index < 5; index += 1) assert.equal((await request()).status, 400);
  const limited = await request();
  assert.equal(limited.status, 429); assert.equal(limited.data.code, "RATE_LIMITED");
});

test("appointment gateway and merchant APIs enforce token, scope, CSRF, subscription, and PII boundaries", async () => {
  const registered = await api("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "appointments@example.com", password: "appointments-password", storeName: "预约 HTTP 店", template: "blank" }) });
  assert.equal(registered.status, 201);
  const merchantCookies = cookieValues(registered.response); const merchantCookie = cookieJar(merchantCookies); const merchantCsrf = csrf(merchantCookies);
  const publicStoreId = registered.data.data.workspace.publicStoreId;
  assert.match(publicStoreId, /^store_public_/);
  const gatewayHeaders = { Authorization: `Bearer ${APPOINTMENT_TOKEN}`, "Content-Type": "application/json" };
  assert.equal((await api("/v1/miniprogram/customers/touch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicStoreId, openid: "forged" }) })).status, 401);
  const touched = await api("/v1/miniprogram/customers/touch", { method: "POST", headers: gatewayHeaders, body: JSON.stringify({ publicStoreId, openid: "openid-touch-private" }) });
  assert.equal(touched.status, 200); assert.doesNotMatch(JSON.stringify(touched.data), /openid-touch-private|wechat_openid_hash/);
  const anonymousCustomerId = touched.data.data.id;

  const inactiveRead = await api("/v1/appointment-settings", { headers: { Cookie: merchantCookie } });
  assert.equal(inactiveRead.status, 200);
  const noCsrf = await api("/v1/appointment-settings", { method: "PUT", headers: { Cookie: merchantCookie, "Content-Type": "application/json" }, body: JSON.stringify(inactiveRead.data.data) });
  assert.equal(noCsrf.status, 403); assert.equal(noCsrf.data.code, "CSRF_INVALID");
  const inactiveWrite = await api("/v1/appointment-settings", { method: "PUT", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify(inactiveRead.data.data) });
  assert.equal(inactiveWrite.status, 403); assert.equal(inactiveWrite.data.code, "SUBSCRIPTION_REQUIRED");
  const inactiveCustomerWrite = await api("/v1/customer-tags", { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ name: "高意向" }) });
  assert.equal(inactiveCustomerWrite.status, 403); assert.equal(inactiveCustomerWrite.data.code, "SUBSCRIPTION_REQUIRED");

  const opsLogin = await api("/ops/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ops-admin@localhost", password: "operator-test-password" }) });
  const opsCookie = cookieJar(cookieValues(opsLogin.response));
  const generated = await api("/ops/v1/license-codes", { method: "POST", headers: { Cookie: opsCookie, "Content-Type": "application/json" }, body: JSON.stringify({ planId: "PRO", durationHours: 720, count: 1 }) });
  const redeemed = await api("/v1/licenses/redeem", { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ code: generated.data.data[0].code }) });
  assert.equal(redeemed.status, 200);

  const services = await api("/v1/appointment-services", { headers: { Cookie: merchantCookie } });
  const advisors = await api("/v1/appointment-advisors", { headers: { Cookie: merchantCookie } });
  const temporaryService = await api("/v1/appointment-services", { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ name: "可删除服务", durationMinutes: 30, bufferMinutesOverride: null, enabled: true }) });
  assert.equal(temporaryService.status, 201);
  assert.equal((await api(`/v1/appointment-services/${temporaryService.data.data.id}`, { method: "DELETE", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf } })).status, 200);
  const optionsBody = { publicStoreId, serviceId: services.data.data[0].id };
  assert.equal((await api("/v1/miniprogram/appointment-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(optionsBody) })).status, 401);
  assert.equal((await api("/v1/miniprogram/appointment-options", { method: "POST", headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" }, body: JSON.stringify(optionsBody) })).status, 401);
  const tag = await api("/v1/customer-tags", { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ name: "高意向" }) });
  assert.equal(tag.status, 201);
  assert.equal((await api(`/v1/customers/${anonymousCustomerId}/tags`, { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ tagId: tag.data.data.id }) })).status, 200);
  const points = await api(`/v1/customers/${anonymousCustomerId}/points/adjust`, { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ points: 100, reason: "HTTP test", idempotencyKey: "http-points-1" }) });
  assert.equal(points.status, 200); assert.equal(points.data.data.balance, 100);
  const customerList = await api("/v1/customers?page=1&pageSize=25", { headers: { Cookie: merchantCookie } });
  assert.equal(customerList.status, 200); assert.ok(customerList.data.data.items.some(item => item.id === anonymousCustomerId)); assert.doesNotMatch(JSON.stringify(customerList.data), /openid-touch-private|wechat_openid_hash/);
  const dates = await api("/v1/miniprogram/appointment-options", { method: "POST", headers: gatewayHeaders, body: JSON.stringify(optionsBody) });
  assert.equal(dates.status, 200);
  let slot = null;
  for (const date of dates.data.data.dates) {
    const option = await api("/v1/miniprogram/appointment-options", { method: "POST", headers: gatewayHeaders, body: JSON.stringify({ ...optionsBody, date: date.value, advisorId: advisors.data.data[0].id }) });
    slot = option.data.data.slots.find(item => item.available);
    if (slot) break;
  }
  assert.ok(slot, "an active store exposes at least one valid slot");
  const booking = { publicStoreId, openid: "openid-http-private", customerName: "网关客户", customerPhone: "13800138000", serviceId: services.data.data[0].id, advisorId: advisors.data.data[0].id, startAt: slot.startAt, notes: "HTTP 私密备注", idempotencyKey: "http-idempotency-key" };
  const created = await api("/v1/miniprogram/appointments", { method: "POST", headers: gatewayHeaders, body: JSON.stringify(booking) });
  assert.equal(created.status, 200); assert.equal(created.data.data.status, "待确认");
  assert.doesNotMatch(JSON.stringify(created.data), /openid-http-private|13800138000|HTTP 私密备注|wechat_openid_hash/);
  const repeated = await api("/v1/miniprogram/appointments", { method: "POST", headers: gatewayHeaders, body: JSON.stringify(booking) });
  assert.equal(repeated.data.data.number, created.data.data.number); assert.equal(repeated.data.data.idempotent, true);

  const merchantList = await api("/v1/appointments", { headers: { Cookie: merchantCookie } });
  assert.equal(merchantList.data.data[0].customerPhoneMasked, "138****8000");
  assert.doesNotMatch(JSON.stringify(merchantList.data), /openid-http-private|wechat_openid_hash|13800138000|HTTP 私密备注/);
  const publicList = await api("/v1/miniprogram/appointments/list", { method: "POST", headers: gatewayHeaders, body: JSON.stringify({ publicStoreId, openid: "openid-http-private" }) });
  assert.equal(publicList.data.data.length, 1);
  assert.doesNotMatch(JSON.stringify(publicList.data), /openid-http-private|wechat_openid_hash|13800138000|HTTP 私密备注/);
  const tampered = await api("/v1/appointments?workspaceId=foreign-workspace", { headers: { Cookie: merchantCookie } });
  assert.equal(tampered.status, 403); assert.equal(tampered.data.code, "WORKSPACE_ACCESS_DENIED");
  const appointmentId = merchantList.data.data[0].id;
  const statusNoCsrf = await api(`/v1/appointments/${appointmentId}/status`, { method: "PATCH", headers: { Cookie: merchantCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "confirmed" }) });
  assert.equal(statusNoCsrf.status, 403);
  const confirmed = await api(`/v1/appointments/${appointmentId}/status`, { method: "PATCH", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ status: "confirmed" }) });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.data.data.status, "confirmed");
});
