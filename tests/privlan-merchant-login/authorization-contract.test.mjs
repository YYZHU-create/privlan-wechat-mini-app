/**
 * privlan-merchant-api v12 —— OWNER_ONLY_FAIL_CLOSED 授权契约 + 拒绝审计 + 审计 fail-closed
 *
 * 运行：node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/
 *
 * 被测对象是 build.mjs 机械转译后的**真实可部署 Function 源码**（同一份
 * functions/privlan-merchant-api/index.ts），不是 admin 侧 legacy 代码、不是重写版。
 * 所有口令、账号、tenant/workspace/user id 均为本地合成值，不来自任何真实商户数据。
 *
 * 覆盖（对应 V12 CANDIDATE RECONCILIATION §4 要求的 12 项）：
 *   owner authorized / arbitrary role denied / missing membership denied /
 *   scope mismatch denied / merchant.authorization_denied persisted-observable /
 *   audit write failure fail-closed / login success compatibility /
 *   login failure compatibility / session resolution / subscription resolution /
 *   no sensitive audit fields / Supabase import exact pin
 * 另加源码级：audit_events append-only、merchant_sessions 撤销必须可按主键定界、
 * 写入面 tripwire 仍为恰好 2 处。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const BUILT = new URL("../../tmp/mbuild/out/", import.meta.url);
const FUNCTION_SRC = "/home/project/functions/privlan-merchant-api/index.ts";

/* ---------- 本地合成夹具（与真实数据无关） ---------- */
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const WORKSPACE_ID = "cccccccc-3333-4333-8333-333333333333";
const FOREIGN_WORKSPACE_ID = "dddddddd-4444-4444-8444-444444444444";
const STORE_ID = "eeeeeeee-5555-4555-8555-555555555555";
const LOGIN = "authz-contract-test@example.invalid";
const PASSWORD = "local-synthetic-password-0002";
const SERVICE_ROLE_KEY = "mock-service-role-key";
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();
const sha256hex = (v) => createHash("sha256").update(v).digest("hex");

