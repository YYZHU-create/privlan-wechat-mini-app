const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const ADMIN_DIR = path.join(ROOT, "admin");
const ADMIN_TOKEN = "server-security-test-token";
let tempDir;
let serverProcess;
let baseUrl;

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); }); }
function close(server) { return new Promise(resolve => server.close(resolve)); }
async function availablePort() { const server = net.createServer(); const port = await listen(server); await close(server); return port; }

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (error) { data = text; }
  return { status: response.status, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request("/api/config", { headers: { "x-privlan-token": ADMIN_TOKEN } });
      if (response.status === 200) return;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("test server did not start");
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "privlan-server-security-"));
  const images = path.join(tempDir, "images");
  const fonts = path.join(tempDir, "fonts");
  fs.mkdirSync(images); fs.mkdirSync(fonts);
  const configPath = path.join(tempDir, "config.json");
  fs.copyFileSync(path.join(ADMIN_DIR, "config.json"), configPath);
  fs.writeFileSync(path.join(tempDir, "media-folders.json"), JSON.stringify({ folders: [], assignments: {} }));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: ADMIN_DIR,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      PRIVLAN_ADMIN_HOST: "0.0.0.0",
      PRIVLAN_ADMIN_TOKEN: ADMIN_TOKEN,
      PRIVLAN_ROOT: tempDir,
      PRIVLAN_CONFIG_PATH: configPath,
      PRIVLAN_CONFIG_BACKUP_DIR: path.join(tempDir, "backups"),
      PRIVLAN_IMAGES_DIR: images,
      PRIVLAN_FONTS_DIR: fonts,
      PRIVLAN_MEDIA_FOLDERS_PATH: path.join(tempDir, "media-folders.json"),
      PRIVLAN_MEDIA_TRASH_DIR: path.join(tempDir, "trash"),
      PRIVLAN_OPS_BOOTSTRAP_PATH: path.join(tempDir, "ops-bootstrap.json"),
      ATELIER_STATE_PATH: path.join(tempDir, "state.json"),
      ATELIER_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
      ATELIER_OPS_PASSWORD: "ops-test-password",
      PRIVLAN_DISABLE_GIT_SYNC: "1",
      NODE_ENV: "test"
    }
  });
  await waitForServer();
});

test.after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("remote GET APIs require the admin token while authorized reads remain available", async () => {
  assert.equal((await request("/api/config")).status, 401);
  assert.equal((await request("/v1/products")).status, 401);
  assert.equal((await request("/api/config", { headers: { "x-privlan-token": ADMIN_TOKEN } })).status, 200);
  assert.equal((await request("/v1/products", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })).status, 200);
});

test("media upload validates Data URL, MIME, extension and magic bytes", async () => {
  const headers = { "Content-Type": "application/json", "x-privlan-token": ADMIN_TOKEN };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const valid = await request("/api/media/upload", { method: "POST", headers, body: JSON.stringify({ name: "valid.png", data: `data:image/png;base64,${png.toString("base64")}` }) });
  assert.equal(valid.status, 200);
  assert.equal(valid.data.kind, "image");

  const mismatch = await request("/api/media/upload", { method: "POST", headers, body: JSON.stringify({ name: "fake.jpg", data: `data:image/png;base64,${png.toString("base64")}` }) });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.data.error, /MIME/);

  const badMagic = await request("/api/media/upload", { method: "POST", headers, body: JSON.stringify({ name: "fake.png", data: `data:image/png;base64,${Buffer.from("not a png").toString("base64")}` }) });
  assert.equal(badMagic.status, 400);
  assert.match(badMagic.data.error, /内容/);

  const badBase64 = await request("/api/media/upload", { method: "POST", headers, body: JSON.stringify({ name: "bad.png", data: "data:image/png;base64,%%%" }) });
  assert.equal(badBase64.status, 400);
});

test("ordinary JSON is capped at 2 MB while the isolated media route accepts a larger body", async () => {
  const headers = { "Content-Type": "application/json", "x-privlan-token": ADMIN_TOKEN };
  const ordinary = await request("/api/config", { method: "POST", headers, body: JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024 + 1024) }) });
  assert.equal(ordinary.status, 413);

  const largePng = Buffer.alloc(3 * 1024 * 1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(largePng);
  const upload = await request("/api/media/upload", { method: "POST", headers, body: JSON.stringify({ name: "large.png", data: `data:image/png;base64,${largePng.toString("base64")}` }) });
  assert.equal(upload.status, 200);
  assert.equal(upload.data.packageEligible, true);
});

test("preview command uses the active WeChat DevTools service instead of a hard-coded port", () => {
  const source = fs.readFileSync(path.join(ADMIN_DIR, "server.js"), "utf8");
  assert.doesNotMatch(source, /preview[^\n]+--port\s+9420/);
});
