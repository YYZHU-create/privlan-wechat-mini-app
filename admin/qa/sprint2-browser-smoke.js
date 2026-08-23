const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("@playwright/test");

const adminRoot = path.resolve(__dirname, "..");
const outputRoot = path.resolve(adminRoot, "..", "verification", "sprint2-operation-engine", "browser-uat");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-sprint2-browser-"));
function port() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(error => error ? reject(error) : resolve(value)); }); }); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitForHealth(url) { for (let attempt = 0; attempt < 100; attempt += 1) { try { const response = await fetch(`${url}/health`); if (response.ok) return; } catch (error) {} await wait(100); } throw new Error("local browser test server did not become healthy"); }
async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const serverPort = await port(); const baseURL = `http://127.0.0.1:${serverPort}`;
  const runtimeKeys = { licensePepper: crypto.randomBytes(32).toString("base64url"), masterKey: crypto.randomBytes(32).toString("base64"), openIdHashKey: crypto.randomBytes(32).toString("base64url"), gatewayToken: crypto.randomBytes(32).toString("base64url") };
  const child = spawn(process.execPath, ["server.js"], { cwd: adminRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "test", PORT: String(serverPort), PRIVLAN_ADMIN_HOST: "127.0.0.1", ATELIER_TEST_DATABASE: "portable", ATELIER_LICENSE_PEPPER: runtimeKeys.licensePepper, ATELIER_MASTER_KEY: runtimeKeys.masterKey, ATELIER_OPENID_HASH_KEY: runtimeKeys.openIdHashKey, ATELIER_APPOINTMENT_GATEWAY_TOKEN: runtimeKeys.gatewayToken, PRIVLAN_ROOT: tempRoot, PRIVLAN_CONFIG_PATH: path.join(tempRoot, "config.json"), PRIVLAN_CONFIG_BACKUP_DIR: path.join(tempRoot, "backups"), PRIVLAN_IMAGES_DIR: path.join(tempRoot, "images"), PRIVLAN_FONTS_DIR: path.join(tempRoot, "fonts"), PRIVLAN_MEDIA_FOLDERS_PATH: path.join(tempRoot, "media-folders.json"), PRIVLAN_MEDIA_TRASH_DIR: path.join(tempRoot, "trash"), PRIVLAN_DISABLE_GIT_SYNC: "1" } });
  const failures = []; child.stderr.on("data", value => failures.push(String(value)));
  try {
    await waitForHealth(baseURL);
    const browser = await chromium.launch();
    try {
      for (const viewport of [{ name: "1366", width: 1366, height: 768 }, { name: "430", width: 430, height: 932, isMobile: true }]) {
        const context = await browser.newContext({ baseURL, viewport: { width: viewport.width, height: viewport.height }, isMobile: Boolean(viewport.isMobile) });
        const page = await context.newPage(); const errors = [];
        page.on("console", message => { if (message.type() === "error" && !/favicon|401 \(Unauthorized\)/i.test(message.text())) errors.push(message.text()); });
        page.on("pageerror", error => errors.push(error.message));
        await page.goto("/");
        const registration = await page.evaluate(async (login) => {
          const response = await fetch("/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, password: crypto.randomUUID() + "A9", storeName: "排班浏览验证店", template: "blank" }) });
          return { status: response.status, body: await response.json() };
        }, `browser-${crypto.randomUUID()}@example.test`);
        assert.equal(registration.status, 201);
        await page.goto("/?view=appointments");
        await page.locator(".app-shell").waitFor({ state: "visible", timeout: 20_000 });
        await page.getByRole("button", { name: "预约设置" }).click();
        await page.getByRole("button", { name: "员工与排班" }).click();
        await page.getByText("员工与排班", { exact: true }).last().waitFor({ state: "visible" });
        const staff = page.locator(".staff-row").first(); await staff.click();
        await page.locator(".staff-editor-panel").waitFor({ state: "visible" });
        await page.screenshot({ path: path.join(outputRoot, `${viewport.name}-staff-schedule.png`), fullPage: true });
        const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
        assert.ok(overflow.width <= overflow.viewport + 2, `${viewport.name} horizontal overflow`);
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally { await browser.close(); }
    console.log("browser-smoke=PASS");
  } finally {
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
