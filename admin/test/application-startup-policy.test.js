const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const { TARGETS } = require("../target-runtime-config");
const { prepareApplicationRuntime } = require("../../scripts/runtime-bootstrap");
const ROOT = path.resolve(__dirname, "../..");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feeldao-startup-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "admin"]) fs.mkdirSync(path.join(root, directory));
  for (const file of ["scripts/runtime-bootstrap.js", "scripts/start.sh", "admin/target-runtime-config.js", "admin/asset-lifecycle-permit.js", "admin/application-startup-policy.js", "admin/runtime-secret-bridge.js"]) {
    fs.writeFileSync(path.join(root, file), fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n"));
  }
  fs.writeFileSync(path.join(root, "runtime-config.json"), JSON.stringify(TARGETS.production));
  fs.writeFileSync(path.join(root, "admin/server.js"), `console.log(JSON.stringify({auto:process.env.ATELIER_AUTO_MIGRATE,environment:process.env.ATELIER_ENVIRONMENT,backend:process.env.ATELIER_DB_BACKEND,url:process.env.DATABASE_URL,media:process.env.MEDIA_ASSET_V1_ENABLED}));`);
  return root;
}

for (const value of [undefined, "0", "1"]) {
  test(`loaded Production config disables inherited auto migration ${value ?? "absent"}`, t => {
    const root = fixture(t);
    const env = { NODE_ENV: "production", MEOO_PROJECT_URL_ID: TARGETS.production.targetProjectId, DATABASE_URL: "postgresql://fixture.invalid/original", ATELIER_DB_BACKEND: "native" };
    if (value !== undefined) env.ATELIER_AUTO_MIGRATE = value;
    const result = prepareApplicationRuntime({ root, env, log() {} });
    assert.equal(env.ATELIER_AUTO_MIGRATE, "0");
    assert.equal(result.environment, "production");
    assert.equal(result.declaredProjectId, "g8o5cv1om41o");
    assert.equal(env.DATABASE_URL, "postgresql://fixture.invalid/original");
    assert.equal(env.ATELIER_DB_BACKEND, "native");
    assert.equal(env.MEDIA_ASSET_V1_ENABLED, "false");
  });
}

test("hosted startup rejects absent config and mismatched project before server", t => {
  const root = fixture(t);
  assert.throws(() => prepareApplicationRuntime({ root, env: { NODE_ENV: "production", MEOO_PROJECT_URL_ID: "asmhysidbg5g" }, log() {} }), /APPLICATION_TARGET_CONFIG_REQUIRED/);
  fs.unlinkSync(path.join(root, "runtime-config.json"));
  assert.throws(() => prepareApplicationRuntime({ root, env: { NODE_ENV: "production" }, log() {} }), /APPLICATION_TARGET_CONFIG_REQUIRED/);
});

test("ambiguous Meoo plus native URL fails before selecting a different database", t => {
  const root = fixture(t);
  const env = { NODE_ENV: "production", ATELIER_DB_BACKEND: "meoo", DATABASE_URL: "postgresql://fixture.invalid/original" };
  assert.throws(() => prepareApplicationRuntime({ root, env, log() {} }), /APPLICATION_DATABASE_SELECTION_AMBIGUOUS/);
  assert.equal(env.DATABASE_URL, "postgresql://fixture.invalid/original");
  assert.equal(env.ATELIER_DB_BACKEND, "meoo");
});

test("actual shell entry loads file then locks migrations and retains database target", t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".runtime.env"), "ATELIER_AUTO_MIGRATE=1\nATELIER_ENVIRONMENT=production\n");
  const shell = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/sh";
  const result = spawnSync(shell, [path.join(root, "scripts/start.sh")], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || "", NODE_ENV: "production", MEOO_PROJECT_URL_ID: "g8o5cv1om41o", ATELIER_AUTO_MIGRATE: "1", DATABASE_URL: "postgresql://fixture.invalid/original" }, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(state, { auto: "0", environment: "production", backend: "native", url: "postgresql://fixture.invalid/original", media: "false" });
});

test("Docker bootstrap entry locks migrations before server without shell", t => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, [path.join(root, "scripts/runtime-bootstrap.js")], {
    env: { NODE_ENV: "production", MEOO_PROJECT_URL_ID: "g8o5cv1om41o", ATELIER_AUTO_MIGRATE: "1", ATELIER_DB_BACKEND: "meoo" }, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(state.auto, "0");
  assert.equal(state.backend, "meoo");
  assert.equal(state.environment, "production");
  assert.equal(state.url, undefined);
});

test("database factory ignores late auto-migrate override, preserves URL and issues zero startup SQL", async t => {
  const old = { ...process.env };
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); });
  const calls = [];
  let selectedURL;
  const filename = path.join(ROOT, "admin/database.js");
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = Module._nodeModulePaths(path.dirname(filename));
  isolated.require = name => name === "pg" ? { Pool: class {
    constructor(options) { selectedURL = options.connectionString; }
    async query(sql) { calls.push(sql); return { rows: [{ version: "already-applied" }] }; }
    async end() {}
  } } : Module.createRequire(filename)(name);
  isolated._compile(fs.readFileSync(filename, "utf8"), filename);
  process.env.DATABASE_URL = "postgresql://fixture.invalid/original";
  process.env.ATELIER_DB_BACKEND = "native";
  process.env.ATELIER_AUTO_MIGRATE = "1";
  const db = await isolated.exports.createDatabaseFromEnv();
  assert.equal(db.kind, "postgres");
  assert.equal(selectedURL, process.env.DATABASE_URL);
  assert.deepEqual(calls, []);
  assert.equal(process.env.ATELIER_AUTO_MIGRATE, "0");
  await db.close();
  await isolated.exports.createPostgresDatabase(process.env.DATABASE_URL, { migrate: true });
  assert.ok(calls.some(sql => /schema_migrations/.test(sql)), "explicit migration API remains independent");
});

test("direct package start installs migration policy before database construction", () => {
  const source = fs.readFileSync(path.join(ROOT, "admin/server.js"), "utf8");
  assert.ok(source.indexOf('enforceApplicationMigrationPolicy()') < source.indexOf('createDatabaseFromEnv()'));
  assert.match(source, /require\.main === module[\s\S]*prepareApplicationRuntime/);
});