/** 与生产同形状：base64(salt16)+"."+base64(scrypt64)；必须与 fake-scrypt 参数一致 */
function makeStoredHash(password) {
  const salt = randomBytes(16);
  const { scryptSync } = globalThis.__nodeCrypto;
  const hash = scryptSync(Buffer.from(password), Buffer.from(salt), 64, {
    cost: 16384,
    blockSize: 8,
    parallelization: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt.toString("base64")}.${Buffer.from(hash).toString("base64")}`;
}

/* ---------- 结构化日志捕获 ---------- */
const logged = [];
console.error = (...args) => logged.push({ level: "error", event: args[0], fields: args[1] });
console.warn = (...args) => logged.push({ level: "warn", event: args[0], fields: args[1] });
const hasEvent = (event) => logged.some((l) => l.event === event);

/* ---------- 可控 env ---------- */
const ENV = { SUPABASE_URL: "https://mock.invalid", SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY };
globalThis.__DenoEnv = { get: (key) => ENV[key] };

let handler = null;
globalThis.__DenoServe = (cb) => {
  handler = cb;
};
const { dbState, resetDb } = await import(pathToFileURL(new URL("fake-supabase.js", BUILT).pathname).href);
globalThis.__nodeCrypto = await import("node:crypto");
const mod = await import(pathToFileURL(new URL("index.js", BUILT).pathname).href);
/** 复刻生产外层：抛出的 ServiceError 必须变成 HTTP 响应，而不是逃进测试 */
handler = (req) => mod.handle(req).catch((error) => mod.failure(error, mod.newRequestId("test")));

function loadFixture(overrides = {}) {
  resetDb();
  logged.length = 0;
  const o = { ...overrides };
  dbState.rows = {
    users: [
      {
        id: USER_ID,
        login_identifier: LOGIN,
        password_hash: o.passwordHash ?? makeStoredHash(PASSWORD),
        display_name: "授权契约测试账号",
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
            role: "role" in o ? o.role : "owner",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
    workspaces: [
      { id: WORKSPACE_ID, tenant_id: TENANT_ID, name: "授权契约工作区", plan_id: "PRO" },
      { id: FOREIGN_WORKSPACE_ID, tenant_id: TENANT_ID, name: "其他工作区", plan_id: "PRO" },
    ],
    tenants: [{ id: TENANT_ID, status: o.tenantStatus ?? "active" }],
    stores: [{ id: STORE_ID, workspace_id: WORKSPACE_ID, name: "授权契约门店", public_store_id: "pub-1" }],
    subscriptions: [
      {
        id: "sub-1",
        tenant_id: TENANT_ID,
        workspace_id: WORKSPACE_ID,
        plan_id: o.planId ?? "PRO_LEGACY",
        status: o.subStatus ?? "active",
        started_at: "2026-01-01T00:00:00Z",
        expires_at: o.expiresAt ?? null,
        source: "legacy",
      },
    ],
    workspace_configs: [
      { workspace_id: WORKSPACE_ID, tenant_id: TENANT_ID, document: { products: [1, 2, 3] }, version: 9 },
    ],
    merchant_sessions: o.sessions ?? [],
    audit_events: [],
    merchant_ai_policies: [],
  };
}

async function call(path, init = {}) {
  const res = await handler(new Request(`https://authz.test${path}`, init));
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}
const post = (path, payload, headers = {}) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
const get = (path, token) =>
  call(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = (password = PASSWORD) => post("/auth/login", { login: LOGIN, password });
const audits = (action) => (dbState.written["audit_events"] || []).filter((r) => r.action === action);
const deniedAudits = () => audits("merchant.authorization_denied");
const sessionWrites = () => dbState.written["merchant_sessions"] || [];

/**
 * 台架 fake 的 INSERT 只记进 dbState.written、不回写 dbState.rows
 * （见 fakes/fake-supabase.ts:143-146），因此「本轮登录刚签发的 token」默认
 * 读不到。本函数把该行提升为可读，等价于真实库里事务已提交 —— 这样才能真正
 * 测「登录 → 该 token 换取 scope → 已认证路由」这条链路，而不是只测登录本身。
 * 字段形状与被测源码 createSession 的 insert 一致（:619-628，无 revoked_at 即匹配 is null）。
 */
const promoteSession = () => {
  const rows = sessionWrites();
  const last = rows[rows.length - 1];
  if (last) (dbState.rows["merchant_sessions"] ||= []).push({ ...last, revoked_at: null });
  return last;
};

/** 造一条「已存在」的会话行：用于证明授权闸门在请求路径上，而不只在登录时 */
async function existingSession(role) {
  const token = randomBytes(32).toString("base64url");
  loadFixture({ role, sessions: [
    {
      id: "sess-synthetic-1",
      user_id: USER_ID,
      workspace_id: WORKSPACE_ID,
      token_hash: sha256hex(token),
      csrf_token_hash: sha256hex("synthetic-csrf"),
      expires_at: FUTURE,
      revoked_at: null,
    },
  ] });
  return token;
}

/* ================= 1. owner authorized（正向兼容） ================= */
test("A1. owner 角色登录放行，且会话可正常换取 scope", async () => {
  loadFixture({ role: "owner" });
  const ok = await login();
  assert.equal(ok.status, 200, "owner 必须放行");
  assert.equal(ok.body.data.user.role, "owner");
  const token = ok.body.data.session.token;
  promoteSession();
  const s = await get("/auth/session", token);
  assert.equal(s.status, 200);
  assert.equal(s.body.data.role, "owner");
  assert.equal(deniedAudits().length, 0, "放行路径不得产生拒绝审计");
});

test("A2. owner 大小写不敏感放行（白名单按 trim+lowercase 匹配）", async () => {
  loadFixture({ role: "OWNER" });
  const ok = await login();
  assert.equal(ok.status, 200);
});

/* ================= 2. arbitrary role denied ================= */
test("A3. 任意非白名单角色登录即拒，且零会话写入", async () => {
  for (const role of ["member", "admin", "staff", "sUPERuser", "owner2", "o wner", "", "   ", null, undefined, 42, { r: "owner" }]) {
    loadFixture({ role });
    const res = await login();
    assert.equal(res.status, 403, `角色 ${JSON.stringify(role)} 必须 DENY`);
    assert.equal(res.body.code, "ROLE_NOT_AUTHORIZED");
    assert.equal(sessionWrites().length, 0, `角色 ${JSON.stringify(role)} 不得签发会话`);
    const rows = deniedAudits();
    assert.equal(rows.length, 1, "每次拒绝必须恰好留一条授权拒绝审计");
    assert.equal(rows[0].metadata.reason, "role_not_allowed");
    assert.equal(rows[0].metadata.contract, "OWNER_ONLY_FAIL_CLOSED");
    assert.equal(rows[0].metadata.stage, "login");
  }
});

test("A4. 审计里只落角色「类别」，绝不回显角色原文", async () => {
  const sentinel = "role-raw-sentinel-should-not-be-audited";
  loadFixture({ role: sentinel });
  const res = await login();
  assert.equal(res.status, 403);
  const row = deniedAudits()[0];
  assert.ok(!JSON.stringify(row).includes(sentinel), "角色原文不得进审计");
  assert.equal(row.metadata.roleClass, "unknown");
});

test("A5. 空/空白/缺失角色分别归入有界类别", () => {
  assert.equal(mod.roleClassOf(null), "null");
  assert.equal(mod.roleClassOf(undefined), "null");
  assert.equal(mod.roleClassOf(""), "empty");
  assert.equal(mod.roleClassOf("   "), "empty");
  assert.equal(mod.roleClassOf("whatever"), "unknown");
  assert.equal(mod.roleClassOf(7), "unknown");
});

test("A6. 白名单是封闭集合，且当前只含 owner", () => {
  assert.deepEqual([...mod.ALLOWED_ROLES], ["owner"]);
  assert.equal(mod.AUTHORIZATION_CONTRACT, "OWNER_ONLY_FAIL_CLOSED");
  assert.equal(mod.isRoleAuthorized("owner"), true);
  assert.equal(mod.isRoleAuthorized(" Owner "), true);
  assert.equal(mod.isRoleAuthorized("admin"), false);
  assert.equal(mod.isRoleAuthorized(null), false);
});

/* ================= 3. 已存在会话也要过闸门（闸门在请求路径上） ================= */
test("A7. 会话有效 ≠ 已授权：非 owner 的既存会话打任意已认证路由仍 403", async () => {
  const token = await existingSession("member");
  for (const path of ["/auth/session", "/v1/profile", "/v1/subscription", "/api/config"]) {
    const res = await get(path, token);
    assert.equal(res.status, 403, `${path} 必须被角色闸门拦住`);
    assert.equal(res.body.code, "ROLE_NOT_AUTHORIZED");
  }
  assert.equal(deniedAudits().length, 4, "四次拒绝四条审计，不得合并、不得漏");
  assert.equal(sessionWrites().length, 0, "拒绝路径不得写 merchant_sessions");
});

test("A8. 入口分类是封闭集合，pathname 原文不进审计", async () => {
  const token = await existingSession("guest");
  const weird = "/auth/session?probe=%2e%2e%2fsecret-path";
  const res = await get(weird, token);
  assert.equal(res.status, 403);
  const row = deniedAudits()[0];
  assert.equal(row.metadata.entrypoint, "auth");
  assert.ok(!JSON.stringify(row).includes("secret-path"), "pathname 原文不得进审计");
  assert.equal(mod.entrypointClassOf("/v1/profile"), "v1");
  assert.equal(mod.entrypointClassOf("/api/platform/bootstrap"), "api");
  assert.equal(mod.entrypointClassOf("/internal/storage/proxy-upload"), "internal_storage");
  assert.equal(mod.entrypointClassOf("/mp-images/a.png"), "media");
  assert.equal(mod.entrypointClassOf("/anything/else"), "other");
});

/* ================= 4. missing membership denied ================= */
test("A9. 认证通过但无 membership → 403 且留拒绝审计", async () => {
  loadFixture({ noMembership: true });
  const res = await login();
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "WORKSPACE_ACCESS_DENIED");
  assert.equal(sessionWrites().length, 0);
  const rows = deniedAudits();
  assert.equal(rows.length, 1, "v11 该分支零审计零日志，v12 必须有证据");
  assert.equal(rows[0].metadata.reason, "no_membership");
  assert.equal(rows[0].metadata.contract, "OWNER_ONLY_FAIL_CLOSED");
  assert.equal(rows[0].action, "merchant.authorization_denied");
  assert.equal(rows[0].resource_type, "merchant_user");
  assert.equal(rows[0].actor_id, USER_ID);
});

test("A10. 口令错误仍走 401，不得被误升级成授权拒绝审计", async () => {
  loadFixture({ role: "member" });
  const res = await login("wrong-password-local");
  assert.equal(res.status, 401, "凭据无效必须先于角色判定，避免账号枚举差异");
  assert.equal(res.body.code, "INVALID_CREDENTIALS");
  assert.equal(deniedAudits().length, 0, "口令错误不是授权拒绝");
  assert.equal(audits("merchant.login_failed").length, 1);
});

/* ================= 5. scope mismatch denied ================= */
test("A11. 浏览器试图覆盖 scope → 403 且审计标出被拒参数名", async () => {
  loadFixture({ role: "owner" });
  const ok = await login();
  const token = ok.body.data.session.token;
  promoteSession();
  const res = await get(`/v1/profile?workspaceId=${FOREIGN_WORKSPACE_ID}`, token);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "WORKSPACE_ACCESS_DENIED");
  const rows = deniedAudits();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metadata.reason, "scope_override_attempt");
  assert.equal(rows[0].metadata.parameter, "workspaceId", "只允许回显封闭三元组里的键名");
  assert.ok(!JSON.stringify(rows[0]).includes(FOREIGN_WORKSPACE_ID), "被拒的取值本身不得进审计");
  assert.equal(rows[0].tenant_id, TENANT_ID, "本条审计必须可按租户归属（v11 登录审计恒 NULL 的那类缺陷不得复现）");
});

