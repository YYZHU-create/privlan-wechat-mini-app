/**
 * privlan-merchant-api — 原 PrivLan 商户端候选接入（只读阶段）
 *
 * 契约来源：ORIGINAL_SOURCE/admin/saas-service.js、merchant-routes.js、platform-store.js
 * （三者 sha256 已与 MANIFEST 逐位比对通过，来源 SHA efd7f12c…1324c2）
 *
 * 严格复刻原实现语义，不做任何"改进"：
 *   口令  platform-store.js:132-144  scrypt(N=16384,r=8,p=1,dkLen=64)，
 *         存储格式 base64(salt)+"."+base64(hash)，共 113 字符，无 pepper
 *   会话  saas-service.js:48-59      token=randomBytes(32).base64url，库内只存 sha256(token)
 *   scope 一律由服务端按会话 + membership 推导，绝不采信浏览器传入的 tenant/workspace/store
 *
 * 只读阶段：除「会话创建/撤销」与「安全审计写入」外，任何写接口一律 410 READ_ONLY_CANDIDATE，
 * 绝不返回"保存成功"之类伪反馈。
 */
// 版本必须写全 major.minor.patch：`@2` 是浮动 range，由 esm.sh 服务端决定落点，
// 曾实测发生 2.115.0 → 2.116.0 的静默漂移（deno check 两轮均通过，不会 fail-fast）。
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import * as ScryptModule from "https://esm.sh/@noble/hashes@1.4.0/scrypt";

const SESSION_COOKIE = "atelier_merchant_session";
const CSRF_COOKIE = "atelier_csrf";
const SESSION_TTL_HOURS = 24 * 7; // saas-service.js:51

/* ---------- 1. scrypt 后端 + 冷启动自检（fail closed） ---------- */

type ScryptOpts = { N: number; r: number; p: number; dkLen?: number; maxMemory?: number };
type ScryptFn = (password: Uint8Array, salt: Uint8Array, opts: ScryptOpts) => Uint8Array;

const mod = ScryptModule as unknown as Record<string, unknown>;
const scrypt = (mod.scryptSync as ScryptFn | undefined) ?? (mod.scrypt as ScryptFn | undefined);
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxMemory: 64 * 1024 * 1024 } as ScryptOpts;

/**
 * 已知答案向量：由沙箱内 Node crypto.scryptSync（与原实现同一算法实现）生成，
 * 仅用于证明 Deno 侧 scrypt 逐位一致，不是任何真实凭据。
 */
const KAT_VECTORS = [
  {
    password: "feeldao-kat-merchant-0001",
    saltB64: "ABEiM0RVZneImaq7zN3u/w==",
    hashB64: "nnLbE1BrIJ9cFv2Zv+vxhwlFaeZO4MkziQGTcI903+2Yg2JF/DZctG49HfEcdwHVz3r4YVqWFv3MPNqb1cWt3Q==",
  },
  {
    password: "PrivLan 商户端 KAT 0002",
    saltB64: "8OHSw7Sllod4aVpLPC0eDw==",
    hashB64: "a74ydw+S2znCrgHZOcFd3smSWvhP4Vjp4/93f50CTN/fp+/kf8cedXomU5B81cXNxCnZkiE6ePheh+22tTtcYA==",
  },
];

function b64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function b64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 线性 base64 校验，语义等价于 /^[A-Za-z0-9+/]{4,}={0,2}$/，但刻意不用正则。
 *
 * ⚠️ 实测教训（2026-09-06 台架）：V8/Deno 的 irregexp 在 6,990,508 字符
 * （= 5 MiB 档 base64）上对该模式抛 `RangeError: Maximum call stack size exceeded`
 * （index.js RegExp.test 处）。容量探针的全部意义是区分「平台天花板」与「我们自己的 bug」，
 * 若让一条回溯型正则在 5MB 上先炸栈，就会把应用层缺陷误判成 Meoo 的限制。
 * 故长 payload 路径一律线性扫描：O(n)、零回溯、零栈风险。
 */
function isStandardBase64(value: string): boolean {
  const n = value.length;
  if (n === 0 || n % 4 !== 0) return false;
  let pad = 0;
  if (value.charCodeAt(n - 1) === 61) pad = value.charCodeAt(n - 2) === 61 ? 2 : 1;
  const body = n - pad;
  if (body < 4) return false;
  for (let i = 0; i < body; i += 1) {
    const c = value.charCodeAt(i);
    const isAlpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const isDigit = c >= 48 && c <= 57;
    if (!isAlpha && !isDigit && c !== 43 && c !== 47) return false;
  }
  return true;
}

function selfTestScrypt(): { ok: boolean; reason: string } {
  if (!scrypt) return { ok: false, reason: "scrypt export missing" };
  try {
    for (const vector of KAT_VECTORS) {
      const actual = scrypt(new TextEncoder().encode(vector.password), b64Decode(vector.saltB64), {
        ...SCRYPT_PARAMS,
        dkLen: 64,
      });
      if (b64Encode(actual) !== vector.hashB64) return { ok: false, reason: "known-answer mismatch" };
    }
    return { ok: true, reason: "known-answer verified" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "scrypt threw" };
  }
}

const SCRYPT_SELF_TEST = selfTestScrypt();

/* ---------- 2. 原语（对齐 saas-service.js / platform-store.js） ---------- */

