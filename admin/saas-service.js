const crypto = require("node:crypto");
const { hashPassword, verifyPassword, encryptSecret, decryptSecret } = require("./platform-store");
const { createWorkspaceConfig, listBusinessTemplates, applyBusinessTemplate } = require("./workspace-templates");
const { createAppointmentService } = require("./appointment-service");
const { createCustomerService } = require("./customer-service");
const { createWorkflowService } = require("./workflow-service");
const { createWorkflowIntegrationService } = require("./workflow-integration-service");
const { DEFAULT_WORKFLOW_MAPPINGS } = require("./workflow-integration-mappings");

class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function id() { return crypto.randomUUID(); }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function normalizeLogin(value) { return String(value || "").trim().toLowerCase(); }
function json(value) { return JSON.stringify(value ?? {}); }
function addHours(value, hours) { return new Date(new Date(value).getTime() + hours * 3600000); }
function publicUser(row) { return { id: row.user_id || row.id, login: row.login_identifier, displayName: row.display_name || "", avatarUrl: row.avatar_url || null, role: row.role || null }; }
function publicAiConnection(row) { return { id: row.id, providerPreset: row.provider_preset, providerName: row.provider_name, baseUrl: row.base_url, model: row.model, timeoutMs: Number(row.timeout_ms), maxTokens: Number(row.max_tokens), status: row.status, hasSecret: Boolean(row.encrypted_secret), lastTestOk: row.last_test_ok, lastTestAt: row.last_test_at, lastError: row.last_error || "" }; }

function makeLicenseCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  const parts = [0, 1, 2].map(part => Array.from(bytes.subarray(part * 4, part * 4 + 4), byte => alphabet[byte % alphabet.length]).join(""));
  return `AT-${parts.join("-")}`;
}

function maskLicense(code) { return `${code.slice(0, 3)}****-****-${code.slice(-4)}`; }

