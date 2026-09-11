/**
 * PROXY_UPLOAD_SLICE focused tests
 * —— E2 写入端点 POST /internal/storage/proxy-upload
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 背景：Kong 网关消费 `?token=`，浏览器直传 signed upload 在本平台无可用通道
 * （SIGNED_UPLOAD_EXECUTION=BLOCKED_BY_GATEWAY）；「云服务」面板只能建根级扁平对象。
 * 本切片改由 Edge Function 以 service_role 内网直连 Storage 写入 canonical nested key。
 *
 * 本文件要证的四件事：
 *   1. 闸门一条不松：会话 → scope 身份锁 → 单一字段 body 白名单 → 权威指纹硬闸 → 存在即 409
 *   2. 客户端对 bucket / path / basename / contentType / upsert 零输入面
 *   3. 指纹不匹配时零写入、零业务表写入（fail closed）
 *   4. 唯一一次 upload 绑定服务端派生的 canonical key，且 upsert=false
 *
 * ⚠️ 台架 PASS 只证明闸门与形状正确；「service_role 能否真的写通私有桶」
 * 必须由线上部署 + SQL 对账定案（storage.objects RLS 为 enabled + 0 policies）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);

/* ---------- 合成夹具（与真实商户数据无关） ---------- */
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const STORE_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_TENANT_ID = "99999999-9999-4999-8999-999999999999";
const FOREIGN_WORKSPACE_ID = "88888888-8888-4888-8888-888888888888";
const TOKEN = "synthetic-proxy-session-token-0123456789abcdef";
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
    k === "SUPABASE_URL" ? "https://mock.invalid" : k === "SUPABASE_SERVICE_ROLE_KEY" ? SERVICE_ROLE_KEY : k === "MERCHANT_STORAGE_PROBE_TENANT_ID" ? "11111111-1111-4111-8111-111111111111" : k === "MERCHANT_STORAGE_PROBE_WORKSPACE_ID" ? "22222222-2222-4222-8222-222222222222" : undefined,
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

const {
  PROBE_TENANT_ID,
  PROBE_WORKSPACE_ID,
  PROBE_BASENAME,
  PROBE_ROUTE,
  MERCHANT_ASSETS_BUCKET,
  EXECUTE_ROUTE,
  EXECUTE_EXPECTED_BYTES,
  EXECUTE_EXPECTED_SHA256,
  EXECUTE_EXPECTED_MIMETYPE,
  PROXY_ROUTE,
  PROXY_MAX_BASE64_CHARS,
} = mod;
const CANONICAL_KEY = `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images/${PROBE_BASENAME}`;
const CANONICAL_FULL = `${MERCHANT_ASSETS_BUCKET}/${CANONICAL_KEY}`;

/**
 * canonical 素材的真实字节（307B）。测试内自证：解码后必须逐位等于服务端权威指纹，
 * 否则下面所有「成功路径」用例都失去意义 —— 这一条本身就是 P0 断言。
 */
const ICON_BACK_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAA+klEQVR4nO2YwQ3DMAwDFU7l" +
  "/V/eqv0Hzc8SyYY3gIQ7GIHjqhBCCCGEEIISe+/PxB6UsPxEBJQYd+nuCCghfsmuta5XBNgE" +
  "eZkALHmJAEx5egC2PDWAgjwtgIo8JYCS/HgANfnRAIryYwFU5UcCKMu3B1CXbw3gIN8WwEW+" +
  "JYCT/PEAbvJHAzjKHw1wl3WQbz0BU6+6sifAJQJODnOMgNMD3SKgY6hTBHQNdomAzuEOEdC9" +
  "QD3CNbXoSfo1T2LrQZR9Gi7GUqX/BjCWKn0XUCRUIqCIKERAkWFHQAnAjIASgRUBJQQjAkoM" +
  "16e147BviCGEEEIIIdR/8wVSJKmrATuwEAAAAABJRU5ErkJggg==";

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
const post = (path, body, token = TOKEN) =>
  handler(
    new Request(API + path, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body,
    }),
  );
const authedPost = (path) => post(path, "");
const anonPost = (path) => handler(new Request(API + path, { method: "POST" }));
const get = (path) => handler(new Request(API + path, { headers: { authorization: "Bearer " + TOKEN } }));
const payloadOf = (b64) => JSON.stringify({ payload: b64 });