test("A12. 四条内部端点的身份锁 403 各自留一条拒绝审计", async () => {
  const routes = [
    ["/internal/storage/signed-upload-probe", "signed_upload_probe"],
    ["/internal/storage/signed-upload-execute", "signed_upload_execute"],
    ["/internal/storage/proxy-upload", "proxy_upload"],
    ["/internal/storage/proxy-capacity-test", "capacity_test"],
  ];
  for (const [route, endpoint] of routes) {
    loadFixture({ role: "owner" });
    const ok = await login();
    const token = ok.body.data.session.token;
    promoteSession();
    const res = await post(route, {}, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403, `${route} 非 canonical 身份必须 403`);
    assert.match(res.body.code, /SCOPE_MISMATCH$/);
    const rows = deniedAudits();
    assert.equal(rows.length, 1, `${route} 必须留下恰好一条拒绝审计`);
    assert.equal(rows[0].metadata.reason, "scope_identity_mismatch");
    assert.equal(rows[0].metadata.endpoint, endpoint);
    assert.equal(rows[0].metadata.entrypoint, "internal_storage");
  }
});

/* ================= 6. audit write failure fail-closed ================= */
test("A13. 拒绝审计写不进去 → 503 AUDIT_WRITE_UNAVAILABLE，绝不静默给出判定", async () => {
  loadFixture({ role: "member" });
  dbState.fail["audit_events:insert"] = 1;
  const res = await login();
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "AUDIT_WRITE_UNAVAILABLE");
  assert.equal(sessionWrites().length, 0, "fail-closed：没有证据就不产出任何授予");
  assert.ok(hasEvent("audit_insert_failed"), "写失败必须同时留结构化错误日志");
  assert.equal(insertCountAudit(), 1, "审计写失败不得自动重试（写路径无重试是既定边界）");
});
const insertCountAudit = () => dbState.calls.filter((c) => c.table === "audit_events" && c.op === "insert").length;

