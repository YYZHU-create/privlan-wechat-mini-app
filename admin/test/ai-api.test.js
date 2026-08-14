const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ADMIN_DIR = path.resolve(__dirname, "..");
const TENANT_ID = "tenant_privlan_demo";
const STORE_ID = "store_privlan_main";
const GATEWAY_TOKEN = "gateway-test-token";
const secrets = { initial: "qa-secret-alpha", rotated: "qa-secret-beta" };
let tempDir;
let statePath;
let mockServer;
let mockPort;
let adminProcess;
let adminPort;
let adminBaseUrl;
let lastAuthorization = "";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server?.close(() => resolve()));
}

async function availablePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function providerResponse(model, content = "连接成功") {
  return JSON.stringify({
    id: "mock-response",
    model,
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
  });
}

async function mockProvider(req, res) {
  if (req.method !== "POST" || req.url !== "/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  lastAuthorization = String(req.headers.authorization || "");
  const body = await readJsonBody(req);
  if (body.model === "unauthorized-model") {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "invalid key" } }));
    return;
  }
  if (body.model === "rate-model") {
    res.writeHead(429, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "rate limited" } }));
    return;
  }
  if (body.model === "server-model") {
    res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "maintenance" } }));
    return;
  }
  if (body.model === "reject-model") {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: `echoed ${lastAuthorization}` } }));
    return;
  }
  if (body.model === "invalid-json-model") {
    res.writeHead(200, { "Content-Type": "application/json" }).end("not-json");
    return;
  }
  if (body.model === "empty-model") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ model: body.model, choices: [] }));
    return;
  }
  if (body.model === "slow-model") {
    setTimeout(() => {
      if (!res.writableEnded) res.writeHead(200, { "Content-Type": "application/json" }).end(providerResponse(body.model));
    }, 3600);
    return;
  }
  const usage = body.model === "bad-usage-model"
    ? { prompt_tokens: "invalid", completion_tokens: -2, total_tokens: null }
    : { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 };
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    model: body.model,
    choices: [{ message: { role: "assistant", content: "这是模拟模型基于店铺知识生成的回答。" } }],
    usage
  }));
}

async function api(pathname, options = {}) {
  const response = await fetch(`${adminBaseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  return { status: response.status, data };
}

function connectionPayload(model = "success-model", apiKey = secrets.initial, baseUrl = `http://127.0.0.1:${mockPort}`) {
  return {
    tenantId: TENANT_ID,
    storeId: STORE_ID,
    providerPreset: "openai-compatible",
    providerName: `QA ${model}`,
    protocol: "openai",
    baseUrl,
    model,
    apiKey,
    timeoutMs: model === "slow-model" ? 3000 : 5000,
    maxTokens: 300
  };
}

async function createConnection(model, apiKey, baseUrl) {
  return api("/v1/ai/connections", { method: "POST", body: JSON.stringify(connectionPayload(model, apiKey, baseUrl)) });
}

async function waitForAdmin() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${adminBaseUrl}/v1/ai/connections`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error("测试后台未启动");
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-ai-test-"));
  statePath = path.join(tempDir, "saas-state.json");
  mockServer = http.createServer((req, res) => void mockProvider(req, res));
  mockPort = await listen(mockServer);
  adminPort = await availablePort();
  adminBaseUrl = `http://127.0.0.1:${adminPort}`;
  adminProcess = spawn(process.execPath, ["server.js"], {
    cwd: ADMIN_DIR,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(adminPort),
      PRIVLAN_ADMIN_HOST: "127.0.0.1",
      NODE_ENV: "test",
      ATELIER_STATE_PATH: statePath,
      ATELIER_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
      ATELIER_AI_GATEWAY_TOKEN: GATEWAY_TOKEN,
      DEEPSEEK_API_KEY: ""
    }
  });
  await waitForAdmin();
});

test.after(async () => {
  if (adminProcess && !adminProcess.killed) adminProcess.kill();
  await close(mockServer);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("validates connection input and returns a stable error envelope", async () => {
  const invalidUrl = await createConnection("success-model", secrets.initial, "ftp://example.com/v1");
  assert.equal(invalidUrl.status, 400);
  assert.equal(invalidUrl.data.ok, false);
  assert.equal(invalidUrl.data.code, "AI_PROVIDER_URL_INSECURE");
  assert.equal(invalidUrl.data.message, invalidUrl.data.error);
  assert.match(invalidUrl.data.requestId, /^aic_/);

  const unsupported = connectionPayload();
  unsupported.protocol = "anthropic";
  const protocol = await api("/v1/ai/connections", { method: "POST", body: JSON.stringify(unsupported) });
  assert.equal(protocol.status, 400);
  assert.equal(protocol.data.code, "AI_CONNECTION_INVALID");
});

test("creates, encrypts, tests and rotates a merchant connection without leaking secrets", async () => {
  const created = await createConnection("success-model");
  assert.equal(created.status, 201);
  assert.equal(created.data.ok, true);
  assert.equal(created.data.code, "OK");
  assert.equal(created.data.data.hasSecret, true);
  assert.equal(created.data.data.secretHint, "••••••••");
  assert.doesNotMatch(JSON.stringify(created.data), /qa-secret|ciphertext|\"iv\"|\"tag\"/);

  const id = created.data.data.id;
  const tested = await api(`/v1/ai/connections/${id}/test`, { method: "POST", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID }) });
  assert.equal(tested.status, 200);
  assert.equal(tested.data.data.connection.lastTestOk, true);
  assert.equal(lastAuthorization, `Bearer ${secrets.initial}`);

  const rotated = await api(`/v1/ai/connections/${id}/rotate-secret`, { method: "POST", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, apiKey: secrets.rotated }) });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.data.data.lastTestOk, null);
  const retested = await api(`/v1/ai/connections/${id}/test`, { method: "POST", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID }) });
  assert.equal(retested.status, 200);
  assert.equal(lastAuthorization, `Bearer ${secrets.rotated}`);

  const stateText = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(stateText, new RegExp(`${secrets.initial}|${secrets.rotated}`));
  assert.match(stateText, /"ciphertext"/);
});