/* ========== 0. 夹具自证：内嵌字节必须就是权威指纹本体 ========== */
test("P0. the embedded base64 really is the authoritative 307-byte asset", () => {
  const bytes = Buffer.from(ICON_BACK_B64, "base64");
  assert.equal(bytes.byteLength, EXECUTE_EXPECTED_BYTES);
  assert.equal(sha256hex(bytes), EXECUTE_EXPECTED_SHA256);
});

/* ========== 1. 匿名 → 401，零存储触达、零写入 ========== */
test("P1. anonymous → 401 AUTH_REQUIRED, zero storage calls, zero writes", async () => {
  loadFixture();
  const res = await anonPost(PROXY_ROUTE);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, "AUTH_REQUIRED");
  assert.equal(storageState.uploadCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "未过会话闸门不得触碰 Storage");
  assert.deepEqual(Object.keys(dbState.written), []);
});

/* ========== 2. 越权 scope 注入 → 403（在路由之前由 assertScopeNotOverridden 拦下） ========== */
test("P2. foreign workspaceId via query → 403 WORKSPACE_ACCESS_DENIED, zero upload", async () => {
  loadFixture();
  const viaQuery = await authedPost(`${PROXY_ROUTE}?workspaceId=${FOREIGN_WORKSPACE_ID}`);
  assert.equal(viaQuery.status, 403);
  assert.equal((await viaQuery.json()).code, "WORKSPACE_ACCESS_DENIED");
  const viaBody = await post(PROXY_ROUTE, JSON.stringify({ payload: ICON_BACK_B64, workspaceId: FOREIGN_WORKSPACE_ID }));
  assert.equal(viaBody.status, 403, "携带越权 scope 的合法 payload 也必须先被 scope 闸门拦下");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 3. 身份锁：非 canonical Staging 租户/工作区一律 403 ========== */
test("P3. canonical 之外的身份 → 403 PROXY_SCOPE_MISMATCH, zero upload", async () => {
  const variants = [
    { tenantId: FOREIGN_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: PROBE_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: FOREIGN_TENANT_ID, workspaceId: PROBE_WORKSPACE_ID },
  ];
  for (const variant of variants) {
    loadFixture(variant);
    const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
    assert.equal(res.status, 403, JSON.stringify(variant));
    assert.equal((await res.json()).code, "PROXY_SCOPE_MISMATCH");
    assert.equal(storageState.uploadCalls.length, 0);
  }
});

/* ========== 4. 单一字段白名单：路径类注入一律 400 ========== */
test("P4. any extra/other field → 400 PROXY_UNEXPECTED_FIELDS, zero upload", async () => {
  loadFixture();
  const attempts = [
    { payload: ICON_BACK_B64, filename: "evil.png" },
    { payload: ICON_BACK_B64, path: "tenant/x/workspace/y/images/z.png" },
    { payload: ICON_BACK_B64, bucket: "avatars" },
    { payload: ICON_BACK_B64, upsert: true },
    { payload: ICON_BACK_B64, contentType: "text/html" },
    { filename: "evil.png" },
    {},
  ];
  for (const body of attempts) {
    const res = await post(PROXY_ROUTE, JSON.stringify(body));
    assert.equal(res.status, 400, JSON.stringify(Object.keys(body)));
    assert.equal((await res.json()).code, "PROXY_UNEXPECTED_FIELDS");
  }
  assert.equal(storageState.uploadCalls.length, 0, "任何注入尝试都不得触达写入");
});

/* ========== 5. body 形状闸门 ========== */
test("P5. empty / non-JSON / array body → 400, zero upload", async () => {
  loadFixture();
  const empty = await authedPost(PROXY_ROUTE);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "PROXY_BODY_REQUIRED");

  const broken = await post(PROXY_ROUTE, "not json at all");
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).code, "PROXY_BODY_INVALID");

  const arr = await post(PROXY_ROUTE, JSON.stringify([ICON_BACK_B64]));
  assert.equal(arr.status, 400);
  assert.equal((await arr.json()).code, "PROXY_BODY_INVALID");

  const blank = await post(PROXY_ROUTE, JSON.stringify({ payload: "   " }));
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).code, "PROXY_PAYLOAD_REQUIRED");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 6. 查询参数一律拒绝 ========== */
test("P6. unrelated query parameter → 400 PROXY_NO_QUERY_PARAMETERS", async () => {
  loadFixture();
  const res = await authedPost(`${PROXY_ROUTE}?key=tenant%2Fevil%2Fx.png`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PROXY_NO_QUERY_PARAMETERS");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 7. 尺寸上限在解码之前生效 ========== */
test("P7. oversized payload → 413 before any decode, zero upload", async () => {
  loadFixture();
  const huge = "A".repeat(PROXY_MAX_BASE64_CHARS + 4);
  const res = await post(PROXY_ROUTE, payloadOf(huge));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, "PROXY_PAYLOAD_TOO_LARGE");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 8. 非 base64 字符 → 400 ========== */
test("P8. non-base64 payload → 400 PROXY_PAYLOAD_NOT_BASE64, zero upload", async () => {
  loadFixture();
  for (const bad of ["!!!!", "ab", "a/b/c d", "iVBOR$$$"]) {
    const res = await post(PROXY_ROUTE, payloadOf(bad));
    assert.equal(res.status, 400, bad);
    assert.equal((await res.json()).code, "PROXY_PAYLOAD_NOT_BASE64");
  }
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 9. 权威指纹硬闸：尺寸对但摘要错 / 摘要对但尺寸错，都不得写入 ========== */
test("P9. fingerprint mismatch → 422 PROXY_FINGERPRINT_MISMATCH, zero writes", async () => {
  loadFixture();
  // 尺寸正确、内容错误
  const sameSize = Buffer.alloc(EXECUTE_EXPECTED_BYTES, 0x41).toString("base64");
  const r1 = await post(PROXY_ROUTE, payloadOf(sameSize));
  assert.equal(r1.status, 422);
  assert.equal((await r1.json()).code, "PROXY_FINGERPRINT_MISMATCH");

  // 内容正确但被截断
  const truncated = ICON_BACK_B64.slice(0, ICON_BACK_B64.length - 8);
  const r2 = await post(PROXY_ROUTE, payloadOf(truncated));
  assert.equal(r2.status, 422, "截断字节必须被摘要闸门拦下，不得落库半个对象");

  assert.equal(storageState.uploadCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "指纹闸门在存在性检查之前，不得触达 Storage");
  assert.deepEqual(Object.keys(dbState.written), [], "指纹不匹配时零业务表写入");
  const rejected = logged.find((l) => l.event === "proxy_upload_fingerprint_rejected");
  assert.ok(rejected, "拒绝必须留结构化痕");
  assert.equal(rejected.fields.writes, 0);
});

/* ========== 10. canonical 成功路径：唯一一次写入绑定服务端 key ========== */
test("P10. canonical asset → 200, exactly one upload on server-derived key with upsert=false", async () => {
  loadFixture();
  const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  assert.equal(res.status, 200);
  assert.deepEqual(storageState.uploadCalls, [
    {
      bucket: MERCHANT_ASSETS_BUCKET,
      path: CANONICAL_KEY,
      upsert: false,
      contentType: EXECUTE_EXPECTED_MIMETYPE,
      bytes: EXECUTE_EXPECTED_BYTES,
    },
  ]);
  assert.equal(storageState.listCalls.length, 2, "写前存在性检查 + 写后目录对账");
  assert.equal(storageState.listCalls[0].prefix, `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images`);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.slice, "PROXY_UPLOAD_SLICE");
  assert.equal(body.data.bucket, "merchant-assets");
  assert.equal(body.data.path, CANONICAL_KEY);
  assert.equal(body.data.echoKeyMatchesCanonical, true);
  assert.deepEqual(body.data.written, {
    bytes: EXECUTE_EXPECTED_BYTES,
    sha256: EXECUTE_EXPECTED_SHA256,
    contentType: "image/png",
    upsert: false,
  });
  assert.equal(body.data.readback.ok, true, "回读指纹必须逐位一致");
  assert.equal(body.data.readback.bytes, EXECUTE_EXPECTED_BYTES);
  assert.equal(body.data.listAfter.count, 1);
  assert.equal(body.data.listAfter.size, EXECUTE_EXPECTED_BYTES);
  assert.equal(body.data.listAfter.mimetype, "image/png");

  /* 落进 fake 的字节必须与源字节全等 */
  assert.equal(storageState.objects[CANONICAL_FULL].bytes.byteLength, EXECUTE_EXPECTED_BYTES);
  assert.equal(sha256hex(Buffer.from(storageState.objects[CANONICAL_FULL].bytes)), EXECUTE_EXPECTED_SHA256);
});

/* ========== 11. 写后 resolver 立即可读（台架级 E2E） ========== */
test("P11. after proxy-upload, GET /mp-images/{basename} serves the exact bytes", async () => {
  loadFixture();
  await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  const img = await get(`/mp-images/${PROBE_BASENAME}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  const buf = new Uint8Array(await img.arrayBuffer());
  assert.equal(buf.byteLength, EXECUTE_EXPECTED_BYTES);
  assert.equal(sha256hex(Buffer.from(buf)), EXECUTE_EXPECTED_SHA256);
});

/* ========== 12. canonical 已存在 → 409，绝不覆盖 ========== */
test("P12. existing canonical → 409 PROXY_CANONICAL_ALREADY_EXISTS, zero upload", async () => {
  loadFixture();
  storageState.objects[CANONICAL_FULL] = {
    bytes: Buffer.alloc(EXECUTE_EXPECTED_BYTES, 0x00),
    contentType: "image/png",
  };
  const before = sha256hex(Buffer.from(storageState.objects[CANONICAL_FULL].bytes));
  const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "PROXY_CANONICAL_ALREADY_EXISTS");
  assert.equal(storageState.uploadCalls.length, 0, "存在即拒，不得走到写入");
  assert.equal(sha256hex(Buffer.from(storageState.objects[CANONICAL_FULL].bytes)), before, "既有对象必须原封不动");
});

/* ========== 13. 写前 list 失败 → 503，零写入 ========== */
test("P13. pre-write list failure → 503 STORAGE_BACKEND_UNAVAILABLE, zero upload", async () => {
  loadFixture();
  storageState.fail = { statusCode: "502", message: "bad gateway" };
  const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "STORAGE_BACKEND_UNAVAILABLE");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 14. 写入被 RLS 拒 → 502，日志只落类别不落原文 ========== */
test("P14. upload rejected by RLS → 502 PROXY_UPLOAD_FAILED with classifiers in log only", async () => {
  loadFixture();
  storageState.uploadFail = {
    statusCode: "403",
    message: "new row violates row-level security policy for table \"objects\"",
  };
  const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(text.includes("PROXY_UPLOAD_FAILED"));
  assert.ok(!/row-level security/.test(text), "存储侧错误原文不得回显给浏览器");

  const failed = logged.find((l) => l.event === "proxy_upload_write_failed");
  assert.ok(failed, "写入失败必须留结构化痕");
  assert.equal(failed.fields.clsRlsViolation, true);
  assert.equal(failed.fields.errStatus, "403");
  assert.ok(!("errMessage" in failed.fields), "日志不得落错误原文");
});

/* ========== 15. 凭据与字节不外泄：响应体 + 日志面 ========== */
test("P15. payload, session token and service_role key never leak into response or logs", async () => {
  loadFixture();
  const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  const text = await res.text();
  assert.ok(!text.includes(ICON_BACK_B64), "payload 原文不得回显");
  assert.ok(!text.includes(SERVICE_ROLE_KEY), "service_role 不得出现在响应");
  assert.ok(!text.includes(TOKEN), "会话 token 不得出现在响应");

  const logText = JSON.stringify(logged);
  assert.ok(!logText.includes(ICON_BACK_B64), "日志不得落 payload");
  assert.ok(!logText.includes(SERVICE_ROLE_KEY), "日志不得落 service_role");
  assert.ok(!logText.includes(TOKEN), "日志不得落会话 token");
});

/* ========== 16. 业务库写入面：只允许审计这一条 ========== */
test("P16. success path writes exactly one audit row and nothing else", async () => {
  loadFixture();
  const res = await post(PROXY_ROUTE, payloadOf(ICON_BACK_B64));
  assert.equal(res.status, 200);
  const keys = Object.keys(dbState.written);
  assert.equal(keys.length, 1, `唯一允许的业务写入是审计，实际 ${keys.join(",")}`);
  assert.match(keys[0], /audit_events/);
  const rows = dbState.written[keys[0]];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "merchant.asset_proxy_upload");
  assert.equal(rows[0].resource_type, "storage_object");
  assert.equal(rows[0].metadata.sha256, EXECUTE_EXPECTED_SHA256);
  assert.equal(rows[0].metadata.bytes, EXECUTE_EXPECTED_BYTES);
  assert.equal(rows[0].metadata.roundTripOk, true);
  const serialized = JSON.stringify(rows[0]);
  assert.ok(!serialized.includes(SERVICE_ROLE_KEY), "审计行不得含凭据");
  assert.ok(!serialized.includes(ICON_BACK_B64), "审计行不得内联 base64 字节");
});

/* ========== 17. 拒绝路径零业务写入（含指纹失败与 409） ========== */
test("P17. every rejection path writes nothing to any business table", async () => {
  const cases = [
    ["query", () => authedPost(`${PROXY_ROUTE}?x=1`)],
    ["fields", () => post(PROXY_ROUTE, JSON.stringify({ payload: ICON_BACK_B64, bucket: "avatars" }))],
    ["fingerprint", () => post(PROXY_ROUTE, payloadOf(Buffer.alloc(307, 0x42).toString("base64")))],
    ["notbase64", () => post(PROXY_ROUTE, payloadOf("!!!!"))],
    ["tooLarge", () => post(PROXY_ROUTE, payloadOf("A".repeat(PROXY_MAX_BASE64_CHARS + 4)))],
  ];
  for (const [label, run] of cases) {
    loadFixture();
    const res = await run();
    assert.ok(res.status >= 400, label);
    assert.deepEqual(Object.keys(dbState.written), [], `${label} 拒绝路径不得写业务表`);
    assert.equal(storageState.uploadCalls.length, 0, `${label} 不得触达写入`);
  }
});

/* ========== 18. 源码级 tripwire：写入面只有两个点，且各自绑定服务端派生 key ========== */
test("P18. exactly two server-side uploads in the whole function, each bound to a server-derived key", async () => {
  const src = readFileSync(new URL("index.js", BUILT), "utf8");
  assert.ok(!/uploadToSignedUrl/.test(src), "服务端严禁出现浏览器侧签名上传 API");
  assert.ok(!/method:\s*"PUT"/.test(src), "服务端严禁任何 PUT");
  const uploadLines = src.split("\n").filter((l) => /\.upload\s*\(/.test(l));
  // 容量探针切片新增第二处写入；断言按「收窄」而非「删除」处理：
  // 数量必须恰好为 2，且两处分别绑定各自的服务端 key，resolver / probe / execute 仍零写入。
  assert.equal(uploadLines.length, 2, "全函数只允许 proxy-upload 与 proxy-capacity-test 两处服务端写入");
  assert.ok(uploadLines.some((l) => /proxyKey/.test(l)), "canonical 写入必须绑定 proxyKey");
  assert.ok(uploadLines.some((l) => /capacityKey/.test(l)), "容量探针写入必须绑定 capacityKey");
  assert.match(src, /upsert:\s*false/, "写入必须固定 upsert=false");
});

/* ========== 19. 既有契约不被写入切片削弱 ========== */
test("P19. healthz / probe / execute / resolver / read-only gates still hold", async () => {
  loadFixture();
  const health = await handler(new Request(API + "/healthz"));
  assert.equal((await health.json()).data.kdf, "verified");

  const session = await get("/auth/session");
  assert.equal(session.status, 200);

  const probe = await authedPost(PROBE_ROUTE);
  assert.equal(probe.status, 200);
  const probeText = await probe.text();
  assert.ok(!probeText.includes("synthetic-signed-upload-token-DO-NOT-LEAK"), "probe 仍 token 六不落");
  assert.ok(!probeText.includes("https://"), "probe 仍不得含任何绝对 URL");

  const exec = await authedPost(EXECUTE_ROUTE);
  assert.equal(exec.status, 200);
  const execBody = await exec.json();
  assert.equal(execBody.data.path, CANONICAL_KEY);
  assert.equal(execBody.data.expected.sha256, EXECUTE_EXPECTED_SHA256);

  const blocked = await post("/api/config", JSON.stringify({ document: {} }));
  assert.equal(blocked.status, 410, "只读闸门不得被写入切片削弱");

  /* 未知路由仍按 404 处理，不确认路由存在性 */
  const unknown = await authedPost("/internal/storage/proxy-upload-x");
  assert.equal(unknown.status, 404);
});

/* ========== 20. 非 POST 方法不得确认路由存在 ========== */
test("P20. GET on proxy route → 404 ROUTE_NOT_FOUND", async () => {
  loadFixture();
  const res = await get(PROXY_ROUTE);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROUTE_NOT_FOUND");
  assert.equal(storageState.uploadCalls.length, 0);
});
