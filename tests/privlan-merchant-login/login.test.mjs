/**
 * privlan-merchant-api 登录可靠性修复的 focused tests（B 主路径 + A 兜底 + 错误可观测性）
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 被测对象是 build.mjs 机械转译后的真实函数体（同一份 index.ts），不是重写版。
 * 所有口令、账号、tenant/workspace id 均为本地合成值，不来自任何真实商户数据。
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);

/* ---------- 本地合成夹具（与真实数据无关） ---------- */
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const FOREIGN_WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const STORE_ID = "55555555-5555-4555-8555-555555555555";
const LOGIN = "candidate-test@example.invalid";
const PASSWORD = "local-synthetic-password-0001";
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

/** 与原实现同形状：base64(salt16)+"."+base64(scrypt64)，共 113 字符 */
function makeStoredHash(password) {
  const salt = randomBytes(16);
  const hash = require_crypto_scrypt(password, salt);
  return `${salt.toString("base64")}.${Buffer.from(hash).toString("base64")}`;
}
function require_crypto_scrypt(password, salt) {
  // 与 fake-scrypt.ts 同一实现，保证 verifyPassword 能对上
  const { scryptSync } = globalThis.__nodeCrypto;
  return scryptSync(Buffer.from(password), Buffer.from(salt), 64, {
    cost: 16384,
    blockSize: 8,
    parallelization: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
const sha256hex = (v) => createHash("sha256").update(v).digest("hex");

/* ---------- 结构化日志捕获 ---------- */
const logged = [];
const realError = console.error;
const realWarn = console.warn;
console.error = (...args) => logged.push({ level: "error", event: args[0], fields: args[1] });
console.warn = (...args) => logged.push({ level: "warn", event: args[0], fields: args[1] });
const hasEvent = (event) => logged.some((l) => l.event === event);
const eventOf = (event) => logged.find((l) => l.event === event);

/* ---------- 可控 env（用于注入「token 下发前异常」） ---------- */
let throwOnEnvKey = null;
const ENV = { SUPABASE_URL: "https://mock.invalid", SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key" };
globalThis.__DenoEnv = {
  get(key) {
    if (throwOnEnvKey === key) throw new Error("injected failure before token delivery");
    return ENV[key];
  },
};

let handler = null;
/** 捕获被测模块底部的 Deno.serve(...)，不真的起服务 */
globalThis.__DenoServe = (cb) => {
  handler = cb;
};
const { dbState, resetDb } = await import(new URL("fake-supabase.js", BUILT).href);
globalThis.__nodeCrypto = await import("node:crypto");
const mod = await import(new URL("index.js", BUILT).href);
/** 与生产 Deno.serve 外层同构：抛出的 ServiceError 必须被转成 HTTP 响应，而不是逃到测试里 */
handler = (req) => mod.handle(req).catch((error) => mod.failure(error, mod.newRequestId("test")));

function loadFixture(overrides = {}) {
  resetDb();
  logged.length = 0;
  throwOnEnvKey = null;
  const o = { ...overrides };
  dbState.rows = {
    users: [
      {
        id: USER_ID,
        login_identifier: LOGIN,
        password_hash: o.passwordHash ?? makeStoredHash(PASSWORD),
        display_name: "候选测试账号",
        avatar_url: "https://avatar.invalid/a.png",
        status: o.userStatus ?? "active",
      },
    ],
    memberships: o.noMembership
      ? []
      : [
          {
            user_id: USER_ID,
            tenant_id: TENANT_ID,
            workspace_id: WORKSPACE_ID,
            role: "owner",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
    workspaces: [
      { id: WORKSPACE_ID, tenant_id: TENANT_ID, name: "候选工作区", plan_id: "PRO" },
      { id: FOREIGN_WORKSPACE_ID, tenant_id: TENANT_ID, name: "其他工作区", plan_id: "PRO" },
    ],
    tenants: [{ id: TENANT_ID, status: o.tenantStatus ?? "active" }],
    stores: o.noStore
      ? []
      : [{ id: STORE_ID, workspace_id: WORKSPACE_ID, name: "候选门店", public_store_id: "pub-1" }],
    subscriptions: [
      {
        id: "sub-1",
        workspace_id: WORKSPACE_ID,
        plan_id: o.planId ?? "PRO_LEGACY",
        status: o.subStatus ?? "active",
        started_at: "2026-01-01T00:00:00Z",
        expires_at: o.expiresAt ?? null,
        source: "legacy",
      },
    ],
    workspace_configs: [{ workspace_id: WORKSPACE_ID, tenant_id: TENANT_ID, document: { products: [1, 2, 3] }, version: 9 }],
    merchant_sessions: o.sessions ?? [],
    audit_events: [],
    merchant_ai_policies: [],
  };
}

async function call(path, init = {}) {
  const res = await handler(new Request(`https://candidate.test${path}`, init));
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}
const post = (path, payload, headers = {}) =>
  call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
const login = (password = PASSWORD) => post("/auth/login", { login: LOGIN, password });
const audits = (action) => (dbState.written["audit_events"] || []).filter((r) => r.action === action);
const sessions = () => dbState.written["merchant_sessions"] || [];
const selectCount = (table) => dbState.calls.filter((c) => c.table === table && c.op === "select").length;
const insertCount = (table) => dbState.calls.filter((c) => c.table === table && c.op === "insert").length;
const retryEvents = () => logged.filter((l) => l.event === "transient_read_retried");

/* ================= 方案 B：成功路径与写序 ================= */

test("1 正常登录：HTTP 200 + token 下发 + session/audit 各 1 条", async () => {
  loadFixture();
  const { status, body } = await login();
  assert.equal(status, 200);
  assert.equal(body.code, "OK");
  assert.ok(body.data.session.token.length >= 40, "token 应已下发");
  assert.equal(sessions().length, 1);
  assert.equal(audits("merchant.login").length, 1);
  assert.equal(audits("merchant.login_failed").length, 0);
});

test("2 登录不再读回刚写入的 merchant_sessions（read-after-write 已消除）", async () => {
  loadFixture();
  await login();
  const readBack = dbState.calls.filter((c) => c.table === "merchant_sessions" && c.op === "select");
  assert.deepEqual(readBack, [], "B 之后登录路径不应再出现对 merchant_sessions 的 SELECT");
});

test("3 成功响应严格由服务端 canonical scope 决定", async () => {
  loadFixture();
  const { body } = await login();
  assert.equal(body.data.user.id, USER_ID);
  assert.equal(body.data.user.role, "owner");
  assert.equal(body.data.user.avatarUrl, "https://avatar.invalid/a.png", "login 的 users SELECT 必须含 avatar_url");
  assert.equal(body.data.workspace.id, WORKSPACE_ID);
  assert.equal(body.data.workspace.tenantId, TENANT_ID);
  assert.equal(body.data.workspace.storeId, STORE_ID);
  assert.equal(body.data.subscription.status, "active");
});

test("4 既有语义保持：登录体内 planId 不做 PRO_LEGACY→PRO 映射", async () => {
  loadFixture();
  const { body } = await login();
  assert.equal(body.data.subscription.planId, "PRO_LEGACY");
});

test("5 audit 语义保持：resource_id 仍为 null，仅 metadata 新增 sessionId", async () => {
  loadFixture();
  const { body } = await login();
  const row = audits("merchant.login")[0];
  assert.equal(row.resource_id, null);
  assert.equal(row.resource_type, "merchant_session");
  assert.equal(row.actor_type, "merchant");
  assert.equal(row.metadata.sessionId, sessions()[0].id, "metadata.sessionId 应指向本次新建会话");
  assert.ok(body.data.session.token && !JSON.stringify(row).includes(body.data.session.token), "audit 不得记录 token");
});

/* ================= 错误可观测性：db_error 不再压成 null ================= */

test("6 scope 构造期瞬时读错误：503 且零写入（不再留下孤儿会话）", async () => {
  for (const table of ["memberships", "workspaces", "tenants", "stores", "subscriptions"]) {
    loadFixture();
    // 注入 3 次 = 三次尝试全部失败；只注入 1–2 次会被有界重试吸收（见 test 22/27）
    dbState.fail[`${table}:select`] = 3;
    const { status, body } = await login();
    assert.equal(status, 503, `${table} 持续读失败应 503 而非 500/401`);
    assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
    assert.equal(sessions().length, 0, `${table} 读失败时不得写 session`);
    assert.equal(audits("merchant.login").length, 0, `${table} 读失败时不得写成功审计`);
  }
  assert.ok(hasEvent("login_scope_build_failed"), "必须留下结构化 error");
  assert.equal(eventOf("login_scope_build_failed").fields.writes, 0);
  assert.ok(eventOf("login_scope_build_failed").fields.dbCode, "日志须含 DB error code");
});

test("7 日志字段白名单：不出现 token / 口令 / password_hash", async () => {
  loadFixture();
  dbState.fail["workspaces:select"] = 3;
  await login();
  dbState.fail["merchant_sessions:update"] = 2;
  throwOnEnvKey = "NODE_ENV";
  await login();
  const dump = JSON.stringify(logged);
  for (const secret of [PASSWORD, "password_hash", "token_hash", "mock-service-role-key"]) {
    assert.ok(!dump.includes(secret), `日志不得含 ${secret}`);
  }
});

test("8 已认证路径：读错误返回 503，真空未命中仍 401", async () => {
  const token = "synthetic-session-token-a".repeat(3);
  loadFixture({
    sessions: [
      {
        id: "sess-1",
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        csrf_token_hash: sha256hex("csrf-1"),
        token_hash: sha256hex(token),
        expires_at: FUTURE,
        revoked_at: null,
      },
    ],
  });
  const auth = { authorization: `Bearer ${token}` };
  const ok = await call("/auth/session", { headers: auth });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.workspace.id, WORKSPACE_ID);

  dbState.fail["memberships:select"] = 3;
  const broken = await call("/auth/session", { headers: auth });
  assert.equal(broken.status, 503);
  assert.equal(broken.body.code, "SESSION_LOOKUP_UNAVAILABLE");
  assert.ok(hasEvent("session_lookup_failed"));

  const forged = await call("/auth/session", { headers: { authorization: "Bearer " + "z".repeat(43) } });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.code, "AUTH_REQUIRED");
  const anon = await call("/auth/session");
  assert.equal(anon.status, 401);
});

/* ================= 方案 A：补偿撤销 ================= */

test("9 token 下发前异常：新 session 被补偿 revoke（仅该单行）", async () => {
  loadFixture();
  throwOnEnvKey = "NODE_ENV";
  const { status, body } = await login();
  assert.equal(status, 500);
  assert.equal(body.ok, false, "不得伪装成功");

  const created = sessions()[0];
  assert.ok(created, "session 确实已创建");
  const updates = dbState.calls.filter((c) => c.table === "merchant_sessions" && c.op === "update");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].filters, [`eq(id,${created.id})`], "revoke 范围必须收窄到本次单行");
  assert.ok(updates[0].values.revoked_at, "revoked_at 应被置位");
  assert.equal(audits("merchant.login_session_revoked").length, 1);
  assert.equal(audits("merchant.login_session_revoked")[0].resource_id, created.id);
  assert.ok(hasEvent("login_session_compensated"));
});

test("10 补偿 revoke 自身失败：重试一次后留结构化 error，仍返回失败", async () => {
  loadFixture();
  dbState.fail["merchant_sessions:update"] = 2;
  throwOnEnvKey = "NODE_ENV";
  const { status } = await login();
  assert.equal(status, 500);

  const updates = dbState.calls.filter((c) => c.table === "merchant_sessions" && c.op === "update");
  assert.equal(updates.length, 2, "应重试一次");
  assert.ok(hasEvent("login_compensation_failed"));
  assert.equal(eventOf("login_compensation_failed").fields.attempts, 2);
  assert.ok(eventOf("login_compensation_failed").fields.dbCode);
  assert.equal(audits("merchant.login_session_revoked").length, 0, "撤销未成功就不该写成功审计");
});

test("11 session 创建失败：不得产生成功审计", async () => {
  loadFixture();
  dbState.fail["merchant_sessions:insert"] = 1;
  const { status, body } = await login();
  assert.equal(status, 500);
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.equal(audits("merchant.login").length, 0);
  assert.ok(hasEvent("session_insert_failed"));
});

/* ================= 门禁不得降级 ================= */

test("12 口令错误 → 401 且只写 login_failed；用户不存在同形", async () => {
  loadFixture();
  const bad = await login("wrong-password");
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "INVALID_CREDENTIALS");
  assert.equal(sessions().length, 0);
  assert.equal(audits("merchant.login_failed").length, 1);

  loadFixture({ userStatus: "suspended" });
  const suspended = await login();
  assert.equal(suspended.status, 401, "非 active 用户仍按不泄露存在性的 401 处理");
});

test("13 无 membership → 403 且零写入", async () => {
  loadFixture({ noMembership: true });
  const { status, body } = await login();
  assert.equal(status, 403);
  assert.equal(body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(sessions().length, 0);
  assert.equal(audits("merchant.login").length, 0);
});

test("14 有效会话下跨 workspace 仍 403，租户暂停仍 403", async () => {
  const token = "synthetic-session-token-b".repeat(3);
  const sess = {
    id: "sess-2",
    user_id: USER_ID,
    workspace_id: WORKSPACE_ID,
    csrf_token_hash: sha256hex("csrf-2"),
    token_hash: sha256hex(token),
    expires_at: FUTURE,
    revoked_at: null,
  };
  loadFixture({ sessions: [sess] });
  const auth = { authorization: `Bearer ${token}` };
  const conflict = await call(`/api/config?workspaceId=${FOREIGN_WORKSPACE_ID}`, { headers: auth });
  assert.equal(conflict.status, 403);
  assert.equal(conflict.body.code, "WORKSPACE_ACCESS_DENIED");

  loadFixture({ sessions: [sess], tenantStatus: "suspended" });
  const suspended = await call("/api/platform/bootstrap", { headers: auth });
  assert.equal(suspended.status, 403);
  assert.equal(suspended.body.code, "TENANT_SUSPENDED");
});

test("15 已撤销 / 已过期会话不再可用", async () => {
  const token = "synthetic-session-token-c".repeat(3);
  loadFixture({
    sessions: [
      {
        id: "sess-3",
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        csrf_token_hash: sha256hex("csrf-3"),
        token_hash: sha256hex(token),
        expires_at: FUTURE,
        revoked_at: new Date().toISOString(),
      },
    ],
  });
  const { status } = await call("/auth/session", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(status, 401);
});

/* ================= 有界幂等只读重试（MAX_RETRIES=1） ================= */

test("16 首次 SELECT 瞬时失败、第二次成功 → HTTP 200", async () => {
  loadFixture();
  dbState.fail["workspaces:select"] = 1;
  const { status, body } = await login();
  assert.equal(status, 200);
  assert.equal(body.data.workspace.id, WORKSPACE_ID);
  assert.equal(selectCount("workspaces"), 2, "应恰好重试一次，不得更多");
  assert.equal(sessions().length, 1);
});

test("17 三次尝试全部失败 → HTTP 503 且零写入", async () => {
  loadFixture();
  dbState.fail["workspaces:select"] = 3;
  const { status, body } = await login();
  assert.equal(status, 503);
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
  assert.equal(selectCount("workspaces"), 3, "总尝试次数必须封顶在 READ_MAX_ATTEMPTS=3");
  assert.equal(sessions().length, 0);
  assert.equal(audits("merchant.login").length, 0);
});

test("18 403 类（membership 确实不存在）不重试", async () => {
  loadFixture({ noMembership: true });
  const { status } = await login();
  assert.equal(status, 403);
  assert.equal(selectCount("memberships"), 1, "无行是决定性结果，不得重试");
  assert.equal(retryEvents().length, 0);
});

test("19 已撤销 / 已过期会话不重试，仍按原语义 401", async () => {
  const base = { user_id: USER_ID, workspace_id: WORKSPACE_ID };
  const revoked = "synthetic-session-token-d1".repeat(3);
  const expired = "synthetic-session-token-d2".repeat(3);
  loadFixture({
    sessions: [
      { ...base, id: "sess-4", csrf_token_hash: sha256hex("csrf-4"), token_hash: sha256hex(revoked), expires_at: FUTURE, revoked_at: new Date().toISOString() },
      { ...base, id: "sess-5", csrf_token_hash: sha256hex("csrf-5"), token_hash: sha256hex(expired), expires_at: PAST, revoked_at: null },
    ],
  });
  assert.equal((await call("/auth/session", { headers: { authorization: `Bearer ${revoked}` } })).status, 401);
  assert.equal((await call("/auth/session", { headers: { authorization: `Bearer ${expired}` } })).status, 401);
  assert.equal(selectCount("merchant_sessions"), 2, "两次请求各一次 SELECT，未发生重试");
  assert.equal(retryEvents().length, 0);
});

test("20 正常查询结果为空（stores 无行）不重试，仍按原语义成功", async () => {
  loadFixture({ noStore: true });
  const { status, body } = await login();
  assert.equal(status, 200);
  assert.equal(body.data.workspace.storeId, null, "无门店沿用原 LEFT JOIN 语义，不是错误");
  assert.equal(selectCount("stores"), 1);
  assert.equal(retryEvents().length, 0);
});

test("21 INSERT / UPDATE 永远不进入 retry helper", async () => {
  loadFixture();
  dbState.fail["merchant_sessions:insert"] = 1;
  const { status } = await login();
  assert.equal(status, 500);
  assert.equal(insertCount("merchant_sessions"), 1, "会话写入失败不得自动重试（会产生重复会话）");
  assert.equal(retryEvents().length, 0);

  /*
   * v12.1 契约变更：授予侧（merchant.login）审计写失败不再返回 200，而是 503 +
   * 按主键补偿撤销刚签发的会话、token 不下发（用户裁定：只升级成功授予路径）。
   * 本用例的原始目的「INSERT/UPDATE 不进 retry helper」完全保留，只是状态码预期翻转：
   * 审计 insert 尝试数 = 2（失败的成功审计 + 补偿撤销审计），仍然零重试。
   */
  loadFixture();
  dbState.fail["audit_events:insert"] = 1;
  const denied = await login();
  assert.equal(denied.status, 503);
  assert.equal(denied.body.code, "AUDIT_WRITE_UNAVAILABLE");
  assert.equal(insertCount("audit_events"), 2, "成功审计 + 补偿审计各尝试一次，均不得自动重试");
  assert.equal(retryEvents().length, 0);
  assert.ok(hasEvent("audit_insert_failed"));
});

test("22 第二次成功仍生成一次 transient-read 日志，且字段全在白名单内", async () => {
  loadFixture();
  dbState.fail["subscriptions:select"] = 1;
  const { status } = await login();
  assert.equal(status, 200);
  const events = retryEvents();
  assert.equal(events.length, 1, "恢复成功也必须留痕，且只留一条");
  assert.equal(events[0].level, "warn", "恢复成功是 warn；两次都失败才是 error");
  const f = events[0].fields;
  assert.deepEqual(
    Object.keys(f).sort(),
    ["attempts", "dbCode", "event", "httpStatus", "kind", "operation", "recovered", "requestId", "stage"],
    "字段集合必须恰好等于白名单（event 由 logEvent 自身写入 payload）",
  );
  assert.equal(f.event, "transient_read_retried");
  assert.equal(f.recovered, true);
  assert.equal(f.kind, "transport");
  assert.equal(f.attempts, 2);
  assert.equal(f.stage, "subscriptions");
  assert.equal(f.operation, "resolve_scope");
  assert.ok(f.requestId);
  const dump = JSON.stringify(events);
  for (const secret of [PASSWORD, "password_hash", "token_hash", "csrf", "mock-service-role-key", LOGIN]) {
    assert.ok(!dump.includes(secret), `日志不得含 ${secret}`);
  }
});

test("23 决定性 SQLSTATE（42P01 缺表）不重试，errKind 留痕为 db", async () => {
  loadFixture();
  dbState.errors["tenants:select"] = { code: "42P01", message: "relation does not exist" };
  dbState.fail["tenants:select"] = 1;
  const { status, body } = await login();
  assert.equal(status, 503);
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
  assert.equal(selectCount("tenants"), 1, "缺表是决定性错误，重试只会放大故障");
  assert.equal(retryEvents().length, 0);
  assert.equal(eventOf("login_scope_build_failed").fields.errKind, "db");
  assert.equal(eventOf("login_scope_build_failed").fields.dbCode, "42P01");
});

test("24 无 code / 无 name / 无 status 的 unknown 形状不重试（生产实测形状）", async () => {
  loadFixture();
  dbState.errors["stores:select"] = { message: "gateway returned a non-JSON body" };
  dbState.fail["stores:select"] = 1;
  const { status } = await login();
  assert.equal(status, 503);
  assert.equal(selectCount("stores"), 1, "分不出来就不猜、不重试");
  assert.equal(retryEvents().length, 0);
  assert.equal(eventOf("login_scope_build_failed").fields.errKind, "unknown");
});

test("25 网关 5xx（无 code 但 statusCode>=500）判为 postgrest 瞬时并重试一次", async () => {
  loadFixture();
  // 用 workspaces 而不是 memberships：登录路径上 memberships 还有一次刻意不包重试的前置读
  dbState.errors["workspaces:select"] = { statusCode: 502, message: "bad gateway" };
  dbState.fail["workspaces:select"] = 1;
  const { status } = await login();
  assert.equal(status, 200);
  assert.equal(selectCount("workspaces"), 2);
  assert.equal(eventOf("transient_read_retried").fields.kind, "postgrest");
  assert.equal(eventOf("transient_read_retried").fields.httpStatus, 502);
});

test("26 已认证路径瞬时失败后恢复 → 200，有效会话不再被误判为不可用", async () => {
  const token = "synthetic-session-token-e".repeat(3);
  loadFixture({
    sessions: [
      {
        id: "sess-6",
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        csrf_token_hash: sha256hex("csrf-6"),
        token_hash: sha256hex(token),
        expires_at: FUTURE,
        revoked_at: null,
      },
    ],
  });
  dbState.fail["memberships:select"] = 1;
  const { status, body } = await call("/auth/session", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(status, 200);
  assert.equal(body.data.workspace.id, WORKSPACE_ID);
  assert.equal(eventOf("transient_read_retried").fields.operation, "resolve_scope");
  assert.ok(!hasEvent("session_lookup_failed"), "恢复成功就不该再报会话查询失败");
});

test("27 生产实测形状 code:UNKNOWN + 4xx → gateway 瞬时，重试后恢复", async () => {
  loadFixture();
  // postgrest-js 对非 JSON 响应体的兜底信封：code 固定 "UNKNOWN"，statusCode 带真实 4xx
  dbState.errors["tenants:select"] = { code: "UNKNOWN", statusCode: 429, message: "Too Many Requests" };
  dbState.fail["tenants:select"] = 1;
  const { status } = await login();
  assert.equal(status, 200, "单次限流读失败不应炸掉整条登录链");
  assert.equal(selectCount("tenants"), 2);
  const f = eventOf("transient_read_retried").fields;
  assert.equal(f.kind, "gateway");
  assert.equal(f.dbCode, "UNKNOWN");
  assert.equal(f.httpStatus, 429);
  assert.equal(f.attempts, 2, "attempts 记实际尝试次数，不是上限");
  assert.equal(f.recovered, true);
  assert.ok(!hasEvent("read_retry_exhausted"), "恢复成功不得留下耗尽日志");
});

test("28 gateway 持续失败：用满 3 次尝试后仍 503，并留耗尽证据", async () => {
  loadFixture();
  dbState.errors["stores:select"] = { code: "UNKNOWN", statusCode: 429, message: "Too Many Requests" };
  dbState.fail["stores:select"] = 99;
  const { status, body } = await login();
  assert.equal(status, 503);
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
  assert.equal(selectCount("stores"), 3, "瞬时类错误应用满有界重试");
  const exhausted = eventOf("read_retry_exhausted").fields;
  assert.equal(exhausted.attempts, 3);
  assert.equal(exhausted.kind, "gateway");
  assert.equal(exhausted.httpStatus, 429);
  const f = eventOf("login_scope_build_failed").fields;
  assert.equal(f.errKind, "gateway");
  assert.equal(f.dbCode, "UNKNOWN");
  assert.equal(f.httpStatus, 429, "会话/作用域读失败必须把 HTTP 状态带进日志，否则无法区分 429 与 5xx");
  assert.equal(f.writes, 0);
});

test("29 裸网关响应（无 code 无 name 但有 statusCode）也判为 gateway", async () => {
  loadFixture();
  dbState.errors["subscriptions:select"] = { statusCode: 429, message: "<html>rate limited</html>" };
  dbState.fail["subscriptions:select"] = 1;
  const { status } = await login();
  assert.equal(status, 200);
  assert.equal(eventOf("transient_read_retried").fields.kind, "gateway");
});

test("30 决定性错误形状完全不受 gateway 规则影响（42501 权限仍不重试）", async () => {
  loadFixture();
  dbState.errors["workspaces:select"] = { code: "42501", statusCode: 401, message: "permission denied" };
  dbState.fail["workspaces:select"] = 99;
  const { status, body } = await login();
  assert.equal(status, 503);
  assert.equal(selectCount("workspaces"), 1, "权限拒绝是决定性错误，重试只会放大故障");
  assert.equal(retryEvents().length, 0);
  assert.equal(eventOf("login_scope_build_failed").fields.errKind, "db");
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
});

/* ================= login scope/read-stage observability ================= */

test("31 user lookup 失败：503、零写入，并记录非敏感固定 stage", async () => {
  loadFixture();
  dbState.errors["users:select"] = { code: "ECONNRESET", statusCode: 503, message: "synthetic failure" };
  dbState.fail["users:select"] = 1;
  const { status, body } = await login();

  assert.equal(status, 503);
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
  assert.equal(sessions().length, 0);
  assert.equal(audits("merchant.login").length, 0);
  const fields = eventOf("login_scope_read_failed").fields;
  assert.deepEqual(Object.keys(fields).sort(), [
    "attempt", "dbCode", "errKind", "event", "httpStatus", "requestId", "retryEligible", "retryExhausted", "stage",
  ]);
  assert.equal(fields.stage, "user_lookup");
  assert.equal(fields.errKind, "transport");
  assert.equal(fields.dbCode, "ECONNRESET");
  assert.equal(fields.httpStatus, 503);
  assert.equal(fields.retryEligible, false);
  assert.equal(fields.attempt, 1);
  assert.equal(fields.retryExhausted, false);
  assert.equal(body.stage, undefined);
  assert.equal(body.dbCode, undefined);
  assert.equal(body.errKind, undefined);

  const dump = JSON.stringify(logged);
  for (const sensitive of [PASSWORD, LOGIN, "cookie", "token", "csrf", "mock-service-role-key", "https://mock.invalid", "SELECT", "synthetic failure"]) {
    assert.ok(!dump.includes(sensitive), `结构化日志不得含 ${sensitive}`);
  }
});

test("32 membership lookup 失败：记录 membership_lookup 且不新增 retry", async () => {
  loadFixture();
  dbState.errors["memberships:select"] = { code: "ECONNREFUSED", statusCode: 503, message: "synthetic failure" };
  dbState.fail["memberships:select"] = 1;
  const { status, body } = await login();

  assert.equal(status, 503);
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
  assert.equal(sessions().length, 0);
  assert.equal(audits("merchant.login").length, 0);
  const fields = eventOf("login_scope_read_failed").fields;
  assert.equal(fields.stage, "membership_lookup");
  assert.equal(fields.retryEligible, false);
  assert.equal(fields.attempt, 1);
  assert.equal(fields.retryExhausted, false);
  assert.equal(selectCount("memberships"), 1, "初始 membership 读保持原有单次读取语义");
  assert.equal(retryEvents().length, 0);
});

test("33 canonical workspace 连续瞬时失败：记录重试证据且客户端不见内部字段", async () => {
  loadFixture();
  dbState.errors["workspaces:select"] = { code: "UNKNOWN", statusCode: 429, message: "synthetic failure" };
  dbState.fail["workspaces:select"] = 99;
  const { status, body } = await login();

  assert.equal(status, 503);
  assert.equal(body.code, "SCOPE_BACKEND_UNAVAILABLE");
  assert.equal(sessions().length, 0);
  assert.equal(audits("merchant.login").length, 0);
  assert.equal(selectCount("workspaces"), 3, "既有 readWithRetry 上限保持三次");
  const fields = eventOf("login_scope_read_failed").fields;
  assert.equal(fields.stage, "workspace_lookup");
  assert.equal(fields.errKind, "gateway");
  assert.equal(fields.dbCode, "UNKNOWN");
  assert.equal(fields.httpStatus, 429);
  assert.equal(fields.retryEligible, true);
  assert.equal(fields.attempt, 3);
  assert.equal(fields.retryExhausted, true);
  for (const key of ["stage", "dbCode", "errKind", "retryEligible", "attempt", "retryExhausted"]) {
    assert.equal(body[key], undefined, `公开响应不得暴露 ${key}`);
  }
});

after(() => {
  console.error = realError;
  console.warn = realWarn;
});
