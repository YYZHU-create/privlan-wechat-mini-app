/**
 * SIGNED_UPLOAD_EXECUTION_SLICE focused tests
 * —— E1.5 签发端点 POST /internal/storage/signed-upload-execute
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 与探针（signed-upload-probe.test.mjs）的契约差别只有一条：
 * 本端点按 E1.5 授权把 signed authorization（signedUrl + token）返回给
 * 当前真实 authenticated browser；其余闸门（会话、scope 身份锁、零参数、
 * 存在即 409、upsert=false、日志不落 token、业务库零写入）逐条与探针相同。
 *
 * ⚠️ 本文件 PASS 只证明端点闸门与响应形状正确，
 * 不构成「浏览器直传成功」的证据 —— 那只能由线上真实上传 + SQL 对账定案。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);

/* ---------- 合成夹具（与真实商户数据无关） ---------- */
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const STORE_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_TENANT_ID = "99999999-9999-4999-8999-999999999999";
const FOREIGN_WORKSPACE_ID = "88888888-8888-4888-8888-888888888888";
const TOKEN = "synthetic-execute-session-token-0123456789abcdef";
const SERVICE_ROLE_KEY = "mock-s…-key";
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const sha256hex = (v) => createHash("sha256").update(v).digest("hex");

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
  pathToFileURL(new URL("fake-supabase.js", BUILT).pathname).href
);
globalThis.__nodeCrypto = await import("node:crypto");
const mod = await import(pathToFileURL(new URL("index.js", BUILT).pathname).href);
/** 复刻生产 Deno.serve 外层：抛出的 ServiceError 必须落成 HTTP 响应，而不是逃进测试 */
handler = (req) => mod.handle(req).catch((error) => mod.failure(error, mod.newRequestId("test")));

const {
  PROBE_ROUTE,
  PROBE_TENANT_ID,
  PROBE_WORKSPACE_ID,
  PROBE_BASENAME,
  MERCHANT_ASSETS_BUCKET,
  EXECUTE_ROUTE,
  EXECUTE_EXPECTED_BYTES,
  EXECUTE_EXPECTED_SHA256,
  EXECUTE_EXPECTED_MIMETYPE,
} = mod;
const CANONICAL_KEY = `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images/${PROBE_BASENAME}`;
/** fake 里固定的合成 signed token；本端点被授权返回它，但日志/库仍不得落 */
const SYNTHETIC_SIGNED_TOKEN = "synthetic-signed-upload-token-DO-NOT-LEAK";