test("enforces tenant and store scope on every merchant connection operation", async () => {
  const list = await api(`/v1/ai/connections?tenantId=${TENANT_ID}&storeId=store_other`);
  assert.equal(list.status, 403);
  assert.equal(list.data.code, "TENANT_SCOPE_MISMATCH");

  const connections = await api("/v1/ai/connections");
  const id = connections.data.data[0].id;
  const tested = await api(`/v1/ai/connections/${id}/test`, { method: "POST", body: JSON.stringify({ tenantId: TENANT_ID, storeId: "store_other" }) });
  assert.equal(tested.status, 403);
  assert.equal(tested.data.code, "TENANT_SCOPE_MISMATCH");
});

test("routes a successful BYOK query and returns provider, usage and request metadata", async () => {
  const connections = await api("/v1/ai/connections");
  const connection = connections.data.data.find(item => item.model === "success-model");
  const policy = await api("/v1/ai/policy", { method: "PUT", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, mode: "byok", connectionId: connection.id, fallbackToRules: true }) });
  assert.equal(policy.status, 200);

  const query = await api("/v1/ai/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, text: "请介绍品牌的设计风格" })
  });
  assert.equal(query.status, 200);
  assert.equal(query.data.ok, true);
  assert.equal(query.data.fallback, false);
  assert.equal(query.data.provider, "QA success-model");
  assert.equal(query.data.data.content, query.data.content);
  assert.deepEqual(query.data.usage, { promptTokens: 12, completionTokens: 6, weightedPoints: 36 });
  assert.match(query.data.requestId, /^ai_/);

  const unauthorized = await api("/v1/ai/query", { method: "POST", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, text: "品牌风格" }) });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.data.code, "AI_GATEWAY_UNAUTHORIZED");
});

test("classifies provider failures and sanitizes malformed usage", async t => {
  const cases = [
    ["unauthorized-model", 502, "AI_PROVIDER_UNAUTHORIZED"],
    ["rate-model", 503, "AI_PROVIDER_RATE_LIMITED"],
    ["server-model", 502, "AI_PROVIDER_UNAVAILABLE"],
    ["reject-model", 502, "AI_PROVIDER_REQUEST_REJECTED"],
    ["invalid-json-model", 502, "AI_PROVIDER_INVALID_RESPONSE"],
    ["empty-model", 502, "AI_PROVIDER_EMPTY_RESPONSE"],
    ["slow-model", 504, "AI_PROVIDER_TIMEOUT"]
  ];
  for (const [model, status, code] of cases) {
    await t.test(model, async () => {
      const created = await createConnection(model);
      const result = await api(`/v1/ai/connections/${created.data.data.id}/test`, { method: "POST", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID }) });
      assert.equal(result.status, status);
      assert.equal(result.data.code, code);
      assert.equal(result.data.data.lastTestOk, false);
      assert.doesNotMatch(JSON.stringify(result.data), /qa-secret/);
    });
  }

  const badUsage = await createConnection("bad-usage-model");
  const policy = await api("/v1/ai/policy", { method: "PUT", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, mode: "byok", connectionId: badUsage.data.data.id }) });
  assert.equal(policy.status, 200);
  const query = await api("/v1/ai/query", { method: "POST", headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` }, body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, text: "品牌设计语言" }) });
  assert.deepEqual(query.data.usage, { promptTokens: 0, completionTokens: 0, weightedPoints: 0 });
});

test("falls back to FAQ with the provider failure code and resets policy after deletion", async () => {
  const connections = await api("/v1/ai/connections");
  const failed = connections.data.data.find(item => item.model === "unauthorized-model");
  await api("/v1/ai/policy", { method: "PUT", body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, mode: "byok", connectionId: failed.id, fallbackToRules: true }) });
  const fallback = await api("/v1/ai/query", { method: "POST", headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` }, body: JSON.stringify({ tenantId: TENANT_ID, storeId: STORE_ID, text: "你们的价格区间是多少" }) });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.data.code, "AI_FALLBACK");
  assert.equal(fallback.data.fallback, true);
  assert.equal(fallback.data.fallbackReason, "AI_PROVIDER_UNAUTHORIZED");
  assert.equal(fallback.data.provider, "rules");

  const deleted = await api(`/v1/ai/connections/${failed.id}?tenantId=${TENANT_ID}&storeId=${STORE_ID}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const policy = await api(`/v1/ai/policy?tenantId=${TENANT_ID}&storeId=${STORE_ID}`);
  assert.equal(policy.data.data.mode, "rules");
  assert.equal(policy.data.data.connectionId, null);
});

test("blocks private and metadata provider addresses in production", async () => {
  const gatewayPath = path.join(ADMIN_DIR, "ai-gateway.js");
  delete require.cache[require.resolve(gatewayPath)];
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const gateway = require(gatewayPath);
  await assert.rejects(() => gateway.assertSafeProviderEndpoint("https://169.254.169.254/chat/completions"), error => error.code === "AI_PROVIDER_URL_BLOCKED");
  await assert.rejects(() => gateway.assertSafeProviderEndpoint("https://127.0.0.1/chat/completions"), error => error.code === "AI_PROVIDER_URL_BLOCKED");
  process.env.NODE_ENV = previous;
});
