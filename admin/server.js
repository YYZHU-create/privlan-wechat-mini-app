/**
 * PRIVLAN 小程序管理面板 — 本地服务端 (WordPress 风格)
 * Express 提供 REST API + 静态文件服务
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, execFileSync } = require("child_process");
const platformStore = require("./platform-store");
const { callOpenAiCompatible, normalizeBaseUrl } = require("./ai-gateway");
const { createDatabaseFromEnv } = require("./database");
const { createSaasService } = require("./saas-service");
const { createSupabaseAdapter, createMeooAuthRepository } = require("./meoo-supabase-adapter");
const { createMeooAppointmentRepository } = require("./meoo-appointment-repository");
const { createMeooCustomerRepository, createMeooAppointmentReadRepository } = require("./meoo-center-repositories");
const { createMeooCustomerWriteRepository, createMeooAppointmentWriteRepository } = require("./meoo-write-repositories");
const { createMeooMediaRepository } = require("./meoo-media-repository");
const { createMeooLaunchV1Repository } = require("./meoo-launch-v1-repository");
const { createMeooOperatorRepository } = require("./meoo-operator-repository");
const { registerMerchantRoutes, registerOpsAuthRoutes, registerOpsSaasRoutes } = require("./merchant-routes");
const { registerAppointmentGatewayRoutes } = require("./appointment-routes");
const { registerLaunchV1Routes, registerLaunchV1OpsRoutes } = require("./launch-v1-routes");
const { validateProductionEnvironment, validateDatabaseBackend } = require("./runtime-config");
const { resolveRuntimeIdentity } = require("./runtime-identity");
const { buildPreviewPackage, formatBytes } = require("./preview-package");

validateProductionEnvironment(process.env);
const DATABASE_BACKEND = validateDatabaseBackend(process.env);

const ROOT = path.resolve(process.env.PRIVLAN_ROOT || path.join(__dirname, ".."));
const RUNTIME_IDENTITY = resolveRuntimeIdentity({ env: process.env, repoRoot: ROOT });
const CONFIG_PATH = path.resolve(process.env.PRIVLAN_CONFIG_PATH || path.join(__dirname, "config.json"));
const CONFIG_BACKUP_DIR = path.resolve(process.env.PRIVLAN_CONFIG_BACKUP_DIR || path.join(__dirname, "config-backups"));
const IMAGES_DIR = path.resolve(process.env.PRIVLAN_IMAGES_DIR || path.join(ROOT, "images"));
const FONTS_DIR = path.resolve(process.env.PRIVLAN_FONTS_DIR || path.join(ROOT, "fonts"));
const MEDIA_FOLDERS_PATH = path.resolve(process.env.PRIVLAN_MEDIA_FOLDERS_PATH || path.join(__dirname, "media-folders.json"));
const SYSTEM_FONTS_DIR = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
const PREVIEW_QR_PATH = path.resolve(process.env.PRIVLAN_PREVIEW_QR_PATH || path.join(path.dirname(ROOT), "preview-qr.png"));
const PREVIEW_ROOT_BASE = path.resolve(process.env.PRIVLAN_PREVIEW_ROOT_BASE || path.join(path.dirname(ROOT), `${path.basename(ROOT)}-preview`));
const PREVIEW_IMAGE_MAX_EDGE = 960;
const PREVIEW_IMAGE_QUALITY = 72;
const PREVIEW_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
const HOST = process.env.HOST || process.env.PRIVLAN_ADMIN_HOST || "0.0.0.0";
const ADMIN_TOKEN = String(process.env.PRIVLAN_ADMIN_TOKEN || "").trim();
const SAAS_DATABASE_ENABLED = Boolean(process.env.DATABASE_URL || DATABASE_BACKEND === "meoo" || (process.env.NODE_ENV === "test" && process.env.ATELIER_TEST_DATABASE === "portable"));
const LEGACY_LOCAL_MODE = !SAAS_DATABASE_ENABLED;
const TRASH_DIR = path.resolve(process.env.PRIVLAN_MEDIA_TRASH_DIR || path.join(__dirname, "media-trash"));
const TRASH_MANIFEST_PATH = path.join(TRASH_DIR, "manifest.json");
const ATELIER_DATA_ROOT = path.resolve(process.env.ATELIER_DATA_ROOT || path.join(__dirname, "data"));
const OPS_BOOTSTRAP_PATH = path.resolve(process.env.PRIVLAN_OPS_BOOTSTRAP_PATH || path.join(__dirname, ".ops-bootstrap.json"));
let previewBuildCount = 0;
const aiUsage = { inputTokens: 0, outputTokens: 0, requests: 0, fallbackRequests: 0, errors: 0 };
const operatorSessions = new Map();
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(FONTS_DIR, { recursive: true });
fs.mkdirSync(CONFIG_BACKUP_DIR, { recursive: true });
fs.mkdirSync(TRASH_DIR, { recursive: true });

const app = express();
const PORT = Number(process.env.PORT || 9000);
const databasePromise = createDatabaseFromEnv();
const meooAdapter = DATABASE_BACKEND === "meoo" ? createSupabaseAdapter() : null;
const meooAuthRepository = DATABASE_BACKEND === "meoo" ? createMeooAuthRepository() : null;
const meooOperatorRepository = DATABASE_BACKEND === "meoo" ? createMeooOperatorRepository() : null;
const saasServicePromise = databasePromise.then(database => database ? createSaasService({
  db: database,
  tagRepository: meooAdapter,
  appointmentRepository: meooAdapter ? createMeooAppointmentRepository({ adapter: meooAdapter }) : null,
  customerRepository: meooAdapter ? createMeooCustomerRepository({ adapter: meooAdapter }) : null,
  customerWriteRepository: meooAdapter ? createMeooCustomerWriteRepository({ adapter: meooAdapter }) : null,
  appointmentWriteRepository: meooAdapter ? createMeooAppointmentWriteRepository({ adapter: meooAdapter }) : null,
  appointmentReadRepository: meooAdapter ? createMeooAppointmentReadRepository({ adapter: meooAdapter }) : null,
  meooLaunchRepository: meooAdapter ? createMeooLaunchV1Repository({ adapter: meooAdapter }) : null,
  authRepository: database?.authRepository || meooAuthRepository,
  configRepository: meooAdapter,
  operatorRepository: meooOperatorRepository
}) : null);
const getSaasService = () => saasServicePromise;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
});

const mutationRequests = new Map();
const localHost = ["127.0.0.1", "localhost", "::1"].includes(HOST);
function requestOriginHost(req) {
  const forwarded = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  return forwarded || String(req.get("host") || "").trim();
}

function originMatchesRequest(req, origin) {
  const originHost = new URL(origin).host;
  if (originHost === requestOriginHost(req)) return true;
  const configuredHosts = [
    process.env.ATELIER_PUBLIC_HOST,
    process.env.MEOO_PUBLIC_HOST,
    process.env.MEOO_PROJECT_URL_ID ? `${process.env.MEOO_PROJECT_URL_ID}.meoo.pub` : "",
    process.env.SUPABASE_PUBLIC_URL,
    process.env.SUPABASE_URL
  ].map(value => { try { return new URL(String(value || "")).host; } catch { return String(value || "").trim(); } }).filter(Boolean);
  return configuredHosts.includes(originHost);
}

function validAdminToken(req) {
  const supplied = String(req.get("x-privlan-token") || req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!ADMIN_TOKEN || supplied.length !== ADMIN_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(ADMIN_TOKEN));
}
app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  const origin = String(req.get("origin") || "");
  if (origin) {
    try {
      if (!originMatchesRequest(req, origin)) return res.status(403).json({ error: "请求来源不受信任" });
    } catch (error) {
      return res.status(403).json({ error: "请求来源无效" });
    }
  }
  if (!SAAS_DATABASE_ENABLED && !localHost && !validAdminToken(req)) return res.status(401).json({ error: "需要后台访问令牌" });
  if (["GET", "HEAD"].includes(req.method)) return next();
  const client = req.ip || req.socket.remoteAddress || "local";
  const now = Date.now();
  const recent = (mutationRequests.get(client) || []).filter(time => now - time < 60_000);
  if (recent.length >= 120) return res.status(429).json({ error: "操作过于频繁，请稍后重试" });
  recent.push(now);
  mutationRequests.set(client, recent);
  next();
});
app.use("/v1", (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  if (req.path === "/ai/query" && req.method === "POST") return next();
  const origin = String(req.get("origin") || "");
  if (origin) {
    try {
      if (!originMatchesRequest(req, origin)) return res.status(403).json({ ok: false, error: "请求来源不受信任" });
    } catch (error) {
      return res.status(403).json({ ok: false, error: "请求来源无效" });
    }
  }
  if (!SAAS_DATABASE_ENABLED && !localHost && !validAdminToken(req)) return res.status(401).json({ ok: false, error: "需要商户后台访问令牌" });
  if (["GET", "HEAD"].includes(req.method)) return next();
  const client = `v1:${req.ip || req.socket.remoteAddress || "local"}`;
  const now = Date.now();
  const recent = (mutationRequests.get(client) || []).filter(time => now - time < 60_000);
  if (recent.length >= 120) return res.status(429).json({ ok: false, error: "操作过于频繁，请稍后重试" });
  recent.push(now);
  mutationRequests.set(client, recent);
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/ops", express.static(path.join(__dirname, "ops-public")));
app.use("/ops/v1", async (req, res, next) => {
  if (!localHost && !process.env.ATELIER_OPS_PASSWORD) {
    try {
      const service = await getSaasService();
      if (!service || !(await service.operatorAuthConfigured())) return res.status(503).json({ ok: false, code: "OPS_REMOTE_DISABLED", error: "远程运营后台未配置安全密码，已拒绝访问" });
    } catch (error) {
      return res.status(503).json({ ok: false, code: "OPS_REMOTE_DISABLED", error: "远程运营后台未配置安全密码，已拒绝访问" });
    }
  }
  next();
});
app.use(["/api/media/upload"], express.json({ limit: "110mb" }));
app.use(["/api/fonts/upload"], express.json({ limit: "12mb" }));
app.use(express.json({ limit: "2mb" }));
registerAppointmentGatewayRoutes(app, getSaasService);
registerMerchantRoutes(app, getSaasService, { dataRoot: ATELIER_DATA_ROOT, runtimeIdentity: RUNTIME_IDENTITY, mediaRepository: meooAdapter ? createMeooMediaRepository() : null });
registerLaunchV1Routes(app);
registerOpsAuthRoutes(app, getSaasService);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
// 静态服务小程序 images 目录（管理面板内预览图片用）
app.use("/mp-images", express.static(IMAGES_DIR));
app.use("/mp-fonts", express.static(FONTS_DIR));

// ---- 工具函数 ----
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}
function suspiciousQuestionPaths(value, currentPath = "", result = []) {
  if (typeof value === "string") {
    if (/\?{2,}/.test(value)) result.push(currentPath || "config");
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => suspiciousQuestionPaths(item, `${currentPath}[${index}]`, result));
    return result;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => suspiciousQuestionPaths(item, currentPath ? `${currentPath}.${key}` : key, result));
  }
  return result;
}
function assertConfigEncoding(cfg) {
  const paths = suspiciousQuestionPaths(cfg);
  if (!paths.length) return;
  const error = new Error(`检测到中文可能被转换为问号，已阻止保存。异常字段：${paths.slice(0, 6).join("、")}${paths.length > 6 ? " 等" : ""}`);
  error.code = "CONFIG_ENCODING_CORRUPTION";
  throw error;
}
function backupConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(CONFIG_PATH, path.join(CONFIG_BACKUP_DIR, `config-${stamp}.json`));
  const backups = fs.readdirSync(CONFIG_BACKUP_DIR)
    .filter(name => /^config-.*\.json$/.test(name))
    .sort()
    .reverse();
  backups.slice(20).forEach(name => fs.rmSync(path.join(CONFIG_BACKUP_DIR, name), { force: true }));
}
function writeConfig(cfg) {
  assertConfigEncoding(cfg);
  backupConfig();
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cfg, null, 2), "utf-8");
  fs.renameSync(tempPath, CONFIG_PATH);
}

function readSaasState() {
  return platformStore.readState();
}

function writeSaasState(state) {
  return platformStore.writeState(state);
}

function requestId(prefix = "req") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function parseCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((result, part) => {
    const index = part.indexOf("=");
    if (index < 0) return result;
    result[decodeURIComponent(part.slice(0, index).trim())] = decodeURIComponent(part.slice(index + 1).trim());
    return result;
  }, {});
}

function ensureLocalOperator() {
  if (!LEGACY_LOCAL_MODE) return;
  const state = readSaasState();
  const email = String(process.env.ATELIER_OPS_EMAIL || "ops-admin@localhost").trim().toLowerCase();
  let password = String(process.env.ATELIER_OPS_PASSWORD || "");
  if (!password && (HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1")) {
    try {
      const bootstrap = JSON.parse(fs.readFileSync(OPS_BOOTSTRAP_PATH, "utf8"));
      password = String(bootstrap.password || "");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!password) {
      password = `${crypto.randomBytes(15).toString("base64url")}!A7`;
      fs.writeFileSync(OPS_BOOTSTRAP_PATH, JSON.stringify({ email, password, createdAt: new Date().toISOString() }, null, 2), { encoding: "utf8", mode: 0o600 });
      console.log(`  Local ops   ${email} / ${password}`);
    }
  }
  const existing = state.operatorUsers.find(item => item.email === email);
  if (existing) {
    const passwordSource = process.env.ATELIER_OPS_PASSWORD ? "environment" : "local_bootstrap";
    const passwordFingerprint = crypto.createHash("sha256").update(password).digest("hex");
    if (password && (existing.passwordSource !== passwordSource || existing.passwordFingerprint !== passwordFingerprint)) {
      existing.passwordHash = platformStore.hashPassword(password);
      existing.passwordSource = passwordSource;
      existing.passwordFingerprint = passwordFingerprint;
      existing.updatedAt = new Date().toISOString();
      platformStore.appendAudit(state, { actorType: "system", actorId: "bootstrap", action: "operator.password_bootstrap", resourceType: "operator_user", resourceId: existing.id, tenantId: null, metadata: { source: "environment" } });
      writeSaasState(state);
    }
    return;
  }
  if (HOST !== "127.0.0.1" && HOST !== "localhost" && !process.env.ATELIER_OPS_PASSWORD) {
    console.warn("ATELIER_OPS_PASSWORD 未配置，运营后台登录已禁用");
    return;
  }
  state.operatorUsers.push({ id: requestId("operator"), email, name: "Feeldao OS 管理员", role: "super_admin", passwordHash: platformStore.hashPassword(password), passwordSource: process.env.ATELIER_OPS_PASSWORD ? "environment" : "local_bootstrap", passwordFingerprint: crypto.createHash("sha256").update(password).digest("hex"), status: "active", createdAt: new Date().toISOString() });
  platformStore.appendAudit(state, { actorType: "system", actorId: "bootstrap", action: "operator.create", resourceType: "operator_user", resourceId: state.operatorUsers[0].id, tenantId: null, metadata: { localBootstrap: !process.env.ATELIER_OPS_PASSWORD } });
  writeSaasState(state);
}

function operatorSession(req) {
  const token = parseCookies(req).atelier_ops_session || String(req.get("x-atelier-ops-session") || "");
  const session = operatorSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) operatorSessions.delete(token);
    return null;
  }
  return session;
}

async function requireOperator(req, res, next) {
  const service = await getSaasService();
  const session = service
    ? await service.resolveOperatorSession(parseCookies(req).atelier_ops_session || String(req.get("x-atelier-ops-session") || ""))
    : operatorSession(req);
  if (!session) return res.status(401).json({ ok: false, code: "OPS_AUTH_REQUIRED", error: "请登录 Feeldao OS 运营后台" });
  req.operator = session;
  next();
}

function safeOperatorUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function appendAuditAndWrite(state, event) {
  platformStore.appendAudit(state, event);
  return writeSaasState(state);
}

function aiSuccess(res, { status = 200, code = "OK", message = "操作成功", data = null, requestId: id = requestId("ai"), legacy = {} } = {}) {
  return res.status(status).json({ ok: true, code, message, data, requestId: id, ...legacy });
}

function aiFailure(res, status, code, message, id = requestId("ai"), data = null) {
  return res.status(status).json({ ok: false, code, message, error: message, data, requestId: id });
}

function isMerchantConnectionForStore(connection, state) {
  return connection?.ownerType === "merchant"
    && connection.tenantId === state.workspace.tenantId
    && connection.storeId === state.workspace.storeId;
}

function connectionFromInput(input, scope) {
  const providerPreset = String(input.providerPreset || "openai-compatible");
  const preset = platformStore.PROVIDER_PRESETS.find(item => item.id === providerPreset) || platformStore.PROVIDER_PRESETS.at(-1);
  const baseUrl = normalizeBaseUrl(input.baseUrl || preset.baseUrl);
  const model = String(input.model || preset.model || "").trim().slice(0, 120);
  const apiKey = String(input.apiKey || "").trim();
  const protocol = String(input.protocol || preset.protocol || "openai").trim();
  if (protocol !== "openai") throw new Error("当前仅支持 OpenAI Chat Completions 兼容协议；其他协议需要平台适配器");
  if (!model) throw new Error("请输入模型名称");
  if (!apiKey) throw new Error("请输入 API Key");
  return {
    id: requestId("aic"),
    tenantId: scope.tenantId,
    storeId: scope.storeId || null,
    ownerType: scope.ownerType,
    providerPreset,
    providerName: String(input.providerName || preset.name || "自定义模型").trim().slice(0, 60),
    protocol,
    baseUrl,
    model,
    timeoutMs: Math.min(60000, Math.max(3000, Number(input.timeoutMs) || 12000)),
    maxTokens: Math.min(2000, Math.max(100, Number(input.maxTokens) || 500)),
    temperature: Math.min(1, Math.max(0, Number(input.temperature) || 0.2)),
    status: "active",
    lastTestOk: null,
    lastTestAt: null,
    lastError: "",
    secret: platformStore.encryptSecret(apiKey),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function currentScopedIds(req, state) {
  const requestedTenant = String(req.get("x-tenant-id") || req.query.tenantId || req.body?.tenantId || state.workspace.tenantId);
  const requestedStore = String(req.get("x-store-id") || req.query.storeId || req.body?.storeId || state.workspace.storeId);
  if (requestedTenant !== state.workspace.tenantId || requestedStore !== state.workspace.storeId) return null;
  return { tenantId: requestedTenant, storeId: requestedStore };
}

function weightedPoints(usage) {
  return Math.max(0, Number(usage?.prompt_tokens || 0) + Number(usage?.completion_tokens || 0) * 4);
}

ensureLocalOperator();

function publicAiStatus() {
  const state = readSaasState();
  migrateLegacyAiConnection(state);
  const policy = platformStore.findScopedPolicy(state, state.workspace.tenantId, state.workspace.storeId);
  const selectedId = policy.mode === "platform" ? policy.platformConnectionId : policy.connectionId;
  const connection = state.aiConnections.find(item => item.id === selectedId && item.status !== "disabled"
    && (policy.mode === "platform" ? item.ownerType === "platform" : isMerchantConnectionForStore(item, state)));
  return {
    configured: Boolean(connection),
    provider: connection?.providerName || "rules",
    status: connection ? (connection.lastTestOk === false ? "error" : "online") : "fallback",
    model: connection?.model || "rules",
    mode: connection ? policy.mode : "rules",
    connectionId: connection?.id || null,
    endpoint: connection ? "configured" : "missing",
    retention: "session_only",
    answerProvider: connection ? "tenant_ai_rag" : "rules"
  };
}

function migrateLegacyAiConnection(state) {
  if (!process.env.DEEPSEEK_API_KEY || state.aiConnections.some(item => item.migratedFrom === "DEEPSEEK_API_KEY")) return state;
  const connection = {
    id: requestId("aic"), tenantId: "platform", storeId: null, ownerType: "platform", providerPreset: "deepseek",
    providerName: "DeepSeek", protocol: "openai", baseUrl: String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
    model: String(process.env.DEEPSEEK_MODEL || "deepseek-chat"), status: "active", lastTestOk: null, lastTestAt: null,
    secret: platformStore.encryptSecret(process.env.DEEPSEEK_API_KEY), migratedFrom: "DEEPSEEK_API_KEY", createdAt: new Date().toISOString()
  };
  state.aiConnections.push(connection);
  const policy = platformStore.findScopedPolicy(state, state.workspace.tenantId, state.workspace.storeId);
  policy.mode = "platform";
  policy.platformConnectionId = connection.id;
  const existing = state.aiPolicies.findIndex(item => item.tenantId === policy.tenantId && item.storeId === policy.storeId);
  if (existing >= 0) state.aiPolicies[existing] = policy; else state.aiPolicies.push(policy);
  platformStore.appendAudit(state, { actorType: "system", actorId: "migration", action: "ai.connection.migrate", resourceType: "ai_connection", resourceId: connection.id, tenantId: state.workspace.tenantId, metadata: { source: "DEEPSEEK_API_KEY" } });
  writeSaasState(state);
  return state;
}

function fallbackFaq(text, cfg) {
  const configuredFaqs = Array.isArray(cfg.serviceBot?.faqs) ? cfg.serviceBot.faqs : [];
  const matched = configuredFaqs.find(item => {
    if (item?.enabled === false || !item?.answer) return false;
    const question = String(item.question || "").trim();
    const keywords = Array.isArray(item.keywords) ? item.keywords : [];
    return (question && (text === question || text.includes(question))) || keywords.some(keyword => keyword && text.includes(String(keyword)));
  });
  if (matched) return { type: "faq", content: String(matched.answer), citations: [`店铺问答：${matched.question}`] };
  const product = (cfg.products || []).find(item => text.includes(String(item.name || "")) || text.includes(String(item.id || "")));
  if (product) return { type: "product", content: `${product.name} 当前标价为 ¥${Number(product.price || 0).toLocaleString("zh-CN")}。你还可以询问颜色、尺码或预约顾问。`, citations: [`商品 #${product.id}`] };
  return { type: "action", content: "现有知识中没有足够信息回答这个问题。你可以补充具体商品或需求，或转接人工顾问。", citations: [], actions: [{ id: "human", label: "转人工服务" }] };
}

function deterministicServiceAction(text) {
  if (/量体|我的尺寸|身体数据/.test(text)) return { type: "action", content: "查看量体资料前需要验证客户身份。", actions: [{ id: "verify_identity", label: "验证身份" }] };
  if (/订单|物流|发货/.test(text)) return { type: "action", content: "查询订单需要验证手机号并选择对应订单。", actions: [{ id: "open_orders", label: "查询我的订单" }] };
  if (/预约/.test(text)) return { type: "action", content: "可以进入预约流程选择日期和时间。系统会预留 135 分钟并避免时段冲突。", actions: [{ id: "appointment", label: "开始预约" }] };
  if (/退款|退货|售后/.test(text)) return { type: "action", content: "退款与售后需要在订单中发起，系统会校验订单和支付状态。", actions: [{ id: "after_sales", label: "申请售后" }] };
  return null;
}

function knowledgeContext(cfg) {
  const products = (cfg.products || []).slice(0, 30).map(item => ({ id: item.id, name: item.name, price: item.price, category: item.cat, description: item.description || item.detail || "" }));
  const categories = (cfg.categories || []).map(item => ({ id: item.id, name: item.name }));
  const faqs = (cfg.serviceBot?.faqs || []).filter(item => item?.enabled !== false).slice(0, 100).map(item => ({ question: item.question, keywords: item.keywords, answer: item.answer }));
  const notes = (cfg.serviceBot?.knowledgeNotes || []).slice(0, 30).map(item => ({ title: item.title, content: item.content }));
  return JSON.stringify({ brand: cfg.brand, products, categories, faqs, notes });
}

function selectedAiConnection(state, tenantId, storeId) {
  migrateLegacyAiConnection(state);
  const policy = platformStore.findScopedPolicy(state, tenantId, storeId);
  const connectionId = policy.mode === "platform" ? policy.platformConnectionId : policy.connectionId;
  const connection = state.aiConnections.find(item => item.id === connectionId && item.status !== "disabled"
    && (policy.mode === "platform"
      ? item.ownerType === "platform"
      : item.ownerType === "merchant" && item.tenantId === tenantId && item.storeId === storeId));
  return { policy, connection };
}

async function queryConfiguredModel(text, cfg, state, tenantId, storeId) {
  const { policy, connection } = selectedAiConnection(state, tenantId, storeId);
  if (!connection || policy.mode === "rules") return null;
  let reservationId = null;
  if (policy.mode === "platform") {
    const plan = state.plans.find(item => item.id === state.workspace.planId);
    const used = state.aiUsageEvents.filter(item => item.tenantId === tenantId && item.billingMode === "platform").reduce((total, item) => total + Number(item.weightedPoints || 0), 0);
    const reserved = state.aiReservations.filter(item => item.tenantId === tenantId).reduce((total, item) => total + Number(item.points || 0), 0);
    const estimatedPoints = Math.max(2000, Number(connection.maxTokens || 500) * 4 + 2000);
    if (Number.isFinite(plan?.aiPoints) && used + reserved + estimatedPoints > plan.aiPoints) throw Object.assign(new Error("平台托管 AI 额度不足，请改用自带 API 或购买额度"), { code: "AI_QUOTA_EXHAUSTED" });
    reservationId = requestId("air");
    state.aiReservations.push({ id: reservationId, tenantId, storeId, points: estimatedPoints, expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString() });
    writeSaasState(state);
  }
  try {
    const answer = await callOpenAiCompatible({
      baseUrl: connection.baseUrl,
      apiKey: platformStore.decryptSecret(connection.secret),
      model: connection.model,
      text,
      context: knowledgeContext(cfg),
      timeoutMs: connection.timeoutMs || 12000,
      temperature: connection.temperature ?? 0.2,
      maxTokens: connection.maxTokens || 500
    });
    if (reservationId) {
      const latest = readSaasState();
      latest.aiReservations = latest.aiReservations.filter(item => item.id !== reservationId);
      writeSaasState(latest);
    }
    return { ...answer, connection, policy };
  } catch (error) {
    if (reservationId) {
      const latest = readSaasState();
      latest.aiReservations = latest.aiReservations.filter(item => item.id !== reservationId);
      writeSaasState(latest);
    }
    throw error;
  }
}

function collectConfigAssetPaths(cfg) {
  const paths = new Set();
  const visit = value => {
    if (typeof value === "string" && /^\/(images|fonts)\/[A-Za-z0-9._-]+$/.test(value)) paths.add(value.slice(1));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(cfg);
  return [...paths];
}

function normalizeGitPathspec(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) return "";
  return normalized;
}

function autoSyncGitHub(reason = "editor save", ownedPaths = []) {
  if (process.env.PRIVLAN_DISABLE_GIT_SYNC === "1") return { ok: true, skipped: true, reason: "disabled" };
  const bundledGit = path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "git", "cmd", "git.exe");
  const gitPath = process.env.PRIVLAN_GIT_BIN || (fs.existsSync(bundledGit) ? bundledGit : "git");
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    return { ok: false, skipped: true, error: "当前项目未连接 Git 仓库" };
  }
  const runGit = args => execFileSync(gitPath, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 120000 });
  try {
    const allowed = [...new Set(["admin/config.json", ...ownedPaths].map(normalizeGitPathspec).filter(Boolean))];
    if (!allowed.length) return { ok: true, committed: false, pushed: false, files: [] };
    runGit(["add", "-A", "--", ...allowed]);
    try {
      runGit(["diff", "--cached", "--quiet"]);
      return { ok: true, committed: false, pushed: false, files: [] };
    } catch (diffError) {
      if (diffError.status !== 1) throw diffError;
    }
    const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
    runGit(["commit", "-m", `chore: sync ${reason} (${stamp})`]);
    runGit(["push", "origin", "HEAD:main"]);
    const commit = runGit(["rev-parse", "--short", "HEAD"]).trim();
    return { ok: true, committed: true, pushed: true, commit, files: allowed };
  } catch (error) {
    return { ok: false, error: error.stderr?.toString()?.trim() || error.message };
  }
}

function readMediaFolders() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEDIA_FOLDERS_PATH, "utf-8"));
    return { folders: Array.isArray(parsed.folders) ? parsed.folders : [], assignments: parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {} };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { folders: [], assignments: {} };
  }
}

function writeMediaFolders(data) {
  const tempPath = `${MEDIA_FOLDERS_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempPath, MEDIA_FOLDERS_PATH);
}

function readTrashManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TRASH_MANIFEST_PATH, "utf-8"));
    return Array.isArray(parsed.items) ? parsed : { items: [] };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { items: [] };
  }
}

function writeTrashManifest(data) {
  const tempPath = `${TRASH_MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempPath, TRASH_MANIFEST_PATH);
}

function purgeExpiredMediaTrash(data = readTrashManifest()) {
  const now = Date.now();
  const active = [];
  let changed = false;
  for (const item of data.items) {
    const filePath = path.join(TRASH_DIR, path.basename(String(item.storedName || "")));
    const expired = Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) <= now;
    if (expired || !fs.existsSync(filePath)) {
      if (expired && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      changed = true;
      continue;
    }
    active.push(item);
  }
  if (changed) writeTrashManifest({ ...data, items: active });
  return { ...data, items: active };
}

function configMediaUsage(cfg) {
  const usage = {};
  const visit = (value, trail = "配置") => {
    if (typeof value === "string" && /^\/images\/[A-Za-z0-9._-]+$/.test(value)) {
      const name = path.basename(value);
      usage[name] ||= [];
      usage[name].push(trail);
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${trail}[${index}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, `${trail}.${key}`));
  };
  visit(cfg);
  return usage;
}

function moveMediaToTrash(name, folderId = "") {
  const sourcePath = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(sourcePath)) return null;
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const storedName = `${id}-${name}`;
  fs.renameSync(sourcePath, path.join(TRASH_DIR, storedName));
  return { id, name, storedName, folderId, deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() };
}

function normalizeMediaFolderId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

const MEDIA_FORMATS = [
  { format: "jpeg", extensions: [".jpg", ".jpeg"], mimes: ["image/jpeg"], kind: "image", matches: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { format: "png", extensions: [".png"], mimes: ["image/png"], kind: "image", matches: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { format: "gif", extensions: [".gif"], mimes: ["image/gif"], kind: "image", matches: buffer => ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")) },
  { format: "webp", extensions: [".webp"], mimes: ["image/webp"], kind: "image", matches: buffer => buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" },
  { format: "mp4", extensions: [".mp4"], mimes: ["video/mp4"], kind: "video", matches: buffer => buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp" },
  { format: "mov", extensions: [".mov"], mimes: ["video/quicktime"], kind: "video", matches: buffer => buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp" },
  { format: "webm", extensions: [".webm"], mimes: ["video/webm"], kind: "video", matches: buffer => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }
];

function decodeMediaUpload(name, data) {
  const match = String(data || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || match[2].length % 4 !== 0) throw Object.assign(new Error("媒体数据必须是有效的 Base64 Data URL"), { status: 400 });
  const mime = match[1].toLowerCase();
  const encoded = match[2];
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) throw Object.assign(new Error("媒体 Base64 数据无效"), { status: 400 });
  const extension = path.extname(String(name || "")).toLowerCase();
  const declared = MEDIA_FORMATS.find(item => item.extensions.includes(extension) && item.mimes.includes(mime));
  if (!declared) throw Object.assign(new Error("文件扩展名与 MIME 类型不一致"), { status: 400 });
  if (!declared.matches(buffer)) throw Object.assign(new Error("文件内容与声明的媒体格式不一致"), { status: 400 });
  return { buffer, kind: declared.kind, format: declared.format, mime, extension };
}

function packageAssetWarnings(cfg) {
  return collectConfigAssetPaths(cfg).filter(relative => relative.startsWith("images/")).map(relative => {
    const filePath = path.join(ROOT, relative);
    if (!fs.existsSync(filePath)) return null;
    const size = fs.statSync(filePath).size;
    return size > 5 * 1024 * 1024 ? { path: `/${relative.replace(/\\/g, "/")}`, size, message: "该素材应迁移至 CDN/COS 后再用于正式发布。" } : null;
  }).filter(Boolean);
}

function presentPublishJob(job) {
  if (job.kind === "local_sync" || (job.environment === "开发预览" && job.status === "succeeded")) {
    return { ...job, kind: "local_sync", environment: "preview", channel: "本地微信开发项目", status: "generated", statusLabel: "已生成开发预览" };
  }
  return job;
}

function findWechatDevtoolsCli() {
  const candidates = [
    process.env.WECHAT_DEVTOOLS_CLI,
    "E:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
    "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
    "C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat"
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}
function listSystemFonts() {
  if (process.platform !== "win32") return [];
  const output = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"], { encoding: "utf8", windowsHide: true });
  const seen = new Set();
  return output.split(/\r?\n/).map(line => {
    const match = line.match(/^\s{2,}(.+?)\s+REG_\w+\s+(.+?)\s*$/);
    if (!match) return null;
    const name = match[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, "").trim();
    const file = path.basename(match[2].trim());
    const filePath = path.join(SYSTEM_FONTS_DIR, file);
    const key = `${name}|${file}`.toLowerCase();
    if (!name || seen.has(key) || !fs.existsSync(filePath)) return null;
    seen.add(key);
    const stat = fs.statSync(filePath);
    return { name, file, format: path.extname(file).slice(1).toLowerCase(), sizeKB: Math.round(stat.size / 1024) };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function buildPreviewProject() {
  previewBuildCount += 1;
  const previewRoot = `${PREVIEW_ROOT_BASE}-${Date.now()}-${process.pid}-${previewBuildCount}`;
  return buildPreviewPackage({
    projectRoot: ROOT,
    previewRoot,
    imageMaxEdge: PREVIEW_IMAGE_MAX_EDGE,
    imageQuality: PREVIEW_IMAGE_QUALITY
  });
}

function migrateCenterTabCrop(cfg) {
  const items = cfg?.tabBar?.items;
  const index = Array.isArray(items) ? items.findIndex(item => item?.center) : -1;
  const item = items?.[index];
  if (!item?.centerIconSource || !/\.webp$/i.test(item.centerIcon || "")) return;

  const sourceName = path.basename(item.centerIconSource);
  const sourcePath = path.join(IMAGES_DIR, sourceName);
  if (!fs.existsSync(sourcePath)) return;

  const crop = item.centerIconCrop || {};
  const targetName = `tab-${index + 1}-centerIcon-crop-${Date.now()}.jpg`;
  const targetPath = path.join(IMAGES_DIR, targetName);
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "tabbar-center-crop.ps1"),
    "-Source", sourcePath, "-Target", targetPath, "-Zoom", String(crop.zoom ?? 1),
    "-OffsetX", String(crop.offsetX ?? 0), "-OffsetY", String(crop.offsetY ?? 0)
  ], { windowsHide: true, stdio: "pipe" });
  item.centerIcon = `/images/${targetName}`;
}

// ---- Dashboard API ----
app.get("/api/dashboard", (req, res) => {
  try {
    const cfg = readConfig();
    let imageCount = 0;
    let totalImageSize = 0;
    try {
      const files = fs.readdirSync(IMAGES_DIR);
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
          imageCount++;
          totalImageSize += fs.statSync(path.join(IMAGES_DIR, f)).size;
        }
      }
    } catch (e) {}
    res.json({
      productCount: cfg.products.length,
      categoryCount: cfg.categories.length,
      heroCount: cfg.heroes.length,
      imageCount,
      imageTotalKB: Math.round(totalImageSize / 1024),
      brandName: cfg.brand.name,
      themePreset: cfg.theme.preset,
      lastSync: cfg._lastSync || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- ATELIER OS platform boundary ----
app.get("/api/platform/bootstrap", (req, res) => {
  try {
    const state = readSaasState();
    migrateLegacyAiConnection(state);
    const cfg = readConfig();
    const plan = state.plans.find(item => item.id === state.workspace.planId) || state.plans[0];
    const imageBytes = fs.readdirSync(IMAGES_DIR).reduce((total, name) => {
      try { return total + fs.statSync(path.join(IMAGES_DIR, name)).size; } catch (error) { return total; }
    }, 0);
    const storedJobs = state.publishJobs.map(presentPublishJob);
    const jobs = storedJobs.length ? storedJobs : [{
      id: "local_initial", version: "local-current", environment: "preview", channel: "本地微信开发项目",
      status: cfg._lastSync ? "generated" : "draft", statusLabel: cfg._lastSync ? "已生成开发预览" : "草稿",
      createdAtLabel: cfg._lastSync ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(cfg._lastSync)) : "尚未同步"
    }];
    res.json({
      ok: true,
      workspace: state.workspace,
      ...(RUNTIME_IDENTITY.visible ? { runtimeIdentity: RUNTIME_IDENTITY } : {}),
      plans: state.plans,
      publishJobs: jobs.slice(0, 20),
      ai: publicAiStatus(),
      aiConnections: state.aiConnections.filter(item => isMerchantConnectionForStore(item, state)).map(platformStore.publicConnection),
      platformAiConnections: state.aiConnections.filter(item => item.ownerType === "platform" && item.status !== "disabled").map(item => ({ id: item.id, providerName: item.providerName, providerPreset: item.providerPreset, model: item.model, status: item.status, lastTestOk: item.lastTestOk, lastTestAt: item.lastTestAt })),
      aiPolicy: platformStore.findScopedPolicy(state, state.workspace.tenantId, state.workspace.storeId),
      providerCatalog: state.providerCatalog,
      usage: {
        aiPointsUsed: state.aiUsageEvents.filter(item => item.tenantId === state.workspace.tenantId && item.billingMode === "platform").reduce((total, item) => total + Number(item.weightedPoints || 0), 0),
        aiPointsLimit: plan.aiPoints || 0,
        storageGbUsed: Number((imageBytes / 1024 / 1024 / 1024).toFixed(2)),
        storageGbLimit: plan.storageGb || 0,
        skuUsed: (cfg.products || []).length,
        skuLimit: plan.skuLimit || 0
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post(["/api/ai/query", "/v1/ai/query"], async (req, res) => {
  const id = requestId("ai");
  try {
    if (req.path === "/v1/ai/query") {
      const expectedToken = String(process.env.ATELIER_AI_GATEWAY_TOKEN || "").trim();
      const suppliedToken = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!expectedToken) return aiFailure(res, 503, "AI_GATEWAY_TOKEN_MISSING", "平台尚未配置云函数网关凭证", id);
      if (!suppliedToken || suppliedToken !== expectedToken) return aiFailure(res, 401, "AI_GATEWAY_UNAUTHORIZED", "AI 网关凭证无效", id);
    }
    const text = String(req.body?.text || "").trim().slice(0, 400);
    if (!text) return aiFailure(res, 400, "AI_QUERY_EMPTY", "请输入问题", id);
    const state = readSaasState();
    const scope = currentScopedIds(req, state);
    if (!scope) return aiFailure(res, 403, "TENANT_SCOPE_MISMATCH", "工作区权限不匹配", id);
    const { tenantId, storeId } = scope;
    const action = deterministicServiceAction(text);
    if (action) {
      const payload = { provider: "tools", confidence: 1, citations: [], ...action };
      return aiSuccess(res, { message: "请通过安全操作继续", data: payload, requestId: id, legacy: payload });
    }
    const cfg = readConfig();
    let providerFailureCode = null;
    try {
      const answer = await queryConfiguredModel(text, cfg, state, tenantId, storeId);
      if (answer) {
        const points = weightedPoints(answer.usage);
        const latest = readSaasState();
        latest.aiUsageEvents.unshift({ id, tenantId, storeId, provider: answer.connection.providerName, model: answer.model, billingMode: answer.policy.mode, resultCode: "ok", inputTokens: answer.usage.prompt_tokens, outputTokens: answer.usage.completion_tokens, weightedPoints: points, createdAt: new Date().toISOString() });
        latest.aiUsageEvents = latest.aiUsageEvents.slice(0, 5000);
        writeSaasState(latest);
        aiUsage.requests += 1;
        aiUsage.inputTokens += answer.usage.prompt_tokens;
        aiUsage.outputTokens += answer.usage.completion_tokens;
        const payload = { provider: answer.connection.providerName, providerId: answer.connection.providerPreset, billingMode: answer.policy.mode, type: "answer", confidence: 0.78, citations: ["店铺商品与页面知识"], content: answer.content, usage: { promptTokens: answer.usage.prompt_tokens, completionTokens: answer.usage.completion_tokens, weightedPoints: points }, model: answer.model, fallback: false };
        return aiSuccess(res, { message: "模型已生成回答", data: payload, requestId: id, legacy: payload });
      }
    } catch (error) {
      aiUsage.errors += 1;
      providerFailureCode = error.code || "AI_PROVIDER_ERROR";
      const latest = readSaasState();
      latest.aiUsageEvents.unshift({ id, tenantId, storeId, provider: "gateway", model: null, billingMode: platformStore.findScopedPolicy(latest, tenantId, storeId).mode, resultCode: providerFailureCode, inputTokens: 0, outputTokens: 0, weightedPoints: 0, createdAt: new Date().toISOString() });
      writeSaasState(latest);
      if (error.code === "AI_QUOTA_EXHAUSTED") return aiFailure(res, 402, error.code, error.message, id);
    }
    aiUsage.fallbackRequests += 1;
    const fallback = fallbackFaq(text, cfg);
    const payload = { provider: "rules", confidence: fallback.type === "faq" ? 0.9 : 0.35, fallback: true, fallbackReason: providerFailureCode, ...fallback };
    return aiSuccess(res, { code: providerFailureCode ? "AI_FALLBACK" : "OK", message: providerFailureCode ? "模型不可用，已使用规则知识回答" : "已使用规则知识回答", data: payload, requestId: id, legacy: payload });
  } catch (error) {
    aiUsage.errors += 1;
    return aiFailure(res, 500, "AI_SERVICE_ERROR", "客服服务暂时不可用，请重试或转人工", id);
  }
});

app.get("/api/ai/status", (req, res) => {
  const data = { ...publicAiStatus(), usage: { ...aiUsage, weightedPoints: aiUsage.inputTokens + aiUsage.outputTokens * 4 } };
  return aiSuccess(res, { message: "AI 服务状态已获取", data, legacy: data });
});

app.get("/v1/ai/connections", (req, res) => {
  const id = requestId("aic");
  const state = scopedWorkspace(req, res, id);
  if (!state) return;
  const data = state.aiConnections.filter(item => isMerchantConnectionForStore(item, state)).map(platformStore.publicConnection);
  return aiSuccess(res, { message: "模型连接已获取", data, requestId: id, legacy: { providerCatalog: state.providerCatalog } });
});

app.post("/v1/ai/connections", (req, res) => {
  const id = requestId("aic");
  const state = scopedWorkspace(req, res, id);
  if (!state) return;
  try {
    const connection = connectionFromInput(req.body || {}, { tenantId: state.workspace.tenantId, storeId: state.workspace.storeId, ownerType: "merchant" });
    state.aiConnections.push(connection);
    platformStore.appendAudit(state, { actorType: "merchant", actorId: "local_owner", action: "ai.connection.create", resourceType: "ai_connection", resourceId: connection.id, tenantId: state.workspace.tenantId, metadata: { provider: connection.providerName, model: connection.model } });
    writeSaasState(state);
    return aiSuccess(res, { status: 201, message: "模型连接已加密保存", data: platformStore.publicConnection(connection), requestId: id });
  } catch (error) {
    return aiFailure(res, error.status || 400, error.code || "AI_CONNECTION_INVALID", error.message, id);
  }
});

app.post("/v1/ai/connections/:id/test", async (req, res) => {
  const id = requestId("aict");
  const state = scopedWorkspace(req, res, id);
  if (!state) return;
  const connection = state.aiConnections.find(item => item.id === req.params.id && isMerchantConnectionForStore(item, state));
  if (!connection) return aiFailure(res, 404, "AI_CONNECTION_NOT_FOUND", "未找到模型连接", id);
  try {
    const result = await callOpenAiCompatible({ baseUrl: connection.baseUrl, apiKey: platformStore.decryptSecret(connection.secret), model: connection.model, text: "请只回答：连接成功", context: "这是连接测试。", timeoutMs: connection.timeoutMs, maxTokens: 50 });
    connection.lastTestOk = true; connection.lastTestAt = new Date().toISOString(); connection.lastError = ""; connection.updatedAt = connection.lastTestAt;
    appendAuditAndWrite(state, { actorType: "merchant", actorId: "local_owner", action: "ai.connection.test", resourceType: "ai_connection", resourceId: connection.id, tenantId: state.workspace.tenantId, metadata: { ok: true } });
    return aiSuccess(res, { message: "模型连接测试成功", data: { connection: platformStore.publicConnection(connection), sample: result.content.slice(0, 80) }, requestId: id });
  } catch (error) {
    connection.lastTestOk = false; connection.lastTestAt = new Date().toISOString(); connection.lastError = error.message.slice(0, 240); connection.updatedAt = connection.lastTestAt;
    appendAuditAndWrite(state, { actorType: "merchant", actorId: "local_owner", action: "ai.connection.test", resourceType: "ai_connection", resourceId: connection.id, tenantId: state.workspace.tenantId, metadata: { ok: false, code: "PROVIDER_TEST_FAILED" } });
    return aiFailure(res, error.status || 502, error.code || "AI_PROVIDER_TEST_FAILED", `${error.message}。请检查接口地址、模型名称和 API Key。`, id, platformStore.publicConnection(connection));
  }
});

app.post("/v1/ai/connections/:id/rotate-secret", (req, res) => {
  const id = requestId("aicr");
  const state = scopedWorkspace(req, res, id);
  if (!state) return;
  const connection = state.aiConnections.find(item => item.id === req.params.id && isMerchantConnectionForStore(item, state));
  if (!connection) return aiFailure(res, 404, "AI_CONNECTION_NOT_FOUND", "未找到模型连接", id);
  const apiKey = String(req.body?.apiKey || "").trim();
  if (!apiKey) return aiFailure(res, 400, "AI_PROVIDER_KEY_MISSING", "请输入新的 API Key", id);
  connection.secret = platformStore.encryptSecret(apiKey); connection.lastTestOk = null; connection.lastError = ""; connection.updatedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "merchant", actorId: "local_owner", action: "ai.connection.rotate_secret", resourceType: "ai_connection", resourceId: connection.id, tenantId: state.workspace.tenantId, metadata: {} });
  return aiSuccess(res, { message: "API Key 已轮换，请重新测试连接", data: platformStore.publicConnection(connection), requestId: id });
});

app.delete("/v1/ai/connections/:id", (req, res) => {
  const id = requestId("aicd");
  const state = scopedWorkspace(req, res, id);
  if (!state) return;
  const index = state.aiConnections.findIndex(item => item.id === req.params.id && isMerchantConnectionForStore(item, state));
  if (index < 0) return aiFailure(res, 404, "AI_CONNECTION_NOT_FOUND", "未找到模型连接", id);
  const [connection] = state.aiConnections.splice(index, 1);
  state.aiPolicies.forEach(policy => { if (policy.connectionId === connection.id) { policy.connectionId = null; policy.mode = "rules"; } });
  appendAuditAndWrite(state, { actorType: "merchant", actorId: "local_owner", action: "ai.connection.delete", resourceType: "ai_connection", resourceId: connection.id, tenantId: state.workspace.tenantId, metadata: {} });
  return aiSuccess(res, { message: "模型连接已删除，客服已切换到规则 FAQ", requestId: id });
});

app.get("/v1/ai/policy", (req, res) => {
  const id = requestId("aip");
  const state = scopedWorkspace(req, res, id);
  if (state) return aiSuccess(res, { message: "客服模型策略已获取", data: platformStore.findScopedPolicy(state, state.workspace.tenantId, state.workspace.storeId), requestId: id });
});

app.put("/v1/ai/policy", (req, res) => {
  const id = requestId("aip");
  const state = scopedWorkspace(req, res, id);
  if (!state) return;
  const mode = ["rules", "byok", "platform"].includes(req.body?.mode) ? req.body.mode : "rules";
  const policy = platformStore.findScopedPolicy(state, state.workspace.tenantId, state.workspace.storeId);
  const candidateId = mode === "platform" ? req.body?.platformConnectionId : req.body?.connectionId;
  if (mode !== "rules") {
    const valid = state.aiConnections.some(item => item.id === candidateId && item.status !== "disabled"
      && (mode === "platform" ? item.ownerType === "platform" : isMerchantConnectionForStore(item, state)));
    if (!valid) return aiFailure(res, 400, "AI_CONNECTION_INVALID", "请选择当前店铺可用的模型连接", id);
  }
  Object.assign(policy, { mode, connectionId: mode === "byok" ? candidateId : null, platformConnectionId: mode === "platform" ? candidateId : null, dailyPointLimit: Math.max(0, Number(req.body?.dailyPointLimit) || policy.dailyPointLimit || 100000), fallbackToRules: req.body?.fallbackToRules !== false, updatedAt: new Date().toISOString() });
  const index = state.aiPolicies.findIndex(item => item.tenantId === policy.tenantId && item.storeId === policy.storeId);
  if (index >= 0) state.aiPolicies[index] = policy; else state.aiPolicies.push(policy);
  appendAuditAndWrite(state, { actorType: "merchant", actorId: "local_owner", action: "ai.policy.update", resourceType: "ai_policy", resourceId: state.workspace.storeId, tenantId: state.workspace.tenantId, metadata: { mode } });
  return aiSuccess(res, { message: "客服模型策略已更新", data: policy, requestId: id });
});

function scopedWorkspace(req, res, id = requestId("scope")) {
  const state = readSaasState();
  const tenantId = String(req.query.tenantId || req.body?.tenantId || state.workspace.tenantId);
  const storeId = String(req.query.storeId || req.body?.storeId || state.workspace.storeId);
  if (tenantId !== state.workspace.tenantId || storeId !== state.workspace.storeId) {
    aiFailure(res, 403, "TENANT_SCOPE_MISMATCH", "租户或店铺作用域不匹配", id);
    return null;
  }
  return state;
}

app.get("/v1/workspaces", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (state) res.json({ ok: true, data: [state.workspace] });
});
app.get("/v1/stores", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (state) res.json({ ok: true, data: [{ id: state.workspace.storeId, tenantId: state.workspace.tenantId, name: state.workspace.storeName, channelMode: state.workspace.channelMode }] });
});
app.get("/v1/designs", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (!state) return;
  const cfg = readConfig();
  res.json({ ok: true, data: [{ id: `design_${state.workspace.storeId}`, tenantId: state.workspace.tenantId, storeId: state.workspace.storeId, schemaVersion: cfg.designSystem?.version || 1, status: cfg._lastSync ? "published" : "draft", document: cfg }] });
});
app.get("/v1/assets", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (!state) return;
  const folderData = readMediaFolders();
  const data = fs.readdirSync(IMAGES_DIR).map(name => ({ id: name, tenantId: state.workspace.tenantId, storeId: state.workspace.storeId, path: `/images/${name}`, folderId: folderData.assignments[name] || "" }));
  res.json({ ok: true, data });
});
app.get("/v1/products", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (state) res.json({ ok: true, data: (readConfig().products || []).map(item => ({ ...item, tenantId: state.workspace.tenantId, storeId: state.workspace.storeId })) });
});
app.get("/v1/orders", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (state) res.json({ ok: true, data: [], meta: { paymentOnboardingRequired: true } });
});
app.get("/v1/publish-jobs", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (state) res.json({ ok: true, data: state.publishJobs.map(presentPublishJob) });
});
app.get("/v1/ai/status", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (state) res.json({ ok: true, data: { ...publicAiStatus(), usage: { ...aiUsage, weightedPoints: aiUsage.inputTokens + aiUsage.outputTokens * 4 } } });
});
app.get("/v1/billing/entitlements", (req, res) => {
  const state = scopedWorkspace(req, res);
  if (!state) return;
  const plan = state.plans.find(item => item.id === state.workspace.planId) || state.plans[0];
  res.json({ ok: true, data: { planId: plan.id, stores: plan.stores, skuLimit: plan.skuLimit, storageGb: plan.storageGb, aiPoints: plan.aiPoints, features: { sharedAppId: true, merchantAppId: ["professional", "enterprise"].includes(plan.id), aiWorkspace: plan.id !== "trial", feishu: ["professional", "enterprise"].includes(plan.id), audit: plan.id === "enterprise" } } });
});

// ---- ATELIER OS operator control plane ----
app.post("/ops/v1/auth/login", (req, res) => {
  const state = readSaasState();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = state.operatorUsers.find(item => item.email === email && item.status === "active");
  if (!user || !platformStore.verifyPassword(password, user.passwordHash)) {
    platformStore.appendAudit(state, { actorType: "operator", actorId: email || "unknown", action: "operator.login_failed", resourceType: "operator_session", resourceId: null, tenantId: null, metadata: { ip: req.ip } });
    writeSaasState(state);
    return res.status(401).json({ ok: false, error: "邮箱或密码不正确" });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const session = { id: requestId("ops_session"), token, userId: user.id, email: user.email, name: user.name, role: user.role, createdAt: Date.now(), expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  operatorSessions.set(token, session);
  platformStore.appendAudit(state, { actorType: "operator", actorId: user.id, action: "operator.login", resourceType: "operator_session", resourceId: session.id, tenantId: null, metadata: { ip: req.ip } });
  writeSaasState(state);
  res.setHeader("Set-Cookie", `atelier_ops_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/ops; Max-Age=28800${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true, data: safeOperatorUser(user) });
});

app.post("/ops/v1/auth/logout", (req, res) => {
  const session = operatorSession(req);
  if (session) operatorSessions.delete(session.token);
  res.setHeader("Set-Cookie", "atelier_ops_session=; HttpOnly; SameSite=Strict; Path=/ops; Max-Age=0");
  res.json({ ok: true });
});

app.get("/ops/v1/auth/session", (req, res) => {
  const session = operatorSession(req);
  res.json({ ok: true, data: session ? { id: session.userId, email: session.email, name: session.name, role: session.role } : null });
});

app.use("/ops/v1", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = String(req.get("origin") || "");
    if (origin) {
      try { if (!originMatchesRequest(req, origin)) return res.status(403).json({ ok: false, error: "请求来源不受信任" }); }
      catch (error) { return res.status(403).json({ ok: false, error: "请求来源无效" }); }
    }
  }
  next();
});
app.use("/ops/v1", requireOperator);
registerLaunchV1OpsRoutes(app, getSaasService);
registerOpsSaasRoutes(app, getSaasService);

// In SaaS mode PostgreSQL is the only operator data source. Anything not
// explicitly registered above is intentionally unavailable instead of falling
// through to the legacy JSON control plane below.
app.use("/ops/v1", (req, res, next) => {
  if (LEGACY_LOCAL_MODE) return next();
  return res.status(404).json({ ok: false, code: "OPS_FEATURE_NOT_AVAILABLE", error: "该运营功能尚未开放" });
});

app.get("/ops/v1/session", (req, res) => {
  res.json({ ok: true, data: { id: req.operator.userId, email: req.operator.email, name: req.operator.name, role: req.operator.role } });
});

app.get("/ops/v1/bootstrap", (req, res) => {
  const state = readSaasState();
  migrateLegacyAiConnection(state);
  const cfg = readConfig();
  const platformUsage = state.aiUsageEvents.filter(item => item.billingMode === "platform");
  const releaseJobs = state.publishJobs.map(presentPublishJob).filter(item => item.status !== "generated");
  const metrics = {
    tenants: state.tenants.length,
    activeTenants: state.tenants.filter(item => item.status === "active").length,
    trials: state.tenants.filter(item => item.status === "trial").length,
    publishSuccessRate: releaseJobs.length ? Math.round(releaseJobs.filter(item => item.status === "succeeded").length / releaseJobs.length * 100) : 0,
    aiPoints: platformUsage.reduce((total, item) => total + Number(item.weightedPoints || 0), 0),
    aiErrors: state.aiUsageEvents.filter(item => item.resultCode !== "ok").length,
    openTickets: state.supportTickets.filter(item => !["resolved", "closed"].includes(item.status)).length,
    activeIncidents: state.incidents.filter(item => item.status !== "resolved").length,
    products: (cfg.products || []).length
  };
  res.json({
    ok: true,
    data: {
      operator: { id: req.operator.userId, email: req.operator.email, name: req.operator.name, role: req.operator.role },
      metrics,
      tenants: state.tenants,
      workspace: state.workspace,
      plans: state.plans,
      subscriptions: state.subscriptions,
      providerCatalog: state.providerCatalog,
      platformConnections: state.aiConnections.filter(item => item.ownerType === "platform").map(platformStore.publicConnection),
      tenantConnections: state.aiConnections.filter(item => item.ownerType === "merchant").map(platformStore.publicConnection),
      aiPolicies: state.aiPolicies,
      aiUsage: state.aiUsageEvents.slice(0, 200),
      publishJobs: state.publishJobs.slice(0, 100).map(presentPublishJob),
      featureFlags: state.featureFlags,
      supportTickets: state.supportTickets,
      incidents: state.incidents,
      impersonationSessions: state.impersonationSessions.filter(item => Date.parse(item.expiresAt) > Date.now()),
      auditEvents: state.auditEvents.slice(0, 300)
    }
  });
});

app.patch("/ops/v1/tenants/:id", (req, res) => {
  const state = readSaasState();
  const tenant = state.tenants.find(item => item.id === req.params.id);
  if (!tenant) return res.status(404).json({ ok: false, error: "未找到租户" });
  if (req.body?.status && !["trial", "active", "past_due", "suspended", "closed"].includes(req.body.status)) return res.status(400).json({ ok: false, error: "租户状态无效" });
  if (req.body?.planId && !state.plans.some(item => item.id === req.body.planId)) return res.status(400).json({ ok: false, error: "套餐不存在" });
  if (req.body?.status) tenant.status = req.body.status;
  if (req.body?.planId) {
    tenant.planId = req.body.planId;
    if (tenant.id === state.workspace.tenantId) {
      const plan = state.plans.find(item => item.id === req.body.planId);
      state.workspace.planId = plan.id; state.workspace.planName = plan.name;
    }
  }
  tenant.updatedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "tenant.update", resourceType: "tenant", resourceId: tenant.id, tenantId: tenant.id, metadata: { status: tenant.status, planId: tenant.planId } });
  res.json({ ok: true, data: tenant });
});

app.post("/ops/v1/ai/connections", (req, res) => {
  const state = readSaasState();
  try {
    const connection = connectionFromInput(req.body || {}, { tenantId: "platform", storeId: null, ownerType: "platform" });
    connection.costInputPerMillion = Math.max(0, Number(req.body?.costInputPerMillion) || 0);
    connection.costOutputPerMillion = Math.max(0, Number(req.body?.costOutputPerMillion) || 0);
    connection.saleMultiplier = Math.max(1, Number(req.body?.saleMultiplier) || 1.5);
    state.aiConnections.push(connection);
    appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "platform_ai.connection.create", resourceType: "ai_connection", resourceId: connection.id, tenantId: null, metadata: { provider: connection.providerName, model: connection.model } });
    res.status(201).json({ ok: true, data: platformStore.publicConnection(connection) });
  } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

app.post("/ops/v1/ai/connections/:id/test", async (req, res) => {
  const state = readSaasState();
  const connection = state.aiConnections.find(item => item.id === req.params.id && item.ownerType === "platform");
  if (!connection) return res.status(404).json({ ok: false, error: "未找到平台模型连接" });
  try {
    const result = await callOpenAiCompatible({ baseUrl: connection.baseUrl, apiKey: platformStore.decryptSecret(connection.secret), model: connection.model, text: "请只回答：连接成功", context: "这是平台连接测试。", timeoutMs: connection.timeoutMs, maxTokens: 50 });
    connection.lastTestOk = true; connection.lastTestAt = new Date().toISOString(); connection.lastError = "";
    appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "platform_ai.connection.test", resourceType: "ai_connection", resourceId: connection.id, tenantId: null, metadata: { ok: true } });
    res.json({ ok: true, data: { connection: platformStore.publicConnection(connection), sample: result.content.slice(0, 80) } });
  } catch (error) {
    connection.lastTestOk = false; connection.lastTestAt = new Date().toISOString(); connection.lastError = error.message.slice(0, 240);
    appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "platform_ai.connection.test", resourceType: "ai_connection", resourceId: connection.id, tenantId: null, metadata: { ok: false } });
    res.status(502).json({ ok: false, error: `${error.message}。请检查模型配置。` });
  }
});

app.post("/ops/v1/ai/connections/:id/rotate-secret", (req, res) => {
  const state = readSaasState();
  const connection = state.aiConnections.find(item => item.id === req.params.id && item.ownerType === "platform");
  if (!connection) return res.status(404).json({ ok: false, error: "未找到平台模型连接" });
  const apiKey = String(req.body?.apiKey || "").trim();
  if (!apiKey) return res.status(400).json({ ok: false, error: "请输入新的 API Key" });
  connection.secret = platformStore.encryptSecret(apiKey);
  connection.lastTestOk = null;
  connection.lastError = "";
  connection.updatedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "platform_ai.connection.rotate_secret", resourceType: "ai_connection", resourceId: connection.id, tenantId: null, metadata: {} });
  res.json({ ok: true, data: platformStore.publicConnection(connection) });
});

app.patch("/ops/v1/ai/connections/:id", (req, res) => {
  const state = readSaasState();
  const connection = state.aiConnections.find(item => item.id === req.params.id && item.ownerType === "platform");
  if (!connection) return res.status(404).json({ ok: false, error: "未找到平台模型连接" });
  if (req.body?.status && !["active", "disabled"].includes(req.body.status)) return res.status(400).json({ ok: false, error: "连接状态无效" });
  if (req.body?.status) connection.status = req.body.status;
  ["costInputPerMillion", "costOutputPerMillion", "saleMultiplier"].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) connection[key] = Math.max(key === "saleMultiplier" ? 1 : 0, Number(req.body[key]) || 0);
  });
  connection.updatedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "platform_ai.connection.update", resourceType: "ai_connection", resourceId: connection.id, tenantId: null, metadata: { status: connection.status } });
  res.json({ ok: true, data: platformStore.publicConnection(connection) });
});

app.delete("/ops/v1/ai/connections/:id", (req, res) => {
  const state = readSaasState();
  const index = state.aiConnections.findIndex(item => item.id === req.params.id && item.ownerType === "platform");
  if (index < 0) return res.status(404).json({ ok: false, error: "未找到平台模型连接" });
  const connection = state.aiConnections[index];
  const usedBy = state.aiPolicies.filter(item => item.platformConnectionId === connection.id);
  if (usedBy.length) return res.status(409).json({ ok: false, error: `仍有 ${usedBy.length} 个店铺使用此平台模型，请先切换这些店铺的客服路由` });
  state.aiConnections.splice(index, 1);
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "platform_ai.connection.delete", resourceType: "ai_connection", resourceId: connection.id, tenantId: null, metadata: {} });
  res.json({ ok: true });
});

app.patch("/ops/v1/plans/:id", (req, res) => {
  const state = readSaasState();
  const plan = state.plans.find(item => item.id === req.params.id);
  if (!plan) return res.status(404).json({ ok: false, error: "未找到套餐" });
  ["monthlyPrice", "yearlyPrice", "stores", "skuLimit", "storageGb", "aiPoints"].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) plan[key] = req.body[key] === null ? null : Math.max(0, Number(req.body[key]) || 0);
  });
  if (req.body?.features && typeof req.body.features === "object") plan.features = { ...(plan.features || {}), ...req.body.features };
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "plan.update", resourceType: "plan", resourceId: plan.id, tenantId: null, metadata: {} });
  res.json({ ok: true, data: plan });
});

app.patch("/ops/v1/feature-flags/:id", (req, res) => {
  const state = readSaasState();
  const flag = state.featureFlags.find(item => item.id === req.params.id);
  if (!flag) return res.status(404).json({ ok: false, error: "未找到功能开关" });
  flag.enabled = Boolean(req.body?.enabled); flag.updatedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "feature_flag.update", resourceType: "feature_flag", resourceId: flag.id, tenantId: flag.scope === "tenant" ? flag.targetId : null, metadata: { enabled: flag.enabled } });
  res.json({ ok: true, data: flag });
});

app.post("/ops/v1/publish-jobs/:id/retry", (req, res) => {
  const state = readSaasState();
  const source = state.publishJobs.find(item => item.id === req.params.id);
  if (!source) return res.status(404).json({ ok: false, error: "未找到发布任务" });
  if (source.status !== "failed") return res.status(409).json({ ok: false, error: "只有失败任务可以重试" });
  const job = { ...source, id: requestId("publish"), requestId: requestId("release"), status: "queued", statusLabel: "等待重试", retryCount: Number(source.retryCount || 0) + 1, sourceJobId: source.id, createdAt: new Date().toISOString(), createdAtLabel: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date()) };
  state.publishJobs.unshift(job);
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "publish_job.retry", resourceType: "publish_job", resourceId: job.id, tenantId: state.workspace.tenantId, metadata: { sourceJobId: source.id } });
  res.status(201).json({ ok: true, data: job });
});

app.post("/ops/v1/publish-jobs/:id/rollback", (req, res) => {
  const state = readSaasState();
  const source = state.publishJobs.find(item => item.id === req.params.id);
  if (!source) return res.status(404).json({ ok: false, error: "未找到发布版本" });
  if (source.status !== "succeeded") return res.status(409).json({ ok: false, error: "只能回滚到成功发布的版本" });
  const job = { id: requestId("publish"), requestId: requestId("rollback"), version: `rollback-${source.version}`, rollbackVersion: source.version, environment: source.environment, channel: source.channel, status: "queued", statusLabel: "等待回滚", retryCount: 0, sourceJobId: source.id, createdAt: new Date().toISOString(), createdAtLabel: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date()) };
  state.publishJobs.unshift(job);
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "publish_job.rollback", resourceType: "publish_job", resourceId: job.id, tenantId: state.workspace.tenantId, metadata: { targetVersion: source.version } });
  res.status(201).json({ ok: true, data: job });
});

app.post("/ops/v1/support-tickets", (req, res) => {
  const state = readSaasState();
  const title = String(req.body?.title || "").trim().slice(0, 120);
  if (!title) return res.status(400).json({ ok: false, error: "请输入工单标题" });
  const ticket = { id: requestId("ticket"), tenantId: String(req.body?.tenantId || state.workspace.tenantId), title, priority: ["low", "normal", "high", "urgent"].includes(req.body?.priority) ? req.body.priority : "normal", status: "open", createdAt: new Date().toISOString(), createdBy: req.operator.userId };
  state.supportTickets.unshift(ticket);
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "support_ticket.create", resourceType: "support_ticket", resourceId: ticket.id, tenantId: ticket.tenantId, metadata: { priority: ticket.priority } });
  res.status(201).json({ ok: true, data: ticket });
});

app.patch("/ops/v1/support-tickets/:id", (req, res) => {
  const state = readSaasState();
  const ticket = state.supportTickets.find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ ok: false, error: "未找到工单" });
  if (req.body?.status && ["open", "in_progress", "resolved", "closed"].includes(req.body.status)) ticket.status = req.body.status;
  ticket.updatedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "support_ticket.update", resourceType: "support_ticket", resourceId: ticket.id, tenantId: ticket.tenantId, metadata: { status: ticket.status } });
  res.json({ ok: true, data: ticket });
});

app.post("/ops/v1/incidents", (req, res) => {
  const state = readSaasState();
  const title = String(req.body?.title || "").trim().slice(0, 120);
  if (!title) return res.status(400).json({ ok: false, error: "请输入事件标题" });
  const incident = { id: requestId("incident"), title, severity: ["minor", "major", "critical"].includes(req.body?.severity) ? req.body.severity : "minor", status: "investigating", createdAt: new Date().toISOString(), createdBy: req.operator.userId };
  state.incidents.unshift(incident);
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "incident.create", resourceType: "incident", resourceId: incident.id, tenantId: null, metadata: { severity: incident.severity } });
  res.status(201).json({ ok: true, data: incident });
});

app.post("/ops/v1/impersonation-sessions", (req, res) => {
  const state = readSaasState();
  const tenantId = String(req.body?.tenantId || "");
  const reason = String(req.body?.reason || "").trim().slice(0, 240);
  const minutes = Math.min(60, Math.max(5, Number(req.body?.minutes) || 30));
  if (!state.tenants.some(item => item.id === tenantId)) return res.status(404).json({ ok: false, error: "未找到租户" });
  if (reason.length < 6) return res.status(400).json({ ok: false, error: "请填写至少 6 个字的代操作原因" });
  const session = { id: requestId("imp"), tenantId, operatorId: req.operator.userId, reason, status: "active", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + minutes * 60 * 1000).toISOString() };
  state.impersonationSessions.unshift(session);
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "impersonation.start", resourceType: "impersonation_session", resourceId: session.id, tenantId, metadata: { reason, minutes } });
  res.status(201).json({ ok: true, data: session });
});

app.delete("/ops/v1/impersonation-sessions/:id", (req, res) => {
  const state = readSaasState();
  const session = state.impersonationSessions.find(item => item.id === req.params.id && item.operatorId === req.operator.userId);
  if (!session) return res.status(404).json({ ok: false, error: "未找到代操作会话" });
  session.status = "ended"; session.endedAt = new Date().toISOString();
  appendAuditAndWrite(state, { actorType: "operator", actorId: req.operator.userId, action: "impersonation.end", resourceType: "impersonation_session", resourceId: session.id, tenantId: session.tenantId, metadata: {} });
  res.json({ ok: true });
});

// ---- Config API ----
app.get("/api/config", (req, res) => {
  try { res.json(readConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/config", (req, res) => {
  try {
    writeConfig(req.body);
    const ownedPaths = ["admin/config.json", ...collectConfigAssetPaths(req.body)];
    res.json({ ok: true, git: autoSyncGitHub("editor save", ownedPaths) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Media Library API ----
app.get("/api/media/folders", (req, res) => {
  try {
    const data = readMediaFolders();
    const counts = Object.entries(data.assignments).reduce((result, [name, folderId]) => {
      if (fs.existsSync(path.join(IMAGES_DIR, name))) result[folderId] = (result[folderId] || 0) + 1;
      return result;
    }, {});
    res.json(data.folders.map(folder => ({ ...folder, count: counts[folder.id] || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/folders", (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return res.status(400).json({ error: "请输入文件夹名称" });
    const data = readMediaFolders();
    if (data.folders.some(folder => folder.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "文件夹名称已存在" });
    const baseId = normalizeMediaFolderId(`folder-${Date.now().toString(36)}`) || `folder-${Date.now()}`;
    let id = baseId;
    let counter = 1;
    while (data.folders.some(folder => folder.id === id)) id = `${baseId}-${counter++}`;
    const folder = { id, name, createdAt: new Date().toISOString() };
    data.folders.push(folder);
    writeMediaFolders(data);
    res.json({ ok: true, folder: { ...folder, count: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/media/folders/:id", (req, res) => {
  try {
    const data = readMediaFolders();
    const folder = data.folders.find(item => item.id === req.params.id);
    if (!folder) return res.status(404).json({ error: "文件夹不存在" });
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return res.status(400).json({ error: "请输入文件夹名称" });
    if (data.folders.some(item => item.id !== folder.id && item.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "文件夹名称已存在" });
    folder.name = name;
    writeMediaFolders(data);
    res.json({ ok: true, folder });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/media/folders/:id", (req, res) => {
  try {
    const data = readMediaFolders();
    const index = data.folders.findIndex(item => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "文件夹不存在" });
    const assigned = Object.values(data.assignments).filter(folderId => folderId === req.params.id).length;
    if (assigned) return res.status(409).json({ error: `文件夹内还有 ${assigned} 个素材，请先移动素材` });
    data.folders.splice(index, 1);
    writeMediaFolders(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/media", (req, res) => {
  try {
    const usage = configMediaUsage(readConfig());
    const folderData = readMediaFolders();
    const folderMap = new Map(folderData.folders.map(folder => [folder.id, folder]));
    const files = fs.readdirSync(IMAGES_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
    }).map(f => {
      const stat = fs.statSync(path.join(IMAGES_DIR, f));
      const ext = path.extname(f).toLowerCase();
      const kind = [".mp4", ".webm", ".mov"].includes(ext) ? "video" : "image";
      return {
        name: f,
        path: `/mp-images/${f}`,
        mpPath: `/images/${f}`,
        kind,
        size: stat.size,
        sizeKB: Math.round(stat.size / 1024),
        mtime: stat.mtime.toISOString(),
        folderId: folderMap.has(folderData.assignments[f]) ? folderData.assignments[f] : "",
         folderName: folderMap.get(folderData.assignments[f])?.name || "",
         usageCount: usage[f]?.length || 0,
         usedIn: (usage[f] || []).slice(0, 8),
         large: stat.size > 5 * 1024 * 1024,
         packageEligible: stat.size <= 5 * 1024 * 1024,
         packageWarning: stat.size > 5 * 1024 * 1024 ? "该素材应迁移至 CDN/COS 后再用于正式发布。" : "",
       };
    }).sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/upload", (req, res) => {
  try {
    const { name, data } = req.body;
    const requestedFolderId = String(req.body?.folderId || "");
    const folderData = readMediaFolders();
    if (requestedFolderId && !folderData.folders.some(folder => folder.id === requestedFolderId)) return res.status(400).json({ error: "目标文件夹不存在" });
    if (!name || !data) return res.status(400).json({ error: "缺少 name 或 data" });
    const { buffer: buf, kind } = decodeMediaUpload(name, data);
    if (buf.length > 80 * 1024 * 1024) return res.status(400).json({ error: "单个媒体文件不能超过 80MB" });
    // 防止覆盖：同名加后缀
    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!safeName) return res.status(400).json({ error: "文件名无效" });
    let destName = safeName;
    let counter = 1;
    while (fs.existsSync(path.join(IMAGES_DIR, destName))) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      destName = `${base}-${counter}${ext}`;
      counter++;
    }
    fs.writeFileSync(path.join(IMAGES_DIR, destName), buf);
    if (requestedFolderId) {
      folderData.assignments[destName] = requestedFolderId;
      writeMediaFolders(folderData);
    }
    const folder = folderData.folders.find(item => item.id === requestedFolderId);
    res.json({ ok: true, name: destName, path: `/mp-images/${destName}`, mpPath: `/images/${destName}`, kind, size: buf.length, sizeKB: Math.round(buf.length / 1024), large: buf.length > 5 * 1024 * 1024, packageEligible: buf.length <= 5 * 1024 * 1024, packageWarning: buf.length > 5 * 1024 * 1024 ? "该素材应迁移至 CDN/COS 后再用于正式发布。" : "", folderId: requestedFolderId, folderName: folder?.name || "" });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post("/api/media/move", (req, res) => {
  try {
    const names = [...new Set(Array.isArray(req.body?.names) ? req.body.names : [])].slice(0, 500);
    const folderId = String(req.body?.folderId || "");
    const data = readMediaFolders();
    if (folderId && !data.folders.some(folder => folder.id === folderId)) return res.status(400).json({ error: "目标文件夹不存在" });
    if (!names.length) return res.status(400).json({ error: "请选择要移动的素材" });
    for (const name of names) {
      const safeName = path.basename(String(name || ""));
      if (!safeName || safeName !== name) return res.status(400).json({ error: `文件名无效：${name}` });
      if (!fs.existsSync(path.join(IMAGES_DIR, safeName))) continue;
      if (folderId) data.assignments[safeName] = folderId;
      else delete data.assignments[safeName];
    }
    writeMediaFolders(data);
    res.json({ ok: true, moved: names.length, folderId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/delete", (req, res) => {
  try {
    const names = [...new Set(Array.isArray(req.body?.names) ? req.body.names : [])].slice(0, 500);
    if (!names.length) return res.status(400).json({ error: "请选择要删除的素材" });
    const deleted = [];
    const missing = [];
    const folderData = readMediaFolders();
    const trash = readTrashManifest();
    for (const name of names) {
      const safeName = path.basename(String(name || ""));
      if (!safeName || safeName !== name) return res.status(400).json({ error: `文件名无效：${name}` });
      const filePath = path.join(IMAGES_DIR, safeName);
      if (!fs.existsSync(filePath)) { missing.push(safeName); continue; }
      const item = moveMediaToTrash(safeName, folderData.assignments[safeName] || "");
      if (item) trash.items.push(item);
      deleted.push(safeName);
    }
    deleted.forEach(name => delete folderData.assignments[name]);
    writeMediaFolders(folderData);
    writeTrashManifest(trash);
    res.json({ ok: true, deleted, missing, recoverableUntil: new Date(Date.now() + 30 * 86400000).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/media/trash", (req, res) => {
  try {
    const data = purgeExpiredMediaTrash();
    res.json(data.items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/trash/restore", (req, res) => {
  try {
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])].slice(0, 500);
    if (!ids.length) return res.status(400).json({ error: "请选择要恢复的素材" });
    const data = purgeExpiredMediaTrash();
    const folderData = readMediaFolders();
    const restored = [];
    for (const item of data.items.filter(entry => ids.includes(entry.id))) {
      const sourcePath = path.join(TRASH_DIR, item.storedName);
      if (!fs.existsSync(sourcePath)) continue;
      let targetName = item.name;
      let counter = 1;
      while (fs.existsSync(path.join(IMAGES_DIR, targetName))) targetName = `${path.basename(item.name, path.extname(item.name))}-restored-${counter++}${path.extname(item.name)}`;
      fs.renameSync(sourcePath, path.join(IMAGES_DIR, targetName));
      if (item.folderId && folderData.folders.some(folder => folder.id === item.folderId)) folderData.assignments[targetName] = item.folderId;
      restored.push({ id: item.id, name: targetName });
    }
    data.items = data.items.filter(item => !restored.some(entry => entry.id === item.id));
    writeTrashManifest(data);
    writeMediaFolders(folderData);
    res.json({ ok: true, restored });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Custom Fonts API ----
app.get("/api/fonts", (req, res) => {
  try {
    const files = fs.readdirSync(FONTS_DIR).filter(f => [".woff2", ".woff", ".ttf", ".otf", ".ttc"].includes(path.extname(f).toLowerCase()));
    res.json(files.map(name => {
      const stat = fs.statSync(path.join(FONTS_DIR, name));
      return { name, path: `/mp-fonts/${name}`, mpPath: `/fonts/${name}`, sizeKB: Math.round(stat.size / 1024) };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fonts/upload", (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: "缺少字体文件" });
    const ext = path.extname(name).toLowerCase();
    if (![".woff2", ".woff", ".ttf", ".otf", ".ttc"].includes(ext)) return res.status(400).json({ error: "仅支持 WOFF2、WOFF、TTF、OTF、TTC" });
    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "-");
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: "字体文件不能超过 8MB" });
    let destName = safeName;
    let counter = 1;
    while (fs.existsSync(path.join(FONTS_DIR, destName))) {
      destName = `${path.basename(safeName, ext)}-${counter}${ext}`;
      counter++;
    }
    fs.writeFileSync(path.join(FONTS_DIR, destName), buf);
    res.json({ ok: true, name: destName, path: `/mp-fonts/${destName}`, mpPath: `/fonts/${destName}`, sizeKB: Math.round(buf.length / 1024) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system-fonts", (req, res) => {
  try { res.json(listSystemFonts()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fonts/import-system", (req, res) => {
  try {
    const { name, file } = req.body || {};
    const available = listSystemFonts();
    const source = available.find(font => font.name === name && font.file === file);
    if (!source) return res.status(404).json({ error: "未找到该电脑字体" });
    const sourcePath = path.join(SYSTEM_FONTS_DIR, source.file);
    if (fs.statSync(sourcePath).size > 8 * 1024 * 1024) return res.status(400).json({ error: "该字体超过 8MB，请先转换为 WOFF2 再上传，避免小程序包体过大" });
    const ext = path.extname(source.file).toLowerCase();
    const safeBase = String(name).normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "system-font";
    let destName = `${safeBase}${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(FONTS_DIR, destName))) {
      const existing = fs.statSync(path.join(FONTS_DIR, destName));
      const original = fs.statSync(sourcePath);
      if (existing.size === original.size) break;
      destName = `${safeBase}-${counter}${ext}`;
      counter++;
    }
    if (!fs.existsSync(path.join(FONTS_DIR, destName))) fs.copyFileSync(sourcePath, path.join(FONTS_DIR, destName));
    const stat = fs.statSync(path.join(FONTS_DIR, destName));
    res.json({ ok: true, name: destName, mpPath: `/fonts/${destName}`, path: `/mp-fonts/${destName}`, format: source.format, sizeKB: Math.round(stat.size / 1024) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/media/:name", (req, res) => {
  try {
    const safeName = path.basename(req.params.name);
    if (safeName !== req.params.name) return res.status(400).json({ error: "文件名无效" });
    const filePath = path.join(IMAGES_DIR, safeName);
    if (fs.existsSync(filePath)) {
      const folderData = readMediaFolders();
      const trash = readTrashManifest();
      const item = moveMediaToTrash(safeName, folderData.assignments[safeName] || "");
      if (item) trash.items.push(item);
      delete folderData.assignments[safeName];
      writeMediaFolders(folderData);
      writeTrashManifest(trash);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: "文件不存在" });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Presets API ----
app.get("/api/presets", (req, res) => {
  try { res.json(readConfig().themePresets || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Sync API ----
app.post("/api/sync", async (req, res) => {
  try {
    if (SAAS_DATABASE_ENABLED && req.saasService) {
      req.saasService.assertWritable(req.merchantScope);
      const source = req.body && Object.keys(req.body).length > 0 ? req.body : null;
      const cfg = source || null;
      const document = cfg || (await req.saasService.readConfig(req.merchantScope)).document;
      migrateCenterTabCrop(document);
      const synced = { ...document, _lastSync: new Date().toISOString() };
      const result = require("./sync")(synced, ROOT, { publicStoreId: req.merchantScope.workspace.publicStoreId || "" });
      const warnings = packageAssetWarnings(synced);
      const saved = await req.saasService.writeConfig(req.merchantScope, synced);
      return res.json({ ok: true, ...result, warnings, lastSync: synced._lastSync, version: `v${synced._lastSync.replace(/[-:TZ.]/g, "").slice(0, 14)}`, configVersion: saved.version, publishJob: null, git: null });
    }
    const sync = require("./sync");
    let cfg;
    if (req.body && Object.keys(req.body).length > 0) {
      writeConfig(req.body);
      cfg = req.body;
    } else {
      cfg = readConfig();
    }
    migrateCenterTabCrop(cfg);
    const result = sync(cfg, ROOT, { publicStoreId: req.merchantScope?.workspace?.publicStoreId || "" });
    const warnings = packageAssetWarnings(cfg);
    cfg._lastSync = new Date().toISOString();
    writeConfig(cfg);
    const ownedPaths = [...(result.files || []), "admin/config.json", ...collectConfigAssetPaths(cfg)];
    const state = readSaasState();
    const version = `v${cfg._lastSync.replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    const publishJob = {
      id: requestId("publish"), version, environment: "preview", kind: "local_sync",
      channel: "本地微信开发项目",
      status: "generated", statusLabel: warnings.length ? "已生成，存在包体风险" : "已生成开发预览", createdAt: cfg._lastSync,
      createdAtLabel: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(cfg._lastSync))
    };
    state.publishJobs.unshift(publishJob);
    state.publishJobs = state.publishJobs.slice(0, 50);
    writeSaasState(state);
    res.json({ ok: true, ...result, warnings, lastSync: cfg._lastSync, version, publishJob, git: autoSyncGitHub("mini program sync", [...ownedPaths, "admin/saas-state.json"]) });
  } catch (e) { res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ---- Preview API ----
app.post("/api/preview", (req, res) => {
  try {
    if (SAAS_DATABASE_ENABLED && !req.saasService) return res.status(401).json({ ok: false, error: "请先登录" });
    const cliPath = findWechatDevtoolsCli();
    if (!cliPath) {
      return res.status(503).json({
        error: "未找到微信开发者工具命令行。请安装微信开发者工具，或设置 WECHAT_DEVTOOLS_CLI 指向 cli.bat。"
      });
    }
    const cliDir = path.dirname(cliPath);
    const previewPackage = buildPreviewProject();
    const { previewRoot: previewProject, report: previewReport } = previewPackage;
    if (previewReport.mainPackageBytes > PREVIEW_PACKAGE_MAX_BYTES) {
      const largestFiles = previewReport.largestRuntimeFiles.slice(0, 5)
        .map(file => `${file.path} (${formatBytes(file.bytes)})`).join("、");
      const error = new Error(`预览主包体积为 ${formatBytes(previewReport.mainPackageBytes)}，超过微信开发版二维码的 2 MB 限制。最大引用运行时文件：${largestFiles || "无"}。`);
      error.details = JSON.stringify({ previewProject, previewReport });
      throw error;
    }
    const tempQrPath = path.join(path.dirname(PREVIEW_QR_PATH), `preview-qr-${Date.now()}-${process.pid}.png`);
    const cmd = `cd /d "${cliDir}" && set NODE_OPTIONS= && "${cliPath}" preview --project "${previewProject}" -f image -o "${tempQrPath}" 2>&1`;
    const output = execSync(cmd, { timeout: 120000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!fs.existsSync(tempQrPath)) {
      const error = new Error(output.trim() || "微信开发者工具未生成新的预览二维码，请先修复小程序编译错误。");
      error.details = output.trim();
      throw error;
    }
    fs.rmSync(PREVIEW_QR_PATH, { force: true });
    fs.renameSync(tempQrPath, PREVIEW_QR_PATH);
    if (!fs.existsSync(PREVIEW_QR_PATH)) throw new Error("微信开发者工具没有生成预览二维码");
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, qrUrl: `/api/preview/qr?v=${Date.now()}`, previewReport });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message, details: e.details || "", stderr: e.stderr ? e.stderr.toString() : "" });
  }
});

app.get("/api/preview/qr", (req, res) => {
  if (!fs.existsSync(PREVIEW_QR_PATH)) return res.status(404).json({ error: "尚未生成预览二维码" });
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(PREVIEW_QR_PATH);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  PRIVLAN Admin Panel (WordPress-style)`);
  console.log(`  ──────────────────────────────────────`);
  console.log(`  Running at  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  Network     ${HOST === "127.0.0.1" ? "local computer only" : `enabled on ${HOST} with access token ${ADMIN_TOKEN ? "configured" : "missing"}`}`);
  console.log(`  Project    ${ROOT}`);
  console.log(`  ──────────────────────────────────────\n`);
});

module.exports = { app, server };