test("A14. 身份锁拒绝时审计写失败同样升级为 503（不得退化为无痕 403）", async () => {
  loadFixture({ role: "owner" });
  const ok = await login();
  const token = ok.body.data.session.token;
  promoteSession();
  // 清掉登录阶段的痕迹，只观察身份锁这一条路径
  dbState.written = {};
  logged.length = 0;
  dbState.fail["audit_events:insert"] = 1;
  const res = await post("/internal/storage/proxy-capacity-test", {}, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 503, "身份锁必须留证据；证据写不进去就 fail-closed，绝不无痕 403");
  assert.equal(res.body.code, "AUDIT_WRITE_UNAVAILABLE");
  assert.ok(hasEvent("audit_insert_failed"));
  assert.equal(sessionWrites().length, 0, "fail-closed 期间不得产生任何会话授予");
});

/* ================= 7/8. 登录成功与失败行为兼容 ================= */
test("A15. 登录成功契约不变：200 + 双 set-cookie + session/audit 各 1 条", async () => {
  loadFixture({ role: "owner" });
  const ok = await login();
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.session.token && ok.body.data.session.csrfToken);
  assert.equal(sessionWrites().length, 1);
  assert.equal(audits("merchant.login").length, 1);
  const cookies = ok.headers.getSetCookie ? ok.headers.getSetCookie() : [];
  assert.equal(cookies.length, 2, "会话 Cookie + CSRF Cookie，与 v11 一致");
  assert.ok(cookies.some((c) => c.includes("HttpOnly")));
});

