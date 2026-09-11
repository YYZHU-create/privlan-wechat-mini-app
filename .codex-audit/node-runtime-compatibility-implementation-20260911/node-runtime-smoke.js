const { spawn } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");

const port = Number(process.env.SMOKE_PORT || 39127);
const env = {
  ...process.env,
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: String(port),
  ATELIER_TEST_DATABASE: "portable",
  ATELIER_LICENSE_PEPPER: "p".repeat(32),
  ATELIER_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  ATELIER_OPENID_HASH_KEY: "o".repeat(32),
  ATELIER_APPOINTMENT_GATEWAY_TOKEN: "g".repeat(32),
  PRIVLAN_DISABLE_GIT_SYNC: "1",
  PRIVLAN_ROOT: os.tmpdir(),
};

const child = spawn(process.execPath, ["server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
let stdout = "";
child.stdout.on("data", value => { stdout += String(value); });
child.stderr.on("data", value => { stderr += String(value); });

function getHealth() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/health" }, response => {
      let body = "";
      response.on("data", value => { body += String(value); });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
  });
}

(async () => {
  let health;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { health = await getHealth(); break; } catch (_) { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!health) {
    console.error(stderr);
    child.kill();
    process.exit(1);
  }
  console.log(`NODE_VERSION=${process.version}`);
  console.log(`HEALTH_STATUS=${health.status}`);
  console.log(`HEALTH_BODY=${health.body}`);
  console.log(`STARTUP_LOG_ERRORS=${stderr.trim() ? "PRESENT" : "NONE"}`);
  child.kill();
})().catch(error => {
  console.error(error.stack || error.message);
  child.kill();
  process.exit(1);
});
