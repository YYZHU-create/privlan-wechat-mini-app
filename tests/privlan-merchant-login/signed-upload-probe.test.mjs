/**
 * SIGNED_UPLOAD_ISSUANCE_PROBE focused tests
 * —— 临时签发端点 POST /internal/storage/signed-upload-probe
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 被测对象是 build.mjs 机械转译后的真实函数体（同一份 index.ts），不是重写版。
 * 身份常量直接从被测模块导入（PROBE_TENANT_ID / PROBE_WORKSPACE_ID / PROBE_BASENAME），
 * 因此「夹具身份 == 生产闸门身份」是可证的，不是两份各写一遍的巧合。
 *
 * ⚠️ 本文件 PASS 只证明「探针的闸门、零参数、token 不外泄、upsert 固定、只签发不上传」正确，
 * 不构成「真实 service_role 在 0 policies 下签发成功」的证据 —— 那只能由线上一次真实签发定案。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);

/* ---------- 合成夹具（与真实商户数据无关） ---------- */
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const STORE_ID = "55555555-5555-4555-8555-555555555555";
/** 代表「其他商户 / Production」身份：与被测模块内的 canonical 常量必然不同 */
const FOREIGN_TENANT_ID = "99999999-9999-4999-8999-999999999999";
const FOREIGN_WORKSPACE_ID = "88888888-8888-4888-8888-888888888888";
const TOKEN = "synthetic-probe-session-token-0123456789abcdef";
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

const { PROBE_ROUTE, PROBE_TENANT_ID, PROBE_WORKSPACE_ID, PROBE_BASENAME, MERCHANT_ASSETS_BUCKET } = mod;
const CANONICAL_KEY = `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images/${PROBE_BASENAME}`;
/** fake 里固定的合成 token；断言它没有从任何出口泄漏 */
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

/* ========== 1. 匿名 → 401，且绝不触达签发 ========== */
test("1. anonymous probe → 401 AUTH_REQUIRED, zero signing, zero storage call", async () => {
  loadFixture();
  const res = await anonPost(PROBE_ROUTE);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, "AUTH_REQUIRED");
  assert.equal(storageState.signCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "未过会话闸门不得触碰 Storage");
});

/* ========== 2. 越权工作区 conflict → 403 ========== */
test("2. client-supplied foreign workspaceId → 403 WORKSPACE_ACCESS_DENIED, zero signing", async () => {
  loadFixture();
  const res = await post(`${PROBE_ROUTE}?workspaceId=${FOREIGN_WORKSPACE_ID}`);
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(storageState.signCalls.length, 0);
});

