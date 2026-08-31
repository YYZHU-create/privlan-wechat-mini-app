const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { createAuthFixture, cleanupFixture } = require("./meoo-live-fixtures");

function port() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(error => error ? reject(error) : resolve(value)); }); }); }
function cookies(response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
async function ready(url) { for (let attempt = 0; attempt < 40; attempt += 1) { try { const response = await fetch(`${url}/health`); if (response.ok && (await response.json()).database === "ok") return; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error("candidate runtime did not become ready"); }

if (process.env.MEOO_B1_LIVE) test("live Meoo runtime authenticates through normal ATELIER auth without DATABASE_URL", async () => {
  const fixture = await createAuthFixture();
  const listenPort = await port();
  const root = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, ATELIER_DB_BACKEND: "meoo", PORT: String(listenPort), PRIVLAN_ADMIN_HOST: "127.0.0.1", PRIVLAN_DISABLE_GIT_SYNC: "1", DATABASE_URL: "" }, stdio: process.env.MEOO_DEBUG_REVOKE === "1" ? "inherit" : "ignore" });
  const base = `http://127.0.0.1:${listenPort}`;
  try {
    await ready(base);
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: fixture.login, password: fixture.password }) });
    assert.equal(login.status, 200);
    const sessionCookies = cookies(login);
    assert.match(sessionCookies, /atelier_merchant_session=/);
    const csrf = sessionCookies.split("; ").find(value => value.startsWith("atelier_csrf="))?.slice("atelier_csrf=".length);
    assert.ok(csrf);
    const profile = await fetch(`${base}/v1/profile`, { headers: { Cookie: sessionCookies } });
    assert.equal(profile.status, 200);
    const invalidLogout = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: sessionCookies, "x-atelier-csrf": "invalid" } });
    assert.equal(invalidLogout.status, 403);
    const logout = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: sessionCookies, "x-atelier-csrf": csrf } });
    assert.equal(logout.status, 200);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const afterLogout = await fetch(`${base}/v1/profile`, { headers: { Cookie: sessionCookies } });
    assert.equal(afterLogout.status, 401);
  } finally {
    child.kill();
    await cleanupFixture(fixture);
  }
});