test("A16. 授予侧 fail-closed：成功审计写不进去 → 503、token 不下发、新会话按主键补偿撤销", async () => {
  loadFixture({ role: "owner" });
  dbState.fail["audit_events:insert"] = 1;
  const res = await login();
  assert.equal(res.status, 503, "会话已落库但成功审计缺失 ⇒ 宁可拒绝也不下发无法追溯的凭据");
  assert.equal(res.body.code, "AUDIT_WRITE_UNAVAILABLE");

  /* token 不得出现在响应头或响应体里 */
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  assert.equal(cookies.length, 0, "503 路径不得下发任何 set-cookie");
  assert.equal(res.body.ok, false);
  assert.equal(res.body.data, undefined, "503 信封不得携带 data（token 的唯一出口在 data.session）");
  assert.ok(!/set-cookie/i.test([...res.headers.keys()].join(",")), "响应头不得出现 set-cookie");

  /* 会话确实被创建过（否则谈不上补偿），且撤销必须按主键定界 */
  const created = sessionWrites();
  assert.equal(created.length, 1, "issueSession 已落库，补偿才有对象");
  const revokeCalls = dbState.calls.filter((c) => c.table === "merchant_sessions" && c.op === "update");
  assert.ok(revokeCalls.length >= 1, "必须发起补偿撤销");
  for (const c of revokeCalls) {
    assert.deepEqual(
      c.filters.filter((f) => f.startsWith("eq(")),
      [`eq(id,${created[0].id})`],
      "撤销只能按本轮会话主键等值，不得扩大范围",
    );
    assert.deepEqual(
      Object.keys(c.values).sort(),
      ["revoked_at"],
      "撤销只能改 revoked_at，不得顺带改 expires_at 等列",
    );
    assert.ok(!Number.isNaN(Date.parse(c.values.revoked_at)), "revoked_at 必须是合法时间戳");
  }
  assert.ok(hasEvent("login_session_compensated"), "补偿成功必须留结构化日志");
  const revoked = audits("merchant.login_session_revoked");
  assert.equal(revoked.length, 1, "补偿撤销本身也要留审计");
  assert.equal(revoked[0].metadata.reason, "token_not_delivered");
  assert.equal(revoked[0].resource_id, created[0].id);
});

test("A17. 登录失败契约不变：三种畸形凭据收敛到同一 401", async () => {
  for (const payload of [{ login: LOGIN, password: "nope" }, { login: "nobody@example.invalid", password: PASSWORD }, { login: { nested: true }, password: PASSWORD }]) {
    loadFixture({ role: "owner" });
    const res = await post("/auth/login", payload);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "INVALID_CREDENTIALS", "不得区分「用户不存在」与「口令错」");
    assert.equal(sessionWrites().length, 0);
  }
});

/* ================= 9. session resolution ================= */
test("A18. 会话三条件仍然生效：撤销/过期/伪造 token 一律 401", async () => {
  const token = await existingSession("owner");
  const good = await get("/auth/session", token);
  assert.equal(good.status, 200);

  loadFixture({ role: "owner", sessions: [{
    id: "s-revoked", user_id: USER_ID, workspace_id: WORKSPACE_ID,
    token_hash: sha256hex(token), csrf_token_hash: sha256hex("c"),
    expires_at: FUTURE, revoked_at: new Date().toISOString(),
  }] });
  assert.equal((await get("/auth/session", token)).status, 401);

  loadFixture({ role: "owner", sessions: [{
    id: "s-expired", user_id: USER_ID, workspace_id: WORKSPACE_ID,
    token_hash: sha256hex(token), csrf_token_hash: sha256hex("c"),
    expires_at: PAST, revoked_at: null,
  }] });
  assert.equal((await get("/auth/session", token)).status, 401);

  assert.equal((await get("/auth/session", "forged-token-local-xyz")).status, 401);
  assert.equal((await get("/auth/session", null)).status, 401);
});

