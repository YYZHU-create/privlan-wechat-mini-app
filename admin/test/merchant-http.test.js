const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ADMIN_DIR = path.resolve(__dirname, "..");
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
  for (const name of ["images", "fonts", "trash", "backups"]) fs.mkdirSync(path.join(temp, name));
  fs.copyFileSync(path.join(ADMIN_DIR, "config.json"), path.join(temp, "config.json"));
  fs.writeFileSync(path.join(temp, "media-folders.json"), JSON.stringify({ folders: [], assignments: {} }));
  const serverPort = await port();
  baseUrl = `http://127.0.0.1:${serverPort}`;
  processHandle = spawn(process.execPath, ["server.js"], {
    cwd: ADMIN_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", PORT: String(serverPort), PRIVLAN_ADMIN_HOST: "127.0.0.1", ATELIER_TEST_DATABASE: "portable", ATELIER_LICENSE_PEPPER: "http-test-pepper", ATELIER_MASTER_KEY: Buffer.alloc(32, 5).toString("base64"), PRIVLAN_ROOT: temp, PRIVLAN_CONFIG_PATH: path.join(temp, "config.json"), PRIVLAN_CONFIG_BACKUP_DIR: path.join(temp, "backups"), PRIVLAN_IMAGES_DIR: path.join(temp, "images"), PRIVLAN_FONTS_DIR: path.join(temp, "fonts"), PRIVLAN_MEDIA_FOLDERS_PATH: path.join(temp, "media-folders.json"), PRIVLAN_MEDIA_TRASH_DIR: path.join(temp, "trash"), PRIVLAN_DISABLE_GIT_SYNC: "1", ATELIER_OPS_PASSWORD: "operator-test-password" }
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
  const opsLogin = await api("/ops/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ops-admin@localhost", password: "operator-test-password" }) });
  assert.equal(opsLogin.status, 200);
  const opsCookie = cookieJar(cookieValues(opsLogin.response));
  async function activate(merchantCookie, merchantCsrf) {
    const generated = await api("/ops/v1/license-codes", { method: "POST", headers: { Cookie: opsCookie, "Content-Type": "application/json" }, body: JSON.stringify({ planId: "PRO", durationHours: 720, count: 1 }) });
    assert.equal(generated.status, 201);
    const redeemed = await api("/v1/licenses/redeem", { method: "POST", headers: { Cookie: merchantCookie, "x-atelier-csrf": merchantCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ code: generated.data.data[0].code }) });
    assert.equal(redeemed.status, 200);
  }
  await activate(aCookie, aCsrf); await activate(bCookie, bCsrf);
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const uploadA = await api("/api/media/upload", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ name: "a.png", data: `data:image/png;base64,${png.toString("base64")}` }) });
  assert.equal(uploadA.status, 200);
  assert.equal((await api(`/api/media/content/${uploadA.data.id}`, { headers: { Cookie: bCookie } })).status, 404);
  assert.equal((await api("/api/media", { headers: { Cookie: bCookie } })).data.length, 0);
  const aiA = await api("/v1/ai/connections", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ providerName: "A Provider", baseUrl: "https://example.com/v1", model: "a-model", apiKey: "secret-a" }) });
  assert.equal(aiA.status, 201);
  assert.equal((await api("/v1/ai/connections", { headers: { Cookie: bCookie } })).data.data.length, 0);
  assert.equal((await api(`/v1/ai/connections/${aiA.data.data.id}/rotate-secret`, { method: "POST", headers: { Cookie: bCookie, "x-atelier-csrf": bCsrf, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "intrusion" }) })).status, 404);
  assert.equal((await api("/ops/v1/bootstrap", { headers: { Cookie: aCookie } })).status, 401);
  assert.equal((await api("/auth/logout", { method: "POST", headers: { Cookie: aCookie, "x-atelier-csrf": aCsrf } })).status, 200);
  assert.equal((await api("/auth/session", { headers: { Cookie: aCookie } })).status, 401);
});

test("rejects mutation without CSRF before subscription checks", async () => {
  const registered = await api("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "csrf@example.com", password: "csrf-password-1", storeName: "CSRF Store", template: "blank" }) });
  const cookie = cookieJar(cookieValues(registered.response));
  const result = await api("/api/config", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ products: [] }) });
  assert.equal(result.status, 403);
  assert.equal(result.data.code, "CSRF_INVALID");
});
