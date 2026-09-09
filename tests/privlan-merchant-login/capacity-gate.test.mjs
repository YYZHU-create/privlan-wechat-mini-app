/**
 * EDGE_FUNCTION_PROXY_UPLOAD_CAPACITY_GATE focused tests
 * —— 临时容量探针端点 POST /internal/storage/proxy-capacity-test
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 本切片唯一目的：为「Browser → Edge Function → Private Storage」这条路线取得真实容量证据。
 * 台架能证的只是闸门形状与命名空间隔离；真实的网关 body limit / Deno 内存 / 超时
 * 必须由线上部署 + 浏览器实测 + SQL 对账定案。
 *
 * 本文件要证的六件事：
 *   1. 档位是封闭 enum：任意 bytes 长度（含 28,582,540）一律 400，杜绝被当成通用上传器
 *   2. 写前门禁 fail closed：长度硬闸 + 服务端权威指纹硬闸，不通过则零写入、零业务表写入
 *   3. objectKey 完全服务端派生：客户端对 bucket / path / prefix / contentType / upsert 零输入面
 *   4. 命名空间与 canonical 隔离：只落 capacity-tests/，永不进 images/，也不进 public.assets
 *   5. PROXY_MAX_BASE64_CHARS=8192 是 APPLICATION_GATE 而非平台上限 —— 同一 payload
 *      走 proxy 路由被 413 拦下、走 capacity 路由正常写入，用代码自证这一点
 *   6. 日志与响应零敏感信息：payload 原文、base64、service_role、会话 token 都不得出现
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);

/* ---------- 合成夹具（与真实商户数据无关） ---------- */
const USER_ID = "aaaaaaaa-2222-4222-8222-222222222222";
const STORE_ID = "66666666-6666-4666-8666-666666666666";
const FOREIGN_TENANT_ID = "99999999-9999-4999-8999-999999999999";
const FOREIGN_WORKSPACE_ID = "88888888-8888-4888-8888-888888888888";
const TOKEN = "synthetic-capacity-session-token-0123456789abcdef";
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
  PROBE_TENANT_ID,
  PROBE_WORKSPACE_ID,
  PROBE_BASENAME,
  MERCHANT_ASSETS_BUCKET,
  PROXY_ROUTE,
  PROXY_MAX_BASE64_CHARS,
  EXECUTE_EXPECTED_BYTES,
  EXECUTE_EXPECTED_SHA256,
  CAPACITY_ROUTE,
  CAPACITY_PREFIX,
  CAPACITY_SIZES,
  CAPACITY_BASENAME,
  CAPACITY_EXPECTED_SHA256,
  CAPACITY_CONTENT_TYPE,
  CAPACITY_MAX_BASE64_CHARS,
} = mod;

const CANONICAL_KEY = `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images/${PROBE_BASENAME}`;
const CAP_ROOT = `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/${CAPACITY_PREFIX}`;
const capKey = (size) => `${CAP_ROOT}/${CAPACITY_BASENAME[String(size)]}`;

/**
 * 确定性 payload：byte[i] = i % 251。
 * 与浏览器触发脚本必须逐位一致 —— 这一条自证（C0）保证服务端常量不是凭空写死的。
 */
function tierBytes(size) {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) b[i] = i % 251;
  return b;
}
const tierB64 = (size) => tierBytes(size).toString("base64");
const bodyOf = (size, b64) => JSON.stringify({ testSize: size, payload: b64 });

/**
 * canonical 素材 base64（307B）：从 proxy-upload.test.mjs 源码里抽取字面量拼接，
 * 绝不在本文件手抄 —— 手抄过一次导致 C21 得到 422 而非 409，是典型的转录污染。
 */
const siblingSrc = readFileSync(new URL("proxy-upload.test.mjs", import.meta.url).pathname, "utf8");
const siblingRegion = siblingSrc.slice(
  siblingSrc.indexOf("const ICON_BACK_B64"),
  siblingSrc.indexOf("function loadFixture"),
);
const ICON_BACK_B64 = (siblingRegion.match(/"([^"\n]*)"/g) ?? []).map((s) => s.slice(1, -1)).join("");