/* ================= 10. subscription resolution ================= */
test("A19. 订阅解析行为不变：过期订阅在 scope 与 bootstrap 上均标为 expired", async () => {
  loadFixture({ role: "owner", expiresAt: PAST });
  const ok = await login();
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.subscription.status, "expired", "resolveCanonicalScope 的过期归一化不得变");

  const token = ok.body.data.session.token;
  promoteSession();
  const sub = await get("/v1/subscription", token);
  assert.equal(sub.status, 200);
  assert.equal(sub.body.data.status, "expired");
  assert.equal(sub.body.data.planId, "PRO", "PRO_LEGACY → PRO 的映射保持不变");

  const bs = await get("/api/platform/bootstrap", token);
  assert.equal(bs.status, 403, "过期订阅在 assertWritable 上仍是 SUBSCRIPTION_REQUIRED");
  assert.equal(bs.body.code, "SUBSCRIPTION_REQUIRED");
});

test("A20. 有效订阅 bootstrap 正常返回，且 owner 闸门不误伤", async () => {
  loadFixture({ role: "owner" });
  const ok = await login();
  promoteSession();
  const bs = await get("/api/platform/bootstrap", ok.body.data.session.token);
  assert.equal(bs.status, 200);
  assert.deepEqual(bs.body.workspace.roles, ["owner"]);
  assert.equal(deniedAudits().length, 0);
});

/* ================= 11. no sensitive audit fields ================= */
test("A21. 全部审计行零敏感材料（token / csrf / 口令 / service_role key）", async () => {
  /* loadFixture 会 resetDb() 清空 written，故逐段收割，覆盖四种不同审计来源 */
  const all = [];
  const harvest = () => all.push(...(dbState.written["audit_events"] || []));

  loadFixture({ role: "member" });
  await login();
  harvest();

  loadFixture({ role: "owner" });
  const ok = await login();
  const token = ok.body.data.session.token;
  const csrf = ok.body.data.session.csrfToken;
  promoteSession();
  harvest();

  await get(`/v1/profile?workspaceId=${FOREIGN_WORKSPACE_ID}`, token);
  harvest();

  await post("/auth/logout", {}, { authorization: `Bearer ${token}`, "x-atelier-csrf": csrf });
  harvest();

  loadFixture({ noMembership: true });
  await login();
  harvest();

  assert.ok(all.length >= 4, `本用例必须真正覆盖多条审计来源，实际 ${all.length} 条`);
  const secrets = [PASSWORD, token, csrf, SERVICE_ROLE_KEY];
  for (const row of all) {
    const dump = JSON.stringify(row);
    for (const s of secrets) {
      assert.ok(!dump.includes(s), `审计行不得含敏感材料（action=${row.action}）`);
    }
    for (const col of ["token", "password", "password_hash", "token_hash", "csrf_token_hash"]) {
      assert.ok(!(col in row), `audit_events 行不得出现 ${col} 列`);
    }
  }
});

