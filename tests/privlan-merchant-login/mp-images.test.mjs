/**
 * STORAGE_VERTICAL_SLICE focused tests —— /mp-images/{basename} 私有桶 resolver
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 被测对象是 build.mjs 机械转译后的真实函数体（同一份 index.ts），不是重写版。
 * 所有 tenant / workspace / 账号 / token 均为本地合成值，与任何真实商户数据无关；
 * 因此本文件 PASS 只证明「resolver 的判定与错误语义正确」，
 * 不构成「真实 PrivLan 素材已接入」的证据。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);

/* ---------- 本地合成夹具（与真实数据无关） ---------- */
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const FOREIGN_WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const STORE_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = "synthetic-session-token-0123456789abcdef";
const SERVICE_ROLE_KEY = "mock-service-role-key";
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const sha256hex = (v) => createHash("sha256").update(v).digest("hex");

/** 307 字节的合成为主数据：形状是 PNG 头，内容不来自任何 Legacy 资产 */
const PNG_BYTES = (() => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([head, Buffer.alloc(307 - head.length, 0x20)]);
})();

/* ---------- 结构化日志捕获 ---------- */
const logged = [];
console.warn = (...a) => logged.push({ level: "warn", event: a[0], fields: a[1] });
console.error = (...a) => logged.push({ level: "error", event: a[0], fields: a[1] });

/* ---------- 可控 env + 捕获 handler ---------- */
globalThis.__DenoEnv = {
  get: (k) =>
    k === "SUPABASE_URL" ? "https://mock.invalid" : k === "SUPABASE_SERVICE_ROLE_KEY" ? SERVICE_ROLE_KEY : undefined,
};
let handler = null;
globalThis.__DenoServe = (cb) => {
  handler = cb;
};

const { dbState, resetDb, storageState, resetStorage } = await import(
  new URL("fake-supabase.js", BUILT).href
);
globalThis.__nodeCrypto = await import("node:crypto");
const mod = await import(new URL("index.js", BUILT).href);
/** 复刻生产 Deno.serve 外层：抛出的 ServiceError 必须落成 HTTP 响应，而不是逃进测试 */
handler = (req) => mod.handle(req).catch((error) => mod.failure(error, mod.newRequestId("test")));

function loadFixture() {
  resetDb();
  resetStorage();
  logged.length = 0;
  dbState.rows = {
    users: [
      {
        id: USER_ID,
        login_identifier: "synthetic@example.invalid",
        password_hash: "x",
        display_name: "合成",
        avatar_url: null,
        status: "active",
      },
    ],
    memberships: [
      { user_id: USER_ID, tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, role: "owner", created_at: "2026-01-01T00:00:00Z" },
    ],
    workspaces: [
      { id: WORKSPACE_ID, tenant_id: TENANT_ID, name: "合成工作区", plan_id: "PRO" },
      { id: FOREIGN_WORKSPACE_ID, tenant_id: TENANT_ID, name: "其他工作区", plan_id: "PRO" },
    ],
    tenants: [{ id: TENANT_ID, status: "active" }],
    stores: [{ id: STORE_ID, workspace_id: WORKSPACE_ID, name: "合成门店", public_store_id: "pub-1" }],
    subscriptions: [
      {
        id: "sub-1",
        workspace_id: WORKSPACE_ID,
        plan_id: "PRO",
        status: "active",
        started_at: "2026-01-01T00:00:00Z",
        expires_at: null,
        source: "synthetic",
      },
    ],
    workspace_configs: [{ workspace_id: WORKSPACE_ID, tenant_id: TENANT_ID, document: {}, version: 9 }],
    merchant_sessions: [
      {
        id: "sess-1",
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        token_hash: sha256hex(TOKEN),
        csrf_token_hash: "csrf-hash",
        expires_at: FUTURE,
        revoked_at: null,
      },
    ],
    audit_events: [],
    merchant_ai_policies: [],
  };
}

const API = "https://mock.invalid/functions/v1/privlan-merchant-api";
const authed = (path) => handler(new Request(API + path, { headers: { authorization: "Bearer " + TOKEN } }));
const anon = (path) => handler(new Request(API + path));

const CANONICAL_KEY = `tenant/${TENANT_ID}/workspace/${WORKSPACE_ID}/images/icon-back.png`;
const putObject = (key = CANONICAL_KEY) => {
  storageState.objects[`merchant-assets/${key}`] = { bytes: new Uint8Array(PNG_BYTES), contentType: "image/png" };
};

/* ---------- 1. 未登录 → 401，且不得触碰 Storage ---------- */
test("anonymous /mp-images/icon-back.png → 401 AUTH_REQUIRED, zero storage read", async () => {
  loadFixture();
  putObject();
  const res = await anon("/mp-images/icon-back.png");
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, "AUTH_REQUIRED");
  assert.equal(storageState.calls.length, 0, "未通过会话闸门不得读 Storage");
});

/* ---------- 2. 有效会话 → canonical key 正确 + 200 + 原始字节 ---------- */
test("valid session → downloads canonical tenant/workspace key and streams exact bytes", async () => {
  loadFixture();
  putObject();
  const res = await authed("/mp-images/icon-back.png");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(storageState.calls, [{ bucket: "merchant-assets", key: CANONICAL_KEY }]);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(bytes.byteLength, 307);
  assert.equal(sha256hex(Buffer.from(bytes)), sha256hex(PNG_BYTES));
});

/* ---------- 3. 对象不存在 → 404，不得返回占位图 ---------- */
test("storage object missing → 404 ASSET_NOT_FOUND, no placeholder fallback", async () => {
  loadFixture();
  const res = await authed("/mp-images/icon-back.png");
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.code, "ASSET_NOT_FOUND");
  assert.equal(storageState.calls.length, 1);
});

