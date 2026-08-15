const crypto = require("node:crypto");
const { ServiceError } = require("./saas-service");
const { createWorkspaceMedia } = require("./workspace-media");
const { callOpenAiCompatible } = require("./ai-gateway");
const { registerMerchantAppointmentRoutes } = require("./appointment-routes");

const SESSION_COOKIE = "atelier_merchant_session";
const CSRF_COOKIE = "atelier_csrf";

function requestId(prefix = "req") { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`; }
function cookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((result, part) => {
    const index = part.indexOf("=");
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return result;
  }, {});
}
function success(res, data, message = "操作成功", status = 200, id = requestId()) { return res.status(status).json({ ok: true, code: "OK", message, data, requestId: id }); }
function failure(res, error, id = requestId()) {
  const status = Number(error?.status || 500);
  const message = status >= 500 && !(error instanceof ServiceError) ? "服务暂时不可用" : String(error?.message || "请求失败");
  return res.status(status).json({ ok: false, code: error?.code || "INTERNAL_ERROR", message, error: message, data: null, requestId: id });
}
function setSessionCookies(res, session) {
  const secure = process.env.NODE_ENV === "production";
  const common = { secure, sameSite: "lax", path: "/", expires: new Date(session.expiresAt) };
  res.cookie(SESSION_COOKIE, session.token, { ...common, httpOnly: true });
  res.cookie(CSRF_COOKIE, session.csrfToken, { ...common, httpOnly: false });
}
function clearSessionCookies(res) {
  const common = { secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };
  res.clearCookie(SESSION_COOKIE, { ...common, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...common, httpOnly: false });
}

function createRateLimiter({ windowMs, limit }) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const values = (buckets.get(key) || []).filter(value => now - value < windowMs);
    if (values.length >= limit) return failure(res, new ServiceError(429, "RATE_LIMITED", "操作过于频繁，请稍后重试"));
    values.push(now); buckets.set(key, values);
    if (buckets.size > 2000) for (const [bucket, times] of buckets) if (!times.some(value => now - value < windowMs)) buckets.delete(bucket);
    next();
  };
}

function registerMerchantRoutes(app, getService, options = {}) {
  const authLimit = createRateLimiter({ windowMs: 60_000, limit: 12 });
  const redeemLimit = createRateLimiter({ windowMs: 60_000, limit: 10 });
  const mediaByService = new WeakMap();
  const workspaceMedia = service => {
    if (!mediaByService.has(service)) mediaByService.set(service, createWorkspaceMedia({ db: service.db, dataRoot: options.dataRoot }));
    return mediaByService.get(service);
  };

  async function serviceOrThrow() {
    const service = await getService();
    if (!service) throw new ServiceError(503, "DATABASE_REQUIRED", "SaaS 数据库尚未配置");
    return service;
  }

  app.post("/auth/register", authLimit, async (req, res) => {
    const id = requestId("register");
    try {
      const service = await serviceOrThrow();
      const data = await service.register(req.body || {}, { requestId: id, ipAddress: req.ip, userAgent: req.get("user-agent") });
      setSessionCookies(res, data.session);
      return success(res, { user: data.user, workspace: data.workspace, subscription: data.subscription }, "工作区已创建", 201, id);
    } catch (error) { return failure(res, error, id); }
  });

  app.post("/auth/login", authLimit, async (req, res) => {
    const id = requestId("login");
    try {
      const service = await serviceOrThrow();
      const data = await service.login(req.body || {}, { requestId: id, ipAddress: req.ip, userAgent: req.get("user-agent") });
      setSessionCookies(res, data.session);
      const scope = await service.resolveSession(data.session.token);
      return success(res, { user: scope.user, workspace: scope.workspace, subscription: scope.subscription }, "登录成功", 200, id);
    } catch (error) { return failure(res, error, id); }
  });

  app.get("/auth/session", async (req, res) => {
    const id = requestId("session");
    try {
      const service = await serviceOrThrow();
      const scope = await service.resolveSession(cookies(req)[SESSION_COOKIE]);
      if (!scope) throw new ServiceError(401, "AUTH_REQUIRED", "请先登录");
      return success(res, { user: scope.user, workspace: scope.workspace, subscription: scope.subscription, role: scope.role }, "会话有效", 200, id);
    } catch (error) { return failure(res, error, id); }
  });

  app.post("/auth/logout", async (req, res) => {
    const id = requestId("logout");
    try {
      const service = await serviceOrThrow();
      const scope = await service.resolveSession(cookies(req)[SESSION_COOKIE]);
      if (scope) {
        if (!service.verifyCsrf(scope, String(req.get("x-atelier-csrf") || ""))) throw new ServiceError(403, "CSRF_INVALID", "页面会话已更新，请刷新后重试");
        await service.logout(scope.sessionId, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: scope.userId, requestId: id });
      }
      clearSessionCookies(res);
      return success(res, null, "已退出登录", 200, id);
    } catch (error) { return failure(res, error, id); }
  });

  app.use(["/api", "/v1"], async (req, res, next) => {
    if (req.path === "/ai/query" && req.method === "POST" && req.baseUrl === "/v1") return next();
    const id = requestId("merchant");
    try {
      const service = await getService();
      if (!service) return next();
      const scope = await service.resolveSession(cookies(req)[SESSION_COOKIE]);
      if (!scope) throw new ServiceError(401, "AUTH_REQUIRED", "请先登录");
      for (const [key, expected] of [["tenantId", scope.tenantId], ["workspaceId", scope.workspaceId], ["storeId", scope.storeId]]) {
        const supplied = req.body?.[key] ?? req.query?.[key];
        if (supplied && String(supplied) !== String(expected)) throw new ServiceError(403, "WORKSPACE_ACCESS_DENIED", "不能访问其他工作区的数据");
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const csrf = String(req.get("x-atelier-csrf") || "");
        if (!service.verifyCsrf(scope, csrf)) throw new ServiceError(403, "CSRF_INVALID", "页面会话已更新，请刷新后重试");
      }
      req.merchantScope = scope;
      req.requestId = id;
      req.saasService = service;
      next();
    } catch (error) { return failure(res, error, id); }
  });

  app.get("/api/config", async (req, res, next) => {
    if (!req.saasService) return next();
    try { return res.json((await req.saasService.readConfig(req.merchantScope)).document); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.post("/api/config", async (req, res, next) => {
    if (!req.saasService) return next();
    try { await req.saasService.writeConfig(req.merchantScope, req.body); return res.json({ ok: true }); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.get("/api/platform/bootstrap", async (req, res, next) => {
    if (!req.saasService) return next();
    try {
      const config = (await req.saasService.readConfig(req.merchantScope)).document;
      const subscription = await req.saasService.getSubscription(req.merchantScope);
      const workspace = { tenantId: req.merchantScope.tenantId, workspaceId: req.merchantScope.workspaceId, storeId: req.merchantScope.storeId, workspaceName: req.merchantScope.workspace.name, storeName: req.merchantScope.workspace.storeName, planId: subscription.planId.toLowerCase(), planName: subscription.planId, channelMode: "shared", roles: [req.merchantScope.role] };
      const aiConnections = await req.saasService.listAiConnections(req.merchantScope);
      const aiPolicy = await req.saasService.getAiPolicy(req.merchantScope);
      return res.json({ ok: true, workspace, subscription, plans: [{ id: "trial", name: "24小时体验", monthlyPrice: 0 }, { id: "pro", name: "PRO", monthlyPrice: 299 }], publishJobs: [], ai: { status: aiPolicy.mode === "byok" ? "configured" : "fallback", provider: aiPolicy.mode }, aiConnections, platformAiConnections: [], aiPolicy, providerCatalog: [{ id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" }, { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" }, { id: "custom", name: "自定义兼容接口", baseUrl: "", model: "" }], usage: { aiPointsUsed: 0, aiPointsLimit: 0, storageGbUsed: 0, storageGbLimit: 0, skuUsed: (config.products || []).length, skuLimit: 0 } });
    } catch (error) { return failure(res, error, req.requestId); }
  });

  registerMerchantAppointmentRoutes(app);

  app.get("/v1/subscription", async (req, res) => {
    try { return success(res, await req.saasService.getSubscription(req.merchantScope), "订阅已获取", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.post("/v1/licenses/redeem", redeemLimit, async (req, res) => {
    try { return success(res, await req.saasService.redeemLicense(req.merchantScope, req.body?.code), "兑换成功", 200, req.requestId); }
    catch (error) { return failure(res, error, req.requestId); }
  });

  app.get("/api/media", async (req, res, next) => {
    if (!req.saasService) return next();
    try { return res.json(await workspaceMedia(req.saasService).list(req.merchantScope)); }
    catch (error) { return failure(res, error, req.requestId); }
  });
  app.get("/api/media/content/:id", async (req, res, next) => {
    if (!req.saasService) return next();
    try { const asset = await workspaceMedia(req.saasService).get(req.merchantScope, req.params.id); res.type(asset.row.mime_type); return res.sendFile(asset.filePath); }
    catch (error) { return failure(res, error, req.requestId); }
  });
  app.post("/api/media/upload", async (req, res, next) => {
    if (!req.saasService) return next();
    try { req.saasService.assertWritable(req.merchantScope); return res.json(await workspaceMedia(req.saasService).upload(req.merchantScope, req.body || {})); }
    catch (error) { return failure(res, error, req.requestId); }
  });
  app.post("/api/media/delete", async (req, res, next) => {
    if (!req.saasService) return next();
    try { req.saasService.assertWritable(req.merchantScope); const media = workspaceMedia(req.saasService); const ids = await media.resolveIds(req.merchantScope, Array.isArray(req.body?.ids) ? req.body.ids : (req.body?.names || [])); return res.json({ ok: true, deleted: await media.remove(req.merchantScope, ids) }); }
    catch (error) { return failure(res, error, req.requestId); }
  });
  app.get("/api/media/trash", async (req, res, next) => { if (!req.saasService) return next(); try { return res.json(await workspaceMedia(req.saasService).list(req.merchantScope, true)); } catch (error) { return failure(res, error, req.requestId); } });
  app.post("/api/media/trash/restore", async (req, res, next) => { if (!req.saasService) return next(); try { req.saasService.assertWritable(req.merchantScope); return res.json({ ok: true, restored: await workspaceMedia(req.saasService).restore(req.merchantScope, req.body?.ids || []) }); } catch (error) { return failure(res, error, req.requestId); } });
  app.get("/api/media/folders", async (req, res, next) => { if (!req.saasService) return next(); try { return res.json(await workspaceMedia(req.saasService).folders(req.merchantScope)); } catch (error) { return failure(res, error, req.requestId); } });
  app.post("/api/media/folders", async (req, res, next) => { if (!req.saasService) return next(); try { req.saasService.assertWritable(req.merchantScope); return res.status(201).json(await workspaceMedia(req.saasService).addFolder(req.merchantScope, req.body?.name)); } catch (error) { return failure(res, error, req.requestId); } });
  app.patch("/api/media/folders/:id", async (req, res, next) => { if (!req.saasService) return next(); try { req.saasService.assertWritable(req.merchantScope); return res.json(await workspaceMedia(req.saasService).renameFolder(req.merchantScope, req.params.id, req.body?.name)); } catch (error) { return failure(res, error, req.requestId); } });
  app.delete("/api/media/folders/:id", async (req, res, next) => { if (!req.saasService) return next(); try { req.saasService.assertWritable(req.merchantScope); return res.json({ ok: true, data: await workspaceMedia(req.saasService).deleteFolder(req.merchantScope, req.params.id) }); } catch (error) { return failure(res, error, req.requestId); } });
  app.post("/api/media/move", async (req, res, next) => { if (!req.saasService) return next(); try { req.saasService.assertWritable(req.merchantScope); const media = workspaceMedia(req.saasService); const ids = await media.resolveIds(req.merchantScope, req.body?.ids || req.body?.names || []); return res.json({ ok: true, moved: await media.move(req.merchantScope, ids, req.body?.folderId || "") }); } catch (error) { return failure(res, error, req.requestId); } });

  app.get("/v1/ai/connections", async (req, res, next) => { if (!req.saasService) return next(); try { return success(res, await req.saasService.listAiConnections(req.merchantScope), "模型连接已获取", 200, req.requestId); } catch (error) { return failure(res, error, req.requestId); } });
  app.post("/v1/ai/connections", async (req, res, next) => { if (!req.saasService) return next(); try { return success(res, await req.saasService.createAiConnection(req.merchantScope, req.body || {}), "模型连接已加密保存", 201, req.requestId); } catch (error) { return failure(res, error, req.requestId); } });
  app.post("/v1/ai/connections/:id/test", async (req, res, next) => {
    if (!req.saasService) return next();
    try {
      const row = await req.saasService.scopedAiConnection(req.merchantScope, req.params.id);
      const result = await callOpenAiCompatible({ baseUrl: row.base_url, apiKey: req.saasService.decryptSecret(row.encrypted_secret), model: row.model, text: "请只回答：连接成功", context: "这是连接测试。", timeoutMs: row.timeout_ms, maxTokens: 50 });
      const connection = await req.saasService.recordAiTest(req.merchantScope, req.params.id, true);
      return success(res, { connection, sample: result.content.slice(0, 80) }, "模型连接测试成功", 200, req.requestId);
    } catch (error) { try { await req.saasService.recordAiTest(req.merchantScope, req.params.id, false, error.code || error.message); } catch (ignored) {} return failure(res, error, req.requestId); }
  });
  app.post("/v1/ai/connections/:id/rotate-secret", async (req, res, next) => { if (!req.saasService) return next(); try { return success(res, await req.saasService.rotateAiSecret(req.merchantScope, req.params.id, req.body?.apiKey), "API Key 已轮换", 200, req.requestId); } catch (error) { return failure(res, error, req.requestId); } });
  app.delete("/v1/ai/connections/:id", async (req, res, next) => { if (!req.saasService) return next(); try { return success(res, await req.saasService.deleteAiConnection(req.merchantScope, req.params.id), "模型连接已删除", 200, req.requestId); } catch (error) { return failure(res, error, req.requestId); } });
  app.get("/v1/ai/policy", async (req, res, next) => { if (!req.saasService) return next(); try { return success(res, await req.saasService.getAiPolicy(req.merchantScope), "模型策略已获取", 200, req.requestId); } catch (error) { return failure(res, error, req.requestId); } });
  app.put("/v1/ai/policy", async (req, res, next) => { if (!req.saasService) return next(); try { return success(res, await req.saasService.setAiPolicy(req.merchantScope, req.body || {}), "模型策略已更新", 200, req.requestId); } catch (error) { return failure(res, error, req.requestId); } });

  app.post("/api/ai/query", async (req, res, next) => {
    if (!req.saasService) return next();
    try {
      const config = (await req.saasService.readConfig(req.merchantScope)).document; const question = String(req.body?.text || "").trim();
      if (!question) throw new ServiceError(400, "QUESTION_REQUIRED", "请输入问题");
      const policy = await req.saasService.getAiPolicy(req.merchantScope);
      if (policy.mode === "byok" && policy.connectionId) {
        try { const row = await req.saasService.scopedAiConnection(req.merchantScope, policy.connectionId); const result = await callOpenAiCompatible({ baseUrl: row.base_url, apiKey: req.saasService.decryptSecret(row.encrypted_secret), model: row.model, text: question, context: (config.serviceBot?.knowledgeNotes || []).map(item => item.content || item).join("\n"), timeoutMs: row.timeout_ms, maxTokens: row.max_tokens }); return res.json({ ok: true, requestId: req.requestId, provider: row.provider_name, model: row.model, type: "answer", content: result.content, confidence: 0.75, citations: [], usage: result.usage, fallback: false }); } catch (error) { if (!policy.fallbackToRules) throw error; }
      }
      const faqs = config.serviceBot?.faqs || []; const faq = faqs.find(item => item.enabled !== false && [item.question, ...(item.keywords || [])].some(value => question.includes(value)));
      return res.json({ ok: true, requestId: req.requestId, provider: "rules", model: null, type: faq ? "faq" : "answer", content: faq?.answer || "暂时没有找到匹配答案，请换一种说法或联系人工客服。", confidence: faq ? 0.9 : 0.2, citations: [], fallback: true });
    } catch (error) { return failure(res, error, req.requestId); }
  });

  app.use(["/api", "/v1"], async (req, res, next) => {
    if (!req.saasService) return next();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.path === "/licenses/redeem" || req.path.startsWith("/subscription")) return next();
    try { req.saasService.assertWritable(req.merchantScope); return next(); }
    catch (error) { return failure(res, error, req.requestId); }
  });
}

function registerOpsSaasRoutes(app, getService) {
  app.get("/ops/v1/bootstrap", async (req, res) => {
    const id = requestId("ops");
    try { return success(res, await (await getService()).opsBootstrap(), "运营数据已获取", 200, id); }
    catch (error) { return failure(res, error, id); }
  });
  app.get("/ops/v1/license-codes", async (req, res) => {
    const id = requestId("ops");
    try { return success(res, await (await getService()).listLicenses(), "兑换码已获取", 200, id); }
    catch (error) { return failure(res, error, id); }
  });
  app.post("/ops/v1/license-codes", async (req, res) => {
    const id = requestId("ops");
    try { return success(res, await (await getService()).generateLicenses(req.body || {}, { id: req.operator.userId, requestId: id }), "兑换码已生成", 201, id); }
    catch (error) { return failure(res, error, id); }
  });
  app.patch("/ops/v1/license-codes/:id/disable", async (req, res) => {
    const id = requestId("ops");
    try { return success(res, await (await getService()).disableLicense(req.params.id, { id: req.operator.userId, requestId: id }), "兑换码已禁用", 200, id); }
    catch (error) { return failure(res, error, id); }
  });
  app.post("/ops/v1/subscriptions/:workspaceId/extend", async (req, res) => {
    const id = requestId("ops");
    try { return success(res, await (await getService()).extendSubscription(req.params.workspaceId, req.body?.days, { id: req.operator.userId, requestId: id }), "订阅已延长", 200, id); }
    catch (error) { return failure(res, error, id); }
  });
}

function registerOpsAuthRoutes(app, getService) {
  app.post("/ops/v1/auth/login", async (req, res, next) => {
    const service = await getService(); if (!service) return next(); const id = requestId("ops_login");
    try {
      const result = await service.operatorLogin(req.body?.email, req.body?.password, { requestId: id, ipAddress: req.ip });
      res.cookie("atelier_ops_session", result.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/ops", expires: new Date(result.expiresAt) });
      return success(res, result.user, "登录成功", 200, id);
    } catch (error) { return failure(res, error, id); }
  });
  app.get("/ops/v1/auth/session", async (req, res, next) => {
    const service = await getService(); if (!service) return next(); const id = requestId("ops_session");
    try { const session = await service.resolveOperatorSession(cookies(req).atelier_ops_session); return success(res, session ? { id: session.userId, email: session.email, name: session.name, role: session.role } : null, "运营会话已获取", 200, id); }
    catch (error) { return failure(res, error, id); }
  });
  app.post("/ops/v1/auth/logout", async (req, res, next) => {
    const service = await getService(); if (!service) return next(); const id = requestId("ops_logout");
    try { const session = await service.resolveOperatorSession(cookies(req).atelier_ops_session); if (session) await service.operatorLogout(session.sessionId); res.clearCookie("atelier_ops_session", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/ops" }); return success(res, null, "已退出登录", 200, id); }
    catch (error) { return failure(res, error, id); }
  });
}

module.exports = { registerMerchantRoutes, registerOpsAuthRoutes, registerOpsSaasRoutes, SESSION_COOKIE, CSRF_COOKIE, success, failure };
