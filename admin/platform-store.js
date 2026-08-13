const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STATE_PATH = path.join(__dirname, "saas-state.json");
const MASTER_KEY_PATH = path.join(__dirname, ".platform-master-key");

const PROVIDER_PRESETS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", protocol: "openai", region: "中国大陆" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", protocol: "openai", region: "中国大陆" },
  { id: "moonshot", name: "Moonshot / Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", protocol: "openai", region: "中国大陆" },
  { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", protocol: "openai", region: "中国大陆" },
  { id: "openai-compatible", name: "自定义供应商（OpenAI 兼容）", baseUrl: "", model: "", protocol: "openai", region: "自定义" }
];

function defaultState() {
  return {
    schemaVersion: 2,
    workspace: {
      tenantId: "tenant_privlan_demo",
      workspaceId: "workspace_privlan_cn",
      storeId: "store_privlan_main",
      workspaceName: "PRIVLAN Retail",
      storeName: "PRIVLAN",
      planId: "professional",
      planName: "Professional",
      channelMode: "shared",
      roles: ["owner", "admin", "designer", "operator", "customer_service"]
    },
    tenants: [{ id: "tenant_privlan_demo", name: "PRIVLAN", status: "active", planId: "professional", createdAt: new Date().toISOString() }],
    plans: [
      { id: "trial", name: "14 天试用", monthlyPrice: 0, yearlyPrice: 0, stores: 1, skuLimit: 50, storageGb: 1, aiPoints: 100000, features: { byok: true, platformAi: true } },
      { id: "starter", name: "Starter", monthlyPrice: 299, yearlyPrice: 2990, stores: 1, skuLimit: 500, storageGb: 5, aiPoints: 1000000, features: { byok: true, platformAi: true } },
      { id: "professional", name: "Professional", monthlyPrice: 899, yearlyPrice: 8990, stores: 3, skuLimit: 5000, storageGb: 50, aiPoints: 5000000, features: { byok: true, platformAi: true, advancedSupport: true } },
      { id: "enterprise", name: "Enterprise", monthlyPrice: 2999, yearlyPrice: null, stores: 10, skuLimit: null, storageGb: null, aiPoints: null, features: { byok: true, platformAi: true, advancedSupport: true, audit: true } }
    ],
    subscriptions: [{ id: "sub_privlan", tenantId: "tenant_privlan_demo", planId: "professional", status: "active", renewsAt: null }],
    providerCatalog: PROVIDER_PRESETS,
    aiConnections: [],
    aiPolicies: [{ tenantId: "tenant_privlan_demo", storeId: "store_privlan_main", mode: "rules", connectionId: null, platformConnectionId: null, dailyPointLimit: 100000, fallbackToRules: true }],
    aiUsageEvents: [],
    aiReservations: [],
    publishJobs: [],
    featureFlags: [
      { id: "ai_service", name: "智能客服", enabled: true, scope: "global", targetId: null },
      { id: "appointments", name: "预约模块", enabled: true, scope: "tenant", targetId: "tenant_privlan_demo" },
      { id: "platform_ai", name: "平台托管模型", enabled: true, scope: "global", targetId: null }
    ],
    supportTickets: [],
    incidents: [],
    auditEvents: [],
    impersonationSessions: [],
    operatorUsers: []
  };
}

function normalizeState(parsed = {}) {
  const defaults = defaultState();
  const workspace = { ...defaults.workspace, ...(parsed.workspace || {}) };
  const tenants = Array.isArray(parsed.tenants) && parsed.tenants.length
    ? parsed.tenants
    : [{ id: workspace.tenantId, name: workspace.storeName, status: "active", planId: workspace.planId, createdAt: new Date().toISOString() }];
  return {
    ...defaults,
    ...parsed,
    schemaVersion: 2,
    workspace,
    tenants,
    plans: Array.isArray(parsed.plans) && parsed.plans.length ? parsed.plans : defaults.plans,
    subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : defaults.subscriptions,
    providerCatalog: (Array.isArray(parsed.providerCatalog) && parsed.providerCatalog.length ? parsed.providerCatalog : defaults.providerCatalog).map(item => item.id === "openai-compatible" ? { ...item, name: "自定义供应商（OpenAI 兼容）", protocol: "openai", region: "自定义", baseUrl: "", model: "" } : item),
    aiConnections: Array.isArray(parsed.aiConnections) ? parsed.aiConnections : [],
    aiPolicies: Array.isArray(parsed.aiPolicies) && parsed.aiPolicies.length ? parsed.aiPolicies : defaults.aiPolicies,
    aiUsageEvents: Array.isArray(parsed.aiUsageEvents) ? parsed.aiUsageEvents : [],
    aiReservations: Array.isArray(parsed.aiReservations) ? parsed.aiReservations.filter(item => Date.parse(item.expiresAt) > Date.now()) : [],
    publishJobs: Array.isArray(parsed.publishJobs) ? parsed.publishJobs : [],
    featureFlags: Array.isArray(parsed.featureFlags) ? parsed.featureFlags : defaults.featureFlags,
    supportTickets: Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [],
    incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
    auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
    impersonationSessions: Array.isArray(parsed.impersonationSessions) ? parsed.impersonationSessions : [],
    operatorUsers: Array.isArray(parsed.operatorUsers) ? parsed.operatorUsers : []
  };
}

function readState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return defaultState();
  }
}

function writeState(state) {
  const next = normalizeState(state);
  const tempPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tempPath, STATE_PATH);
  return next;
}

function getMasterKey() {
  if (process.env.ATELIER_MASTER_KEY) {
    const key = Buffer.from(process.env.ATELIER_MASTER_KEY, "base64");
    if (key.length !== 32) throw new Error("ATELIER_MASTER_KEY 必须是 32 字节 Base64 密钥");
    return key;
  }
  if (!fs.existsSync(MASTER_KEY_PATH)) {
    fs.writeFileSync(MASTER_KEY_PATH, crypto.randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
  }
  const key = Buffer.from(fs.readFileSync(MASTER_KEY_PATH, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("本地主密钥格式无效");
  return key;
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decryptSecret(payload) {
  if (!payload?.ciphertext) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  const [saltValue, hashValue] = String(stored || "").split(".");
  if (!saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64");
  const actual = crypto.scryptSync(String(password), Buffer.from(saltValue, "base64"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function appendAudit(state, event) {
  state.auditEvents.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event });
  state.auditEvents = state.auditEvents.slice(0, 2000);
}

function publicConnection(connection) {
  if (!connection) return null;
  const { secret, ...safe } = connection;
  return { ...safe, hasSecret: Boolean(secret), secretHint: secret ? "••••••••" : "" };
}

function findScopedPolicy(state, tenantId, storeId) {
  return state.aiPolicies.find(item => item.tenantId === tenantId && item.storeId === storeId)
    || { tenantId, storeId, mode: "rules", connectionId: null, platformConnectionId: null, dailyPointLimit: 100000, fallbackToRules: true };
}

module.exports = {
  PROVIDER_PRESETS,
  readState,
  writeState,
  encryptSecret,
  decryptSecret,
  hashPassword,
  verifyPassword,
  appendAudit,
  publicConnection,
  findScopedPolicy
};