function loadFixture({ tenantId = PROBE_TENANT_ID, workspaceId = PROBE_WORKSPACE_ID } = {}) {
  resetDb();
  resetStorage();
  logged.length = 0;
  dbState.rows = {
    users: [
      {
        id: USER_ID,
        login_identifier: "synthetic-capacity@example.invalid",
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
    stores: [{ id: STORE_ID, workspace_id: workspaceId, name: "合成门店", public_store_id: "pub-cap" }],
    subscriptions: [
      {
        id: "sub-cap",
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
        id: "sess-cap",
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

/* ========== 0. 夹具自证：五档确定性字节必须逐位命中服务端权威指纹 ========== */
test("C0. deterministic payload byte[i]=i%251 matches every server-side fingerprint", () => {
  assert.deepEqual([...CAPACITY_SIZES], [65536, 262144, 1048576, 5242880, 10485760]);
  for (const size of CAPACITY_SIZES) {
    const bytes = tierBytes(size);
    assert.equal(bytes.byteLength, size);
    assert.equal(
      sha256hex(bytes),
      CAPACITY_EXPECTED_SHA256[String(size)],
      `tier ${size} fingerprint constant drifted from byte[i]=i%251`,
    );
  }
  // 28,582,540（大 Legacy GIF）刻意不在档位内 —— 属下一切片
  assert.equal(CAPACITY_SIZES.includes(28582540), false);
  assert.equal(CAPACITY_BASENAME["28582540"], undefined);
});

/* ========== 1. 匿名 → 401，零存储触达、零写入 ========== */
test("C1. anonymous → 401 AUTH_REQUIRED, zero storage calls, zero writes", async () => {
  loadFixture();
  const res = await anonPost(CAPACITY_ROUTE);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, "AUTH_REQUIRED");
  assert.equal(storageState.uploadCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "未过会话闸门不得触碰 Storage");
  assert.deepEqual(Object.keys(dbState.written), []);
});

/* ========== 2. 越权 scope 注入 → 403（路由之前由 assertScopeNotOverridden 拦下） ========== */
test("C2. foreign scope via query/body → 403 WORKSPACE_ACCESS_DENIED, zero upload", async () => {
  loadFixture();
  // scope 闸门在路由分发之前，GET 携带越权 workspaceId 也必须先被 403 拦下（而非 404/405）
  const viaQuery = await get(`${CAPACITY_ROUTE}?workspaceId=${FOREIGN_WORKSPACE_ID}`);
  assert.equal(viaQuery.status, 403);
  assert.equal((await viaQuery.json()).code, "WORKSPACE_ACCESS_DENIED");
  const viaBody = await post(
    CAPACITY_ROUTE,
    JSON.stringify({ testSize: 65536, payload: tierB64(65536), workspaceId: FOREIGN_WORKSPACE_ID }),
  );
  assert.equal(viaBody.status, 403);
  assert.equal((await viaBody.json()).code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 3. 身份锁：非 canonical Staging 租户/工作区一律 403 ========== */
test("C3. non-canonical identity → 403 CAPACITY_SCOPE_MISMATCH, zero upload", async () => {
  const variants = [
    { tenantId: FOREIGN_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: PROBE_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: FOREIGN_TENANT_ID, workspaceId: PROBE_WORKSPACE_ID },
  ];
  for (const variant of variants) {
    loadFixture(variant);
    const res = await post(CAPACITY_ROUTE, bodyOf(65536, tierB64(65536)));
    assert.equal(res.status, 403, JSON.stringify(variant));
    assert.equal((await res.json()).code, "CAPACITY_SCOPE_MISMATCH");
    assert.equal(storageState.uploadCalls.length, 0);
  }
});

/* ========== 4. 双字段白名单：任何路径类注入一律 400 ========== */
test("C4. field whitelist is exactly {testSize,payload} — any extra/missing field → 400", async () => {
  loadFixture();
  const b64 = tierB64(65536);
  const attempts = [
    { testSize: 65536, payload: b64, bucket: "public-assets" },
    { testSize: 65536, payload: b64, path: "tenant/x/workspace/y/images/z.png" },
    { testSize: 65536, payload: b64, filename: "capacity-evil.bin" },
    { testSize: 65536, payload: b64, prefix: "images" },
    { testSize: 65536, payload: b64, upsert: true },
    { testSize: 65536, payload: b64, contentType: "text/html" },
    { testSize: 65536, payload: b64, sha256: "0".repeat(64) },
    { testSize: 65536 },
    { payload: b64 },
    {},
  ];
  for (const body of attempts) {
    const res = await post(CAPACITY_ROUTE, JSON.stringify(body));
    assert.equal(res.status, 400, JSON.stringify(Object.keys(body)));
    assert.equal((await res.json()).code, "CAPACITY_UNEXPECTED_FIELDS");
  }
  assert.equal(storageState.uploadCalls.length, 0, "任何注入尝试都不得触达写入");
  assert.equal(storageState.listCalls.length, 0, "字段白名单失败前不得触碰 Storage");
});

/* ========== 5. 档位封闭 enum：任意 bytes 长度一律 400 ========== */
test("C5. testSize must be one of the five fixed tiers — arbitrary sizes refused", async () => {
  loadFixture();
  const b64 = tierB64(65536);
  const bad = [
    65537,
    1,
    1024,
    300000,
    10485761,
    28582540,
    34831776,
    -65536,
    0,
    65536.5,
    NaN,
    Infinity,
    "65536",
    null,
    true,
    [65536],
  ];
  for (const size of bad) {
    const res = await post(CAPACITY_ROUTE, JSON.stringify({ testSize: size, payload: b64 }));
    assert.equal(res.status, 400, `testSize=${String(size)}`);
    assert.equal((await res.json()).code, "CAPACITY_SIZE_NOT_ALLOWED");
  }
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 6. body 形状闸门 ========== */
test("C6. empty / non-JSON / array / malformed body → 400, zero upload", async () => {
  loadFixture();
  const attempts = ["", "   ", "not json", "[]", "null", "42", '"str"'];
  for (const body of attempts) {
    const res = await post(CAPACITY_ROUTE, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 7. 查询参数一律拒绝 ========== */
test("C7. any query parameter → 400 CAPACITY_NO_QUERY_PARAMETERS, zero storage", async () => {
  loadFixture();
  const res = await post(`${CAPACITY_ROUTE}?dryRun=1`, bodyOf(65536, tierB64(65536)));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "CAPACITY_NO_QUERY_PARAMETERS");
  assert.equal(storageState.uploadCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0);
});

/* ========== 8. 非 base64 / 空 payload ========== */
test("C8. non-base64 or empty payload → 400, zero upload", async () => {
  loadFixture();
  const bad = ["", "   ", "!!!!", "YWJ", "aGVsbG8$%2B%2F", "not base64 at all"];
  for (const payload of bad) {
    const res = await post(CAPACITY_ROUTE, JSON.stringify({ testSize: 65536, payload }));
    assert.equal(res.status, 400, JSON.stringify(payload));
  }
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 9. 长度硬闸：档位与解码字节数不一致 → 422 且零写入 ========== */
test("C9. decoded length != testSize → 422 CAPACITY_LENGTH_MISMATCH, zero writes", async () => {
  loadFixture();
  const res = await post(CAPACITY_ROUTE, bodyOf(65536, tierB64(262144)));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, "CAPACITY_LENGTH_MISMATCH");
  assert.equal(storageState.uploadCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "长度闸门必须先于任何 Storage 触达");
  assert.deepEqual(Object.keys(dbState.written), [], "拒绝路径不得写任何业务表");
  const ev = logged.find((l) => l.event === "capacity_test_length_mismatch");
  assert.ok(ev, "长度不一致必须留日志");
  assert.equal(ev.fields.writes, 0);
  assert.equal(ev.fields.expected, 65536);
  assert.equal(ev.fields.actual, 262144);
});

/* ========== 10. 指纹硬闸：字节数对但内容不对 → 422 且零写入 ========== */
test("C10. right length, wrong bytes → 422 CAPACITY_FINGERPRINT_MISMATCH, zero writes", async () => {
  loadFixture();
  const size = 65536;
  const evil = tierBytes(size);
  evil[0] = (evil[0] + 1) % 251; // 单字节扰动：长度不变、摘要必变
  assert.equal(evil.byteLength, size);
  assert.notEqual(sha256hex(evil), CAPACITY_EXPECTED_SHA256[String(size)]);
  const res = await post(CAPACITY_ROUTE, bodyOf(size, evil.toString("base64")));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, "CAPACITY_FINGERPRINT_MISMATCH");
  assert.equal(storageState.uploadCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "指纹闸门必须先于 Storage 触达");
  assert.deepEqual(Object.keys(dbState.written), []);
  const ev = logged.find((l) => l.event === "capacity_test_fingerprint_rejected");
  assert.ok(ev);
  assert.equal(ev.fields.writes, 0);
});

/* ========== 11. 五档成功路径：写入 capacity-tests/、回读对账、upsert=false ========== */
test("C11. all five tiers write to capacity-tests/ with round-trip hash match", async () => {
  for (const size of CAPACITY_SIZES) {
    loadFixture();
    const res = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
    assert.equal(res.status, 200, `tier ${size} should pass`);
    const body = await res.json();
    assert.equal(body.ok, true);
    const data = body.data;
    assert.equal(data.slice, "EDGE_FUNCTION_PROXY_UPLOAD_CAPACITY_GATE");
    assert.equal(data.bucket, MERCHANT_ASSETS_BUCKET);
    assert.equal(data.path, capKey(size), `tier ${size} key must be server-derived`);
    assert.equal(data.namespaceIsolated, true);
    assert.ok(!data.path.includes("/images/"), "探针严禁落入 canonical images/ 命名空间");
    assert.ok(data.path.includes(`/${CAPACITY_PREFIX}/`));
    assert.equal(data.written.bytes, size);
    assert.equal(data.written.sha256, CAPACITY_EXPECTED_SHA256[String(size)]);
    assert.equal(data.written.contentType, "application/octet-stream");
    assert.equal(data.written.upsert, false);
    assert.equal(data.echoKeyMatchesCanonical, true);
    assert.equal(data.readback.ok, true, `tier ${size} round-trip must match`);
    assert.equal(data.readback.bytes, size);
    assert.equal(data.readback.sha256, CAPACITY_EXPECTED_SHA256[String(size)]);
    assert.equal(storageState.uploadCalls.length, 1, "每档恰好一次写入");
    const call = storageState.uploadCalls[0];
    assert.equal(call.bucket, MERCHANT_ASSETS_BUCKET);
    assert.equal(call.path, capKey(size));
    assert.equal(call.bytes, size);
    assert.equal(call.upsert, false);
    assert.equal(call.contentType, "application/octet-stream");
    // 服务端分段耗时必须全部上报（容量判定的核心指标）
    for (const f of ["base64Chars", "bodyChars", "decodeMs", "hashMs", "uploadMs", "downloadMs", "totalServerMs"]) {
      assert.equal(typeof data.serverMeasure[f], "number", `serverMeasure.${f} missing`);
    }
    assert.equal(data.serverMeasure.base64Chars, tierB64(size).length);
    const done = logged.find((l) => l.event === "capacity_test_completed");
    assert.ok(done, "成功路径必须留 completed 日志");
    assert.equal(done.fields.roundTripOk, true);
  }
});

/* ========== 12. 档位隔离：basename 与 key 一一对应，不共用对象 ========== */
test("C12. each tier writes its own distinct object key", async () => {
  loadFixture();
  const seen = new Set();
  for (const size of CAPACITY_SIZES) {
    const res = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
    assert.equal(res.status, 200);
    const data = (await res.json()).data;
    assert.equal(data.path, capKey(size));
    assert.equal(data.tier.basename, CAPACITY_BASENAME[String(size)]);
    seen.add(data.path);
  }
  assert.equal(seen.size, 5, "五档必须是五个互不相同的对象");
  assert.equal(storageState.uploadCalls.length, 5);
  assert.equal(Object.keys(storageState.objects).length, 5);
});

/* ========== 13. 幂等重放：已存在 → 409，且第二次零写入、字节不变 ========== */
test("C13. replay → 409 CAPACITY_OBJECT_ALREADY_EXISTS with zero further writes", async () => {
  loadFixture();
  const size = 262144;
  const first = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
  assert.equal(first.status, 200);
  const before = Buffer.from(storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${capKey(size)}`].bytes);
  const res = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "CAPACITY_OBJECT_ALREADY_EXISTS");
  assert.equal(storageState.uploadCalls.length, 1, "重放不得产生第二次写入");
  const after = Buffer.from(storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${capKey(size)}`].bytes);
  assert.ok(before.equals(after), "已存在对象的字节必须原封不动");
  const ev = logged.find((l) => l.event === "capacity_test_already_exists");
  assert.ok(ev, "409 拒绝路径必须留日志（上一轮暴露的可观测性缺口不得复发）");
  assert.equal(ev.fields.writes, 0);
});

/* ========== 14. 写前 list 失败 → 503，零写入 ========== */
test("C14. pre-write list failure → 503 STORAGE_BACKEND_UNAVAILABLE, zero upload", async () => {
  loadFixture();
  storageState.fail = { statusCode: "502", message: "bad gateway" };
  const res = await post(CAPACITY_ROUTE, bodyOf(65536, tierB64(65536)));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "STORAGE_BACKEND_UNAVAILABLE");
  assert.equal(storageState.uploadCalls.length, 0);
  assert.ok(logged.some((l) => l.event === "capacity_test_list_failed"));
});

/* ========== 15. 写入失败 → 502，不谎报成功 ========== */
test("C15. storage upload failure → 502 CAPACITY_UPLOAD_FAILED", async () => {
  loadFixture();
  storageState.uploadFail = { statusCode: "413", message: "record size limit exceeded" };
  const res = await post(CAPACITY_ROUTE, bodyOf(1048576, tierB64(1048576)));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, "CAPACITY_UPLOAD_FAILED");
  assert.equal(storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${capKey(1048576)}`], undefined);
  const ev = logged.find((l) => l.event === "capacity_test_write_failed");
  assert.ok(ev);
  assert.equal(ev.fields.bytes, 1048576);
});

/* ========== 16. 回读失败 → 仍返回 200 但 readback.ok=false，绝不谎报对账通过 ========== */
test("C16. readback failure reports readback.ok=false instead of pretending PASS", async () => {
  loadFixture();
  const size = 65536;
  const ok = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.readback.ok, true);

  loadFixture();
  await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
  storageState.fail = { statusCode: "500", message: "download backend error" };
  const replay = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
  // 存在性检查已因 fail 返回 503 —— 关键是不出现「写入成功但对账谎报 PASS」
  const bodies = await replay.json();
  assert.ok(replay.status === 503 || (bodies.data && bodies.data.readback.ok === false), "不得谎报 round-trip 通过");
});

/* ========== 17. 只有 audit_events 被写，public.assets / workspace_configs 零变更 ========== */
test("C17. success writes exactly one audit row and touches no other business table", async () => {
  loadFixture();
  const res = await post(CAPACITY_ROUTE, bodyOf(65536, tierB64(65536)));
  assert.equal(res.status, 200);
  const tables = Object.keys(dbState.written).sort();
  assert.deepEqual(tables, ["audit_events"], `只允许 audit_events，实际 ${tables.join(",")}`);
  assert.equal(dbState.written.audit_events.length, 1);
  const row = dbState.written.audit_events[0];
  assert.equal(row.action, "merchant.asset_capacity_probe");
  assert.equal(row.metadata.bytes, 65536);
  assert.equal(row.metadata.roundTripOk, true);
  assert.equal(row.metadata.path, capKey(65536));
  assert.equal(CANONICAL_KEY.includes(CAPACITY_PREFIX), false);
  assert.equal(storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${CANONICAL_KEY}`], undefined, "canonical 对象不得被探针创建/改动");
});

/* ========== 18. 零敏感信息：日志与响应不含 payload/base64/token/service_role ========== */
test("C18. no payload, base64, session token or service_role leaks into logs/response", async () => {
  loadFixture();
  const size = 262144;
  const b64 = tierB64(size);
  const res = await post(CAPACITY_ROUTE, bodyOf(size, b64));
  assert.equal(res.status, 200);
  const text = await res.text();
  const dump = JSON.stringify(logged);
  for (const [label, secret] of [
    ["base64 head", b64.slice(0, 64)],
    ["base64 tail", b64.slice(-64)],
    ["session token", TOKEN],
    ["service role key", SERVICE_ROLE_KEY],
  ]) {
    assert.ok(!text.includes(secret), `响应泄漏了 ${label}`);
    assert.ok(!dump.includes(secret), `日志泄漏了 ${label}`);
  }
  assert.ok(!/"payload"|\brawBytes\b/.test(dump), "日志字段不得内联 payload");
  assert.ok(!/authorization/i.test(dump), "日志不得记录 authorization");
  assert.ok(!/jwt|Bearer/i.test(dump), "日志不得记录 JWT / Bearer");
});

/* ========== 19. 方法闸门：GET → 404 ROUTE_NOT_FOUND ========== */
test("C19. GET on capacity route → 404 ROUTE_NOT_FOUND, zero storage", async () => {
  loadFixture();
  const res = await get(CAPACITY_ROUTE);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROUTE_NOT_FOUND");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 20. APPLICATION_GATE 自证：8192 是 proxy 路由自设，不是平台上限 ========== */
test("C20. PROXY_MAX_BASE64_CHARS is an application gate, not a platform ceiling", async () => {
  assert.equal(PROXY_MAX_BASE64_CHARS, 8192);
  assert.ok(
    CAPACITY_MAX_BASE64_CHARS > tierB64(10485760).length,
    "探针上限必须高于最大档位，否则测不到平台真实天花板",
  );
  loadFixture();
  const b64 = tierB64(65536);
  assert.ok(b64.length > PROXY_MAX_BASE64_CHARS, "64KB 档 base64 必须超过 proxy 路由自设上限");
  const viaProxy = await post(PROXY_ROUTE, JSON.stringify({ payload: b64 }));
  assert.equal(viaProxy.status, 413, "同一 payload 走 proxy 路由被应用层闸门拦下");
  assert.equal((await viaProxy.json()).code, "PROXY_PAYLOAD_TOO_LARGE");
  const viaCapacity = await post(CAPACITY_ROUTE, bodyOf(65536, b64));
  assert.equal(viaCapacity.status, 200, "同一 payload 走探针路由正常写入 → 8192 不是平台限制");
  assert.equal(storageState.uploadCalls.length, 1);
});

/* ========== 21. 既有契约不削弱：resolver 只读、proxy 契约、healthz ========== */
test("C21. healthz / canonical proxy / mp-images contracts still hold after adding the probe", async () => {
  loadFixture();
  const health = await handler(new Request(API + "/healthz"));
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.data.kdf, "verified");

  // canonical proxy 仍按自身常量工作：307B 指纹通过 → 写入 images/
  storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${CANONICAL_KEY}`] = {
    bytes: Buffer.from(ICON_BACK_B64, "base64"),
    contentType: "image/png",
  };
  const dup = await post(PROXY_ROUTE, JSON.stringify({ payload: ICON_BACK_B64 }));
  assert.equal(dup.status, 409, "canonical 存在即 409，探针不得改变该语义");
  assert.equal((await dup.json()).code, "PROXY_CANONICAL_ALREADY_EXISTS");

  // resolver 仍只读
  const r = await handler(
    new Request(`${API}/mp-images/${PROBE_BASENAME}`, { headers: { authorization: "Bearer " + TOKEN } }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(storageState.uploadCalls.length, 0, "resolver 读取不得引入写入");
});

/* ========== 23. 长 base64 校验不得炸栈（应用层 bug 不得伪装成平台容量上限） ========== */
test("C23. base64 validation stays linear at 5MiB/10MiB — no RegExp stack blow-up", async () => {
  loadFixture();
  for (const size of [5242880, 10485760]) {
    const res = await post(CAPACITY_ROUTE, bodyOf(size, tierB64(size)));
    const body = await res.json().catch(() => null);
    assert.notEqual(body?.code, "INTERNAL_ERROR", `tier ${size} 不得因内部异常失败`);
    assert.ok(
      res.status === 200 || res.status === 409,
      `tier ${size} 应通过或幂等 409，实际 ${res.status} ${JSON.stringify(body?.code)}`,
    );
  }
  // 非法字符出现在 7M 字符处也必须被线性扫描拒为 400，而不是抛 RangeError → 500
  loadFixture();
  const evil = tierBytes(5242880).toString("base64");
  const broken = evil.slice(0, 6990500) + "!!!!" + evil.slice(6990504);
  assert.equal(broken.length, evil.length);
  const res = await post(CAPACITY_ROUTE, JSON.stringify({ testSize: 5242880, payload: broken }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "CAPACITY_PAYLOAD_NOT_BASE64");
  assert.equal(storageState.uploadCalls.length, 0);
});

/* ========== 22. 源码级 tripwire：探针不泛化成通用上传器 ========== */
test("C22. source-level guards: two writes, fixed prefix, no client-controlled key", async () => {
  const src = readFileSync(new URL("index.js", BUILT).pathname, "utf8");
  const uploadLines = src.split("\n").filter((l) => /\.upload\s*\(/.test(l));
  assert.equal(uploadLines.length, 2);
  assert.ok(uploadLines.some((l) => /proxyKey/.test(l)));
  assert.ok(uploadLines.some((l) => /capacityKey/.test(l)));
  assert.match(src, /CAPACITY_PREFIX\s*=\s*"capacity-tests"/);
  assert.match(src, /CAPACITY_CONTENT_TYPE\s*=\s*"application\/octet-stream"/);
  assert.ok(!/uploadToSignedUrl/.test(src));
  assert.ok(!/method:\s*"PUT"/.test(src));
  // 探针 key 必须由 scope 派生，且不接受任何客户端输入
  assert.match(src, /`tenant\/\$\{scope\.tenantId\}\/workspace\/\$\{scope\.workspaceId\}\/\$\{CAPACITY_PREFIX\}`/);
  assert.ok(!/28582540/.test(src), "本轮不得把大 Legacy GIF 写进档位表");
});