/* ---------- 4. 基础设施故障 → 503，不得压成 401 ---------- */
test("storage infrastructure error → 503 STORAGE_BACKEND_UNAVAILABLE (never 401)", async () => {
  loadFixture();
  storageState.fail = { statusCode: "502", message: "bad gateway" };
  const res = await authed("/mp-images/icon-back.png");
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, "STORAGE_BACKEND_UNAVAILABLE");
  assert.ok(!logged.some((l) => l.event === "session_lookup_failed"), "存储故障不得被误报为会话故障");
});

/* ---------- 5. 越权工作区的对象不得被本会话读到 ---------- */
test("foreign workspace object is unreachable from this session", async () => {
  loadFixture();
  putObject(`tenant/${TENANT_ID}/workspace/${FOREIGN_WORKSPACE_ID}/images/icon-back.png`);
  const res = await authed("/mp-images/icon-back.png");
  assert.equal(res.status, 404);
  assert.equal(storageState.calls[0].key, CANONICAL_KEY, "只允许查本会话 canonical key");
});

/* ---------- 6. traversal / 绝对路径 / URL / 嵌套 / 编码绕过 全部拒绝 ---------- */
const REJECTS = [
  "/mp-images/../../secret.png",
  "/mp-images/%2e%2e%2fsecret.png",
  "/mp-images/..%2f..%2fsecret.png",
  "/mp-images/a/b.png",
  "/mp-images/C:\\windows\\x.png",
  "/mp-images/icon-back.png%00.png",
  "/mp-images/.hidden.png",
  "/mp-images/",
  "/mp-images/x.svg",
  "/mp-images/http://evil.invalid/x.png",
];
for (const path of REJECTS) {
  test(`path traversal / invalid name rejected: ${path}`, async () => {
    loadFixture();
    putObject();
    const res = await authed(path);
    const body = await res.json().catch(() => ({}));
    assert.ok(res.status === 400 || res.status === 404, `unexpected status ${res.status}`);
    if (res.status === 400) assert.equal(body.code, "INVALID_ASSET_NAME");
    assert.equal(storageState.calls.length, 0, "被拒的名称不得触达 Storage");
  });
}

/* ---------- 6b. 点号段在 URL 解析期就被折叠，无法借相对段逃出 canonical 前缀 ---------- */
test("dot-segment after a valid basename collapses during URL parsing and stays in-prefix", async () => {
  loadFixture();
  putObject();
  const res = await authed("/mp-images/icon-back.png/../secret.png");
  assert.equal(res.status, 404, "折叠后是 secret.png，本工作区没有该对象");
  assert.equal(storageState.calls.length, 1);
  assert.ok(
    storageState.calls[0].key.startsWith(`tenant/${TENANT_ID}/workspace/${WORKSPACE_ID}/images/`),
    "任何情况下 key 都不得逃出本会话 canonical 前缀",
  );
  assert.equal(storageState.calls[0].key, `tenant/${TENANT_ID}/workspace/${WORKSPACE_ID}/images/secret.png`);
});

/* ---------- 7. 浏览器传入 workspaceId 只能当 conflict probe ---------- */
test("client-supplied foreign workspaceId is rejected, never used for the key", async () => {
  loadFixture();
  putObject();
  const res = await authed(`/mp-images/icon-back.png?workspaceId=${FOREIGN_WORKSPACE_ID}`);
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(storageState.calls.length, 0);
});

test("matching workspaceId probe does not widen the canonical key", async () => {
  loadFixture();
  putObject();
  const res = await authed(`/mp-images/icon-back.png?workspaceId=${WORKSPACE_ID}`);
  assert.equal(res.status, 200);
  assert.deepEqual(storageState.calls, [{ bucket: "merchant-assets", key: CANONICAL_KEY }]);
});

/* ---------- 8. 凭据与内部标识不外泄 ---------- */
test("response never carries service_role key, session token or canonical object key", async () => {
  loadFixture();
  storageState.fail = { statusCode: "500", message: "internal" };
  const res = await authed("/mp-images/icon-back.png");
  const text = JSON.stringify(await res.json());
  assert.ok(!text.includes(SERVICE_ROLE_KEY));
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes(TENANT_ID), "canonical key 不得回显给浏览器");
});

/* ---------- 9. 业务库零写入 ---------- */
test("resolver writes nothing to business tables", async () => {
  loadFixture();
  putObject();
  await authed("/mp-images/icon-back.png");
  await anon("/mp-images/icon-back.png");
  await authed("/mp-images/../../secret.png");
  assert.deepEqual(Object.keys(dbState.written), [], "读取链路不得产生任何 INSERT/UPDATE");
});

/* ---------- 10. resolver 只读：写入面收窄到 proxy-upload + capacity-test 两点 ---------- */
test("built function source keeps the resolver read-only — exactly two server-side writes, neither in the resolver", async () => {
  const src = readFileSync(new URL("index.js", BUILT), "utf8");
  const uploadLines = src.split("\n").filter((l) => /\.upload\s*\(/.test(l));
  assert.equal(
    uploadLines.length,
    2,
    "resolver 只允许 download；全函数仅 proxy-upload 与 proxy-capacity-test 两处写入",
  );
  assert.ok(uploadLines.some((l) => /proxyKey/.test(l)), "canonical 写入绑定 proxyKey");
  assert.ok(uploadLines.some((l) => /capacityKey/.test(l)), "容量探针写入绑定 capacityKey");
  assert.ok(!uploadLines.some((l) => /\.download\(/.test(l)), "写入行不得与 resolver 读取混在同一行");
  assert.match(src, /storage\.from\(MERCHANT_ASSETS_BUCKET\)\.download\(/);
});