function createSaasService({ db, licensePepper = process.env.ATELIER_LICENSE_PEPPER || "", workflowMappings = DEFAULT_WORKFLOW_MAPPINGS, tagRepository = null, appointmentRepository = null, authRepository = null, configRepository = null }) {
  if (!db) throw new Error("database is required");
  const customerService = createCustomerService({ db, tagRepository });
  const appointmentService = createAppointmentService({ db, customerService, appointmentRepository });
  const licenseHash = code => {
    if (!licensePepper) throw new ServiceError(503, "LICENSE_PEPPER_MISSING", "兑换服务尚未配置");
    return crypto.createHmac("sha256", licensePepper).update(String(code || "").trim().toUpperCase()).digest("hex");
  };

  async function audit(tx, scope, action, resourceType, resourceId, metadata = {}) {
    await tx.query(`insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [id(), scope?.tenantId || null, scope?.workspaceId || null, scope?.actorType || "system", scope?.actorId || "system", action, resourceType, resourceId || null, scope?.requestId || id(), json(metadata)]);
  }

  async function issueSession(tx, { userId, workspaceId, ipAddress, userAgent }) {
    const token = crypto.randomBytes(32).toString("base64url");
    const csrfToken = crypto.randomBytes(24).toString("base64url");
    const expiresAt = addHours(new Date(), 24 * 7);
    const sessionInput = { id: id(), user_id: userId, workspace_id: workspaceId, token_hash: sha256(token), csrf_token_hash: sha256(csrfToken), ip_address: ipAddress || null, user_agent: userAgent || null, expires_at: expiresAt.toISOString() };
    if (authRepository) {
      await authRepository.createSession(sessionInput);
      return { token, csrfToken, expiresAt };
    }
    await tx.query(`insert into merchant_sessions(id,user_id,workspace_id,token_hash,csrf_token_hash,ip_address,user_agent,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,$8)`, [sessionInput.id, userId, workspaceId, sessionInput.token_hash, sessionInput.csrf_token_hash, ipAddress || null, userAgent || null, expiresAt]);
    return { token, csrfToken, expiresAt };
  }

  async function register(input, context = {}) {
    const login = normalizeLogin(input.login);
    const password = String(input.password || "");
    const storeName = String(input.storeName || "").trim();
    const template = ["retail", "service", "restaurant", "education", "studio", "blank", "sample"].includes(input.template) ? (input.template === "sample" ? "retail" : input.template) : "retail";
    if (!/^[\p{L}\p{N}_.@+-]{3,64}$/u.test(login)) throw new ServiceError(400, "INVALID_LOGIN", "登录账号格式不正确");
    if (password.length < 8 || password.length > 128) throw new ServiceError(400, "INVALID_PASSWORD", "密码长度需为 8 至 128 位");
    if (storeName.length < 2 || storeName.length > 64) throw new ServiceError(400, "INVALID_STORE_NAME", "店铺名称长度需为 2 至 64 位");
    return db.transaction(async tx => {
      if ((await tx.query("select id from users where login_identifier=$1", [login])).rows.length) throw new ServiceError(409, "ACCOUNT_EXISTS", "该账号暂时无法注册");
      const tenantId = id(); const userId = id(); const workspaceId = id(); const storeId = id(); const now = new Date();
      await tx.query("insert into tenants(id,name,status) values($1,$2,'trial')", [tenantId, storeName]);
      await tx.query("insert into users(id,login_identifier,password_hash,display_name) values($1,$2,$3,$4)", [userId, login, hashPassword(password), String(input.contactName || "").trim() || null]);
      await tx.query("insert into workspaces(id,tenant_id,name,plan_id) values($1,$2,$3,'TRIAL')", [workspaceId, tenantId, storeName]);
      const publicStoreId = `store_public_${crypto.randomBytes(16).toString("hex")}`;
      await tx.query("insert into stores(id,tenant_id,workspace_id,name,channel_mode,status,public_store_id) values($1,$2,$3,$4,'shared','draft',$5)", [storeId, tenantId, workspaceId, storeName, publicStoreId]);
      await tx.query("insert into memberships(tenant_id,workspace_id,user_id,role) values($1,$2,$3,'owner')", [tenantId, workspaceId, userId]);
      await tx.query("insert into workspace_configs(workspace_id,tenant_id,store_id,document) values($1,$2,$3,$4::jsonb)", [workspaceId, tenantId, storeId, json(createWorkspaceConfig({ storeName, template }))]);
      const subscriptionId = id();
      await tx.query("insert into subscriptions(id,tenant_id,workspace_id,plan_id,status,source,metadata) values($1,$2,$3,'TRIAL','inactive','registration',$4::jsonb)", [subscriptionId, tenantId, workspaceId, json({ trialUsed: false })]);
      await appointmentService.ensureDefaults(tx, { tenantId, workspaceId, storeId }, 60);
      await customerService.ensureDefaults(tx, { tenantId, workspaceId, storeId });
      const session = await issueSession(tx, { userId, workspaceId, ipAddress: context.ipAddress, userAgent: context.userAgent });
      await audit(tx, { tenantId, workspaceId, actorType: "merchant", actorId: userId, requestId: context.requestId }, "workspace.register", "workspace", workspaceId, { template });
      return { session, user: { id: userId, login, displayName: String(input.contactName || "") }, workspace: { id: workspaceId, tenantId, storeId, publicStoreId, name: storeName }, subscription: { id: subscriptionId, planId: "TRIAL", status: "inactive", expiresAt: null } };
    });
  }

  async function login(input, context = {}) {
    const login = normalizeLogin(input.login);
    const user = authRepository ? await authRepository.findUserByLogin(login) : (await db.query("select id,login_identifier,password_hash,display_name,status from users where login_identifier=$1", [login])).rows[0];
    if (!user || user.status !== "active" || !verifyPassword(String(input.password || ""), user.password_hash)) {
      if (authRepository) await authRepository.recordAudit({ id: id(), actor_type: "merchant", actor_id: login || "unknown", action: "merchant.login_failed", resource_type: "merchant_session", request_id: context.requestId || id(), metadata: { ip: context.ipAddress || null } });
      else await db.transaction(tx => audit(tx, { actorType: "merchant", actorId: login || "unknown", requestId: context.requestId }, "merchant.login_failed", "merchant_session", null, { ip: context.ipAddress || null }));
      throw new ServiceError(401, "INVALID_CREDENTIALS", "账号或密码不正确");
    }
    const membership = authRepository ? await authRepository.findMembership(user.id) : (await db.query("select workspace_id from memberships where user_id=$1 order by created_at limit 1", [user.id])).rows[0];
    if (!membership) throw new ServiceError(403, "WORKSPACE_ACCESS_DENIED", "账号没有可访问的工作区");
    if (authRepository) {
      const session = await issueSession(null, { userId: user.id, workspaceId: membership.workspace_id, ipAddress: context.ipAddress, userAgent: context.userAgent });
      await authRepository.recordAudit({ id: id(), tenant_id: membership.tenant_id || null, workspace_id: membership.workspace_id, actor_type: "merchant", actor_id: user.id, action: "merchant.login", resource_type: "merchant_session", request_id: context.requestId || id(), metadata: {} });
      return { session, user: publicUser(user) };
    }
    return db.transaction(async tx => {
      const session = await issueSession(tx, { userId: user.id, workspaceId: membership.workspace_id, ipAddress: context.ipAddress, userAgent: context.userAgent });
      await audit(tx, { actorType: "merchant", actorId: user.id, workspaceId: membership.workspace_id, requestId: context.requestId }, "merchant.login", "merchant_session", null);
      return { session, user: publicUser(user) };
    });
  }

  async function resolveSession(token) {
    if (!token) return null;
    if (authRepository) {
      const row = await authRepository.loadSession(sha256(token));
      if (!row) return null;
      const expired = row.expires_at && new Date(row.expires_at) <= new Date();
      return { sessionId: row.session_id, userId: row.user_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, storeId: row.store_id, role: row.role, csrfTokenHash: row.csrf_token_hash, user: publicUser(row), workspace: { id: row.workspace_id, tenantId: row.tenant_id, storeId: row.store_id, publicStoreId: row.public_store_id, name: row.workspace_name, storeName: row.store_name }, subscription: { id: row.subscription_id, planId: row.subscription_plan_id || row.plan_id, status: expired ? "expired" : row.subscription_status, startedAt: row.started_at, expiresAt: row.subscription_expires_at } };
    }
    const result = await db.query(`select s.id session_id,s.user_id,s.workspace_id,s.csrf_token_hash,s.expires_at,
      u.login_identifier,u.display_name,u.avatar_url,u.status user_status,w.tenant_id,w.name workspace_name,w.plan_id,
      st.id store_id,st.name store_name,st.public_store_id,m.role,sub.id subscription_id,sub.status subscription_status,
      sub.plan_id subscription_plan_id,sub.started_at,sub.expires_at
      from merchant_sessions s join users u on u.id=s.user_id join memberships m on m.user_id=u.id and m.workspace_id=s.workspace_id
      join workspaces w on w.id=s.workspace_id join stores st on st.workspace_id=w.id
      left join subscriptions sub on sub.workspace_id=w.id
      where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() and u.status='active' limit 1`, [sha256(token)]);
    const row = result.rows[0];
    if (!row) return null;
    const expired = row.expires_at && new Date(row.expires_at) <= new Date();
    return {
      sessionId: row.session_id, userId: row.user_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, storeId: row.store_id,
      role: row.role, csrfTokenHash: row.csrf_token_hash, user: publicUser(row), workspace: { id: row.workspace_id, tenantId: row.tenant_id, storeId: row.store_id, publicStoreId: row.public_store_id, name: row.workspace_name, storeName: row.store_name },
      subscription: { id: row.subscription_id, planId: row.subscription_plan_id || row.plan_id, status: expired ? "expired" : row.subscription_status, startedAt: row.started_at, expiresAt: row.expires_at }
    };
  }

  async function logout(sessionId, context = {}) {
    if (!sessionId) return;
    if (authRepository) {
      await authRepository.revokeSession(sessionId);
      await authRepository.recordAudit({ id: id(), tenant_id: context.tenantId || null, workspace_id: context.workspaceId || null, actor_type: "merchant", actor_id: context.actorId || "merchant", action: "merchant.logout", resource_type: "merchant_session", resource_id: sessionId, request_id: context.requestId || id(), metadata: {} });
      return;
    }
    await db.transaction(async tx => {
      await tx.query("update merchant_sessions set revoked_at=now() where id=$1", [sessionId]);
      await audit(tx, { ...context, actorType: "merchant" }, "merchant.logout", "merchant_session", sessionId);
    });
  }

  async function changePassword(scope, input = {}, context = {}) {
    if (!scope?.userId) throw new ServiceError(401, "AUTH_REQUIRED", "请先登录");
    const currentPassword = String(input.currentPassword || "");
    const newPassword = String(input.newPassword || "");
    if (!currentPassword) throw new ServiceError(400, "CURRENT_PASSWORD_REQUIRED", "请输入当前密码");
    if (newPassword.length < 8 || newPassword.length > 128) throw new ServiceError(400, "INVALID_PASSWORD", "密码至少 8 位");
    return db.transaction(async tx => {
      const user = (await tx.query("select id,password_hash,status from users where id=$1 for update", [scope.userId])).rows[0];
      if (!user || user.status !== "active") throw new ServiceError(401, "AUTH_REQUIRED", "请先登录");
      if (!verifyPassword(currentPassword, user.password_hash)) throw new ServiceError(400, "CURRENT_PASSWORD_INVALID", "当前密码不正确");
      if (newPassword === currentPassword) throw new ServiceError(400, "PASSWORD_REUSE_NOT_ALLOWED", "新密码不能与当前密码相同");
      await tx.query("update users set password_hash=$1,updated_at=now() where id=$2", [hashPassword(newPassword), scope.userId]);
      await tx.query("update merchant_sessions set revoked_at=now() where user_id=$1 and revoked_at is null", [scope.userId]);
      await audit(tx, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorType: "merchant", actorId: scope.userId, requestId: context.requestId }, "merchant.password_changed", "user", scope.userId);
      return { passwordChanged: true };
    });
  }

  async function getProfile(scope) {
    if (authRepository) {
      const row = await authRepository.getProfile(scope.userId, scope.workspaceId);
      if (!row) throw new ServiceError(404, "PROFILE_NOT_FOUND", "账户资料不存在");
      return publicUser(row);
    }
    const row = (await db.query(`select u.id,u.login_identifier,u.display_name,u.avatar_url,u.status,m.role
      from users u join memberships m on m.user_id=u.id and m.workspace_id=$2
      where u.id=$1 and u.status='active' limit 1`, [scope.userId, scope.workspaceId])).rows[0];
    if (!row) throw new ServiceError(404, "PROFILE_NOT_FOUND", "账户资料不存在");
    return publicUser(row);
  }

  async function updateProfile(scope, input = {}, context = {}) {
    assertWritable(scope);
    const displayName = String(input.displayName ?? "").trim();
    if (displayName.length > 80) throw new ServiceError(400, "PROFILE_NAME_INVALID", "姓名或昵称不能超过 80 个字符");
    return db.transaction(async tx => {
      const row = (await tx.query(`update users set display_name=$1,updated_at=now()
        where id=$2 and exists(select 1 from memberships m where m.user_id=users.id and m.workspace_id=$3)
        returning id,login_identifier,display_name,avatar_url,status`, [displayName || null, scope.userId, scope.workspaceId])).rows[0];
      if (!row) throw new ServiceError(404, "PROFILE_NOT_FOUND", "账户资料不存在");
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId, requestId: context.requestId }, "profile.update", "user", scope.userId, { fields: ["display_name"] });
      return publicUser(row);
    });
  }

  async function setProfileAvatar(scope, avatarUrl, context = {}) {
    assertWritable(scope);
    return db.transaction(async tx => {
      const row = (await tx.query(`update users set avatar_url=$1,updated_at=now()
        where id=$2 and exists(select 1 from memberships m where m.user_id=users.id and m.workspace_id=$3)
        returning id,login_identifier,display_name,avatar_url,status`, [String(avatarUrl || ""), scope.userId, scope.workspaceId])).rows[0];
      if (!row) throw new ServiceError(404, "PROFILE_NOT_FOUND", "账户资料不存在");
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId, requestId: context.requestId }, "profile.avatar.update", "user", scope.userId, { fields: ["avatar_url"] });
      return publicUser(row);
    });
  }

  function verifyCsrf(scope, token) { return Boolean(token && scope?.csrfTokenHash && crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(scope.csrfTokenHash))); }

  async function readConfig(scope) {
    if (configRepository) return configRepository.readConfig(scope);
    const row = (await db.query("select document,version,updated_at from workspace_configs where workspace_id=$1 and tenant_id=$2", [scope.workspaceId, scope.tenantId])).rows[0];
    if (!row) throw new ServiceError(404, "CONFIG_NOT_FOUND", "工作区配置不存在");
    return { document: row.document, version: row.version, updatedAt: row.updated_at };
  }

  async function writeConfig(scope, document) {
    assertWritable(scope);
    if (configRepository) return configRepository.writeConfig(scope, document);
    const row = (await db.query("update workspace_configs set document=$1::jsonb,version=version+1,updated_at=now() where workspace_id=$2 and tenant_id=$3 returning version,updated_at", [json(document), scope.workspaceId, scope.tenantId])).rows[0];
    if (!row) throw new ServiceError(404, "CONFIG_NOT_FOUND", "工作区配置不存在");
    return { document, version: row.version, updatedAt: row.updated_at };
  }

  async function applyBusinessTemplateToConfig(scope, templateId, expectedVersion) {
    assertWritable(scope);
    const current = (await db.query("select document,version,updated_at from workspace_configs where workspace_id=$1 and tenant_id=$2", [scope.workspaceId, scope.tenantId])).rows[0];
    if (!current) throw new ServiceError(404, "CONFIG_NOT_FOUND", "工作区配置不存在");
    if (expectedVersion !== undefined && Number(expectedVersion) !== Number(current.version)) throw new ServiceError(409, "CONFIG_VERSION_CONFLICT", "配置已被其他操作更新，请刷新后重试");
    let document;
    try { document = applyBusinessTemplate(current.document, templateId); } catch (error) { throw new ServiceError(404, "TEMPLATE_NOT_FOUND", error.message); }
    // Template selection is intentionally non-persistent. The editor records
    // the returned document in its normal undo history and Save remains the
    // single write path for workspace configuration.
    return { document, version: current.version, updatedAt: current.updated_at, persisted: false };
  }

  function assertWritable(scope) {
    const subscription = scope?.subscription;
    if (!subscription || subscription.status !== "active") throw new ServiceError(403, "SUBSCRIPTION_REQUIRED", "订阅已到期，请兑换后继续使用");
  }

  async function getSubscription(scope) {
    if (configRepository) {
      const row = await configRepository.getSubscription(scope);
      if (!row) throw new ServiceError(404, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
      const expired = row.expires_at && new Date(row.expires_at) <= new Date();
      return { id: row.id, planId: row.plan_id === "PRO_LEGACY" ? "PRO" : row.plan_id, status: expired ? "expired" : row.status, startedAt: row.started_at, expiresAt: row.expires_at, source: row.source, remainingDays: row.expires_at ? Math.max(0, Math.ceil((new Date(row.expires_at) - Date.now()) / 86400000)) : null };
    }
    const row = (await db.query("select id,plan_id,status,started_at,expires_at,source,metadata from subscriptions where workspace_id=$1 and tenant_id=$2", [scope.workspaceId, scope.tenantId])).rows[0];
    if (!row) throw new ServiceError(404, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
    const expired = row.expires_at && new Date(row.expires_at) <= new Date();
    return { id: row.id, planId: row.plan_id === "PRO_LEGACY" ? "PRO" : row.plan_id, status: expired ? "expired" : row.status, startedAt: row.started_at, expiresAt: row.expires_at, source: row.source, remainingDays: row.expires_at ? Math.max(0, Math.ceil((new Date(row.expires_at) - Date.now()) / 86400000)) : null };
  }

  async function listAiConnections(scope) {
    return (await db.query("select * from merchant_ai_connections where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by created_at desc", [scope.tenantId, scope.workspaceId, scope.storeId])).rows.map(publicAiConnection);
  }

  async function createAiConnection(scope, input) {
    assertWritable(scope);
    const apiKey = String(input.apiKey || "").trim(); const baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, ""); const model = String(input.model || "").trim();
    if (!apiKey || !baseUrl || !model) throw new ServiceError(400, "AI_CONNECTION_INVALID", "接口地址、模型名称和 API Key 均为必填项");
    let parsed; try { parsed = new URL(baseUrl); } catch (error) { throw new ServiceError(400, "AI_BASE_URL_INVALID", "接口地址格式不正确"); }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new ServiceError(400, "AI_BASE_URL_INVALID", "生产环境模型接口必须使用 HTTPS");
    const connectionId = id();
    await db.query(`insert into merchant_ai_connections(id,tenant_id,workspace_id,store_id,provider_preset,provider_name,base_url,model,encrypted_secret,timeout_ms,max_tokens)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`, [connectionId, scope.tenantId, scope.workspaceId, scope.storeId, String(input.providerPreset || "custom"), String(input.providerName || "自定义模型"), baseUrl, model, json(encryptSecret(apiKey)), Math.max(1000, Math.min(60000, Number(input.timeoutMs || 12000))), Math.max(50, Math.min(4000, Number(input.maxTokens || 500)))]);
    return publicAiConnection((await db.query("select * from merchant_ai_connections where id=$1", [connectionId])).rows[0]);
  }

  async function scopedAiConnection(scope, connectionId) {
    const row = (await db.query("select * from merchant_ai_connections where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [connectionId, scope.tenantId, scope.workspaceId, scope.storeId])).rows[0];
    if (!row) throw new ServiceError(404, "AI_CONNECTION_NOT_FOUND", "模型连接不存在");
    return row;
  }

  async function rotateAiSecret(scope, connectionId, apiKey) {
    assertWritable(scope); await scopedAiConnection(scope, connectionId);
    if (!String(apiKey || "").trim()) throw new ServiceError(400, "AI_KEY_REQUIRED", "请输入新的 API Key");
    await db.query("update merchant_ai_connections set encrypted_secret=$1::jsonb,last_test_ok=null,last_error=null,updated_at=now() where id=$2 and workspace_id=$3", [json(encryptSecret(String(apiKey).trim())), connectionId, scope.workspaceId]);
    return publicAiConnection(await scopedAiConnection(scope, connectionId));
  }

  async function recordAiTest(scope, connectionId, ok, error = "") {
    await scopedAiConnection(scope, connectionId);
    await db.query("update merchant_ai_connections set last_test_ok=$1,last_test_at=now(),last_error=$2,updated_at=now() where id=$3 and workspace_id=$4", [ok, String(error || "").slice(0, 300) || null, connectionId, scope.workspaceId]);
    return publicAiConnection(await scopedAiConnection(scope, connectionId));
  }

  async function deleteAiConnection(scope, connectionId) { assertWritable(scope); await scopedAiConnection(scope, connectionId); await db.transaction(async tx => { await tx.query("update merchant_ai_policies set mode='rules',connection_id=null,updated_at=now() where workspace_id=$1 and connection_id=$2", [scope.workspaceId, connectionId]); await tx.query("delete from merchant_ai_connections where id=$1 and workspace_id=$2", [connectionId, scope.workspaceId]); }); return { id: connectionId }; }

  async function getAiPolicy(scope) {
    if (configRepository) {
      const row = await configRepository.getAiPolicy(scope);
      return row ? { tenantId: scope.tenantId, workspaceId: scope.workspaceId, storeId: scope.storeId, mode: row.mode, connectionId: row.connection_id, fallbackToRules: row.fallback_to_rules } : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, storeId: scope.storeId, mode: "rules", connectionId: null, fallbackToRules: true };
    }
    const row = (await db.query("select * from merchant_ai_policies where tenant_id=$1 and workspace_id=$2 and store_id=$3", [scope.tenantId, scope.workspaceId, scope.storeId])).rows[0];
    return row ? { tenantId: scope.tenantId, workspaceId: scope.workspaceId, storeId: scope.storeId, mode: row.mode, connectionId: row.connection_id, fallbackToRules: row.fallback_to_rules } : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, storeId: scope.storeId, mode: "rules", connectionId: null, fallbackToRules: true };
  }

  async function setAiPolicy(scope, input) {
    assertWritable(scope);
    if (input.mode === "platform" || input.mode === "byok") throw new ServiceError(400, "AI_MODE_UNSUPPORTED", "当前客服仅支持规则 FAQ");
    if (input.mode && input.mode !== "rules") throw new ServiceError(400, "AI_MODE_INVALID", "客服回答模式无效");
    const mode = "rules"; const connectionId = null;
    if (connectionId) await scopedAiConnection(scope, connectionId);
    await db.query(`insert into merchant_ai_policies(tenant_id,workspace_id,store_id,mode,connection_id,fallback_to_rules) values($1,$2,$3,$4,$5,$6)
      on conflict(workspace_id,store_id) do update set mode=excluded.mode,connection_id=excluded.connection_id,fallback_to_rules=excluded.fallback_to_rules,updated_at=now()`, [scope.tenantId, scope.workspaceId, scope.storeId, mode, connectionId, input.fallbackToRules !== false]);
    return getAiPolicy(scope);
  }

  async function generateLicenses(input, operator) {
    const planId = ["TRIAL", "PRO"].includes(input.planId) ? input.planId : null;
    const durationHours = Number(input.durationHours);
    const count = Math.min(100, Math.max(1, Number(input.count || 1)));
    if (!planId || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 24 * 366) throw new ServiceError(400, "INVALID_LICENSE_REQUEST", "兑换码参数不正确");
    const output = [];
    await db.transaction(async tx => {
      for (let index = 0; index < count; index += 1) {
        const code = makeLicenseCode(); const licenseId = id();
        await tx.query(`insert into license_codes(id,code_hash,code_masked,plan_id,duration_hours,status,redeem_deadline,max_uses,batch_id,channel,note,created_by)
          values($1,$2,$3,$4,$5,'unused',$6,1,$7,$8,$9,$10)`, [licenseId, licenseHash(code), maskLicense(code), planId, durationHours, input.redeemDeadline || null, String(input.batchId || "").trim() || null, String(input.channel || "").trim() || null, String(input.note || "").trim() || null, operator.id]);
        output.push({ id: licenseId, code, codeMasked: maskLicense(code), planId, durationHours });
      }
      await audit(tx, { actorType: "operator", actorId: operator.id, requestId: operator.requestId }, "license.generate", "license_batch", String(input.batchId || "adhoc"), { count, planId, durationHours, channel: input.channel || null });
    });
    return output;
  }

  async function redeemLicense(scope, code) {
    const codeHash = licenseHash(code);
    return db.transaction(async tx => {
      const license = (await tx.query("select * from license_codes where code_hash=$1", [codeHash])).rows[0];
      if (!license) throw new ServiceError(404, "LICENSE_INVALID", "兑换码无效");
      if (license.status === "disabled") throw new ServiceError(409, "LICENSE_DISABLED", "兑换码已禁用");
      if (license.redeem_deadline && new Date(license.redeem_deadline) <= new Date()) throw new ServiceError(409, "LICENSE_EXPIRED", "兑换码已过期");
      if (Number(license.used_count) >= Number(license.max_uses)) throw new ServiceError(409, "LICENSE_REDEEMED", "兑换码已使用");
      if (license.plan_id === "TRIAL") {
        const usedTrial = await tx.query("select 1 from license_redemptions where workspace_id=$1 and plan_id='TRIAL' limit 1", [scope.workspaceId]);
        if (usedTrial.rows.length) throw new ServiceError(409, "TRIAL_ALREADY_USED", "该工作区已经使用过体验兑换码");
      }
      const claimed = await tx.query(`update license_codes set used_count=used_count+1,
        status=case when used_count+1>=max_uses then 'redeemed' else 'partially_used' end
        where id=$1 and used_count<max_uses and status in ('unused','partially_used') returning id`, [license.id]);
      if (!claimed.rowCount) throw new ServiceError(409, "LICENSE_REDEEMED", "兑换码已使用");
      const current = (await tx.query("select * from subscriptions where workspace_id=$1", [scope.workspaceId])).rows[0];
      const now = new Date();
      const currentExpiry = current?.expires_at ? new Date(current.expires_at) : null;
      const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
      const expiresAt = addHours(base, Number(license.duration_hours));
      await tx.query(`insert into subscriptions(id,tenant_id,workspace_id,plan_id,status,started_at,expires_at,current_period_end,source,metadata)
        values($1,$2,$3,$4,'active',$5,$6,$6,'license','{}')
        on conflict (workspace_id) where workspace_id is not null do update set plan_id=excluded.plan_id,status='active',started_at=coalesce(subscriptions.started_at,excluded.started_at),expires_at=excluded.expires_at,current_period_end=excluded.current_period_end,source='license',updated_at=now()`,
        [current?.id || id(), scope.tenantId, scope.workspaceId, license.plan_id, now, expiresAt]);
      await tx.query("update workspaces set plan_id=$1 where id=$2 and tenant_id=$3", [license.plan_id, scope.workspaceId, scope.tenantId]);
      await tx.query(`insert into license_redemptions(id,license_id,tenant_id,workspace_id,user_id,plan_id,previous_expires_at,new_expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [id(), license.id, scope.tenantId, scope.workspaceId, scope.userId, license.plan_id, currentExpiry, expiresAt]);
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId }, "license.redeem", "license_code", license.id, { planId: license.plan_id, durationHours: Number(license.duration_hours) });
      return { planId: license.plan_id, status: "active", startedAt: current?.started_at || now, expiresAt };
    });
  }

  async function listLicenses() {
    const rows = (await db.query(`select l.id,l.code_masked,l.plan_id,l.duration_hours,l.status,l.redeem_deadline,l.used_count,l.max_uses,l.batch_id,l.channel,l.note,l.created_at,l.disabled_at,
      r.redeemed_at,r.workspace_id,r.new_expires_at from license_codes l left join lateral
      (select * from license_redemptions where license_id=l.id order by redeemed_at desc limit 1) r on true order by l.created_at desc`)).rows;
    return rows.map(row => ({ id: row.id, codeMasked: row.code_masked, planId: row.plan_id, durationHours: Number(row.duration_hours), status: row.status, redeemDeadline: row.redeem_deadline, usedCount: Number(row.used_count), maxUses: Number(row.max_uses), batchId: row.batch_id, channel: row.channel, note: row.note, createdAt: row.created_at, disabledAt: row.disabled_at, redeemedAt: row.redeemed_at, workspaceId: row.workspace_id, newExpiresAt: row.new_expires_at }));
  }

  async function disableLicense(licenseId, operator) {
    return db.transaction(async tx => {
      const row = (await tx.query("update license_codes set status='disabled',disabled_at=now() where id=$1 and used_count=0 and status in ('unused','partially_used') returning id", [licenseId])).rows[0];
      if (!row) throw new ServiceError(409, "LICENSE_NOT_DISABLEABLE", "仅可禁用尚未使用的兑换码");
      await audit(tx, { actorType: "operator", actorId: operator.id, requestId: operator.requestId }, "license.disable", "license_code", licenseId);
      return { id: licenseId, status: "disabled" };
    });
  }

  async function extendSubscription(workspaceId, days, operator) {
    const amount = Number(days);
    if (!Number.isInteger(amount) || amount < 1 || amount > 3660) throw new ServiceError(400, "INVALID_EXTENSION", "续期天数不正确");
    return db.transaction(async tx => {
      const current = (await tx.query("select * from subscriptions where workspace_id=$1", [workspaceId])).rows[0];
      if (!current) throw new ServiceError(404, "SUBSCRIPTION_NOT_FOUND", "订阅不存在");
      const now = new Date(); const currentExpiry = current.expires_at ? new Date(current.expires_at) : now;
      const expiresAt = addHours(currentExpiry > now ? currentExpiry : now, amount * 24);
      await tx.query("update subscriptions set plan_id='PRO',status='active',expires_at=$1,current_period_end=$1,source='operator',updated_at=now() where id=$2", [expiresAt, current.id]);
      await audit(tx, { tenantId: current.tenant_id, workspaceId, actorType: "operator", actorId: operator.id, requestId: operator.requestId }, "subscription.extend", "subscription", current.id, { days: amount, previousExpiresAt: current.expires_at, expiresAt });
      return { id: current.id, workspaceId, planId: "PRO", status: "active", expiresAt };
    });
  }

  async function ensureOperatorFromEnv() {
    const email = normalizeLogin(process.env.ATELIER_OPS_EMAIL || "ops-admin@localhost");
    const password = String(process.env.ATELIER_OPS_PASSWORD || "");
    if (!password) return null;
    let row = (await db.query("select * from operator_users where email=$1", [email])).rows[0];
    if (!row) {
      row = (await db.query("insert into operator_users(id,email,display_name,password_hash,role,status) values($1,$2,'ATELIER OS 管理员',$3,'super_admin','active') returning *", [id(), email, hashPassword(password)])).rows[0];
    }
    return row;
  }

  async function operatorLogin(emailValue, password, context = {}) {
    await ensureOperatorFromEnv();
    const email = normalizeLogin(emailValue); const user = (await db.query("select * from operator_users where email=$1", [email])).rows[0];
    if (!user || user.status !== "active" || !verifyPassword(String(password || ""), user.password_hash)) throw new ServiceError(401, "OPS_INVALID_CREDENTIALS", "邮箱或密码不正确");
    const token = crypto.randomBytes(32).toString("base64url"); const expiresAt = addHours(new Date(), 8); const sessionId = id();
    await db.transaction(async tx => {
      await tx.query("insert into operator_sessions(id,operator_id,token_hash,expires_at) values($1,$2,$3,$4)", [sessionId, user.id, sha256(token), expiresAt]);
      await audit(tx, { actorType: "operator", actorId: user.id, requestId: context.requestId }, "operator.login", "operator_session", sessionId, { ip: context.ipAddress || null });
    });
    return { token, expiresAt, user: { userId: user.id, email: user.email, name: user.display_name, role: user.role } };
  }

  async function resolveOperatorSession(token) {
    if (!token) return null;
    const row = (await db.query(`select s.id session_id,u.id user_id,u.email,u.display_name,u.role from operator_sessions s join operator_users u on u.id=s.operator_id
      where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() and u.status='active' limit 1`, [sha256(token)])).rows[0];
    return row ? { token, sessionId: row.session_id, userId: row.user_id, email: row.email, name: row.display_name, role: row.role } : null;
  }

  async function operatorLogout(sessionId) { if (sessionId) await db.query("update operator_sessions set revoked_at=now() where id=$1", [sessionId]); }

  async function operatorHealth() {
    await db.health();
    return { database: "ok", databaseKind: db.kind, checkedAt: new Date().toISOString() };
  }

  async function opsBootstrap() {
    const tenantRows = (await db.query(`select t.id,t.name,t.status,w.id workspace_id,w.name workspace_name,w.plan_id,s.status subscription_status,s.expires_at
      from tenants t left join workspaces w on w.tenant_id=t.id left join subscriptions s on s.workspace_id=w.id order by t.created_at desc`)).rows;
    const plans = (await db.query("select * from plan_catalog order by public desc,price_fen")).rows.map(row => ({ id: row.id, name: row.display_name, monthlyPrice: Number(row.price_fen) / 100, durationHours: row.duration_hours, public: row.public, entitlements: row.entitlements }));
    const subscriptions = tenantRows.filter(row => row.workspace_id).map(row => ({ tenantId: row.id, tenantName: row.name, workspaceId: row.workspace_id, workspaceName: row.workspace_name, planId: row.plan_id, status: row.subscription_status, expiresAt: row.expires_at }));
    const auditEvents = (await db.query("select * from audit_events order by created_at desc limit 200")).rows.map(row => ({ id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, actorType: row.actor_type, actorId: row.actor_id, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, requestId: row.request_id, metadata: row.metadata, createdAt: row.created_at }));
    const licenses = await listLicenses();
    return {
      metrics: { tenants: tenantRows.length, activeTenants: tenantRows.filter(row => row.status === "active").length, trials: tenantRows.filter(row => row.status === "trial").length },
      tenants: tenantRows.map(row => ({ id: row.id, name: row.name, status: row.status, workspaceId: row.workspace_id, workspaceName: row.workspace_name, planId: row.plan_id, subscriptionStatus: row.subscription_status, expiresAt: row.expires_at })),
      plans, subscriptions, licenses, auditEvents
    };
  }

  const workflowService = createWorkflowService({ db, audit });
  const workflowIntegrationService = createWorkflowIntegrationService({ db, workflowService, audit, mappings: workflowMappings, autoStart: process.env.NODE_ENV !== "test" && process.env.ATELIER_WORKFLOW_INTEGRATION_WORKER !== "0" });
  return { db, appointmentService, customerService, workflowService, workflowIntegrationService, recordAudit: audit, register, login, resolveSession, logout, changePassword, getProfile, updateProfile, setProfileAvatar, verifyCsrf, readConfig, writeConfig, applyBusinessTemplateToConfig, listBusinessTemplates, assertWritable, getSubscription, listAiConnections, createAiConnection, scopedAiConnection, rotateAiSecret, recordAiTest, deleteAiConnection, getAiPolicy, setAiPolicy, generateLicenses, redeemLicense, listLicenses, disableLicense, extendSubscription, ensureOperatorFromEnv, operatorLogin, resolveOperatorSession, operatorLogout, operatorHealth, opsBootstrap, ServiceError, encryptSecret, decryptSecret };
}

module.exports = { createSaasService, ServiceError, makeLicenseCode, maskLicense, sha256 };