/** platform-store.js:138-144 verifyPassword 的逐行等价实现 */
function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const parts = String(stored || "").split(".");
  if (!scrypt || parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    const expected = b64Decode(parts[1]);
    const actual = scrypt(new TextEncoder().encode(String(password)), b64Decode(parts[0]), {
      ...SCRYPT_PARAMS,
      dkLen: expected.length,
    });
    return constantTimeEqual(expected, actual);
  } catch {
    return false;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 字节版摘要：proxy-upload 的写入前硬闸与写后回读对账共用 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBase64Url(byteLength: number): string {
  return b64Encode(crypto.getRandomValues(new Uint8Array(byteLength)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function normalizeLogin(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function publicUser(row: Record<string, unknown>) {
  return {
    id: row.user_id ?? row.id ?? null,
    login: row.login_identifier ?? null,
    displayName: row.display_name || "",
    avatarUrl: row.avatar_url || null,
    role: row.role ?? null,
  };
}

/* ---------- 3. 错误与响应包络（merchant-routes.js:23-26） ---------- */

class ServiceError extends Error {
  status: number;
  code: string;
  trustedPublicMessage = true; // 等价 markTrustedPublicMessage
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * 结构化日志：字段全部走白名单，只允许分类信息。
 * 严禁出现 token、token_hash、csrf、口令、password_hash、service_role key、行数据。
 */
type LogValue = string | number | boolean | null;

function logEvent(level: "error" | "warn", event: string, fields: Record<string, LogValue>): void {
  const payload: Record<string, LogValue> = { event, ...fields };
  if (level === "error") console.error(event, payload);
  else console.warn(event, payload);
}

/* ---- 非敏感错误分类：只输出类别，绝不输出 message 内容（message 可能回显列名或值） ---- */

type DbErrorKind = "transport" | "timeout" | "postgrest" | "db" | "gateway" | "unknown";

type LoginReadStage =
  | "user_lookup"
  | "membership_lookup"
  | "workspace_lookup"
  | "tenant_lookup"
  | "store_lookup"
  | "subscription_lookup"
  | "unknown_lookup";

function loginReadStageFromScopeStage(stage: string): LoginReadStage {
  switch (stage) {
    case "users": return "user_lookup";
    case "memberships": return "membership_lookup";
    case "workspaces": return "workspace_lookup";
    case "tenants": return "tenant_lookup";
    case "stores": return "store_lookup";
    case "subscriptions": return "subscription_lookup";
    default: return "unknown_lookup";
  }
}

function logLoginScopeReadFailed(input: {
  requestId: string;
  stage: LoginReadStage;
  errKind: DbErrorKind;
  dbCode: string;
  httpStatus: number;
  retryEligible: boolean;
  attempt: number;
  retryExhausted: boolean;
}): void {
  logEvent("error", "login_scope_read_failed", {
    requestId: input.requestId,
    stage: input.stage,
    errKind: input.errKind,
    dbCode: input.dbCode,
    httpStatus: input.httpStatus,
    retryEligible: input.retryEligible,
    attempt: input.attempt,
    retryExhausted: input.retryExhausted,
  });
}

const rawDbCode = (error: unknown): string => {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
};
const rawDbName = (error: unknown): string => {
  if (!error || typeof error !== "object") return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
};
const rawDbStatus = (error: unknown): number => {
  if (!error || typeof error !== "object") return 0;
  const e = error as { statusCode?: unknown; status?: unknown };
  const v = e.statusCode ?? e.status;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/** 既有语义保持：日志里的 dbCode 仍优先取 code，退化到 name，最后 UNKNOWN */
function dbErrorCode(error: unknown): string {
  return rawDbCode(error) || rawDbName(error) || "UNKNOWN";
}

/**
 * dbCode=UNKNOWN 不等同于 network failure。分不出来就归 unknown，并且不重试 ——
 * 宁可多暴露一次 503，也不靠猜去重试一个可能是决定性的错误。
 */
function classifyDbError(error: unknown): DbErrorKind {
  if (!error || typeof error !== "object") return "unknown";
  const code = rawDbCode(error);
  const name = rawDbName(error);
  const status = rawDbStatus(error);
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "PGRST002") return "timeout";
  if (
    code === "FETCH_ERROR" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ECONNABORTED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EPIPE" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  )
    return "transport";
  if (code.startsWith("PGRST")) return "postgrest";
  if (/^[0-9A-Z]{5}$/.test(code)) return "db"; // SQLSTATE
  if (status >= 500) return "postgrest"; // 网关/PostgREST 5xx，常伴随非 JSON 响应体
  if (!code && !status && name === "TypeError") return "transport";
  /*
   * postgrest-js 对「响应体不是合法 PostgREST 错误 JSON」的兜底信封固定填 code:"UNKNOWN"
   * 并带上真实 HTTP statusCode。决定性错误（缺表 42P01 / 权限 42501 / 无行 PGRST116）
   * 必然携带 SQLSTATE 或 PGRST 码，绝不可能是 UNKNOWN —— 所以 UNKNOWN 是网关/基础设施签名，
   * 不属于「分不出来」。2026-09-05 实测：4xx + code:"UNKNOWN" 一路掉到 unknown，
   * 导致 readWithRetry 完全不触发（日志零条 transient_read_retried），鉴权链 5 连 503。
   */
  if (code === "UNKNOWN") return "gateway";
  if (!code && !name && status > 0) return "gateway"; // 裸网关响应：无 code 无 name 但有 HTTP 状态
  return "unknown";
}

/** 只有基础设施/传输/超时这一类才是瞬时；决定性错误（语法、缺表、权限、无行）一律不重试 */
const TRANSIENT_SQLSTATE = new Set([
  "08000", "08001", "08003", "08004", "08006", // connection
  "40001", "40P01", // 序列化冲突 / 死锁
  "53300", "55P03", // 连接数耗尽 / 锁等待
  "57P01", "57P02", "57P03", // 实例重启、正在关闭
  "58000", "58030", // 后台崩溃 / db 不可用
]);
const TRANSIENT_PGRST = new Set(["PGRST002", "PGRST003", "PGRST500"]);

function isTransientReadError(error: unknown): boolean {
  const kind = classifyDbError(error);
  if (kind === "transport" || kind === "timeout" || kind === "gateway") return true;
  const code = rawDbCode(error);
  if (kind === "db") return TRANSIENT_SQLSTATE.has(code);
  if (kind === "postgrest") return TRANSIENT_PGRST.has(code) || rawDbStatus(error) >= 500;
  if (rawDbStatus(error) === 429) return true; // 限流对只读 SELECT 永远安全
  return false;
}

/* ---- 有界幂等只读重试（MAX_RETRIES=2） ---- */

/**
 * 为什么从 2 次提到 3 次：resolveCanonicalScope 单次鉴权要打 7 条 SELECT
 * （merchant_sessions / users / memberships / workspaces / tenants / stores / subscriptions），
 * 一轮脚本 5 个请求 = 35 次读挤在 1.5s 内，任意一次网关抖动即整请求 503。
 * 只读 SELECT 重试没有数据风险（INSERT/UPDATE 一律不经过这里，见 test 21），
 * 最坏附加延迟 120+350=470ms/读，且只在瞬时类错误上发生。
 */
const READ_MAX_ATTEMPTS = 3; // 1 次原始 + 2 次重试（仅用于断言上限，日志记实际次数）
const READ_BACKOFF_MS = [120, 350]; // 递增退避

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type ReadAttemptResult = { data: any; error: any };
type ReadRetryEvidence = { retryEligible: boolean; attempt: number; retryExhausted: boolean };
type ReadResult = ReadAttemptResult & { retry: ReadRetryEvidence };
type ReadCtx = { requestId: string; operation: string; stage: string };

/**
 * 只包 SELECT 型只读查询；INSERT / UPDATE / DELETE 一律不得经过这里。
 * 「查询成功但行为空」不是错误（error 为 null），因此天然不会被重试。
 * 第二次即使成功也必须留痕，不得把基础设施抖动完全隐藏。
 */
async function readWithRetry(run: () => PromiseLike<ReadAttemptResult>, ctx: ReadCtx): Promise<ReadResult> {
  const first = await run();
  if (!first.error || !isTransientReadError(first.error)) {
    return {
      ...first,
      retry: { retryEligible: false, attempt: 1, retryExhausted: false },
    };
  }

  let last = first;
  let attempts = 1;
  while (attempts < READ_MAX_ATTEMPTS) {
    await sleep(READ_BACKOFF_MS[attempts - 1] ?? READ_BACKOFF_MS[READ_BACKOFF_MS.length - 1]);
    attempts += 1;
    last = await run();
    // 成功、或换成决定性错误（不再瞬时）都立即停止，绝不把重试用在缺表/权限这类故障上
    if (!last.error || !isTransientReadError(last.error)) break;
  }
  if (last.error) {
    logEvent("error", "read_retry_exhausted", {
      requestId: ctx.requestId,
      operation: ctx.operation,
      stage: ctx.stage,
      kind: classifyDbError(last.error),
      dbCode: dbErrorCode(last.error),
      httpStatus: rawDbStatus(last.error),
      attempts,
    });
  }
  logEvent(last.error ? "error" : "warn", "transient_read_retried", {
    requestId: ctx.requestId,
    operation: ctx.operation,
    stage: ctx.stage,
    kind: classifyDbError(first.error),
    dbCode: dbErrorCode(first.error),
    httpStatus: rawDbStatus(first.error),
    attempts,
    recovered: !last.error,
  });
  return {
    ...last,
    retry: {
      retryEligible: true,
      attempt: attempts,
      retryExhausted: Boolean(last.error && isTransientReadError(last.error) && attempts === READ_MAX_ATTEMPTS),
    },
  };
}

function newRequestId(prefix = "req"): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBase64Url(4)}`;
}

type HeaderList = Array<[string, string]>;

function toHeaders(list: HeaderList): Headers {
  const headers = new Headers();
  for (const [key, value] of list) headers.append(key, value);
  return headers;
}

function json(payload: unknown, status = 200, headers: HeaderList = []): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: toHeaders([["content-type", "application/json; charset=utf-8"], ...headers]),
  });
}

function success(data: unknown, message: string, requestId: string, headers: HeaderList = []) {
  return json({ ok: true, code: "OK", message, data, requestId }, 200, headers);
}

function failure(error: unknown, requestId: string, headers: HeaderList = []) {
  const known = error instanceof ServiceError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known && error.trustedPublicMessage ? error.message : "服务暂时不可用";
  if (!known) {
    // 只记类别，绝不记口令、token、行数据
    console.error("unhandled_error", { requestId, name: error instanceof Error ? error.name : typeof error });
  }
  return json({ ok: false, code, message, error: null, requestId }, status, headers);
}

/* ---------- 4. 只读阶段闸门 ---------- */

/**
 * 实例自带写入闸门（在本轮取得的 3 个源码文件里 0 命中，说明由缺失的
 * server.js / meoo-supabase-adapter.js 读取）。登录必须写 merchant_sessions，
 * 故仅在闸门「显式关闭」时拒绝，未设置时保持原实现的无条件写入语义。
 */
function sessionWritesAllowed(): { allowed: boolean; gate: string } {
  const raw = Deno.env.get("MEOO_WRITES_ENABLED");
  if (raw === undefined || raw.trim() === "") return { allowed: true, gate: "unset" };
  const normalized = raw.trim().toLowerCase();
  return { allowed: normalized !== "false" && normalized !== "0", gate: normalized };
}

const readOnly = (feature: string) =>
  new ServiceError(410, "READ_ONLY_CANDIDATE", `候选版为只读接入，未开放${feature}`);

/* ---------- 5. 数据库（service_role；这些表对 anon/authenticated 无表级授权） ---------- */

function createDb(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ServiceError(503, "DATABASE_REQUIRED", "SaaS 数据库尚未配置");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Scope = {
  sessionId: string;
  userId: string;
  tenantId: string;
  tenantStatus: string;
  workspaceId: string;
  storeId: string;
  role: string;
  csrfTokenHash: string;
  user: ReturnType<typeof publicUser>;
  workspace: Record<string, unknown>;
  subscription: Record<string, unknown>;
};

/** Scope 中与「会话行」绑定的两个字段以外的部分 —— 可仅由服务端 canonical 输入构造 */
type ScopeCore = Omit<Scope, "sessionId" | "csrfTokenHash">;

/**
 * 解析失败必须区分两类，绝不合并成同一个 null（这正是原 500 不可诊断的原因）：
 *   db_error    —— 数据库读本身失败（网络/网关抖动、超时），对外 503，会话本身仍然有效
 *   row_missing —— 行确实不存在或主体已失效，对外按原语义 401 / 500
 */
type ScopeFailure = {
  ok: false;
  kind: "db_error" | "row_missing";
  stage: string;
  dbCode?: string;
  errKind?: DbErrorKind;
  httpStatus?: number;
  retryEligible?: boolean;
  attempt?: number;
  retryExhausted?: boolean;
};
type CoreResult = { ok: true; core: ScopeCore } | ScopeFailure;
type ScopeResult = { ok: true; scope: Scope } | ScopeFailure;

/**
 * saas-service.js:112-136 那条多表 JOIN 的顺序查询等价实现。
 * 只读「本轮写入之前就已存在」的行，绝不读回刚创建的 merchant_sessions，
 * 因此登录成功不再依赖 read-after-write（方案 B 的落点）。
 * 注意：stores / subscriptions 沿用原 SQL 的无 ORDER BY + limit(1)，
 * 该非确定性是原契约的一部分，此处刻意不「修正」。
 */
async function resolveCanonicalScope(
  db: SupabaseClient,
  input: { userId: string; workspaceId: string; userRow?: Record<string, any> | null; requestId?: string },
): Promise<CoreResult> {
  const requestId = input.requestId ?? "";
  /** 全部是 SELECT 型只读查询，故统一走有界重试；stage 与日志一一对应 */
  const readonly = (stage: string) => ({ requestId, operation: "resolve_scope", stage });
  const dbFail = (stage: string, result: ReadResult): ScopeFailure => ({
    ok: false,
    kind: "db_error",
    stage,
    dbCode: dbErrorCode(result.error),
    errKind: classifyDbError(result.error),
    httpStatus: rawDbStatus(result.error),
    retryEligible: result.retry.retryEligible,
    attempt: result.retry.attempt,
    retryExhausted: result.retry.retryExhausted,
  });

  let user: Record<string, any> | null = input.userRow ?? null;
  if (!user) {
    const res = await readWithRetry(
      () =>
        db
          .from("users")
          .select("id,login_identifier,display_name,avatar_url,status")
          .eq("id", input.userId)
          .maybeSingle(),
      readonly("users"),
    );
    if (res.error) return dbFail("users", res);
    user = res.data as Record<string, any> | null;
  }
  if (!user) return { ok: false, kind: "row_missing", stage: "users" };
  if (user.status !== "active") return { ok: false, kind: "row_missing", stage: "user_inactive" };

  // JOIN memberships on user_id AND workspace_id —— membership 失效即会话失效
  const membershipRes = await readWithRetry(
    () =>
      db
        .from("memberships")
        .select("tenant_id,workspace_id,role")
        .eq("user_id", user!.id)
        .eq("workspace_id", input.workspaceId)
        .limit(1)
        .maybeSingle(),
    readonly("memberships"),
  );
  if (membershipRes.error) return dbFail("memberships", membershipRes);
  if (!membershipRes.data) return { ok: false, kind: "row_missing", stage: "memberships" };

  const workspaceRes = await readWithRetry(
    () =>
      db
        .from("workspaces")
        .select("id,tenant_id,name,plan_id")
        .eq("id", input.workspaceId)
        .maybeSingle(),
    readonly("workspaces"),
  );
  if (workspaceRes.error) return dbFail("workspaces", workspaceRes);
  if (!workspaceRes.data) return { ok: false, kind: "row_missing", stage: "workspaces" };

  const tenantRes = await readWithRetry(
    () =>
      db
        .from("tenants")
        .select("id,status")
        .eq("id", workspaceRes.data.tenant_id)
        .maybeSingle(),
    readonly("tenants"),
  );
  if (tenantRes.error) return dbFail("tenants", tenantRes);
  if (!tenantRes.data) return { ok: false, kind: "row_missing", stage: "tenants" };

  const storeRes = await readWithRetry(
    () =>
      db
        .from("stores")
        .select("id,name,public_store_id")
        .eq("workspace_id", workspaceRes.data.id)
        .limit(1)
        .maybeSingle(),
    readonly("stores"),
  );
  if (storeRes.error) return dbFail("stores", storeRes);

  const subscriptionRes = await readWithRetry(
    () =>
      db
        .from("subscriptions")
        .select("id,plan_id,status,started_at,expires_at")
        .eq("workspace_id", workspaceRes.data.id)
        .limit(1)
        .maybeSingle(),
    readonly("subscriptions"),
  );
  if (subscriptionRes.error) return dbFail("subscriptions", subscriptionRes);

  const subscription = subscriptionRes.data;
  const expired = subscription?.expires_at ? new Date(subscription.expires_at).getTime() <= Date.now() : false;

  return {
    ok: true,
    core: {
      userId: user.id,
      tenantId: workspaceRes.data.tenant_id,
      tenantStatus: tenantRes.data.status,
      workspaceId: workspaceRes.data.id,
      storeId: storeRes.data?.id ?? "",
      role: membershipRes.data.role,
      user: publicUser({ ...user, role: membershipRes.data.role }),
      workspace: {
        id: workspaceRes.data.id,
        tenantId: workspaceRes.data.tenant_id,
        storeId: storeRes.data?.id ?? null,
        publicStoreId: storeRes.data?.public_store_id ?? null,
        name: workspaceRes.data.name,
        storeName: storeRes.data?.name ?? null,
      },
      subscription: {
        id: subscription?.id ?? null,
        planId: subscription?.plan_id ?? workspaceRes.data.plan_id ?? null,
        status: expired ? "expired" : subscription?.status ?? null,
        startedAt: subscription?.started_at ?? null,
        expiresAt: subscription?.expires_at ?? null,
      },
    },
  };
}

/** token → merchant_sessions 行 → canonical scope；读失败与未命中不再共用一个出口 */
async function resolveSession(db: SupabaseClient, token: string | null, requestId = ""): Promise<ScopeResult> {
  if (!token) return { ok: false, kind: "row_missing", stage: "no_token" };
  const tokenHash = await sha256(token);

  // 已撤销 / 已过期在 SQL 条件里就被排除掉，结果是「成功但无行」，不会进入重试
  const sessionRes = await readWithRetry(
    () =>
      db
        .from("merchant_sessions")
        .select("id,user_id,workspace_id,csrf_token_hash,expires_at")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle(),
    { requestId, operation: "resolve_session", stage: "merchant_sessions" },
  );
  if (sessionRes.error)
    return {
      ok: false,
      kind: "db_error",
      stage: "merchant_sessions",
      dbCode: dbErrorCode(sessionRes.error),
      errKind: classifyDbError(sessionRes.error),
      httpStatus: rawDbStatus(sessionRes.error),
    };
  const session = sessionRes.data;
  if (!session) return { ok: false, kind: "row_missing", stage: "session_not_found" };

  const built = await resolveCanonicalScope(db, {
    userId: session.user_id,
    workspaceId: session.workspace_id,
    requestId,
  });
  if (!built.ok) return built;
  return {
    ok: true,
    scope: { ...built.core, sessionId: session.id, csrfTokenHash: session.csrf_token_hash },
  };
}

/** saas-service.js:48-59 issueSession */
async function issueSession(
  db: SupabaseClient,
  input: {
    userId: string;
    workspaceId: string;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string;
  },
) {
  // 主键改为预先在内存生成并返回：这样「会话已落库但响应未能下发」时才能精确撤销这一行
  const sessionId = crypto.randomUUID();
  const token = randomBase64Url(32);
  const csrfToken = randomBase64Url(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600000).toISOString();
  const { error } = await db.from("merchant_sessions").insert({
    id: sessionId,
    user_id: input.userId,
    workspace_id: input.workspaceId,
    token_hash: await sha256(token),
    csrf_token_hash: await sha256(csrfToken),
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    expires_at: expiresAt,
  });
  if (error) {
    // 抛出发生在 recordAudit 之前：会话没落库，就绝不留下成功审计
    logEvent("error", "session_insert_failed", {
      requestId: input.requestId,
      operation: "insert_session",
      stage: "merchant_sessions",
      dbCode: dbErrorCode(error),
    });
    throw new ServiceError(500, "INTERNAL_ERROR", "服务暂时不可用");
  }
  return { sessionId, token, csrfToken, expiresAt };
}

/** saas-service.js:43-46 audit */
async function recordAudit(
  db: SupabaseClient,
  scope: Record<string, unknown>,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
  required = false,
): Promise<boolean> {
  const { error } = await db.from("audit_events").insert({
    id: crypto.randomUUID(),
    tenant_id: scope.tenantId ?? null,
    workspace_id: scope.workspaceId ?? null,
    actor_type: scope.actorType || "system",
    actor_id: scope.actorId || "system",
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    request_id: scope.requestId || crypto.randomUUID(),
    metadata,
  });
  if (!error) return true;
  logEvent("error", "audit_insert_failed", {
    requestId: String(scope.requestId || ""),
    operation: "insert_audit",
    stage: "audit_events",
    action,
    dbCode: dbErrorCode(error),
  });
  /*
   * fail-closed 边界（required 的三级策略，v12.1 定案）：
   *  1) 实质性授权拒绝（5 处 merchant.authorization_denied）→ required=true：
   *     没有留下证据的授权判定不可自证，宁可 503 也不让判定静默收场。
   *  2) 成功授予访问权限（唯一一处 merchant.login / 会话签发）→ required=true：
   *     由调用方 catch 做补偿撤销 —— 撤销按主键定界到本轮这一行，且 success(...) 尚未
   *     构造，token 不下发。这是有意的「可用性换可追溯性」，代价是审计 sink 故障期间
   *     该租户无法登录，不能当作无成本的安全增强。
   *  3) 其余全部 required=false（失败登录、logout、补偿审计、资产类普通审计）：
   *     审计 sink 故障不得把它们拖成 5xx。非授予、非判定的事件不值得用整条链路的
   *     可用性去换，且失败路径已有 logEvent 结构化留痕可查。
   * 写路径一律不自动重试（recordAudit 无 retry 是既定边界），故 required=true 的语义是
   * 「单次失败即判定不可自证」，不是「重试后仍失败」。策略集合由台架 A29 封闭钉住。
   */
  if (required) throw new ServiceError(503, "AUDIT_WRITE_UNAVAILABLE", "服务暂时不可用，请稍后重试");
  return false;
}

/**
 * 方案 A 兜底：撤销「本次刚创建、但 token 未能下发」的那一条会话。
 * 只按主键撤销单行；不删除历史会话，不扩大 revoke 范围；
 * 失败重试一次后只留结构化 error，绝不伪装成功。
 */
async function compensateRevokeSession(
  db: SupabaseClient,
  input: { sessionId: string; tenantId: string | null; workspaceId: string; requestId: string },
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { error } = await db
      .from("merchant_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", input.sessionId);
    if (!error) {
      await recordAudit(
        db,
        {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          actorType: "system",
          actorId: "privlan-merchant-api",
          requestId: input.requestId,
        },
        "merchant.login_session_revoked",
        "merchant_session",
        input.sessionId,
        { reason: "token_not_delivered", attempt },
      );
      logEvent("warn", "login_session_compensated", {
        requestId: input.requestId,
        operation: "revoke_session",
        stage: "merchant_sessions",
        sessionId: input.sessionId,
        attempt,
        dbCode: "NONE",
      });
      return true;
    }
    if (attempt === 2) {
      logEvent("error", "login_compensation_failed", {
        requestId: input.requestId,
        operation: "revoke_session",
        stage: "merchant_sessions_revoke",
        sessionId: input.sessionId,
        attempts: attempt,
        dbCode: dbErrorCode(error),
      });
    }
  }
  return false;
}

/** saas-service.js:210-215 readConfig */
async function readConfig(db: SupabaseClient, scope: Scope) {
  const { data, error } = await db
    .from("workspace_configs")
    .select("document,version,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle();
  if (error) throw new ServiceError(500, "INTERNAL_ERROR", "服务暂时不可用");
  if (!data) throw new ServiceError(404, "CONFIG_NOT_FOUND", "工作区配置不存在");
  return { document: data.document, version: data.version, updatedAt: data.updated_at };
}

/** saas-service.js:241-253 getSubscription */
async function getSubscription(db: SupabaseClient, scope: Scope) {
  const { data, error } = await db
    .from("subscriptions")
    .select("id,plan_id,status,started_at,expires_at,source")
    .eq("workspace_id", scope.workspaceId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle();
  if (error) throw new ServiceError(500, "INTERNAL_ERROR", "服务暂时不可用");
  if (!data) throw new ServiceError(404, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
  const expired = data.expires_at ? new Date(data.expires_at).getTime() <= Date.now() : false;
  return {
    id: data.id,
    planId: data.plan_id === "PRO_LEGACY" ? "PRO" : data.plan_id,
    rawPlanId: data.plan_id,
    status: expired ? "expired" : data.status,
    startedAt: data.started_at,
    expiresAt: data.expires_at,
    source: data.source,
    remainingDays: data.expires_at
      ? Math.max(0, Math.ceil((new Date(data.expires_at).getTime() - Date.now()) / 86400000))
      : null,
  };
}

/** saas-service.js:293-299 getAiPolicy */
async function getAiPolicy(db: SupabaseClient, scope: Scope) {
  const fallback = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, storeId: scope.storeId, mode: "rules", connectionId: null, fallbackToRules: true };
  const { data } = await db
    .from("merchant_ai_policies")
    .select("mode,connection_id,fallback_to_rules")
    .eq("tenant_id", scope.tenantId)
    .eq("workspace_id", scope.workspaceId)
    .eq("store_id", scope.storeId)
    .maybeSingle();
  if (!data) return fallback;
  return { ...fallback, mode: data.mode, connectionId: data.connection_id, fallbackToRules: data.fallback_to_rules };
}

/* ---------- 6. 请求门禁（merchant-routes.js:153-174） ---------- */

function parseCookies(header: string | null): Record<string, string> {
  return String(header || "").split(";").reduce<Record<string, string>>((acc, part) => {
    const i = part.indexOf("=");
    if (i > 0) acc[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    return acc;
  }, {});
}

function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() || null : null;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

/**
 * 原实现对所有非 GET 校验 x-atelier-csrf。Bearer 只驻留内存、不构成环境凭据，
 * CSRF 面天然不存在；Cookie 会话仍严格校验，与原实现一致。
 */
async function assertCsrf(req: Request, scope: Scope, viaCookie: boolean) {
  if (!viaCookie || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const token = String(req.headers.get("x-atelier-csrf") || "");
  if (!(token && scope.csrfTokenHash) || (await sha256(token)) !== scope.csrfTokenHash) {
    throw new ServiceError(403, "CSRF_INVALID", "页面会话已更新，请刷新后重试");
  }
}

/** merchant-routes.js:161-164 —— 浏览器传入的 scope 与会话不符直接拒（实质性授权拒绝，须留审计） */
async function assertScopeNotOverridden(
  db: SupabaseClient,
  req: Request,
  scope: Scope,
  url: URL,
  requestId: string,
  pathname: string,
) {
  let body: Record<string, unknown> = {};
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    try {
      body = (await req.clone().json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const pairs: Array<[string, unknown]> = [
    ["tenantId", scope.tenantId],
    ["workspaceId", scope.workspaceId],
    ["storeId", scope.storeId],
  ];
  for (const [key, expected] of pairs) {
    const supplied = body?.[key] ?? url.searchParams.get(key);
    if (supplied && String(supplied) !== String(expected)) {
      // key 取自上方封闭三元组，可安全入审计；supplied 原文是浏览器可控字符串，不回显
      await recordAudit(
        db,
        {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          actorType: "merchant",
          actorId: scope.userId,
          requestId,
        },
        "merchant.authorization_denied",
        "merchant_session",
        scope.sessionId,
        {
          reason: "scope_override_attempt",
          contract: AUTHORIZATION_CONTRACT,
          entrypoint: entrypointClassOf(pathname),
          parameter: key,
        },
        true,
      );
      throw new ServiceError(403, "WORKSPACE_ACCESS_DENIED", "不能访问其他工作区的数据");
    }
  }
}

/** saas-service.js:237-241 assertWritable */
function assertWritable(scope: Scope) {
  if (scope.tenantStatus === "suspended") {
    throw new ServiceError(403, "TENANT_SUSPENDED", "租户已暂停，请联系运营人员恢复");
  }
  if (!scope.subscription || scope.subscription.status !== "active") {
    throw new ServiceError(403, "SUBSCRIPTION_REQUIRED", "订阅已到期，请兑换后继续使用");
  }
}

/* ---------- 6.5 授权契约（interim：OWNER_ONLY_FAIL_CLOSED） ---------- */

/**
 * memberships.role 是裸 text：无 CHECK、无枚举类型（实测 pg_type JOIN pg_enum 0 命中），
 * 现存 9/9 行取值均为 "owner"。因此这里采用「封闭白名单 + 默认拒绝」而非黑名单：
 * 只有白名单内角色放行，任何未知值（"" / 空白 / null / "admin" / "member" /
 * 未来新增的任意字符串）一律 DENY。放开 admin/member 属独立切片 ——
 * 需先定义角色语义并给列补 CHECK，本文件不预设。
 */
const AUTHORIZATION_CONTRACT = "OWNER_ONLY_FAIL_CLOSED";
const ALLOWED_ROLES: ReadonlySet<string> = new Set(["owner"]);

/** 非字符串、空串、未知值全部 false —— 默认拒绝，绝不因「没命中黑名单」而放行 */
function isRoleAuthorized(role: unknown): boolean {
  return typeof role === "string" && ALLOWED_ROLES.has(role.trim().toLowerCase());
}

/** 审计只落「有界类别」，不回显角色原文（来源是库内裸 text，长度与取值均无约束） */
function roleClassOf(role: unknown): "null" | "empty" | "unknown" {
  if (role === null || role === undefined) return "null";
  if (typeof role !== "string") return "unknown";
  if (role.trim() === "") return "empty";
  return "unknown";
}

/** 入口分类同样是封闭集合：pathname 浏览器可控，不得原样进审计 */
function entrypointClassOf(pathname: string): "auth" | "v1" | "api" | "internal_storage" | "media" | "other" {
  if (pathname.startsWith("/auth/")) return "auth";
  if (pathname.startsWith("/v1/")) return "v1";
  if (pathname.startsWith("/api/")) return "api";
  if (pathname.startsWith("/internal/storage/")) return "internal_storage";
  if (pathname.startsWith(MP_IMAGE_PREFIX)) return "media";
  return "other";
}

/**
 * 授权判定汇聚点：「会话有效」≠「已授权」。
 * 未通过 → 先落一条 merchant.authorization_denied（append-only），再抛 403。
 * required=true 使审计写失败升级为 503：没有证据的授权判定不允许静默收场。
 */
async function assertAuthorizedRole(
  db: SupabaseClient,
  scope: Scope,
  requestId: string,
  pathname: string,
): Promise<void> {
  if (isRoleAuthorized(scope.role)) return;
  await recordAudit(
    db,
    {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorType: "merchant",
      actorId: scope.userId,
      requestId,
    },
    "merchant.authorization_denied",
    "merchant_session",
    scope.sessionId,
    {
      reason: "role_not_allowed",
      contract: AUTHORIZATION_CONTRACT,
      entrypoint: entrypointClassOf(pathname),
      roleClass: roleClassOf(scope.role),
    },
    true,
  );
  throw new ServiceError(403, "ROLE_NOT_AUTHORIZED", "当前账号角色未被授权访问该功能");
}

/**
 * 四条内部端点的身份锁共用：拒绝前落审计。
 * endpoint 是封闭字面量联合，不来自请求，可安全入 metadata。
 */
async function recordScopeIdentityDenial(
  db: SupabaseClient,
  scope: Scope,
  requestId: string,
  endpoint: "signed_upload_probe" | "signed_upload_execute" | "proxy_upload" | "capacity_test",
): Promise<void> {
  await recordAudit(
    db,
    {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorType: "merchant",
      actorId: scope.userId,
      requestId,
    },
    "merchant.authorization_denied",
    "storage_object",
    null,
    {
      reason: "scope_identity_mismatch",
      contract: AUTHORIZATION_CONTRACT,
      entrypoint: "internal_storage",
      endpoint,
    },
    true,
  );
}

/* ---------- 7. 路由 ---------- */

const MARKER = "/functions/v1/privlan-merchant-api";

/* ---------- 7.5 /mp-images —— Legacy 兼容读取（PRIVATE Storage resolver） ---------- */

/** 本轮唯一允许读取的桶；public=false，公开读不可用，只能经服务端 resolver 取档 */
const MERCHANT_ASSETS_BUCKET = "merchant-assets";
const MP_IMAGE_PREFIX = "/mp-images/";

/**
 * Legacy 的 object_key 就是 basename，故 resolver 采用 basename-only 策略。
 * 拒绝面：分隔符、点号序列、百分号（覆盖 %2e%2e%2f 这类编码绕过）、绝对路径、
 * URL、反斜杠、null byte、盘符冒号。
 * URL.pathname 本身不做百分号解码，因此这里刻意只判定一次、绝不二次 decode ——
 * 双解码正是 traversal 绕过的标准入口。
 */
const LEGACY_IMAGE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|gif|webp)$/i;

function extractLegacyImageBasename(path: string): string | null {
  const raw = path.slice(MP_IMAGE_PREFIX.length);
  if (!raw || raw.length > 128) return null;
  if (raw.includes("%") || raw.includes("/") || raw.includes("\\") || raw.includes(String.fromCharCode(0))) return null;
  if (raw.includes("..") || raw.includes(":")) return null;
  return LEGACY_IMAGE_BASENAME.test(raw) ? raw : null;
}

/** 扩展名 → Content-Type 白名单映射；不回显存储侧返回的 MIME，避免反射任意类型 */
const IMAGE_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function storageErrField(error: unknown, key: string): string {
  const value = (error as Record<string, unknown> | null | undefined)?.[key];
  return value === undefined || value === null ? "" : String(value);
}

/**
 * 存储侧错误分诊：「对象不存在」与「后端不可用」必须分开。
 * 不得压成 401（会把基础设施故障说成未登录），也不得回退本地旧文件后宣称成功。
 */
function storageReadFailure(error: unknown): ServiceError {
  const status = storageErrField(error, "statusCode");
  const code = storageErrField(error, "code");
  const message = storageErrField(error, "message");
  const notFound = status === "404" || code === "404" || /not\s*found/i.test(message);
  return notFound
    ? new ServiceError(404, "ASSET_NOT_FOUND", "该工作区下不存在此素材")
    : new ServiceError(503, "STORAGE_BACKEND_UNAVAILABLE", "素材服务暂时不可用，请稍后重试");
}

/** 日志字段白名单：只记分类信息，绝不记 canonical key 之外的内容，也不记凭据 */
function logStorageReadFail(requestId: string, stage: string, error: unknown): void {
  logEvent("warn", "mp_image_read_failed", {
    requestId,
    operation: "mp_image",
    stage,
    dbCode: storageErrField(error, "statusCode") || storageErrField(error, "code") || "UNKNOWN",
  });
}

/* ---------- 7.6 临时签发探针的模块级常量（SIGNED_UPLOAD_ISSUANCE_PROBE） ---------- */

/**
 * 一次性探针，不是通用上传 API。身份由部署期 runtime configuration 显式提供：
 * 未配置、配置不完整或配置非 UUID 时，所有 probe 路由关闭且不会触及 Storage。
 * 本轮结束后应连同路由一起摘除。
 */
const PROBE_ROUTE = "/internal/storage/signed-upload-probe";
const PROBE_TENANT_ID = (Deno.env.get("MERCHANT_STORAGE_PROBE_TENANT_ID") || "").trim();
const PROBE_WORKSPACE_ID = (Deno.env.get("MERCHANT_STORAGE_PROBE_WORKSPACE_ID") || "").trim();
const PROBE_BASENAME = "icon-back.png";
const PROBE_SCOPE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 临时 Storage probe 仅在部署显式提供完整 UUID scope 时开放；源码不保存任何租户身份。 */
function hasConfiguredProbeScope(): boolean {
  return PROBE_SCOPE_UUID.test(PROBE_TENANT_ID) && PROBE_SCOPE_UUID.test(PROBE_WORKSPACE_ID);
}

function matchesConfiguredProbeScope(scope: Pick<Scope, "tenantId" | "workspaceId">): boolean {
  return hasConfiguredProbeScope() && scope.tenantId === PROBE_TENANT_ID && scope.workspaceId === PROBE_WORKSPACE_ID;
}

/* ---------- 7.6b E1.5 执行切片的模块级常量（SIGNED_UPLOAD_EXECUTION_SLICE） ---------- */

/**
 * 与探针同一 deployment-configured scope（复用上方配置），差别只在授权范围：
 * 探针 token 六不落；本端点经 E1.5 明确授权，把短期、限定上传用途的
 * signed authorization 返回给当前真实 authenticated browser。
 * 服务端权威指纹：浏览器脚本必须在上传前用它们闸住内嵌字节。
 */
const EXECUTE_ROUTE = "/internal/storage/signed-upload-execute";
const EXECUTE_EXPECTED_BYTES = 307;
const EXECUTE_EXPECTED_SHA256 = "4a7e42b5e78a0c379c58edaeb1c5c3bdeebf6f0e03e728f7761df5da26741add";
const EXECUTE_EXPECTED_MIMETYPE = "image/png";

/* ---------- 7.6c proxy-upload 的模块级常量（PROXY_UPLOAD_SLICE） ---------- */

/**
 * E2 写入切片：由 Edge Function 以 service_role 直写 canonical nested key。
 * 之所以存在：Kong 网关会消费 `?token=`，浏览器直传在本平台无可用通道；
 * 而「云服务」面板只能建根级扁平对象，产不出 5 层 canonical key。
 * Storage 内网直连不经 Kong，故该路径不受网关限制约束（本切片即为实证）。
 *
 * scope lock 与权威指纹复用探针/execute 同一组 runtime configuration：本切片只写 canonical 的
 * icon-back.png（307B / 固定 sha256）。泛化到 64 个素材属另一切片，
 * 需先解决 basename 白名单与逐素材权威指纹，届时再放开。
 */
const PROXY_ROUTE = "/internal/storage/proxy-upload";
/** base64 长度上限：目标对象 307B → base64 412 字符，8192 已留约 20 倍余量；超出即在解码前拒绝 */
const PROXY_MAX_BASE64_CHARS = 8192;

/* ---------- 7.6d proxy-capacity-test 常量（EDGE_FUNCTION_PROXY_UPLOAD_CAPACITY_GATE） ---------- */

/**
 * 容量探针专用临时端点，不是正式上传 API，且刻意无法被泛化：
 * 只接受固定档位 enum，objectKey 全由服务端 scope + 档位派生，前缀固定 capacity-tests/，
 * 与正式 images/ 命名空间物理隔离，也不进 public.assets / workspace_configs。
 *
 * ⚠️ 存在目的只有一个：实测 Browser → Edge Function → Private Storage 这条路线的真实容量边界。
 * 因此下面的上限刻意放到「远大于最大档位」，让 Meoo 网关 / Deno 函数先表态，
 * 而不是被我们自己提前拦掉。PROXY_MAX_BASE64_CHARS=8192 是 APPLICATION_GATE，
 * 它不是平台上限 —— 把「≈6KB」当成 Meoo 的限制正是本轮要纠正的误判。
 */
const CAPACITY_ROUTE = "/internal/storage/proxy-capacity-test";
const CAPACITY_PREFIX = "capacity-tests";
const CAPACITY_CONTENT_TYPE = "application/octet-stream";
/** 固定档位；刻意不含 28,582,540（大 Legacy GIF），那属下一切片 */
const CAPACITY_SIZES = [65536, 262144, 1048576, 5242880, 10485760];
const CAPACITY_BASENAME: Record<number, string> = {
  65536: "capacity-64k.bin",
  262144: "capacity-256k.bin",
  1048576: "capacity-1m.bin",
  5242880: "capacity-5m.bin",
  10485760: "capacity-10m.bin",
};
/**
 * 服务端权威指纹。payload 是确定性字节 byte[i] = i % 251，摘要由服务端常量决定，
 * 不采信浏览器提交的 hash —— 比「客户端自报 hash + 服务端比对」更强，
 * 浏览器只需把自己算出的 LOCAL_SHA256 与响应里的 written.sha256 对比。
 */
const CAPACITY_EXPECTED_SHA256: Record<number, string> = {
  65536: "4b640d85ab3ba30fd02c9fc9db4a8928f416322ad27022ea58a65aaee68a4df2",
  262144: "31a1f9dea0169551092d05e8bf4a446228c8c3eb4c9b713c66adcb7fd53c89be",
  1048576: "631b84027d6b9e52b539c4e8373622d23032dfadc64d60af87339c9037e4f769",
  5242880: "16b632f11cf950dda67dc4c184a3f9e0aa1ffa4c18927bb8977e7da97ca25bca",
  10485760: "44f9296993796e201208c6c245b9515d36b62c87d0be4459ff347bfa054cd527",
};
/** 10 MiB 档 base64 实测 13,981,016 字符，上限留约 15% 余量，刻意让它不构成瓶颈 */
const CAPACITY_MAX_BASE64_CHARS = 16000000;

/**
 * 存储侧错误只输出「类别布尔量 + 状态码 + 原文长度」，绝不回显 message 原文 ——
 * 原文可能带列名、路径或策略名。类别布尔量已足够定位根因（RLS / 已存在 / 未找到 / 权限）。
 */
function storageErrorClassifiers(error: unknown): Record<string, LogValue> {
  const message = storageErrField(error, "message");
  const code = storageErrField(error, "code");
  const status = storageErrField(error, "statusCode");
  const hay = `${status} ${code} ${message}`.toLowerCase();
  return {
    errStatus: status || null,
    errCode: code || null,
    errMessageLength: message.length,
    clsRlsViolation: /row.level security/.test(hay),
    clsAlreadyExists: /already exists|duplicate/.test(hay),
    clsNotFound: /not\s*found/.test(hay),
    clsPermission: /permission|unauthorized|forbidden/.test(hay),
    clsBucket: /bucket/.test(hay),
    clsInvalid: /invalid/.test(hay),
  };
}

const BLOCKED_WRITES: Array<[string, string, string]> = [
  ["POST", "/api/config", "配置保存"],
  ["POST", "/auth/register", "注册（不会创建空白租户或默认配置）"],
  ["POST", "/auth/change-password", "修改密码"],
  ["POST", "/v1/licenses/redeem", "兑换码"],
  ["PATCH", "/v1/profile", "资料修改"],
  ["POST", "/v1/profile/avatar", "头像上传"],
  ["POST", "/api/media/upload", "素材上传"],
  ["POST", "/api/media/delete", "素材删除"],
  ["POST", "/api/sync", "小程序同步"],
  ["POST", "/api/preview", "打包与二维码"],
];

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let path = url.pathname.startsWith(MARKER) ? url.pathname.slice(MARKER.length) : url.pathname;
  if (!path.startsWith("/")) path = "/" + path;
  const requestId = newRequestId("merchant");
  const db = createDb();

  if (req.method === "GET" && path === "/healthz") {
    // 只暴露自检结论，不暴露任何数据或凭据
    return json({
      ok: true,
      code: "OK",
      message: "privlan-merchant-api candidate",
      data: { kdf: SCRYPT_SELF_TEST.ok ? "verified" : "unverified", readOnly: true },
      requestId,
    });
  }

  for (const [method, route, feature] of BLOCKED_WRITES) {
    if (req.method === method && path === route) return failure(readOnly(feature), requestId);
  }

  if (req.method === "POST" && path === "/auth/login") {
    const gate = sessionWritesAllowed();
    if (!gate.allowed) {
      console.warn("login_refused_by_write_gate", { gate: gate.gate });
      return failure(new ServiceError(503, "SESSION_BACKEND_READONLY", "会话写入已被实例闸门关闭"), requestId);
    }
    if (!SCRYPT_SELF_TEST.ok) {
      // fail closed：KDF 未通过自检时绝不比对真实口令
      console.error("login_refused_kdf_unverified", { reason: SCRYPT_SELF_TEST.reason });
      return failure(new ServiceError(503, "PASSWORD_BACKEND_UNVERIFIED", "口令校验后端未通过自检，暂不可登录"), requestId);
    }

    let input: Record<string, unknown> = {};
    try {
      input = (await req.json()) as Record<string, unknown>;
    } catch {
      input = {};
    }
    const login = normalizeLogin(input.login);
    const userRow = await db
      .from("users")
      .select("id,login_identifier,password_hash,display_name,avatar_url,status")
      .eq("login_identifier", login)
      .maybeSingle();

    if (userRow.error) {
      logLoginScopeReadFailed({
        requestId,
        stage: "user_lookup",
        errKind: classifyDbError(userRow.error),
        dbCode: dbErrorCode(userRow.error),
        httpStatus: rawDbStatus(userRow.error),
        retryEligible: false,
        attempt: 1,
        retryExhausted: false,
      });
      // 读失败 ≠ 口令错误：压成 401 既会误判凭据，又会白写一条 merchant.login_failed 审计
      logEvent("error", "login_scope_build_failed", {
        requestId,
        operation: "read_login_identity",
        stage: "users",
        dbCode: dbErrorCode(userRow.error),
        writes: 0,
      });
      return failure(new ServiceError(503, "SCOPE_BACKEND_UNAVAILABLE", "服务暂时不可用，请稍后重试"), requestId);
    }

    const user = userRow.data;
    // 与原实现一致：用户不存在 / 非 active / 口令不符，三者合并为同一条 401，不泄露账号是否存在
    if (!user || user.status !== "active" || !verifyPassword(String(input.password || ""), user.password_hash)) {
      await recordAudit(
        db,
        { actorType: "merchant", actorId: login || "unknown", requestId },
        "merchant.login_failed",
        "merchant_session",
        null,
        { ip: clientIp(req) },
      );
      return failure(new ServiceError(401, "INVALID_CREDENTIALS", "账号或密码不正确"), requestId);
    }

    // saas-service.js:98 —— created_at 最早的 membership
    const membership = await db
      .from("memberships")
      .select("workspace_id,tenant_id,role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membership.error) {
      logLoginScopeReadFailed({
        requestId,
        stage: "membership_lookup",
        errKind: classifyDbError(membership.error),
        dbCode: dbErrorCode(membership.error),
        httpStatus: rawDbStatus(membership.error),
        retryEligible: false,
        attempt: 1,
        retryExhausted: false,
      });
      // 读失败 ≠ 越权：403 WORKSPACE_ACCESS_DENIED 只用于「确实没有 membership」
      logEvent("error", "login_scope_build_failed", {
        requestId,
        operation: "read_membership",
        stage: "memberships",
        dbCode: dbErrorCode(membership.error),
        writes: 0,
      });
      return failure(new ServiceError(503, "SCOPE_BACKEND_UNAVAILABLE", "服务暂时不可用，请稍后重试"), requestId);
    }
    if (!membership.data) {
      // 认证通过但零成员关系 —— 实质性授权拒绝，先留可观测证据再 403（该分支 v11 零审计零日志）
      await recordAudit(
        db,
        { actorType: "merchant", actorId: user.id, requestId },
        "merchant.authorization_denied",
        "merchant_user",
        user.id,
        { reason: "no_membership", contract: AUTHORIZATION_CONTRACT, entrypoint: "auth", stage: "login" },
        true,
      );
      return failure(new ServiceError(403, "WORKSPACE_ACCESS_DENIED", "账号没有可访问的工作区"), requestId);
    }
    /*
     * 登录侧即执行 OWNER_ONLY_FAIL_CLOSED：不给注定无法授权的角色签发会话。
     * 否则会得到「能登录、处处 403」的僵尸会话，且每次访问都重复产生拒绝审计。
     */
    if (!isRoleAuthorized(membership.data.role)) {
      await recordAudit(
        db,
        {
          tenantId: membership.data.tenant_id ?? null,
          workspaceId: membership.data.workspace_id,
          actorType: "merchant",
          actorId: user.id,
          requestId,
        },
        "merchant.authorization_denied",
        "merchant_user",
        user.id,
        {
          reason: "role_not_allowed",
          contract: AUTHORIZATION_CONTRACT,
          entrypoint: "auth",
          stage: "login",
          roleClass: roleClassOf(membership.data.role),
        },
        true,
      );
      return failure(new ServiceError(403, "ROLE_NOT_AUTHORIZED", "当前账号角色未被授权访问该功能"), requestId);
    }

    // 写序（方案 B）：先用服务端 canonical 输入构造 scope（全程只读），成功后才落会话。
    // 于是「读不回自己刚写的行」这一类瞬时失败不再可能把一次已成功的登录变成 500 + 孤儿会话。
    // 登录自身的 users / memberships 两次读不在此范围内：按批准边界，重试只覆盖
    // resolveCanonicalScope / resolveSession 及其依赖的 SELECT，写路径一律不加自动重试。
    const built = await resolveCanonicalScope(db, {
      userId: user.id,
      userRow: user,
      workspaceId: membership.data.workspace_id,
      requestId,
    });
    if (!built.ok) {
      const dbError = built.kind === "db_error";
      if (dbError) {
        logLoginScopeReadFailed({
          requestId,
          stage: loginReadStageFromScopeStage(built.stage),
          errKind: built.errKind || "unknown",
          dbCode: built.dbCode || "UNKNOWN",
          httpStatus: built.httpStatus ?? 0,
          retryEligible: built.retryEligible === true,
          attempt: built.attempt ?? 1,
          retryExhausted: built.retryExhausted === true,
        });
      }
      logEvent("error", "login_scope_build_failed", {
        requestId,
        operation: "build_scope",
        stage: built.stage,
        dbCode: dbError ? built.dbCode || "UNKNOWN" : "NONE",
        errKind: dbError ? built.errKind || "unknown" : "none",
        httpStatus: dbError ? (built.httpStatus ?? 0) : 0,
        writes: 0,
      });
      return failure(
        dbError
          ? new ServiceError(503, "SCOPE_BACKEND_UNAVAILABLE", "服务暂时不可用，请稍后重试")
          : new ServiceError(500, "INTERNAL_ERROR", "服务暂时不可用"),
        requestId,
      );
    }

    const session = await issueSession(db, {
      userId: user.id,
      workspaceId: membership.data.workspace_id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      requestId,
    });
    try {
      /*
       * 授予侧 fail-closed（v12.1）：会话已落库，但「本次登录成功」这条证据写不进去时，
       * 宁可撤销这条刚签发的会话并返回 503，也不下发一个无法追溯的凭据。
       * 抛错由下方 catch 统一补偿 —— compensateRevokeSession 按主键只撤销 session.sessionId
       * 这一行；success(...) 尚未构造 ⇒ token 与两个 set-cookie 都不会出现在响应里。
       * 刻意只升级「成功授予访问权限」这一条路径：失败登录、logout、普通审计保持
       * required=false，不因审计 sink 故障产生不必要的可用性故障。
       */
      await recordAudit(
        db,
        { tenantId: membership.data.tenant_id, workspaceId: membership.data.workspace_id, actorType: "merchant", actorId: user.id, requestId },
        "merchant.login",
        "merchant_session",
        null,
        { sessionId: session.sessionId },
        true,
      );

      const secure = (Deno.env.get("NODE_ENV") || "").toLowerCase() === "production";
      const common = `Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}; SameSite=Lax${secure ? "; Secure" : ""}`;
      return success(
        {
          user: built.core.user,
          workspace: built.core.workspace,
          subscription: built.core.subscription,
          session: { token: session.token, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
        },
        "登录成功",
        requestId,
        [
          ["set-cookie", `${SESSION_COOKIE}=${session.token}; ${common}; HttpOnly`],
          ["set-cookie", `${CSRF_COOKIE}=${session.csrfToken}; ${common}`],
        ],
      );
    } catch (error) {
      // 兜底：会话已落库但 token 未能成功下发 → 只撤销这一条，不删历史、不扩大范围
      await compensateRevokeSession(db, {
        sessionId: session.sessionId,
        tenantId: membership.data.tenant_id ?? null,
        workspaceId: membership.data.workspace_id,
        requestId,
      });
      return failure(error, requestId);
    }
  }

  /* ---- 以下全部要求有效会话 ---- */
  const bearer = readBearer(req);
  const cookieToken = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE] || null;
  const resolved = await resolveSession(db, bearer || cookieToken, requestId);
  if (!resolved.ok) {
    if (resolved.kind === "db_error") {
      // 数据库读失败 ≠ 未登录：不能再把它压成 401，否则抖动会把有效会话误判为过期
      logEvent("error", "session_lookup_failed", {
        requestId,
        operation: "resolve_session",
        stage: resolved.stage,
        dbCode: resolved.dbCode || "UNKNOWN",
        errKind: resolved.errKind || "unknown",
        httpStatus: resolved.httpStatus ?? 0,
      });
      return failure(
        new ServiceError(503, "SESSION_LOOKUP_UNAVAILABLE", "服务暂时不可用，请稍后重试"),
        requestId,
      );
    }
    return failure(new ServiceError(401, "AUTH_REQUIRED", "请先登录"), requestId);
  }
  const scope = resolved.scope;
  await assertScopeNotOverridden(db, req, scope, url, requestId, path);
  await assertCsrf(req, scope, !bearer && Boolean(cookieToken));
  /*
   * 授权汇聚点：覆盖其后全部已认证路由（/auth/* /v1/* /api/* /mp-images 及四条内部端点）。
   * 只挂一处，是为了让角色白名单只有一份实现、不可能漏挂某个路由。
   * 单独 catch 以保住 requestId：沿用 failure(error, requestId)，不走外层 fatal 兜底。
   */
  try {
    await assertAuthorizedRole(db, scope, requestId, path);
  } catch (error) {
    if (error instanceof ServiceError) return failure(error, requestId);
    throw error;
  }

  /**
   * Legacy 兼容读取：GET /mp-images/{basename}
   * canonical key 全部来自 session → membership → workspace → tenant（scope 变量），
   * 浏览器传入的 workspaceId 只会被上面 assertScopeNotOverridden 当作 conflict probe，
   * 永远不参与 key 拼装。
   */
  if (path.startsWith(MP_IMAGE_PREFIX)) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return failure(new ServiceError(405, "METHOD_NOT_ALLOWED", "素材仅支持 GET"), requestId);
    }
    const basename = extractLegacyImageBasename(path);
    if (!basename) {
      logEvent("warn", "mp_image_rejected", { requestId, operation: "mp_image", stage: "basename_validation" });
      return failure(new ServiceError(400, "INVALID_ASSET_NAME", "素材名称不合法"), requestId);
    }
    const objectKey = `tenant/${scope.tenantId}/workspace/${scope.workspaceId}/images/${basename}`;
    // 本轮刻意不加自动重试：批准边界只要求验证基础链路，Storage 读重试必要性记为 NOT_VERIFIED
    const downloaded = await db.storage.from(MERCHANT_ASSETS_BUCKET).download(objectKey);
    if (downloaded.error || !downloaded.data) {
      logStorageReadFail(requestId, "storage_download", downloaded.error);
      return failure(storageReadFailure(downloaded.error), requestId);
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const contentType = IMAGE_CONTENT_TYPE[basename.slice(basename.lastIndexOf(".") + 1).toLowerCase()] || "application/octet-stream";
    const headers = toHeaders([
      ["content-type", contentType],
      ["content-length", String(bytes.byteLength)],
      // 保守策略：认证素材不得被公共 CDN 长期缓存；发布态 public projection 另行设计
      ["cache-control", "private, no-store"],
      ["vary", "Cookie, Authorization"],
    ]);
    if (req.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(bytes, { status: 200, headers });
  }

  /**
   * POST /internal/storage/signed-upload-probe —— 临时签发探针。
   * 走到这里时 resolveSession / assertScopeNotOverridden / assertCsrf 已全部生效。
   *
   * 硬约束（与批准边界一一对应）：
   *   零参数        不接受 filename / bucket / path / key / tenantId / workspaceId，
   *                 canonical key 由「服务端常量 + 会话 scope」双重锁定，客户端无从注入
   *   只签发        只创建授权凭据，绝不执行任何上传动作、绝不发起写请求、绝不传输任何字节
   *                 （源码级 tripwire：本文件出现任何上传调用或其 API 名即测试失败，
   *                   故此处刻意不书写被禁 API 的字面名）
   *   token 六不落  不进响应体、不进日志、不进库、不进文件、不回显、不返回任何客户端
   *   upsert=false  固定，防覆盖已迁移素材
   *   已存在即拒    canonical 对象已在则 409，杜绝把 storage.objects 撑出第 2 行
   *   身份锁定      仅对 deployment-configured 租户/工作区开放，其他身份一律 403
   */
  if (path === PROBE_ROUTE) {
    // 不用 405：405 会确认路由存在，统一按未知路由处理
    if (req.method !== "POST") return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    if (!sessionWritesAllowed().allowed) {
      return failure(new ServiceError(503, "SESSION_BACKEND_READONLY", "会话写入已被实例闸门关闭"), requestId);
    }
    if (!hasConfiguredProbeScope()) {
      logEvent("warn", "signed_upload_probe_disabled", { requestId, operation: "signed_upload_probe", stage: "probe_scope_configuration" });
      return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    }
    if (!matchesConfiguredProbeScope(scope)) {
      logEvent("warn", "signed_upload_probe_scope_refused", {
        requestId,
        operation: "signed_upload_probe",
        stage: "scope_identity",
      });
      await recordScopeIdentityDenial(db, scope, requestId, "signed_upload_probe");
      return failure(new ServiceError(403, "PROBE_SCOPE_MISMATCH", "该探针只对本轮 canonical 工作区开放"), requestId);
    }

    // 零参数闸门：任何 body 或 query 都视为试图注入 authoritative 路径
    let rawBody = "";
    try {
      rawBody = await req.text();
    } catch {
      rawBody = "";
    }
    if (rawBody.trim() !== "" || [...url.searchParams.keys()].length > 0) {
      logEvent("warn", "signed_upload_probe_params_refused", {
        requestId,
        operation: "signed_upload_probe",
        stage: "parameter_rejection",
      });
      return failure(
        new ServiceError(400, "PROBE_NO_PARAMETERS", "该探针不接受任何参数，canonical 路径由服务端固定"),
        requestId,
      );
    }

    const bucket = db.storage.from(MERCHANT_ASSETS_BUCKET);
    const canonicalKey = `tenant/${scope.tenantId}/workspace/${scope.workspaceId}/images/${PROBE_BASENAME}`;
    const prefix = canonicalKey.slice(0, canonicalKey.lastIndexOf("/"));
    const listOptions = { search: PROBE_BASENAME, limit: 10 };

    // 签发前存在性检查（只读）：canonical 已在则拒绝，杜绝第 2 行
    const before = await bucket.list(prefix, listOptions);
    if (before.error) {
      logEvent("error", "signed_upload_probe_list_failed", {
        requestId,
        operation: "signed_upload_probe",
        stage: "list_before",
        ...storageErrorClassifiers(before.error),
      });
      return failure(
        new ServiceError(503, "STORAGE_BACKEND_UNAVAILABLE", "素材服务暂时不可用，请稍后重试"),
        requestId,
      );
    }
    if ((before.data || []).some((o) => String(o?.name || "") === PROBE_BASENAME)) {
      return failure(
        new ServiceError(409, "PROBE_CANONICAL_ALREADY_EXISTS", "canonical 对象已存在，按批准边界不得二次签发"),
        requestId,
      );
    }

    // 唯一一次签发；upsert 固定 false
    const signedRes = await bucket.createSignedUploadUrl(canonicalKey, { upsert: false });
    const signedError = signedRes.error ?? null;
    const signedData = signedRes.data ?? null;
    const token = typeof signedData?.token === "string" ? signedData.token : "";
    const signedUrl = typeof signedData?.signedUrl === "string" ? signedData.signedUrl : "";
    const returnedPath = typeof signedData?.path === "string" ? signedData.path : "";

    if (signedError || token.length === 0 || signedUrl.length === 0) {
      const classifiers = storageErrorClassifiers(signedError ?? { message: "empty token or signedUrl" });
      logEvent("error", "signed_upload_probe_issuance_failed", {
        requestId,
        operation: "signed_upload_probe",
        stage: "create_signed_upload_url",
        ...classifiers,
      });
      return json(
        {
          ok: false,
          code: "SIGNED_UPLOAD_ISSUANCE_FAILED",
          message: "签发未成功",
          data: { issued: false, tokenDiscarded: true, bytesUploaded: 0, classifiers },
          requestId,
        },
        502,
      );
    }

    // 只提取非敏感结构属性；token / signedUrl 随本作用域结束即丢弃，绝不外传
    let urlHostIsStorageRoot = false;
    let urlPathHasCanonicalKey = false;
    let tokenOnlyInQuery = false;
    try {
      const parsed = new URL(signedUrl);
      const root = new URL(Deno.env.get("SUPABASE_URL") || "https://invalid.invalid");
      urlHostIsStorageRoot = parsed.origin === root.origin;
      urlPathHasCanonicalKey = parsed.pathname.includes(
        `/object/upload/sign/${MERCHANT_ASSETS_BUCKET}/${canonicalKey}`,
      );
      tokenOnlyInQuery = parsed.searchParams.get("token") === token && !parsed.pathname.includes(token);
    } catch {
      /* 解析失败只记 false，绝不记原文 */
    }
    const tokenLength = token.length;
    const pathEchoedBack = returnedPath === canonicalKey;

    // 签发后只读对账：Storage API 自己是否看到了 canonical 行
    const after = await bucket.list(prefix, listOptions);
    const afterRows = (after.data || []).filter((o) => String(o?.name || "") === PROBE_BASENAME);
    const listedMeta = (afterRows[0]?.metadata ?? null) as unknown as Record<string, unknown> | null;
    const objectRowCreated = afterRows.length > 0;

    // 残留对现有 /mp-images resolver 的影响（只读；只回报长度，绝不回传字节）
    const probeDownload = await bucket.download(canonicalKey);
    let downloadOk = false;
    let downloadBytes = -1;
    if (!probeDownload.error && probeDownload.data) {
      downloadOk = true;
      downloadBytes = (await probeDownload.data.arrayBuffer()).byteLength;
    }
    const downloadStatus = downloadOk
      ? "200"
      : storageErrField(probeDownload.error, "statusCode") || storageErrField(probeDownload.error, "code") || "UNKNOWN";

    logEvent("warn", "signed_upload_probe_issued", {
      requestId,
      operation: "signed_upload_probe",
      stage: "complete",
      issued: true,
      objectRowCreated,
      downloadOk,
      downloadBytes,
    });

    return success(
      {
        probe: "SIGNED_UPLOAD_ISSUANCE_PROBE",
        issued: true,
        upsertRequested: false,
        tokenDiscarded: true,
        bytesUploaded: 0,
        tokenLength,
        tokenOnlyInQuery,
        signedUrlHostIsStorageRoot: urlHostIsStorageRoot,
        signedUrlPathContainsCanonicalKey: urlPathHasCanonicalKey,
        returnedPathEqualsCanonical: pathEchoedBack,
        objectRowCreated,
        listedObjectCount: afterRows.length,
        listedSize: listedMeta && typeof listedMeta.size === "number" ? listedMeta.size : null,
        listedMimetype: listedMeta && typeof listedMeta.mimetype === "string" ? listedMeta.mimetype : null,
        listAfterError: after.error ? storageErrorClassifiers(after.error).errStatus : null,
        resolverDownloadAfterSigning: { ok: downloadOk, byteLength: downloadBytes, statusCode: downloadStatus },
      },
      "签发探针完成，token 已在服务端丢弃",
      requestId,
    );
  }

  /**
   * POST /internal/storage/signed-upload-execute —— E1.5 执行切片：签发并返回上传授权。
   * 走到这里时 resolveSession / assertScopeNotOverridden / assertCsrf 已全部生效。
   *
   * 与探针的闸门逐条相同：会话 → scope 身份锁 → 零参数 → 存在即 409 → upsert=false。
   * 唯一差别：signed authorization（signedUrl + token）按 E1.5 授权返回给浏览器，
   * 由浏览器直接 PUT 到 Storage；本端点自身仍然零字节传输、零上传动作
   * （源码级 tripwire 同样约束本路由：不出现任何上传 API 名或 PUT）。
   * 响应绝不含 service_role、会话 token；日志绝不含 signed token / signedUrl 原文。
   */
  if (path === EXECUTE_ROUTE) {
    if (req.method !== "POST") return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    if (!sessionWritesAllowed().allowed) {
      return failure(new ServiceError(503, "SESSION_BACKEND_READONLY", "会话写入已被实例闸门关闭"), requestId);
    }
    if (!hasConfiguredProbeScope()) {
      logEvent("warn", "signed_upload_execute_disabled", { requestId, operation: "signed_upload_execute", stage: "probe_scope_configuration" });
      return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    }
    if (!matchesConfiguredProbeScope(scope)) {
      logEvent("warn", "signed_upload_execute_scope_refused", {
        requestId,
        operation: "signed_upload_execute",
        stage: "scope_identity",
      });
      await recordScopeIdentityDenial(db, scope, requestId, "signed_upload_execute");
      return failure(new ServiceError(403, "EXECUTE_SCOPE_MISMATCH", "该端点只对本轮 canonical 工作区开放"), requestId);
    }

    // 零参数闸门：任何 body 或 query 都视为试图注入 authoritative 路径
    let execRawBody = "";
    try {
      execRawBody = await req.text();
    } catch {
      execRawBody = "";
    }
    if (execRawBody.trim() !== "" || [...url.searchParams.keys()].length > 0) {
      logEvent("warn", "signed_upload_execute_params_refused", {
        requestId,
        operation: "signed_upload_execute",
        stage: "parameter_rejection",
      });
      return failure(
        new ServiceError(400, "EXECUTE_NO_PARAMETERS", "该端点不接受任何参数，canonical 路径由服务端固定"),
        requestId,
      );
    }

    const execBucket = db.storage.from(MERCHANT_ASSETS_BUCKET);
    const execCanonicalKey = `tenant/${scope.tenantId}/workspace/${scope.workspaceId}/images/${PROBE_BASENAME}`;
    const execPrefix = execCanonicalKey.slice(0, execCanonicalKey.lastIndexOf("/"));

    // 签发前存在性检查（只读）：canonical 已在则拒绝，杜绝覆盖与第 2 行
    const execBefore = await execBucket.list(execPrefix, { search: PROBE_BASENAME, limit: 10 });
    if (execBefore.error) {
      logEvent("error", "signed_upload_execute_list_failed", {
        requestId,
        operation: "signed_upload_execute",
        stage: "list_before",
        ...storageErrorClassifiers(execBefore.error),
      });
      return failure(
        new ServiceError(503, "STORAGE_BACKEND_UNAVAILABLE", "素材服务暂时不可用，请稍后重试"),
        requestId,
      );
    }
    if ((execBefore.data || []).some((o) => String(o?.name || "") === PROBE_BASENAME)) {
      return failure(
        new ServiceError(409, "EXECUTE_CANONICAL_ALREADY_EXISTS", "canonical 对象已存在，不得二次签发或覆盖"),
        requestId,
      );
    }

    const execSigned = await execBucket.createSignedUploadUrl(execCanonicalKey, { upsert: false });
    const execSignedData = execSigned.data ?? null;
    const execToken = typeof execSignedData?.token === "string" ? execSignedData.token : "";
    const execSignedUrl = typeof execSignedData?.signedUrl === "string" ? execSignedData.signedUrl : "";
    if (execSigned.error || execToken.length === 0 || execSignedUrl.length === 0) {
      logEvent("error", "signed_upload_execute_issuance_failed", {
        requestId,
        operation: "signed_upload_execute",
        stage: "create_signed_upload_url",
        ...storageErrorClassifiers(execSigned.error ?? { message: "empty token or signedUrl" }),
      });
      return failure(new ServiceError(502, "SIGNED_UPLOAD_ISSUANCE_FAILED", "签发未成功"), requestId);
    }

    // 日志只记长度与结构结论，token / signedUrl 原文六不落（日志面）
    logEvent("warn", "signed_upload_execute_issued", {
      requestId,
      operation: "signed_upload_execute",
      stage: "complete",
      issued: true,
      tokenLength: execToken.length,
      returnedPathEqualsCanonical: execSignedData?.path === execCanonicalKey,
    });

    return success(
      {
        slice: "SIGNED_UPLOAD_EXECUTION_SLICE",
        bucket: MERCHANT_ASSETS_BUCKET,
        path: execCanonicalKey,
        signedUrl: execSignedUrl,
        token: execToken,
        upsert: false,
        expected: {
          bytes: EXECUTE_EXPECTED_BYTES,
          sha256: EXECUTE_EXPECTED_SHA256,
          mimetype: EXECUTE_EXPECTED_MIMETYPE,
        },
      },
      "signed upload authorization 已签发，浏览器可直传 Storage",
      requestId,
    );
  }

  /* === PROXY_UPLOAD_BEGIN === */
  /**
   * POST /internal/storage/proxy-upload —— E2 写入切片。
   * 前置闸门与探针逐条相同：resolveSession → assertScopeNotOverridden → assertCsrf。
   *
   * 客户端唯一能影响的量是「字节本身」：
   *   bucket / path / basename / contentType / upsert 全部由服务端常量 + session scope 决定，
   *   body 只接受 { payload: "<base64>" } 一个字段，出现任何其他字段一律 400
   * 写入前硬闸：解码后字节数与 sha256 必须逐位等于服务端权威指纹，否则 422 且零写入。
   * upsert=false + 写前存在性检查：canonical 已在即 409，绝不覆盖、绝不撑出第 2 行。
   * 写后回读再做一次摘要对账，作为「EF 通道字节保真」的直接证据。
   * 日志与响应均不含 service_role、会话 token、payload 原文。
   */
  if (path === PROXY_ROUTE) {
    if (req.method !== "POST") return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    if (!sessionWritesAllowed().allowed) {
      return failure(new ServiceError(503, "SESSION_BACKEND_READONLY", "会话写入已被实例闸门关闭"), requestId);
    }
    if (!hasConfiguredProbeScope()) {
      logEvent("warn", "proxy_upload_disabled", { requestId, operation: "proxy_upload", stage: "probe_scope_configuration" });
      return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    }
    if (!matchesConfiguredProbeScope(scope)) {
      logEvent("warn", "proxy_upload_scope_refused", {
        requestId,
        operation: "proxy_upload",
        stage: "scope_identity",
      });
      await recordScopeIdentityDenial(db, scope, requestId, "proxy_upload");
      return failure(new ServiceError(403, "PROXY_SCOPE_MISMATCH", "该端点只对本轮 canonical 工作区开放"), requestId);
    }

    // ---- 1. 单一字段 body 闸门（canonical 路径无任何客户端输入面） ----
    if ([...url.searchParams.keys()].length > 0) {
      logEvent("warn", "proxy_upload_query_refused", {
        requestId,
        operation: "proxy_upload",
        stage: "query_rejection",
      });
      return failure(new ServiceError(400, "PROXY_NO_QUERY_PARAMETERS", "该端点不接受查询参数"), requestId);
    }
    let proxyRaw = "";
    try {
      proxyRaw = await req.text();
    } catch {
      proxyRaw = "";
    }
    if (proxyRaw.trim() === "") {
      return failure(new ServiceError(400, "PROXY_BODY_REQUIRED", "请求体必须包含 payload"), requestId);
    }
    let proxyInput: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(proxyRaw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return failure(new ServiceError(400, "PROXY_BODY_INVALID", "请求体必须是 JSON 对象"), requestId);
      }
      proxyInput = parsed as Record<string, unknown>;
    } catch {
      return failure(new ServiceError(400, "PROXY_BODY_INVALID", "请求体必须是 JSON 对象"), requestId);
    }
    const proxyKeys = Object.keys(proxyInput);
    if (proxyKeys.length !== 1 || proxyKeys[0] !== "payload") {
      logEvent("warn", "proxy_upload_fields_refused", {
        requestId,
        operation: "proxy_upload",
        stage: "field_whitelist",
        fieldCount: proxyKeys.length,
      });
      return failure(
        new ServiceError(400, "PROXY_UNEXPECTED_FIELDS", "请求体只允许 payload 一个字段"),
        requestId,
      );
    }
    const proxyB64 = typeof proxyInput.payload === "string" ? proxyInput.payload.trim() : "";
    if (proxyB64.length === 0) {
      return failure(new ServiceError(400, "PROXY_PAYLOAD_REQUIRED", "payload 不得为空"), requestId);
    }
    if (proxyB64.length > PROXY_MAX_BASE64_CHARS) {
      logEvent("warn", "proxy_upload_payload_too_large", {
        requestId,
        operation: "proxy_upload",
        stage: "size_cap",
        base64Length: proxyB64.length,
      });
      return failure(new ServiceError(413, "PROXY_PAYLOAD_TOO_LARGE", "payload 超出本切片上限"), requestId);
    }
    if (!/^[A-Za-z0-9+/]{4,}={0,2}$/.test(proxyB64)) {
      return failure(new ServiceError(400, "PROXY_PAYLOAD_NOT_BASE64", "payload 必须是标准 base64"), requestId);
    }

    // ---- 2. 解码 + 权威指纹硬闸（fail closed：不通过则一次写入都不会发生） ----
    let proxyBytes: Uint8Array;
    try {
      proxyBytes = b64Decode(proxyB64);
    } catch {
      return failure(new ServiceError(400, "PROXY_PAYLOAD_NOT_BASE64", "payload 必须是标准 base64"), requestId);
    }
    const proxySha = await sha256Hex(proxyBytes);
    const proxySizeOk = proxyBytes.byteLength === EXECUTE_EXPECTED_BYTES;
    const proxyHashOk = proxySha === EXECUTE_EXPECTED_SHA256;
    if (!proxySizeOk || !proxyHashOk) {
      logEvent("warn", "proxy_upload_fingerprint_rejected", {
        requestId,
        operation: "proxy_upload",
        stage: "integrity_gate",
        bytes: proxyBytes.byteLength,
        sizeOk: proxySizeOk,
        hashOk: proxyHashOk,
        writes: 0,
      });
      return failure(
        new ServiceError(422, "PROXY_FINGERPRINT_MISMATCH", "字节与服务端权威指纹不一致，已拒绝写入"),
        requestId,
      );
    }

    const proxyBucket = db.storage.from(MERCHANT_ASSETS_BUCKET);
    const proxyKey = `tenant/${scope.tenantId}/workspace/${scope.workspaceId}/images/${PROBE_BASENAME}`;
    const proxyPrefix = proxyKey.slice(0, proxyKey.lastIndexOf("/"));
    const proxyListOptions = { search: PROBE_BASENAME, limit: 10 };
    const proxyContentType =
      IMAGE_CONTENT_TYPE[PROBE_BASENAME.slice(PROBE_BASENAME.lastIndexOf(".") + 1).toLowerCase()] ||
      "application/octet-stream";

    // ---- 3. 写前存在性检查：已存在即 409，杜绝覆盖 ----
    const proxyBefore = await proxyBucket.list(proxyPrefix, proxyListOptions);
    if (proxyBefore.error) {
      logEvent("error", "proxy_upload_list_failed", {
        requestId,
        operation: "proxy_upload",
        stage: "list_before",
        ...storageErrorClassifiers(proxyBefore.error),
      });
      return failure(
        new ServiceError(503, "STORAGE_BACKEND_UNAVAILABLE", "素材服务暂时不可用，请稍后重试"),
        requestId,
      );
    }
    if ((proxyBefore.data || []).some((o) => String(o?.name || "") === PROBE_BASENAME)) {
      return failure(
        new ServiceError(409, "PROXY_CANONICAL_ALREADY_EXISTS", "canonical 对象已存在，不得二次写入或覆盖"),
        requestId,
      );
    }

    // ---- 4. 唯一一次写入（service_role 内网直连 Storage，不经 Kong） ----
    // 按 storage.md 口径传 ArrayBuffer 而非 Blob / FormData
    const proxyPut = await proxyBucket.upload(proxyKey, proxyBytes.buffer as ArrayBuffer, {
      contentType: proxyContentType,
      upsert: false,
    });
    const proxyPutData = (proxyPut.data ?? null) as unknown as Record<string, unknown> | null;
    const proxyEchoKey = typeof proxyPutData?.Key === "string" ? proxyPutData.Key : null;
    if (proxyPut.error || !proxyPutData) {
      logEvent("error", "proxy_upload_write_failed", {
        requestId,
        operation: "proxy_upload",
        stage: "storage_write",
        ...storageErrorClassifiers(proxyPut.error ?? { message: "empty upload result" }),
      });
      return failure(new ServiceError(502, "PROXY_UPLOAD_FAILED", "写入未成功"), requestId);
    }

    // ---- 5. 写后对账：目录表可见性 + 回读字节逐位一致 ----
    const proxyAfter = await proxyBucket.list(proxyPrefix, proxyListOptions);
    const proxyRows = (proxyAfter.data || []).filter((o) => String(o?.name || "") === PROBE_BASENAME);
    const proxyMeta = (proxyRows[0]?.metadata ?? null) as unknown as Record<string, unknown> | null;
    const proxyReadback = await proxyBucket.download(proxyKey);
    let proxyReadBytes = -1;
    let proxyReadSha = "";
    if (!proxyReadback.error && proxyReadback.data) {
      const buf = new Uint8Array(await proxyReadback.data.arrayBuffer());
      proxyReadBytes = buf.byteLength;
      proxyReadSha = await sha256Hex(buf);
    }
    const proxyRoundTripOk = proxyReadSha === EXECUTE_EXPECTED_SHA256;

    logEvent("warn", "proxy_upload_completed", {
      requestId,
      operation: "proxy_upload",
      stage: "complete",
      bytes: proxyBytes.byteLength,
      roundTripOk: proxyRoundTripOk,
      listedCount: proxyRows.length,
      echoKeyMatchesCanonical: proxyEchoKey === proxyKey,
    });

    await recordAudit(
      db,
      {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        actorType: "merchant",
        actorId: scope.userId,
        requestId,
      },
      "merchant.asset_proxy_upload",
      "storage_object",
      null,
      {
        path: proxyKey,
        bytes: proxyBytes.byteLength,
        sha256: proxySha,
        roundTripOk: proxyRoundTripOk,
      },
    );

    return success(
      {
        slice: "PROXY_UPLOAD_SLICE",
        bucket: MERCHANT_ASSETS_BUCKET,
        path: proxyKey,
        written: {
          bytes: proxyBytes.byteLength,
          sha256: proxySha,
          contentType: proxyContentType,
          upsert: false,
        },
        echoKeyMatchesCanonical: proxyEchoKey === proxyKey,
        listAfter: {
          count: proxyRows.length,
          size: proxyMeta && typeof proxyMeta.size === "number" ? proxyMeta.size : null,
          mimetype: proxyMeta && typeof proxyMeta.mimetype === "string" ? proxyMeta.mimetype : null,
        },
        readback: {
          ok: proxyRoundTripOk,
          bytes: proxyReadBytes,
          sha256: proxyRoundTripOk ? proxyReadSha : null,
        },
      },
      "canonical 对象已由服务端写入并通过回读指纹对账",
      requestId,
    );
  }
  /* === PROXY_UPLOAD_END === */

  /* === CAPACITY_TEST_BEGIN === */
  /**
   * POST /internal/storage/proxy-capacity-test —— 容量探针（临时端点）。
   * 闸门链与 proxy-upload 同构：resolveSession → assertScopeNotOverridden → assertCsrf
   * → 写闸门 → canonical 身份锁 → 无查询参数 → 双字段白名单 { testSize, payload }
   * → 档位 enum 严格校验 → base64 上限（先于解码）→ 解码 → 长度==档位
   * → 摘要==服务端权威常量 → 写前存在性检查（409）→ 唯一一次 upload → download 回读对账。
   * 日志与响应均不含 payload 原文、base64、service_role、会话 token。
   */
  if (path === CAPACITY_ROUTE) {
    if (req.method !== "POST") return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    if (!sessionWritesAllowed().allowed) {
      return failure(new ServiceError(503, "SESSION_BACKEND_READONLY", "会话写入已被实例闸门关闭"), requestId);
    }
    if (!hasConfiguredProbeScope()) {
      logEvent("warn", "capacity_test_disabled", { requestId, operation: "capacity_test", stage: "probe_scope_configuration" });
      return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
    }
    if (!matchesConfiguredProbeScope(scope)) {
      logEvent("warn", "capacity_test_scope_refused", {
        requestId,
        operation: "capacity_test",
        stage: "scope_identity",
      });
      await recordScopeIdentityDenial(db, scope, requestId, "capacity_test");
      return failure(new ServiceError(403, "CAPACITY_SCOPE_MISMATCH", "容量探针只对本轮 canonical 工作区开放"), requestId);
    }
    if ([...url.searchParams.keys()].length > 0) {
      logEvent("warn", "capacity_test_query_refused", {
        requestId,
        operation: "capacity_test",
        stage: "query_rejection",
      });
      return failure(new ServiceError(400, "CAPACITY_NO_QUERY_PARAMETERS", "该端点不接受查询参数"), requestId);
    }

    // ---- 1. 双字段白名单（objectKey 无任何客户端输入面） ----
    const capT0 = performance.now();
    let capRaw = "";
    try {
      capRaw = await req.text();
    } catch {
      capRaw = "";
    }
    const capBodyChars = capRaw.length;
    if (capRaw.trim() === "") {
      return failure(new ServiceError(400, "CAPACITY_BODY_REQUIRED", "请求体必须包含 testSize 与 payload"), requestId);
    }
    let capInput: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(capRaw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return failure(new ServiceError(400, "CAPACITY_BODY_INVALID", "请求体必须是 JSON 对象"), requestId);
      }
      capInput = parsed as Record<string, unknown>;
    } catch {
      return failure(new ServiceError(400, "CAPACITY_BODY_INVALID", "请求体必须是 JSON 对象"), requestId);
    }
    const capKeys = Object.keys(capInput).sort();
    if (capKeys.length !== 2 || capKeys[0] !== "payload" || capKeys[1] !== "testSize") {
      logEvent("warn", "capacity_test_fields_refused", {
        requestId,
        operation: "capacity_test",
        stage: "field_whitelist",
        fieldCount: capKeys.length,
      });
      return failure(
        new ServiceError(400, "CAPACITY_UNEXPECTED_FIELDS", "请求体只允许 testSize 与 payload 两个字段"),
        requestId,
      );
    }

    // ---- 2. 档位 enum：只允许 5 个固定值，杜绝任意 bytes 长度 ----
    const capSize = capInput.testSize;
    if (
      typeof capSize !== "number" ||
      !Number.isInteger(capSize) ||
      !Object.prototype.hasOwnProperty.call(CAPACITY_BASENAME, String(capSize))
    ) {
      logEvent("warn", "capacity_test_size_refused", {
        requestId,
        operation: "capacity_test",
        stage: "size_enum",
        sizeType: typeof capSize,
        sizeValue: typeof capSize === "number" ? capSize : null,
      });
      return failure(new ServiceError(400, "CAPACITY_SIZE_NOT_ALLOWED", "testSize 必须是固定档位之一"), requestId);
    }

    const capB64 = typeof capInput.payload === "string" ? capInput.payload.trim() : "";
    const capBase64Chars = capB64.length;
    if (capBase64Chars === 0) {
      return failure(new ServiceError(400, "CAPACITY_PAYLOAD_REQUIRED", "payload 不得为空"), requestId);
    }
    if (capBase64Chars > CAPACITY_MAX_BASE64_CHARS) {
      logEvent("warn", "capacity_test_payload_too_large", {
        requestId,
        operation: "capacity_test",
        stage: "application_size_cap",
        base64Chars: capBase64Chars,
        appCap: CAPACITY_MAX_BASE64_CHARS,
      });
      return failure(new ServiceError(413, "CAPACITY_PAYLOAD_TOO_LARGE", "payload 超出本探针应用层上限"), requestId);
    }
    if (!isStandardBase64(capB64)) {
      return failure(new ServiceError(400, "CAPACITY_PAYLOAD_NOT_BASE64", "payload 必须是标准 base64"), requestId);
    }

    // ---- 3. 解码 + 长度/摘要双硬闸（fail closed：不通过则一次写入都不会发生） ----
    const capDecodeT0 = performance.now();
    let capBytes: Uint8Array;
    try {
      capBytes = b64Decode(capB64);
    } catch {
      return failure(new ServiceError(400, "CAPACITY_PAYLOAD_NOT_BASE64", "payload 解码失败"), requestId);
    }
    const capDecodeMs = Math.round(performance.now() - capDecodeT0);
    if (capBytes.byteLength !== capSize) {
      logEvent("warn", "capacity_test_length_mismatch", {
        requestId,
        operation: "capacity_test",
        stage: "length_gate",
        expected: capSize,
        actual: capBytes.byteLength,
        writes: 0,
      });
      return failure(
        new ServiceError(422, "CAPACITY_LENGTH_MISMATCH", "解码字节数与档位不一致，已拒绝写入"),
        requestId,
      );
    }
    const capHashT0 = performance.now();
    const capSha = await sha256Hex(capBytes);
    const capHashMs = Math.round(performance.now() - capHashT0);
    const capAuthoritativeSha = CAPACITY_EXPECTED_SHA256[capSize];
    if (capSha !== capAuthoritativeSha) {
      logEvent("warn", "capacity_test_fingerprint_rejected", {
        requestId,
        operation: "capacity_test",
        stage: "integrity_gate",
        bytes: capBytes.byteLength,
        writes: 0,
      });
      return failure(
        new ServiceError(422, "CAPACITY_FINGERPRINT_MISMATCH", "字节与服务端权威指纹不一致，已拒绝写入"),
        requestId,
      );
    }

    // ---- 4. key 完全服务端派生，前缀与正式 images/ 隔离 ----
    const capBucket = db.storage.from(MERCHANT_ASSETS_BUCKET);
    const capBasename = CAPACITY_BASENAME[capSize];
    const capPrefix = `tenant/${scope.tenantId}/workspace/${scope.workspaceId}/${CAPACITY_PREFIX}`;
    const capacityKey = `${capPrefix}/${capBasename}`;
    const capListOptions = { search: capBasename, limit: 10 };

    // ---- 5. 写前存在性检查：已存在即 409，杜绝覆盖 ----
    const capBefore = await capBucket.list(capPrefix, capListOptions);
    if (capBefore.error) {
      logEvent("error", "capacity_test_list_failed", {
        requestId,
        operation: "capacity_test",
        stage: "list_before",
        bytes: capSize,
        ...storageErrorClassifiers(capBefore.error),
      });
      return failure(
        new ServiceError(503, "STORAGE_BACKEND_UNAVAILABLE", "素材服务暂时不可用，请稍后重试"),
        requestId,
      );
    }
    if ((capBefore.data || []).some((o) => String(o?.name || "") === capBasename)) {
      // 409 也必须留日志：幂等重放在服务端不可见是上一轮暴露的可观测性缺口
      logEvent("warn", "capacity_test_already_exists", {
        requestId,
        operation: "capacity_test",
        stage: "list_before",
        bytes: capSize,
        writes: 0,
      });
      return failure(
        new ServiceError(409, "CAPACITY_OBJECT_ALREADY_EXISTS", "该档位探针对象已存在，不得二次写入或覆盖"),
        requestId,
      );
    }

    // ---- 6. 唯一一次写入（service_role 内网直连 Storage，不经 Kong） ----
    const capUploadT0 = performance.now();
    const capPut = await capBucket.upload(capacityKey, capBytes.buffer as ArrayBuffer, {
      contentType: CAPACITY_CONTENT_TYPE,
      upsert: false,
    });
    const capUploadMs = Math.round(performance.now() - capUploadT0);
    const capPutData = (capPut.data ?? null) as unknown as Record<string, unknown> | null;
    const capEchoKey = typeof capPutData?.Key === "string" ? capPutData.Key : null;
    if (capPut.error || !capPutData) {
      logEvent("error", "capacity_test_write_failed", {
        requestId,
        operation: "capacity_test",
        stage: "storage_write",
        bytes: capSize,
        uploadMs: capUploadMs,
        ...storageErrorClassifiers(capPut.error ?? { message: "empty upload result" }),
      });
      return failure(new ServiceError(502, "CAPACITY_UPLOAD_FAILED", "写入未成功"), requestId);
    }

    // ---- 7. 写后回读对账（回读失败不谎报成功，也不谎报写入失败） ----
    const capDlT0 = performance.now();
    const capReadback = await capBucket.download(capacityKey);
    const capDownloadMs = Math.round(performance.now() - capDlT0);
    let capReadBytes = -1;
    let capReadSha = "";
    if (!capReadback.error && capReadback.data) {
      const buf = new Uint8Array(await capReadback.data.arrayBuffer());
      capReadBytes = buf.byteLength;
      capReadSha = await sha256Hex(buf);
    } else {
      logEvent("error", "capacity_test_readback_failed", {
        requestId,
        operation: "capacity_test",
        stage: "storage_download",
        bytes: capSize,
        ...storageErrorClassifiers(capReadback.error ?? { message: "empty download result" }),
      });
    }
    const capRoundTripOk = capReadSha === capAuthoritativeSha;
    const capTotalServerMs = Math.round(performance.now() - capT0);

    logEvent("warn", "capacity_test_completed", {
      requestId,
      operation: "capacity_test",
      stage: "complete",
      bytes: capSize,
      base64Chars: capBase64Chars,
      bodyChars: capBodyChars,
      decodeMs: capDecodeMs,
      hashMs: capHashMs,
      uploadMs: capUploadMs,
      downloadMs: capDownloadMs,
      totalServerMs: capTotalServerMs,
      roundTripOk: capRoundTripOk,
      echoKeyMatchesCanonical: capEchoKey === capacityKey,
    });

    await recordAudit(
      db,
      {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        actorType: "merchant",
        actorId: scope.userId,
        requestId,
      },
      "merchant.asset_capacity_probe",
      "storage_object",
      null,
      {
        path: capacityKey,
        bytes: capSize,
        sha256: capSha,
        roundTripOk: capRoundTripOk,
        uploadMs: capUploadMs,
      },
    );

    return success(
      {
        slice: "EDGE_FUNCTION_PROXY_UPLOAD_CAPACITY_GATE",
        bucket: MERCHANT_ASSETS_BUCKET,
        path: capacityKey,
        namespaceIsolated: !capacityKey.includes("/images/"),
        tier: { testSize: capSize, basename: capBasename },
        serverMeasure: {
          base64Chars: capBase64Chars,
          bodyChars: capBodyChars,
          decodeMs: capDecodeMs,
          hashMs: capHashMs,
          uploadMs: capUploadMs,
          downloadMs: capDownloadMs,
          totalServerMs: capTotalServerMs,
        },
        written: {
          bytes: capSize,
          sha256: capSha,
          contentType: CAPACITY_CONTENT_TYPE,
          upsert: false,
        },
        echoKeyMatchesCanonical: capEchoKey === capacityKey,
        readback: {
          ok: capRoundTripOk,
          bytes: capReadBytes,
          sha256: capRoundTripOk ? capReadSha : null,
        },
      },
      "容量探针对象已由服务端写入并通过回读指纹对账",
      requestId,
    );
  }
  /* === CAPACITY_TEST_END === */

  if (req.method === "GET" && path === "/auth/session") {
    return success(
      { user: scope.user, workspace: scope.workspace, subscription: scope.subscription, role: scope.role },
      "会话有效",
      requestId,
    );
  }

  if (req.method === "POST" && path === "/auth/logout") {
    if (!sessionWritesAllowed().allowed) {
      return failure(new ServiceError(503, "SESSION_BACKEND_READONLY", "会话写入已被实例闸门关闭"), requestId);
    }
    const { error } = await db
      .from("merchant_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", scope.sessionId);
    if (error) return failure(new ServiceError(500, "INTERNAL_ERROR", "服务暂时不可用"), requestId);
    await recordAudit(
      db,
      { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorType: "merchant", actorId: scope.userId, requestId },
      "merchant.logout",
      "merchant_session",
      scope.sessionId,
    );
    const cleared = "Path=/; Max-Age=0; SameSite=Lax";
    return success(null, "已退出登录", requestId, [
      ["set-cookie", `${SESSION_COOKIE}=; ${cleared}; HttpOnly`],
      ["set-cookie", `${CSRF_COOKIE}=; ${cleared}`],
    ]);
  }

  if (req.method === "GET" && path === "/api/config") {
    const config = await readConfig(db, scope);
    // 原实现直接返回 document 本体，版本号在响应头
    return json(config.document, 200, [["x-atelier-config-version", String(config.version)]]);
  }

  if (req.method === "GET" && path === "/v1/profile") {
    const row = await db
      .from("users")
      .select("id,login_identifier,display_name,avatar_url,status")
      .eq("id", scope.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!row.data) return failure(new ServiceError(404, "PROFILE_NOT_FOUND", "账户资料不存在"), requestId);
    return success(publicUser({ ...row.data, role: scope.role }), "账户资料已获取", requestId);
  }

  if (req.method === "GET" && path === "/v1/subscription") {
    return success(await getSubscription(db, scope), "订阅已获取", requestId);
  }

  if (req.method === "GET" && path === "/api/platform/bootstrap") {
    assertWritable(scope);
    const config = await readConfig(db, scope);
    const subscription = await getSubscription(db, scope);
    const aiPolicy = await getAiPolicy(db, scope);
    const document = (config.document || {}) as Record<string, unknown>;
    return json({
      ok: true,
      // 网关的 Access-Control-Expose-Headers 不含 x-atelier-config-version，
      // 跨源页面读不到该响应头，故版本号在体内再给一份（GET /api/config 的原始契约保持不变）
      configVersion: config.version,
      configUpdatedAt: config.updatedAt ?? null,
      workspace: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        storeId: scope.storeId,
        workspaceName: scope.workspace.name,
        storeName: scope.workspace.storeName,
        planId: String(subscription.planId || "").toLowerCase(),
        planName: subscription.planId,
        channelMode: "shared",
        roles: [scope.role],
      },
      subscription,
      plans: [
        { id: "trial", name: "24小时体验", monthlyPrice: 0 },
        { id: "pro", name: "PRO", monthlyPrice: 299 },
      ],
      publishJobs: [],
      ai: { status: "rules", provider: "rules" },
      aiPolicy: { ...aiPolicy, mode: "rules", connectionId: null },
      usage: {
        aiPointsUsed: 0,
        aiPointsLimit: 0,
        storageGbUsed: 0,
        storageGbLimit: 0,
        skuUsed: Array.isArray(document.products) ? document.products.length : 0,
        skuLimit: 0,
      },
    });
  }

  if (path === "/v1/business-templates") {
    return failure(
      new ServiceError(501, "NOT_PORTED", "业务模板实现体在 workspace-templates.js，该源码尚未取得，不猜响应形状"),
      requestId,
    );
  }

  if (path === "/v1/appointment-services" || path.startsWith("/api/media")) {
    return failure(
      new ServiceError(
        501,
        "NOT_PORTED",
        "预约/素材接口依赖 appointment-routes.js 与 workspace-media.js（未取得），且本实例 Storage 为空、素材字节未迁移",
      ),
      requestId,
    );
  }

  return failure(new ServiceError(404, "ROUTE_NOT_FOUND", "接口不存在"), requestId);
}

Deno.serve((req) => handle(req).catch((error) => failure(error, newRequestId("fatal"))));
