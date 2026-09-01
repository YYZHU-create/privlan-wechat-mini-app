const crypto = require("node:crypto");

const COMPONENTS = Object.freeze([
  ["hero", "首屏主视觉", ["home", "campaign"]],
  ["media", "媒体区块", ["home", "category", "campaign", "detail", "cart", "mine"]],
  ["categories", "分类导航", ["home", "category"]],
  ["product-grid", "商品网格", ["home", "category", "campaign", "detail", "cart", "mine"]],
  ["product-detail", "商品详情", ["detail"]],
  ["member-banner", "会员横幅", ["home", "mine"]],
  ["text", "文字区块", ["home", "category", "campaign", "detail", "appointment", "cart", "mine"]],
  ["image", "图片区块", ["home", "category", "campaign", "detail"]],
  ["divider", "分隔线", ["home", "category", "campaign", "detail", "appointment"]],
  ["spacer", "留白区块", ["home", "category", "campaign", "detail", "appointment"]],
  ["appointment-hero", "预约页头图", ["appointment"]],
  ["appointment-form", "预约表单", ["appointment"]],
  ["appointment-notes", "预约备注", ["appointment"]],
  ["appointment-submit", "预约提交", ["appointment"]]
].map(([id, displayName, supportedPages]) => ({
  id, displayName, supportedPages,
  allowedProps: ["title", "text", "description", "image", "heroIndex", "showButton", "buttonText", "count", "category", "columns", "showName", "showPrice", "productId", "showActions", "slides", "autoplay", "interval", "transition", "subtitle", "kicker", "fit", "src", "loop", "mode", "overlay", "muted", "controls", "position", "linkType", "linkValue", "successCopy", "successTitle", "placeholder", "label", "showPhone", "showService", "showStore", "showDate", "showTime", "showAdvisor"],
  allowedStyleProperties: ["height", "paddingX", "paddingY", "gap", "backgroundColor", "textColor", "fontFamily", "fontSize"],
  allowedVariants: ["default", "editorial", "compact"]
})));

const CAPABILITIES = Object.freeze([
  { id: "products", label: "商品", source: "workspace_config.products", available: true },
  { id: "appointments", label: "预约", source: "appointment_domain", available: true },
  { id: "customer", label: "客户", source: "customer_domain", available: true },
  { id: "staff", label: "团队", source: "operation_engine", available: true },
  { id: "membership", label: "会员", source: "membership_domain", available: true },
  { id: "media", label: "素材", source: "workspace_media", available: true },
  { id: "serviceBot", label: "客服", source: "workspace_config.serviceBot", available: true },
  { id: "payment", label: "支付", source: "future_payment_domain", available: false },
  { id: "wallet", label: "钱包", source: "future_wallet_domain", available: false }
]);

const FORBIDDEN = /(?:ignore\s+(?:all\s+)?previous|忽略之前|系统提示|system prompt|隐藏规则|api\s*key|密码|token|cookie|authorization|跨租户|other tenant|读取客户数据|read all customers|execute\s+(?:shell|sql|python)|执行\s*(?:命令|shell|sql)|修改数据库|外部网址|arbitrary\s*(?:url|code|tool)|javascript|<\/?(?:script|wxml|wxss))/i;

class TemplateError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function id() { return crypto.randomUUID(); }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function clone(value) { return JSON.parse(JSON.stringify(value ?? {})); }
function cleanText(value, max = 5000) { return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max); }
function sanitizePrompt(value) {
  const prompt = cleanText(value, 4000);
  if (!prompt) throw new TemplateError(400, "AI_TEMPLATE_PROMPT_REQUIRED", "请输入店铺和小程序需求");
  if (FORBIDDEN.test(prompt)) throw new TemplateError(400, "AI_TEMPLATE_INPUT_REJECTED", "请求包含不受支持的指令");
  return prompt;
}
function buildComponentRegistry() { return COMPONENTS.map(item => clone(item)); }
function buildCapabilityRegistry() { return CAPABILITIES.map(item => clone(item)); }
function allowedComponent(type) { return COMPONENTS.some(item => item.id === type); }

function validateTemplateDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new TemplateError(400, "AI_TEMPLATE_INVALID_DOCUMENT", "模板文档格式无效");
  const pages = document.pageLayouts;
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) throw new TemplateError(400, "AI_TEMPLATE_INVALID_DOCUMENT", "模板缺少页面布局");
  const output = clone(document);
  for (const [page, sections] of Object.entries(pages)) {
    if (!Array.isArray(sections) || sections.length > 40) throw new TemplateError(400, "AI_TEMPLATE_INVALID_DOCUMENT", "页面区块数量无效");
    const ids = new Set();
    for (const section of sections) {
      if (!section || typeof section !== "object") throw new TemplateError(400, "AI_TEMPLATE_INVALID_DOCUMENT", "区块格式无效");
      const type = cleanText(section.type, 80); const sectionId = cleanText(section.id, 120);
      if (!sectionId || ids.has(sectionId)) throw new TemplateError(400, "AI_TEMPLATE_INVALID_DOCUMENT", "区块标识必须唯一");
      if (!allowedComponent(type)) throw new TemplateError(400, "AI_TEMPLATE_UNSUPPORTED_COMPONENT", `不支持的区块：${type}`);
      const registry = COMPONENTS.find(item => item.id === type);
      if (page && !registry.supportedPages.includes(page)) throw new TemplateError(400, "AI_TEMPLATE_COMPONENT_PAGE_INVALID", `区块不能用于页面：${page}`);
      ids.add(sectionId);
      section.type = type; section.id = sectionId; section.enabled = section.enabled !== false;
      section.props = section.props && typeof section.props === "object" && !Array.isArray(section.props) ? section.props : {};
      section.style = section.style && typeof section.style === "object" && !Array.isArray(section.style) ? section.style : {};
      for (const key of Object.keys(section.props)) if (!registry.allowedProps.includes(key)) delete section.props[key];
      for (const key of Object.keys(section.style)) if (!registry.allowedStyleProperties.includes(key)) delete section.style[key];
      for (const value of Object.values(section.props)) if (typeof value === "string" && FORBIDDEN.test(value)) throw new TemplateError(400, "AI_TEMPLATE_OUTPUT_REJECTED", "模板内容包含不受支持的指令");
    }
  }
  if (!Object.values(pages).some(sections => sections.some(section => section.enabled !== false))) throw new TemplateError(400, "AI_TEMPLATE_INVALID_DOCUMENT", "模板至少需要一个启用区块");
  delete output.code; delete output.script; delete output.wxml; delete output.wxss; delete output.sql; delete output.tools;
  return output;
}

function buildDraftDocument(config, prompt) {
  const draft = clone(config);
  draft.pageLayouts = clone(config.pageLayouts || {});
  const home = Array.isArray(draft.pageLayouts.home) ? draft.pageLayouts.home : [];
  if (!home.length) draft.pageLayouts.home = [{ id: "ai-hero-1", type: "hero", name: "AI 生成主视觉", enabled: true, props: { heroIndex: 0, showButton: true, buttonText: "了解更多" }, style: { height: 350 }, visibility: { mobile: true, tablet: true, desktop: true } }];
  if (/预约|服务|咨询|课程|摄影|婚礼/.test(prompt) && !Object.values(draft.pageLayouts).some(sections => (sections || []).some(section => section.type === "appointment-form"))) {
    draft.pageLayouts.appointment = [{ id: "ai-appointment-form", type: "appointment-form", name: "预约表单", enabled: true, props: { showName: true, showPhone: true, showService: true, showStore: true, showDate: true, showTime: true, showAdvisor: true }, style: { paddingX: 16, paddingY: 20 }, visibility: { mobile: true, tablet: true, desktop: true } }];
  }
  return validateTemplateDocument(draft);
}