/* ================= 12. Supabase import exact pin ================= */
test("A22. 可部署源码的 Supabase import 必须是 exact 2.115.0，零浮动", () => {
  const src = readFileSync(FUNCTION_SRC, "utf8");
  assert.ok(
    src.includes('import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";'),
    "必须存在 exact specifier",
  );
  /* 判据：出现 @supabase/supabase-js@2 且其后不是 .115.0 ⇒ 即浮动 range（注释行除外） */
  const floating = src
    .split("\n")
    .filter((l) => l.includes("esm.sh/@supabase/supabase-js@2") && !l.includes("supabase-js@2.115.0"))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert.deepEqual(floating, [], `不得残留浮动 @supabase/supabase-js@2，实际：${floating.join(" | ")}`);
  assert.ok(src.includes("https://esm.sh/@noble/hashes@1.4.0/scrypt"), "noble scrypt 保持 exact");
  const remote = src.split("\n").filter((l) => /^\s*import .* from "https:\/\//.test(l));
  assert.equal(remote.length, 2, "函数仍只有 2 条 remote import、零本地模块");
});

/* ================= 源码级：append-only / 定界撤销 / 写入面 ================= */
test("A23. audit_events 只有 INSERT，不存在 UPDATE/DELETE（append-only 证据链）", () => {
  const src = readFileSync(FUNCTION_SRC, "utf8");
  const auditOps = src.split("\n").filter((l) => /from\("audit_events"\)\s*\.\s*(update|delete|upsert)/.test(l));
  assert.deepEqual(auditOps, [], "审计表不得被改写或删除");
  const inserts = src.split("\n").filter((l) => /from\("audit_events"\)\s*\.\s*insert/.test(l));
  assert.equal(inserts.length, 1, "全函数只允许一处审计写入入口，便于证明 append-only");
});

test("A24. merchant_sessions 撤销必须按主键定界（UAT 清理可收窄到单会话）", () => {
  const src = readFileSync(FUNCTION_SRC, "utf8");
  const lines = src.split("\n");
  const revokeSites = [];
  lines.forEach((l, i) => {
    if (/from\("merchant_sessions"\)/.test(l)) {
      const window = lines.slice(i, i + 6).join("\n");
      if (/\.update\(/.test(window)) revokeSites.push({ line: i + 1, window });
    }
  });
  assert.equal(revokeSites.length, 2, "两处撤销：compensateRevokeSession 与 logout");
  for (const site of revokeSites) {
    assert.match(site.window, /\.eq\("id",\s*[^)]+\)/, `第 ${site.line} 行的撤销必须带主键等值条件`);
    assert.ok(!/not\.is\("id"/.test(site.window), "不得用「排除法」扩大撤销范围");
  }
});

test("A25. 写入面 tripwire 仍恰好 2 处（新增授权逻辑不得夹带新写入面）", () => {
  const src = readFileSync(FUNCTION_SRC, "utf8");
  const uploadLines = src.split("\n").filter((l) => /\.upload\s*\(/.test(l));
  assert.equal(uploadLines.length, 2);
  assert.ok(uploadLines.some((l) => /proxyKey/.test(l)));
  assert.ok(uploadLines.some((l) => /capacityKey/.test(l)));
});

test("A26. 授权闸门只挂一处汇聚点，四条身份锁共用同一审计函数", () => {
  const src = readFileSync(FUNCTION_SRC, "utf8");
  const gates = src.split("\n").filter((l) => /await assertAuthorizedRole\(/.test(l));
  assert.equal(gates.length, 1, "角色白名单必须只有一份调用点，杜绝漏挂路由");
  const denialCalls = src.split("\n").filter((l) => /"merchant\.authorization_denied"/.test(l));
  assert.equal(denialCalls.length, 5, "角色闸门 / 身份锁 / 登录侧两处 / scope 覆盖 —— 各一处字面量");
  const locks = src.split("\n").filter((l) => /await recordScopeIdentityDenial\(/.test(l));
  assert.equal(locks.length, 4, "四条内部端点身份锁都要留证据");
});

test("A27. 补偿撤销自身也失败时，仍然 503 且 token 绝不下发（宁可留孤儿会话）", async () => {
  loadFixture({ role: "owner" });
  dbState.fail["audit_events:insert"] = 1;
  /* 撤销写不进去：attempt 1 + attempt 2 都失败 → compensateRevokeSession 返回 false */
  dbState.fail["merchant_sessions:update"] = 9;
  const res = await login();
  assert.equal(res.status, 503, "补偿失败不得把结果改回 200 —— 凭据泄漏的代价高于孤儿会话");
  assert.equal(res.body.code, "AUDIT_WRITE_UNAVAILABLE");
  assert.equal(res.body.data, undefined);
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  assert.equal(cookies.length, 0, "补偿失败路径同样不得下发 token/CSRF");

  assert.ok(hasEvent("login_compensation_failed"), "补偿失败必须留结构化错误日志，否则线上不可见");
  assert.ok(!hasEvent("login_session_compensated"), "未成功撤销不得谎报已补偿");
  const revoke = dbState.calls.filter((c) => c.table === "merchant_sessions" && c.op === "update");
  assert.equal(revoke.length, 2, "补偿撤销按既有实现有界尝试两次（这是补偿动作，不是业务写重试）");
  for (const c of revoke) {
    assert.deepEqual(c.filters.filter((f) => f.startsWith("eq(")), [`eq(id,${sessionWrites()[0].id})`]);
  }
});

test("A28. 审计 sink 故障不得把非授予路径拖成 5xx（失败登录 401 / logout 200 保持原样）", async () => {
  /* 1) 失败登录：merchant.login_failed 保持 required=false，审计抖动不得变成 503 */
  loadFixture({ role: "owner" });
  dbState.fail["audit_events:insert"] = 5;
  const bad = await login("wrong-password-000");
  assert.equal(bad.status, 401, "口令错误就是口令错误，不能因审计写失败而 5xx");
  assert.equal(bad.body.code, "INVALID_CREDENTIALS");
  assert.equal(sessionWrites().length, 0, "失败登录仍零会话写入");
  assert.ok(hasEvent("audit_insert_failed"), "失败仍要留结构化日志，只是不升级为 5xx");

  /* 2) logout：撤销已成功，尾部审计写失败必须仍是 200 */
  loadFixture({ role: "owner" });
  const ok = await login();
  const token = ok.body.data.session.token;
  const csrf = ok.body.data.session.csrfToken;
  promoteSession();
  dbState.written = {};
  logged.length = 0;
  dbState.fail["audit_events:insert"] = 5;
  const out = await post("/auth/logout", {}, { authorization: `Bearer ${token}`, "x-atelier-csrf": csrf });
  assert.equal(out.status, 200, "logout 的审计是普通事件，不得因 sink 故障拒绝用户退出");
  assert.equal(audits("merchant.logout").length, 0, "注入下确实写失败，而非静默成功");
  assert.ok(hasEvent("audit_insert_failed"));
  const cleared = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
  assert.equal(cleared.length, 2, "退出仍要清 Cookie");
});

test("A29. required 策略集合封闭：恰好 6 处 true = 5 处授权拒绝 + 1 处会话授予", () => {
  const src = readFileSync(FUNCTION_SRC, "utf8");
  const sites = [];
  const re = /await recordAudit\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.ok(end > open, "recordAudit 调用必须括号平衡");
    /* 顶层逗号切分实参（忽略嵌套括号内的逗号） */
    const args = [];
    let cur = "";
    let nest = 0;
    for (const ch of src.slice(open + 1, end)) {
      if ("([{".includes(ch)) nest += 1;
      if (")]}".includes(ch)) nest -= 1;
      if (ch === "," && nest === 0) {
        args.push(cur);
        cur = "";
      } else cur += ch;
    }
    args.push(cur);
    const action = (args[2] || "").trim().replace(/"/g, "");
    const requiredArg = (args[6] || "").trim();
    sites.push({
      line: src.slice(0, m.index).split("\n").length,
      action,
      required: requiredArg === "true",
      explicit: requiredArg !== "",
    });
  }

  assert.equal(sites.length, 11, `审计调用点总数应稳定为 11，实际 ${sites.length}`);
  const requiredSites = sites.filter((s) => s.required);
  assert.equal(requiredSites.length, 6, "required=true 只能覆盖「授权拒绝 + 会话授予」，严禁无差别推到全函数");
  const countByAction = {};
  for (const s of requiredSites) countByAction[s.action] = (countByAction[s.action] || 0) + 1;
  assert.deepEqual(countByAction, { "merchant.authorization_denied": 5, "merchant.login": 1 });

  /* 其余调用点必须完全不传 required（走默认 false），而不是显式写 false 蒙混 */
  const sloppy = sites.filter((s) => !s.required && s.explicit);
  assert.deepEqual(sloppy, [], "非 fail-closed 路径应保持默认参数，显式传 false 会让策略集合失去唯一真源");
  const protectedActions = sites.filter((s) => !s.required).map((s) => s.action).sort();
  assert.deepEqual(protectedActions, [
    "merchant.asset_capacity_probe",
    "merchant.asset_proxy_upload",
    "merchant.login_failed",
    "merchant.login_session_revoked",
    "merchant.logout",
  ]);
});
