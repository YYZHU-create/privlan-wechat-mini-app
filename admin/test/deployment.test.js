const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { validateProductionEnvironment } = require("../runtime-config");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");

process.env.NODE_ENV = "test";
const ROOT = path.resolve(__dirname, "../..");

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); }); }
async function freePort() { const server = net.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; }

test("production environment fails closed when database or secrets are missing", () => {
  assert.throws(() => validateProductionEnvironment({ NODE_ENV: "production" }), /DATABASE_URL/);
  assert.throws(() => validateProductionEnvironment({ NODE_ENV: "production", DATABASE_URL: "postgresql://db/app", ATELIER_LICENSE_PEPPER: "short", ATELIER_MASTER_KEY: "bad", ATELIER_OPS_EMAIL: "ops@example.com", ATELIER_OPS_PASSWORD: "strong-password" }), /ATELIER_LICENSE_PEPPER/);
  assert.throws(() => validateProductionEnvironment({ NODE_ENV: "production", DATABASE_URL: "postgresql://db/app", ATELIER_LICENSE_PEPPER: "p".repeat(32), ATELIER_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), ATELIER_OPS_EMAIL: "ops@example.com", ATELIER_OPS_PASSWORD: "strong-password" }), /ATELIER_APPOINTMENT_GATEWAY_TOKEN/);
  assert.equal(validateProductionEnvironment({ NODE_ENV: "production", DATABASE_URL: "postgresql://db/app", ATELIER_LICENSE_PEPPER: "p".repeat(32), ATELIER_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), ATELIER_OPS_EMAIL: "ops@example.com", ATELIER_OPS_PASSWORD: "strong-password", ATELIER_APPOINTMENT_GATEWAY_TOKEN: "g".repeat(32), ATELIER_OPENID_HASH_KEY: "o".repeat(32) }).ok, true);
});

test("portable PostgreSQL backup restores merchant and workspace data", async () => {
  const source = await createPortableTestDatabase();
  try {
    const service = createSaasService({ db: source, licensePepper: "backup-test-pepper" });
    const account = await service.register({ login: "backup@example.com", password: "backup-password-1", storeName: "Backup Atelier", template: "blank" });
    const scope = await service.resolveSession(account.session.token);
    await source.query("update subscriptions set status='active',expires_at=now()+interval '1 day' where workspace_id=$1", [scope.workspaceId]);
    scope.subscription.status = "active";
    const config = (await service.readConfig(scope)).document;
    config.products = [{ id: 101, name: "Restored Product" }];
    await service.writeConfig(scope, config);
    const archive = await source.dumpDataDir();
    const bytes = Buffer.from(await archive.arrayBuffer());
    assert.ok(bytes.length > 1024);
    await source.close();

    const restored = await createPortableTestDatabase({ loadDataDir: new Blob([bytes]) });
    try {
      assert.equal((await restored.query("select count(*)::int count from users where login_identifier=$1", ["backup@example.com"])).rows[0].count, 1);
      const document = (await restored.query("select document from workspace_configs where workspace_id=$1", [scope.workspaceId])).rows[0].document;
      assert.equal(document.products[0].name, "Restored Product");
    } finally { await restored.close(); }
  } catch (error) {
    try { await source.close(); } catch (ignored) {}
    throw error;
  }
});

test("health is a liveness-only endpoint independent of PostgreSQL", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(__dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), PRIVLAN_ADMIN_HOST: "127.0.0.1", DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/atelier", ATELIER_LICENSE_PEPPER: "p".repeat(32), ATELIER_MASTER_KEY: Buffer.alloc(32, 8).toString("base64"), ATELIER_OPS_EMAIL: "ops@example.com", ATELIER_OPS_PASSWORD: "operator-password", ATELIER_APPOINTMENT_GATEWAY_TOKEN: "g".repeat(32), ATELIER_OPENID_HASH_KEY: "o".repeat(32), PRIVLAN_DISABLE_GIT_SYNC: "1" }
  });
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`); break; } catch (error) { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(response, "server did not start");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  } finally { child.kill(); }
});

test("Docker and PostgreSQL operations files retain the production safety contract", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  const backup = fs.readFileSync(path.join(ROOT, "scripts/backup-postgres.ps1"), "utf8");
  const restore = fs.readFileSync(path.join(ROOT, "scripts/restore-postgres.ps1"), "utf8");
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /EXPOSE 9000/);
  assert.match(dockerfile, /127\.0\.0\.1:9000\/health/);
  assert.match(dockerfile, /HEALTHCHECK/);
  const server = fs.readFileSync(path.join(ROOT, "admin/server.js"), "utf8");
  assert.match(server, /process\.env\.PORT \|\| 9000/);
  assert.match(server, /process\.env\.HOST \|\| process\.env\.PRIVLAN_ADMIN_HOST \|\| "0\.0\.0\.0"/);
  assert.match(server, /app\.get\("\/health", \(req, res\) => \{\n  res\.status\(200\)\.json\(\{ status: "ok" \}\);\n\}\);/);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /PRIVLAN_DISABLE_GIT_SYNC: "1"/);
  assert.match(compose, /atelier_postgres:\/var\/lib\/postgresql\/data/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /SHA256/);
  assert.match(restore, /ConfirmRestore/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /SHA-256 verification failed/);
});