function loadFixture({ tenantId = PROBE_TENANT_ID, workspaceId = PROBE_WORKSPACE_ID } = {}) {
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
      { user_id: USER_ID, tenant_id: tenantId, workspace_id: workspaceId, role: "owner", created_at: "2026-01-01T00:00:00Z" },
    ],
    workspaces: [{ id: workspaceId, tenant_id: tenantId, name: "合成工作区", plan_id: "PRO" }],
    tenants: [{ id: tenantId, status: "active" }],
    stores: [{ id: STORE_ID, workspace_id: workspaceId, name: "合成门店", public_store_id: "pub-1" }],
    subscriptions: [
      {
        id: "sub-1",
        workspace_id: workspaceId,
        plan_id: "PRO",
        status: "active",
        started_at: "2026-01-01T00:00:00Z",
        expires_at: null,
        source: "synthetic",
      },
    ],
    workspace_configs: [{ workspace_id: workspaceId, tenant_id: tenantId, document: {}, version: 9 }],
    merchant_sessions: [
      {
        id: "sess-1",
        user_id: USER_ID,
        workspace_id: workspaceId,
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
const post = (path, init = {}) =>
  handler(new Request(API + path, { method: "POST", headers: { authorization: "Bearer " + TOKEN }, ...init }));
const anonPost = (path) => handler(new Request(API + path, { method: "POST" }));
const get = (path) => handler(new Request(API + path, { headers: { authorization: "Bearer " + TOKEN } }));

/* ========== 1. 匿名 → 401，绝不触达签发 ========== */
test("E1. anonymous execute → 401 AUTH_REQUIRED, zero signing, zero storage call", async () => {
  loadFixture();
  const res = await anonPost(EXECUTE_ROUTE);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, "AUTH_REQUIRED");
  assert.equal(storageState.signCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "未过会话闸门不得触碰 Storage");
});

/* ========== 2. 越权 scope 注入 → 403 ========== */
test("E2. client-supplied foreign workspaceId → 403 WORKSPACE_ACCESS_DENIED, zero signing", async () => {
  loadFixture();
  const res = await post(`${EXECUTE_ROUTE}?workspaceId=${FOREIGN_WORKSPACE_ID}`);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 3. 零参数闸门 ========== */
test("E3. arbitrary filename / objectKey / upsert in body → 400 EXECUTE_NO_PARAMETERS, zero signing", async () => {
  loadFixture();
  const attempts = [
    { filename: "evil.png" },
    { objectKey: "tenant/x/workspace/y/images/z.png" },
    { path: "../../secret.png" },
    { bucket: "avatars" },
    { upsert: true },
  ];
  for (const payload of attempts) {
    const res = await post(EXECUTE_ROUTE, { body: JSON.stringify(payload) });
    assert.equal(res.status, 400, `${JSON.stringify(payload)} 应被拒`);
    assert.equal((await res.json()).code, "EXECUTE_NO_PARAMETERS");
  }
  const viaQuery = await post(`${EXECUTE_ROUTE}?key=tenant%2Fevil%2Fx.png`);
  assert.equal(viaQuery.status, 400);
  assert.equal(storageState.signCalls.length, 0, "任何注入尝试都不得触达签发");
});

/* ========== 4. canonical 签发：响应形状 + 权威指纹 ========== */
test("E4. canonical session → 200, signs exact canonical key with upsert=false, returns authorization", async () => {
  loadFixture();
  const res = await post(EXECUTE_ROUTE);
  assert.equal(res.status, 200);
  assert.deepEqual(storageState.signCalls, [
    { bucket: MERCHANT_ASSETS_BUCKET, path: CANONICAL_KEY, upsert: false },
  ]);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.slice, "SIGNED_UPLOAD_EXECUTION_SLICE");
  assert.equal(body.data.bucket, "merchant-assets");
  assert.equal(body.data.path, CANONICAL_KEY, "浏览器需要 canonical key 做上传前闸门");
  assert.equal(body.data.token, SYNTHETIC_SIGNED_TOKEN, "E1.5 授权：signed token 返回给当前会话浏览器");
  assert.ok(body.data.signedUrl.includes(`/object/upload/sign/merchant-assets/${CANONICAL_KEY}`), "signedUrl 指向 canonical 签发路由");
  assert.ok(body.data.signedUrl.includes("token="), "signedUrl 携带 token query");
  assert.equal(body.data.upsert, false);
  assert.deepEqual(body.data.expected, {
    bytes: EXECUTE_EXPECTED_BYTES,
    sha256: EXECUTE_EXPECTED_SHA256,
    mimetype: EXECUTE_EXPECTED_MIMETYPE,
  });
  /* 权威指纹本身必须与 E1.5 批准值逐字符一致 */
  assert.equal(EXECUTE_EXPECTED_BYTES, 307);
  assert.equal(EXECUTE_EXPECTED_SHA256, "4a7e42b5e78a0c379c58edaeb1c5c3bdeebf6f0e03e728f7761df5da26741add");
  assert.equal(EXECUTE_EXPECTED_MIMETYPE, "image/png");
});

test("E4b. existence check happens strictly BEFORE signing", async () => {
  loadFixture();
  await post(EXECUTE_ROUTE);
  assert.equal(storageState.listCalls.length, 1, "execute 只做签发前检查，不做签发后对账（对账由 SQL/resolver 承担）");
  assert.equal(storageState.listCalls[0].prefix, `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images`);
  assert.equal(storageState.listCalls[0].search, PROBE_BASENAME);
});

/* ========== 5. service_role / 会话 token 绝不外泄 ========== */
test("E5. response never carries service_role key, merchant session token or userId", async () => {
  loadFixture();
  const res = await post(EXECUTE_ROUTE);
  const text = await res.text();
  assert.ok(!text.includes(SERVICE_ROLE_KEY), "service_role key 不得出现");
  assert.ok(!text.includes(TOKEN), "商户会话 token 不得出现");
  assert.ok(!text.includes(USER_ID), "userId 不得回显");
  // signed token 允许出现（正是本端点的授权产物），但必须只等于 fake 的合成值
  const body = JSON.parse(text);
  assert.equal(body.data.token, SYNTHETIC_SIGNED_TOKEN);
});

/* ========== 6. 日志面：token / signedUrl 原文不落 ========== */
test("E6. logs never carry signed token, signedUrl literal or service_role", async () => {
  loadFixture();
  await post(EXECUTE_ROUTE);
  const logText = JSON.stringify(logged);
  assert.ok(!logText.includes(SYNTHETIC_SIGNED_TOKEN), "signed token 不得出现在日志");
  assert.ok(!logText.includes("object/upload/sign"), "signedUrl 不得出现在日志");
  assert.ok(!logText.includes(SERVICE_ROLE_KEY), "service_role 不得出现在日志");
  const issued = logged.find((l) => l.event === "signed_upload_execute_issued");
  assert.ok(issued, "必须留下结构化签发日志");
  assert.equal(issued.fields.issued, true);
  assert.equal(typeof issued.fields.tokenLength, "number", "日志只允许给长度");
});

/* ========== 7. canonical 已存在 → 409 ========== */
test("E7. canonical object already exists → 409, refuses to sign a second time", async () => {
  loadFixture();
  storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${CANONICAL_KEY}`] = {
    bytes: new Uint8Array(0),
    contentType: "application/octet-stream",
  };
  const res = await post(EXECUTE_ROUTE);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "EXECUTE_CANONICAL_ALREADY_EXISTS");
  assert.equal(storageState.signCalls.length, 0, "已存在则绝不签发");
});

test("E7b. flat residue at bucket root does NOT satisfy the canonical existence check", async () => {
  loadFixture();
  storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${PROBE_BASENAME}`] = {
    bytes: new Uint8Array(307),
    contentType: "image/png",
  };
  const res = await post(EXECUTE_ROUTE);
  assert.equal(res.status, 200, "扁平残留与 canonical 路径互不相干，不得误判为已存在");
  assert.deepEqual(storageState.signCalls, [
    { bucket: MERCHANT_ASSETS_BUCKET, path: CANONICAL_KEY, upsert: false },
  ]);
});

/* ========== 8. 非 canonical 身份（含 Production）→ 403 ========== */
test("E8. foreign identity variants → 403 EXECUTE_SCOPE_MISMATCH, zero storage contact", async () => {
  const variants = [
    { tenantId: FOREIGN_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: PROBE_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: FOREIGN_TENANT_ID, workspaceId: PROBE_WORKSPACE_ID },
  ];
  for (const variant of variants) {
    loadFixture(variant);
    const res = await post(EXECUTE_ROUTE);
    assert.equal(res.status, 403, JSON.stringify(variant));
    assert.equal((await res.json()).code, "EXECUTE_SCOPE_MISMATCH");
    assert.equal(storageState.signCalls.length, 0);
    assert.equal(storageState.listCalls.length, 0, "身份不符时连 Storage 都不得触碰");
  }
});

/* ========== 9. 签发失败 → 502 + 非敏感分类 ========== */
test("E9. issuance failure → 502 with non-sensitive classifiers, raw storage message never echoed", async () => {
  loadFixture();
  storageState.signFail = {
    statusCode: "403",
    code: "42501",
    message: "new row violates row-level security policy for storage.objects",
  };
  const res = await post(EXECUTE_ROUTE);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.code, "SIGNED_UPLOAD_ISSUANCE_FAILED");
  const text = JSON.stringify(body);
  assert.ok(!text.includes("storage.objects"), "不得回显存储侧原文");
  assert.ok(!text.includes(SYNTHETIC_SIGNED_TOKEN), "失败响应不得携带任何 token");
  assert.ok(!text.includes("signedUrl"));
});