test("2b. client-supplied foreign tenantId → 403 WORKSPACE_ACCESS_DENIED", async () => {
  loadFixture();
  const res = await post(`${PROBE_ROUTE}?tenantId=${FOREIGN_TENANT_ID}`);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 3. 任意 filename → 拒绝 ========== */
test("3. arbitrary filename in body → 400 PROBE_NO_PARAMETERS, zero signing", async () => {
  loadFixture();
  const res = await post(PROBE_ROUTE, { body: JSON.stringify({ filename: "evil.png" }) });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.code, "PROBE_NO_PARAMETERS");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 4. 任意 storage key → 不可能 ========== */
test("4. arbitrary objectKey / path / key injection → rejected, canonical key never influenced", async () => {
  loadFixture();
  const attempts = [
    { objectKey: "tenant/x/workspace/y/images/z.png" },
    { path: "../../secret.png" },
    { key: "icon-back.png" },
    { storageObjectKey: CANONICAL_KEY },
    { prefix: "tenant" },
  ];
  for (const payload of attempts) {
    const res = await post(PROBE_ROUTE, { body: JSON.stringify(payload) });
    assert.equal(res.status, 400, `${JSON.stringify(payload)} 应被拒`);
    assert.equal((await res.json()).code, "PROBE_NO_PARAMETERS");
  }
  const viaQuery = await post(`${PROBE_ROUTE}?key=tenant%2Fevil%2Fx.png`);
  assert.equal(viaQuery.status, 400);
  assert.equal(storageState.signCalls.length, 0, "任何注入尝试都不得触达签发");
});

/* ========== 5. 任意 bucket → 不可能 ========== */
test("5. arbitrary bucket → rejected; only merchant-assets is reachable", async () => {
  loadFixture();
  const res = await post(PROBE_ROUTE, { body: JSON.stringify({ bucket: "avatars" }) });
  assert.equal(res.status, 400);
  assert.equal(storageState.signCalls.length, 0);

  loadFixture();
  await post(PROBE_ROUTE);
  assert.equal(MERCHANT_ASSETS_BUCKET, "merchant-assets");
  assert.deepEqual(
    storageState.signCalls.map((c) => c.bucket),
    ["merchant-assets"],
    "签发只可能落在 merchant-assets",
  );
  assert.deepEqual(
    storageState.listCalls.map((c) => c.bucket),
    ["merchant-assets", "merchant-assets"],
    "存在性检查前后各一次，同一个桶",
  );
});

/* ========== 6. canonical key 由服务端派生，逐字符精确 ========== */
test("6. canonical key is server-derived from session scope, byte-exact", async () => {
  loadFixture();
  const res = await post(PROBE_ROUTE);
  assert.equal(res.status, 200);
  assert.deepEqual(storageState.signCalls, [
    { bucket: MERCHANT_ASSETS_BUCKET, path: CANONICAL_KEY, upsert: false },
  ]);
  assert.equal(
    storageState.signCalls[0].path,
    `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images/${PROBE_BASENAME}`,
  );
  const body = await res.json();
  assert.equal(body.data.returnedPathEqualsCanonical, true);
  assert.equal(body.data.signedUrlPathContainsCanonicalKey, true);
  assert.equal(body.data.signedUrlHostIsStorageRoot, true);
});

test("6b. existence check happens strictly BEFORE signing", async () => {
  loadFixture();
  await post(PROBE_ROUTE);
  assert.equal(storageState.listCalls.length, 2);
  assert.equal(storageState.listCalls[0].prefix, `tenant/${PROBE_TENANT_ID}/workspace/${PROBE_WORKSPACE_ID}/images`);
  assert.equal(storageState.listCalls[0].search, PROBE_BASENAME);
});

/* ========== 7. upsert 固定 false，客户端无法翻转 ========== */
test("7. upsert is hard-fixed to false and cannot be flipped by the client", async () => {
  loadFixture();
  const res = await post(PROBE_ROUTE, { body: JSON.stringify({ upsert: true }) });
  assert.equal(res.status, 400, "带任何参数一律拒绝");
  assert.equal(storageState.signCalls.length, 0);

  loadFixture();
  const ok = await post(PROBE_ROUTE);
  assert.equal(ok.status, 200);
  assert.equal(storageState.signCalls[0].upsert, false);
  assert.equal((await ok.json()).data.upsertRequested, false);
});

/* ========== 8. service_role / 会话 token / canonical key 一律不外泄 ========== */
test("8. response never carries service_role key, session token, tenant/workspace id or canonical key", async () => {
  loadFixture();
  const res = await post(PROBE_ROUTE);
  const text = await res.text();
  assert.ok(!text.includes(SERVICE_ROLE_KEY), "service_role key 不得出现");
  assert.ok(!text.includes(TOKEN), "会话 token 不得出现");
  assert.ok(!text.includes(PROBE_TENANT_ID), "tenantId 不得回显");
  assert.ok(!text.includes(PROBE_WORKSPACE_ID), "workspaceId 不得回显");
  assert.ok(!text.includes(CANONICAL_KEY), "canonical key 不得回显");
  assert.ok(!text.includes(USER_ID), "userId 不得回显");
});

/* ========== 9. signed token 不落日志、不落库、不进响应 ========== */
test("9. signed token is never logged, never persisted, never returned", async () => {
  loadFixture();
  storageState.signCreatesRow = true;
  const res = await post(PROBE_ROUTE);
  const body = await res.json();
  assert.equal(body.data.issued, true);
  assert.equal(body.data.tokenDiscarded, true);
  assert.equal(typeof body.data.tokenLength, "number", "只允许给长度，不允许给内容");

  const responseText = JSON.stringify(body);
  assert.ok(!responseText.includes(SYNTHETIC_SIGNED_TOKEN), "token 不得出现在响应体");
  assert.ok(!responseText.includes("object/upload/sign"), "签发路由字面量不得出现在响应体");
  // 比「字段名不含 signedUrl」更强且无误报：响应体里不允许出现任何 URL / 主机 / query 形态。
  // 布尔字段名（signedUrlHostIsStorageRoot 等）是结论，不是值，允许存在。
  assert.ok(!responseText.includes("https://"), "响应体不得含任何绝对 URL");
  assert.ok(!responseText.includes("mock.invalid"), "响应体不得回显存储主机");
  assert.ok(!responseText.includes("token="), "响应体不得含任何 token query 形态");
  assert.ok(!/signedUrl"\s*:/.test(responseText), "响应体不得有 signedUrl 值字段");

  const logText = JSON.stringify(logged);
  assert.ok(!logText.includes(SYNTHETIC_SIGNED_TOKEN), "token 不得出现在日志");
  assert.ok(!logText.includes("object/upload/sign"), "signedUrl 不得出现在日志");
  assert.ok(!logText.includes(SERVICE_ROLE_KEY), "service_role 不得出现在日志");
  assert.ok(!logText.includes(CANONICAL_KEY), "canonical key 不得出现在日志");

  assert.deepEqual(Object.keys(dbState.written), [], "token 不得落任何业务表");
});

/* ========== 10. canonical 已存在 → 拒绝二次签发 ========== */
test("10. canonical object already exists → 409, refuses to sign a second time", async () => {
  loadFixture();
  storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${CANONICAL_KEY}`] = {
    bytes: new Uint8Array(0),
    contentType: "application/octet-stream",
  };
  const res = await post(PROBE_ROUTE);
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, "PROBE_CANONICAL_ALREADY_EXISTS");
  assert.equal(storageState.signCalls.length, 0, "已存在则绝不签发");
});

test("10b. second probe after a row-creating issuance → 409, storage.objects delta stays 1", async () => {
  loadFixture();
  storageState.signCreatesRow = true;
  const first = await post(PROBE_ROUTE);
  assert.equal(first.status, 200);
  const second = await post(PROBE_ROUTE);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "PROBE_CANONICAL_ALREADY_EXISTS");
  assert.equal(storageState.signCalls.length, 1, "全程只允许签发一次");
  assert.equal(
    Object.keys(storageState.objects).filter((k) => k.startsWith(`${MERCHANT_ASSETS_BUCKET}/`)).length,
    1,
    "storage.objects 增量不得超过 1",
  );
});

test("10c. flat residue at bucket root does NOT satisfy the canonical existence check", async () => {
  loadFixture();
  // 复刻线上现状：面板上传留下的根级扁平残留
  storageState.objects[`${MERCHANT_ASSETS_BUCKET}/${PROBE_BASENAME}`] = {
    bytes: new Uint8Array(307),
    contentType: "image/png",
  };
  const res = await post(PROBE_ROUTE);
  assert.equal(res.status, 200, "扁平残留与 canonical 路径互不相干，不得误判为已存在");
  assert.deepEqual(storageState.signCalls, [
    { bucket: MERCHANT_ASSETS_BUCKET, path: CANONICAL_KEY, upsert: false },
  ]);
});

/* ========== 11. 非 canonical 身份（含 Production）→ 拒绝 ========== */
test("11. foreign tenant + workspace identity → 403 PROBE_SCOPE_MISMATCH", async () => {
  loadFixture({ tenantId: FOREIGN_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID });
  const res = await post(PROBE_ROUTE);
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "PROBE_SCOPE_MISMATCH");
  assert.equal(storageState.signCalls.length, 0);
  assert.equal(storageState.listCalls.length, 0, "身份不符时连 Storage 都不得触碰");
});

test("11b. canonical tenant but foreign workspace → 403 PROBE_SCOPE_MISMATCH", async () => {
  loadFixture({ tenantId: PROBE_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID });
  const res = await post(PROBE_ROUTE);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "PROBE_SCOPE_MISMATCH");
  assert.equal(storageState.signCalls.length, 0);
});

test("11c. foreign tenant but canonical workspace → 403 PROBE_SCOPE_MISMATCH", async () => {
  loadFixture({ tenantId: FOREIGN_TENANT_ID, workspaceId: PROBE_WORKSPACE_ID });
  const res = await post(PROBE_ROUTE);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "PROBE_SCOPE_MISMATCH");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 12. 既有 Auth / resolver 回归仍 PASS ========== */
test("12. existing auth + resolver regression remains PASS after adding the probe", async () => {
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
  assert.deepEqual(storageState.calls, [{ bucket: MERCHANT_ASSETS_BUCKET, key: CANONICAL_KEY }]);

  const blocked = await post("/api/config", { body: JSON.stringify({ document: {} }) });
  assert.equal(blocked.status, 410, "只读闸门不得被探针削弱");
  assert.equal((await blocked.json()).code, "READ_ONLY_CANDIDATE");
});

test("12b. non-POST on the probe route stays 404 (route existence not disclosed)", async () => {
  loadFixture();
  const res = await get(PROBE_ROUTE);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROUTE_NOT_FOUND");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 13. 签发失败 → 502 + 非敏感分类，绝不回显存储侧原文 ========== */
test("13. issuance failure → 502 with non-sensitive classifiers, raw storage message never echoed", async () => {
  loadFixture();
  storageState.signFail = {
    statusCode: "403",
    code: "42501",
    message: "new row violates row-level security policy for storage.objects",
  };
  const res = await post(PROBE_ROUTE);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.code, "SIGNED_UPLOAD_ISSUANCE_FAILED");
  assert.equal(body.data.issued, false);
  assert.equal(body.data.bytesUploaded, 0);
  assert.equal(body.data.classifiers.clsRlsViolation, true);
  assert.equal(body.data.classifiers.errStatus, "403");
  const text = JSON.stringify(body);
  assert.ok(!text.includes("storage.objects"), "不得回显存储侧原文");
  assert.ok(!text.includes("row-level security policy for"), "不得回显存储侧原文");
  assert.ok(!text.includes(CANONICAL_KEY));
});

test("13b. already-exists failure at signing time is classified distinctly from RLS", async () => {
  loadFixture();
  storageState.signFail = { statusCode: "409", message: "The resource already exists" };
  const body = await (await post(PROBE_ROUTE)).json();
  assert.equal(body.data.classifiers.clsAlreadyExists, true);
  assert.equal(body.data.classifiers.clsRlsViolation, false);
});

/* ========== 14. 源码级：探针路由自身绝无上传（写入面收窄到 proxy + capacity 两点） ========== */
test("14. probe route stays upload-free — server-side writes are limited to proxy-upload and capacity-test", async () => {
  const src = readFileSync(new URL("index.js", BUILT), "utf8");
  assert.ok(!/uploadToSignedUrl/.test(src), "服务端严禁出现浏览器侧签名上传 API");
  assert.ok(!/method:\s*"PUT"/.test(src), "服务端严禁任何 PUT");
  const uploadLines = src.split("\n").filter((l) => /\.upload\s*\(/.test(l));
  assert.equal(uploadLines.length, 2, "全函数只允许 proxy-upload 与 proxy-capacity-test 两处服务端写入调用");
  assert.ok(uploadLines.some((l) => /proxyKey/.test(l)), "canonical 写入绑定 proxyKey");
  assert.ok(uploadLines.some((l) => /capacityKey/.test(l)), "容量探针写入绑定 capacityKey");
  assert.match(src, /createSignedUploadUrl\(/, "签发能力保留");
  assert.match(src, /MERCHANT_ASSETS_BUCKET\s*=\s*"merchant-assets"/);
});

/* ========== 15. 签发前 list 失败 → 503，零签发 ========== */
test("15. pre-signing list failure → 503 STORAGE_BACKEND_UNAVAILABLE, zero signing", async () => {
  loadFixture();
  storageState.fail = { statusCode: "502", message: "bad gateway" };
  const res = await post(PROBE_ROUTE);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "STORAGE_BACKEND_UNAVAILABLE");
  assert.equal(storageState.signCalls.length, 0);
});

/* ========== 16. 全路径业务库零写入 ========== */
test("16. probe writes nothing to any business table on every path", async () => {
  const variants = [
    {},
    { tenantId: FOREIGN_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
    { tenantId: PROBE_TENANT_ID, workspaceId: FOREIGN_WORKSPACE_ID },
  ];
  for (const variant of variants) {
    loadFixture(variant);
    storageState.signCreatesRow = true;
    await post(PROBE_ROUTE);
    await post(PROBE_ROUTE, { body: JSON.stringify({ filename: "x.png" }) });
    await post(`${PROBE_ROUTE}?workspaceId=${FOREIGN_WORKSPACE_ID}`);
    await anonPost(PROBE_ROUTE);
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

/* ========== 17/18. 签发后残留的两种真实分支都必须可判读 ========== */
test("17. signing pre-creates a row → diagnostics report it without returning bytes", async () => {
  loadFixture();
  storageState.signCreatesRow = true;
  const body = await (await post(PROBE_ROUTE)).json();
  assert.equal(body.data.objectRowCreated, true);
  assert.equal(body.data.listedObjectCount, 1);
  assert.equal(body.data.listedSize, 0);
  assert.equal(body.data.resolverDownloadAfterSigning.ok, true);
  assert.equal(body.data.resolverDownloadAfterSigning.byteLength, 0);
  assert.equal(body.data.resolverDownloadAfterSigning.statusCode, "200");
  assert.equal(body.data.bytesUploaded, 0);
  assert.ok(!JSON.stringify(body).includes(CANONICAL_KEY));
});

test("18. signing does NOT pre-create a row → delta 0 path is equally readable", async () => {
  loadFixture();
  storageState.signCreatesRow = false;
  const body = await (await post(PROBE_ROUTE)).json();
  assert.equal(body.data.issued, true);
  assert.equal(body.data.objectRowCreated, false);
  assert.equal(body.data.listedObjectCount, 0);
  assert.equal(body.data.listedSize, null);
  assert.equal(body.data.resolverDownloadAfterSigning.ok, false);
  assert.equal(body.data.resolverDownloadAfterSigning.statusCode, "404");
});

/* ========== 19. 写入闸门关闭时探针必须一起关 ========== */
test("19. instance write gate closed → probe refused 503, zero signing", async () => {
  loadFixture();
  const original = globalThis.__DenoEnv;
  globalThis.__DenoEnv = {
    get: (k) => (k === "MEOO_WRITES_ENABLED" ? "false" : original.get(k)),
  };
  try {
    const res = await post(PROBE_ROUTE);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "SESSION_BACKEND_READONLY");
    assert.equal(storageState.signCalls.length, 0);
  } finally {
    globalThis.__DenoEnv = original;
  }
});