function normalizeSkill(input) {
  const name = cleanText(input?.name || "未命名技能", 120);
  const source = cleanText(input?.source ?? input?.content, 20000);
  if (!source) throw new TemplateError(400, "AI_SKILL_SOURCE_REQUIRED", "技能内容不能为空");
  const safeSource = source.split(/\r?\n/).filter(line => !FORBIDDEN.test(line)).join("\n");
  let instructions = Array.isArray(input?.instructions) ? input.instructions : safeSource.split(/\r?\n/).map(line => line.replace(/^[-*#]\s*/, "").trim()).filter(Boolean);
  instructions = instructions.map(item => cleanText(item, 500)).filter(item => item && !FORBIDDEN.test(item)).slice(0, 50);
  return { name, description: cleanText(input?.description, 500), instructions, preferredComponents: [], discouragedComponents: [], designPreferences: {}, contentRules: [], examples: [] };
}

function createNativeAiTemplateService({ db, audit } = {}) {
  if (!db) throw new Error("database is required");
  async function scopedDraft(scope, draftId) {
    const row = (await db.query("select * from ai_template_drafts where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [draftId, scope.tenantId, scope.workspaceId, scope.storeId])).rows[0];
    if (!row) throw new TemplateError(404, "AI_TEMPLATE_DRAFT_NOT_FOUND", "模板草稿不存在");
    return row;
  }
  async function log(tx, scope, action, resourceType, resourceId, metadata = {}) {
    if (audit) return audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId }, action, resourceType, resourceId, metadata);
  }
  async function getConfigVersion(scope) { return Number((await db.query("select version from workspace_configs where workspace_id=$1 and tenant_id=$2", [scope.workspaceId, scope.tenantId])).rows[0]?.version || 0); }
  async function generate(scope, input = {}) {
    const prompt = sanitizePrompt(input.prompt); const key = cleanText(input.idempotencyKey, 160);
    if (!key) throw new TemplateError(400, "AI_TEMPLATE_IDEMPOTENCY_REQUIRED", "缺少幂等键");
    const requestHash = hash(JSON.stringify({ prompt }));
    const existing = (await db.query("select * from ai_template_request_receipts where tenant_id=$1 and workspace_id=$2 and store_id=$3 and idempotency_key=$4 and operation='generate'", [scope.tenantId, scope.workspaceId, scope.storeId, key])).rows[0];
    if (existing) { if (existing.request_hash !== requestHash) throw new TemplateError(409, "AI_TEMPLATE_IDEMPOTENCY_CONFLICT", "幂等键已用于其他模板请求"); return { ...existing.response, idempotent: true }; }
    const config = (await db.query("select document,version from workspace_configs where workspace_id=$1 and tenant_id=$2", [scope.workspaceId, scope.tenantId])).rows[0];
    if (!config) throw new TemplateError(404, "CONFIG_NOT_FOUND", "工作区配置不存在");
    const document = buildDraftDocument(config.document, prompt); const draftId = id("draft"); const revisionId = id("rev");
    const response = { draftId, draftRevision: 1, baseConfigVersion: Number(config.version), status: "draft", document, businessBrief: { primaryGoal: "建立清晰的小程序入口", prompt } };
    await db.transaction(async tx => {
      await tx.query("insert into ai_template_drafts(id,tenant_id,workspace_id,store_id,base_config_version,current_revision,status,prompt,business_brief,provider,model) values($1,$2,$3,$4,$5,1,'draft',$6,$7::jsonb,'rules','declarative')", [draftId, scope.tenantId, scope.workspaceId, scope.storeId, Number(config.version), prompt, JSON.stringify(response.businessBrief)]);
      await tx.query("insert into ai_template_draft_revisions(id,draft_id,tenant_id,workspace_id,store_id,revision,document,change_instruction) values($1,$2,$3,$4,$5,1,$6::jsonb,$7)", [revisionId, draftId, scope.tenantId, scope.workspaceId, scope.storeId, JSON.stringify(document), "initial generation"]);
      await tx.query("insert into ai_template_request_receipts(tenant_id,workspace_id,store_id,idempotency_key,operation,request_hash,response) values($1,$2,$3,$4,'generate',$5,$6::jsonb)", [scope.tenantId, scope.workspaceId, scope.storeId, key, requestHash, JSON.stringify(response)]);
      await tx.query("insert into ai_credit_accounts(tenant_id,workspace_id,store_id,balance_points) values($1,$2,$3,100000) on conflict (tenant_id,workspace_id,store_id) do nothing", [scope.tenantId, scope.workspaceId, scope.storeId]);
      await tx.query("insert into ai_credit_ledger(tenant_id,workspace_id,store_id,idempotency_key,entry_type,points,metadata) values($1,$2,$3,$4,'reserve',0,'{}') on conflict do nothing", [scope.tenantId, scope.workspaceId, scope.storeId, key]);
      await tx.query("insert into ai_credit_ledger(tenant_id,workspace_id,store_id,idempotency_key,entry_type,points,metadata) values($1,$2,$3,$4,'reconcile',0,'{}') on conflict do nothing", [scope.tenantId, scope.workspaceId, scope.storeId, key]);
      await log(tx, scope, "ai.template.generate", "ai_template_draft", draftId, { revision: 1 });
    });
    return response;
  }
  async function listDrafts(scope) { return (await db.query("select id,current_revision,status,prompt,base_config_version,created_at,updated_at from ai_template_drafts where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by created_at desc", [scope.tenantId, scope.workspaceId, scope.storeId])).rows.map(row => ({ draftId: row.id, draftRevision: Number(row.current_revision), status: row.status, prompt: row.prompt, baseConfigVersion: Number(row.base_config_version), createdAt: row.created_at, updatedAt: row.updated_at })); }
  async function getDraft(scope, draftId) { const row = await scopedDraft(scope, draftId); const revision = (await db.query("select document,revision,change_instruction,created_at from ai_template_draft_revisions where draft_id=$1 and revision=$2", [draftId, row.current_revision])).rows[0]; return { draftId: row.id, draftRevision: Number(row.current_revision), status: row.status, prompt: row.prompt, baseConfigVersion: Number(row.base_config_version), document: revision?.document || {}, businessBrief: row.business_brief, createdAt: row.created_at, updatedAt: row.updated_at }; }
  async function refine(scope, draftId, input = {}) {
    const row = await scopedDraft(scope, draftId); const supplied = Number(input.draftRevision);
    if (row.status !== "draft") throw new TemplateError(409, "AI_TEMPLATE_DRAFT_NOT_EDITABLE", "草稿当前不可修改");
    if (!Number.isInteger(supplied) || supplied !== Number(row.current_revision)) throw new TemplateError(409, "AI_TEMPLATE_DRAFT_REVISION_CONFLICT", "草稿已产生新版本，请刷新后重试");
    const instruction = sanitizePrompt(input.merchantInstruction); const current = await getDraft(scope, draftId); const document = clone(current.document);
    if (/删除|移除/.test(instruction)) document.pageLayouts.home = (document.pageLayouts.home || []).slice(0, Math.max(0, (document.pageLayouts.home || []).length - 1));
    if (/预约|服务/.test(instruction) && !document.pageLayouts.appointment) document.pageLayouts.appointment = [{ id: `ai-appointment-${Date.now()}`, type: "appointment-form", enabled: true, props: { showName: true, showPhone: true, showService: true }, style: {} }];
    const validated = validateTemplateDocument(document); const next = supplied + 1; const revisionId = id("rev");
    await db.transaction(async tx => {
      const locked = (await tx.query("update ai_template_drafts set current_revision=$1,updated_at=now() where id=$2 and tenant_id=$3 and workspace_id=$4 and store_id=$5 and current_revision=$6 and status='draft' returning id", [next, draftId, scope.tenantId, scope.workspaceId, scope.storeId, supplied])).rows[0];
      if (!locked) throw new TemplateError(409, "AI_TEMPLATE_DRAFT_REVISION_CONFLICT", "草稿已产生新版本，请刷新后重试");
      await tx.query("insert into ai_template_draft_revisions(id,draft_id,tenant_id,workspace_id,store_id,revision,document,change_instruction) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [revisionId, draftId, scope.tenantId, scope.workspaceId, scope.storeId, next, JSON.stringify(validated), instruction]);
      await log(tx, scope, "ai.template.refine", "ai_template_draft", draftId, { revision: next });
    });
    return { draftId, draftRevision: next, status: "draft", baseConfigVersion: Number(row.base_config_version), document: validated };
  }
  async function apply(scope, draftId) {
    const row = await scopedDraft(scope, draftId); const currentVersion = await getConfigVersion(scope);
    if (currentVersion !== Number(row.base_config_version)) throw new TemplateError(409, "AI_TEMPLATE_CONFIG_VERSION_CONFLICT", "编辑器配置已更新，请基于最新配置重新生成");
    const current = await getDraft(scope, draftId); await db.query("update ai_template_drafts set status='applied',updated_at=now() where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 and status='draft'", [draftId, scope.tenantId, scope.workspaceId, scope.storeId]);
    await log(db, scope, "ai.template.apply", "ai_template_draft", draftId, { persisted: false });
    return { ...current, persisted: false, editorDirty: true };
  }
  async function discard(scope, draftId) { await scopedDraft(scope, draftId); await db.query("update ai_template_drafts set status='discarded',updated_at=now() where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [draftId, scope.tenantId, scope.workspaceId, scope.storeId]); return { draftId, status: "discarded" }; }
  async function createSkill(scope, input) { const skill = normalizeSkill(input); const skillId = id("skill"); await db.query("insert into ai_workspace_skills(id,tenant_id,workspace_id,store_id,name,description,status,document) values($1,$2,$3,$4,$5,$6,'disabled',$7::jsonb)", [skillId, scope.tenantId, scope.workspaceId, scope.storeId, skill.name, skill.description, JSON.stringify(skill)]); return { skillId, ...skill, status: "disabled" }; }
  async function setSkill(scope, skillId, enabled) { const row = (await db.query("update ai_workspace_skills set status=$1,updated_at=now() where id=$2 and tenant_id=$3 and workspace_id=$4 and store_id=$5 returning id,status,document", [enabled ? "enabled" : "disabled", skillId, scope.tenantId, scope.workspaceId, scope.storeId])).rows[0]; if (!row) throw new TemplateError(404, "AI_SKILL_NOT_FOUND", "技能不存在"); return { skillId: row.id, status: row.status, ...row.document }; }
  async function getCredits(scope) { const row = (await db.query("select balance_points,reserved_points,used_points from ai_credit_accounts where tenant_id=$1 and workspace_id=$2 and store_id=$3", [scope.tenantId, scope.workspaceId, scope.storeId])).rows[0]; return { balance: Number(row?.balance_points || 0), reserved: Number(row?.reserved_points || 0), used: Number(row?.used_points || 0) }; }
  return { generate, listDrafts, getDraft, refine, apply, discard, createSkill, setSkill, getComponents: buildComponentRegistry, getCapabilities: buildCapabilityRegistry, getCredits };
}

function createRepositoryAiTemplateService({ db, audit, repository } = {}) {
  if (!repository) throw new Error("AI repository is required");
  async function generate(scope, input = {}) {
    const prompt = sanitizePrompt(input.prompt); const key = cleanText(input.idempotencyKey, 160);
    if (!key) throw new TemplateError(400, "AI_TEMPLATE_IDEMPOTENCY_REQUIRED", "缺少幂等键");
    const requestHash = hash(JSON.stringify({ prompt })); const existing = await repository.receipt(scope, key, "generate");
    if (existing) { if (existing.request_hash !== requestHash) throw new TemplateError(409, "AI_TEMPLATE_IDEMPOTENCY_CONFLICT", "幂等键已用于其他模板请求"); return { ...existing.response, idempotent: true }; }
    const config = await repository.config(scope); const document = buildDraftDocument(config.document, prompt); const draftId = id("draft"); const revisionId = id("rev");
    const businessBrief = { primaryGoal: "建立清晰的小程序入口", prompt }; const response = { draftId, draftRevision: 1, baseConfigVersion: Number(config.version), status: "draft", document, businessBrief };
    await repository.generate(scope, { draftId, revisionId, prompt, response, document, requestHash, idempotencyKey: key, baseConfigVersion: Number(config.version), businessBrief }); return response;
  }
  async function listDrafts(scope) { return (await repository.list(scope)).map(row => ({ draftId: row.id, draftRevision: Number(row.current_revision), status: row.status, prompt: row.prompt, baseConfigVersion: Number(row.base_config_version), createdAt: row.created_at, updatedAt: row.updated_at })); }
  async function getDraft(scope, draftId) { const row = await repository.get(scope, draftId); return { draftId: row.id, draftRevision: Number(row.current_revision), status: row.status, prompt: row.prompt, baseConfigVersion: Number(row.base_config_version), document: row.revision?.document || {}, businessBrief: row.business_brief, createdAt: row.created_at, updatedAt: row.updated_at }; }
  async function refine(scope, draftId, input = {}) {
    const row = await repository.get(scope, draftId); const supplied = Number(input.draftRevision);
    if (row.status !== "draft") throw new TemplateError(409, "AI_TEMPLATE_DRAFT_NOT_EDITABLE", "草稿当前不可修改");
    if (!Number.isInteger(supplied) || supplied !== Number(row.current_revision)) throw new TemplateError(409, "AI_TEMPLATE_DRAFT_REVISION_CONFLICT", "草稿已产生新版本，请刷新后重试");
    const instruction = sanitizePrompt(input.merchantInstruction); const document = clone(row.revision?.document || {});
    if (/删除|移除/.test(instruction)) document.pageLayouts.home = (document.pageLayouts.home || []).slice(0, Math.max(0, (document.pageLayouts.home || []).length - 1));
    if (/预约|服务/.test(instruction) && !document.pageLayouts.appointment) document.pageLayouts.appointment = [{ id: `ai-appointment-${Date.now()}`, type: "appointment-form", enabled: true, props: { showName: true, showPhone: true, showService: true }, style: {} }];
    const validated = validateTemplateDocument(document); const next = supplied + 1; await repository.refine(scope, draftId, next, validated, instruction); return { draftId, draftRevision: next, status: "draft", baseConfigVersion: Number(row.base_config_version), document: validated };
  }
  async function apply(scope, draftId) { const row = await repository.get(scope, draftId); const config = await repository.config(scope); if (Number(config.version) !== Number(row.base_config_version)) throw new TemplateError(409, "AI_TEMPLATE_CONFIG_VERSION_CONFLICT", "编辑器配置已更新，请基于最新配置重新生成"); const current = await getDraft(scope, draftId); await repository.markStatus(scope, draftId, "applied"); await repository.audit(scope, "ai.template.apply", "ai_template_draft", draftId, { persisted: false }); return { ...current, status: "applied", persisted: false, editorDirty: true }; }
  async function discard(scope, draftId) { await repository.get(scope, draftId); await repository.markStatus(scope, draftId, "discarded"); return { draftId, status: "discarded" }; }
  async function createSkill(scope, input) { const skill = normalizeSkill(input); const row = await repository.createSkill(scope, skill); return { skillId: row.id, ...skill, status: "disabled" }; }
  async function setSkill(scope, skillId, enabled) { const row = await repository.setSkill(scope, skillId, enabled); return { skillId: row.id, status: row.status, ...(row.document || {}) }; }
  async function getCredits(scope) { return repository.credits(scope); }
  return { generate, listDrafts, getDraft, refine, apply, discard, createSkill, setSkill, getComponents: buildComponentRegistry, getCapabilities: buildCapabilityRegistry, getCredits };
}

function createAiTemplateService({ db, audit, repository } = {}) { return repository ? createRepositoryAiTemplateService({ db, audit, repository }) : createNativeAiTemplateService({ db, audit }); }
module.exports = { TemplateError, sanitizePrompt, normalizeSkill, validateTemplateDocument, buildComponentRegistry, buildCapabilityRegistry, buildDraftDocument, createAiTemplateService };