/* ========== 10. 签发前 list 失败 → 503 ========== */
test("E10. pre-signing list failure → 503 STORAGE_BACKEND_UNAVAILABLE, zero signing", async () => {
  loadFixture();
  storageState.fail = { statusCode: "502", message: "bad gateway" };
  const res = await post(EXECUTE_ROUTE);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "STORAGE_BACKEND_UNAVAILABLE");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 11. 实例写入闸门关闭 → 503 ========== */
test("E11. instance write gate closed → execute refused 503, zero signing", async () => {
  loadFixture();
  const original = globalThis.__DenoEnv;
  globalThis.__DenoEnv = {
    get: (k) => (k === "MEOO_WRITES_ENABLED" ? "false" : original.get(k)),
  };
  try {
    const res = await post(EXECUTE_ROUTE);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "SESSION_BACKEND_READONLY");
    assert.equal(storageState.signCalls.length, 0);
  } finally {
    globalThis.__DenoEnv = original;
  }
});

/* ========== 12. 非 POST → 404（不泄露路由存在） ========== */
test("E12. non-POST on the execute route stays 404", async () => {
  loadFixture();
  const res = await get(EXECUTE_ROUTE);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROUTE_NOT_FOUND");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 13. 全路径业务库零写入 ========== */
test("E13. execute writes nothing to any business table on every path", async () => {
  const variants = [
    {},
    { tenantId: FOREIGN_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: PROBE_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
  ];
  for (const variant of variants) {
    loadFixture(variant);
    await post(EXECUTE_ROUTE);
    await post(EXECUTE_ROUTE, { body: JSON.stringify({ filename: "x.png" }) });
    await post(`${EXECUTE_ROUTE}?workspaceId=${FOREIGN_WORKSPACE_ID}`);
    await anonPost(EXECUTE_ROUTE);
    /*
     * 收窄而非删除（沿用本项目既有 tripwire 处理原则）：本断言原意是
     * 「拒绝路径不得改动业务数据」。v12 起，实质性授权拒绝必须留下
     * merchant.authorization_denied 证据（audit_events 仅 INSERT），
     * 故 audit_events 从「禁止写入」改为「只允许这一类拒绝审计」；
     * 其余任何表、任何 action、任何多余行仍然一律失败。
     */
    const tables = Object.keys(dbState.written).filter((t) => t !== "audit_events");
    assert.deepEqual(tables, [], `${JSON.stringify(variant)} 下不得有任何业务表写入`);
    for (const row of dbState.written.audit_events || []) {
      assert.equal(row.action, "merchant.authorization_denied", "拒绝路径只允许授权拒绝审计");
      assert.equal(row.metadata.contract, "OWNER_ONLY_FAIL_CLOSED");
      assert.ok(
        ["scope_identity_mismatch", "scope_override_attempt"].includes(row.metadata.reason),
        `拒绝原因必须在封闭集合内，实际 ${row.metadata.reason}`,
      );
    }
  }
});

/* ========== 14. 源码级：execute 自身只签发（写入面收窄到 proxy + capacity 两点） ========== */
test("E14. execute route stays upload-free — server-side writes are limited to proxy-upload and capacity-test", async () => {
  const src = readFileSync(new URL("index.js", BUILT).pathname, "utf8");
  assert.ok(!/uploadToSignedUrl/.test(src), "服务端严禁出现浏览器侧签名上传 API");
  assert.ok(!/method:\s*"PUT"/.test(src), "服务端严禁任何 PUT");
  const uploadLines = src.split("\n").filter((l) => /\.upload\s*\(/.test(l));
  assert.equal(uploadLines.length, 2, "全函数只允许 proxy-upload 与 proxy-capacity-test 两处服务端写入调用");
  assert.ok(uploadLines.some((l) => /proxyKey/.test(l)), "canonical 写入绑定 proxyKey");
  assert.ok(uploadLines.some((l) => /capacityKey/.test(l)), "容量探针写入绑定 capacityKey");
  assert.match(src, /createSignedUploadUrl\(/, "签发能力保留");
  assert.match(src, /signed-upload-execute/, "execute 路由必须存在");
});

/* ========== 15. 既有回归：healthz / session / resolver / 只读闸门 / 探针契约 ========== */
test("E15. existing auth + resolver + probe contracts remain PASS after adding execute", async () => {
  loadFixture();
  const health = await handler(new Request(API + "/healthz"));
  assert.equal((await health.json()).data.kdf, "verified");

  const session = await get("/auth/session");
  assert.equal(session.status, 200);

  storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${CANONICAL_KEY}`] = {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
  };
  const img = await get(`/mp-images/${PROBE_BASENAME}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");

  const blocked = await post("/api/config", { body: JSON.stringify({ document: {} }) });
  assert.equal(blocked.status, 410, "只读闸门不得被执行切片削弱");

  /* 探针契约不被执行切片污染：probe 响应仍然 token 六不落 */
  loadFixture();
  const probe = await post(PROBE_ROUTE);
  assert.equal(probe.status, 200);
  const probeText = await probe.text();
  assert.ok(!probeText.includes(SYNTHETIC_SIGNED_TOKEN), "probe 响应仍不得含 token");
  assert.ok(!probeText.includes("https://"), "probe 响应仍不得含任何绝对 URL");
});
