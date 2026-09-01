const crypto = require("node:crypto");

class MeooAiTemplateRepositoryError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}

function scopeValues(scope) {
  const values = [scope?.tenantId, scope?.workspaceId, scope?.storeId].map(v => String(v || "").trim());
  if (values.some(v => !v)) throw new MeooAiTemplateRepositoryError("SCOPE_REQUIRED", "tenant/workspace/store scope is required", 400);
  return values;
}
function encode(v) { return encodeURIComponent(String(v)); }
function qs(scope, extra = "") {
  const [tenantId, workspaceId, storeId] = scopeValues(scope);
  return `tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}&store_id=eq.${encode(storeId)}${extra ? `&${extra}` : ""}`;
}
function rows(body) { return Array.isArray(body) ? body : []; }

function createMeooAiTemplateRepository({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!url || !/^https:\/\//i.test(String(url)) || !serviceRoleKey || typeof fetchImpl !== "function") throw new Error("Meoo server configuration is required");
  const base = String(url).replace(/\/$/, "");
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  async function request(table, query = "", options = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/rest/v1/${table}${query}`, { ...options, signal: controller.signal, headers: { ...headers, ...(options.headers || {}) } });
      const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        const status = response.status >= 500 ? 503 : response.status;
        throw new MeooAiTemplateRepositoryError(body?.code || "DATABASE_UNAVAILABLE", status >= 500 ? "database request failed" : (body?.message || "database request failed"), status);
      }
      return body;
    } catch (error) {
      if (error instanceof MeooAiTemplateRepositoryError) throw error;
      throw new MeooAiTemplateRepositoryError("DATABASE_UNAVAILABLE", "database request failed", 503);
    } finally { clearTimeout(timer); }
  }
  async function list(scope) {
    return rows(await request("ai_template_drafts", `?select=id,current_revision,status,prompt,base_config_version,business_brief,created_at,updated_at&${qs(scope)}&order=created_at.desc`));
  }
  async function get(scope, draftId) {
    const [drafts, revisions] = await Promise.all([
      request("ai_template_drafts", `?select=id,current_revision,status,prompt,base_config_version,business_brief,created_at,updated_at&${qs(scope, `id=eq.${encode(draftId)}`)}&limit=1`),
      request("ai_template_draft_revisions", `?select=document,revision,change_instruction,created_at&${qs(scope, `draft_id=eq.${encode(draftId)}`)}&order=revision.desc&limit=1`)
    ]);
    const draft = rows(drafts)[0]; if (!draft) throw new MeooAiTemplateRepositoryError("AI_TEMPLATE_DRAFT_NOT_FOUND", "模板草稿不存在", 404);
    return { ...draft, revision: rows(revisions)[0] || null };
  }
  async function config(scope) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    const body = await request("workspace_configs", `?select=document,version&tenant_id=eq.${encode(tenantId)}&workspace_id=eq.${encode(workspaceId)}&store_id=eq.${encode(storeId)}&limit=1`);
    const row = rows(body)[0]; if (!row) throw new MeooAiTemplateRepositoryError("CONFIG_NOT_FOUND", "工作区配置不存在", 404); return row;
  }
  async function receipt(scope, key, operation) {
    return rows(await request("ai_template_request_receipts", `?select=response,request_hash&${qs(scope, `idempotency_key=eq.${encode(key)}&operation=eq.${encode(operation)}`)}&limit=1`))[0] || null;
  }
  async function insert(table, value) {
    const result = rows(await request(table, "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(value) }));
    if (!result[0]) throw new MeooAiTemplateRepositoryError("DATABASE_UNAVAILABLE", "database write returned no row", 503); return result[0];
  }
  async function update(table, query, value) {
    return rows(await request(table, `?${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(value) }))[0] || null;
  }
  async function generate(scope, { draftId, revisionId, prompt, response, document, requestHash, idempotencyKey, baseConfigVersion, businessBrief }) {
    const [tenantId, workspaceId, storeId] = scopeValues(scope);
    await insert("ai_template_drafts", { id: draftId, tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, base_config_version: baseConfigVersion, current_revision: 1, status: "draft", prompt, business_brief: businessBrief, provider: "rules", model: "declarative" });
    await insert("ai_template_draft_revisions", { id: revisionId, draft_id: draftId, tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, revision: 1, document, change_instruction: "initial generation" });
    await insert("ai_template_request_receipts", { tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, idempotency_key: idempotencyKey, operation: "generate", request_hash: requestHash, response });
    await request("ai_credit_accounts", "", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, balance_points: 100000 }) });
    for (const entryType of ["reserve", "reconcile"]) await request("ai_credit_ledger", "", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, idempotency_key: idempotencyKey, entry_type: entryType, points: 0, metadata: {} }) });
    await this.audit(scope, "ai.template.generate", "ai_template_draft", draftId, { revision: 1 });
    return response;
  }
  async function audit(scope, action, resourceType, resourceId, metadata = {}) {
    const [tenantId, workspaceId] = scopeValues(scope);
    await insert("audit_events", { id: crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, actor_type: "merchant", actor_id: scope.userId || null, action, resource_type: resourceType, resource_id: resourceId, metadata });
  }
  async function refine(scope, draftId, next, document, instruction) {
    const row = await get(scope, draftId); const updated = await update("ai_template_drafts", qs(scope, `id=eq.${encode(draftId)}&current_revision=eq.${Number(next) - 1}&status=eq.draft`), { current_revision: next, updated_at: new Date().toISOString() });
    if (!updated) throw new MeooAiTemplateRepositoryError("AI_TEMPLATE_DRAFT_REVISION_CONFLICT", "草稿已产生新版本，请刷新后重试", 409);
    await insert("ai_template_draft_revisions", { id: crypto.randomUUID(), draft_id: draftId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, store_id: scope.storeId, revision: next, document, change_instruction: instruction });
    await audit(scope, "ai.template.refine", "ai_template_draft", draftId, { revision: next });
    return { ...row, current_revision: next, revision: { document } };
  }
  async function markStatus(scope, draftId, status) {
    const row = await update("ai_template_drafts", qs(scope, `id=eq.${encode(draftId)}`), { status, updated_at: new Date().toISOString() });
    if (!row) throw new MeooAiTemplateRepositoryError("AI_TEMPLATE_DRAFT_NOT_FOUND", "模板草稿不存在", 404); return row;
  }
  async function createSkill(scope, skill) { const [tenantId, workspaceId, storeId] = scopeValues(scope); return insert("ai_workspace_skills", { id: crypto.randomUUID(), tenant_id: tenantId, workspace_id: workspaceId, store_id: storeId, name: skill.name, description: skill.description, status: "disabled", document: skill }); }
  async function setSkill(scope, skillId, enabled) { const row = await update("ai_workspace_skills", qs(scope, `id=eq.${encode(skillId)}`), { status: enabled ? "enabled" : "disabled", updated_at: new Date().toISOString() }); if (!row) throw new MeooAiTemplateRepositoryError("AI_SKILL_NOT_FOUND", "技能不存在", 404); return row; }
  async function credits(scope) { const row = rows(await request("ai_credit_accounts", `?${qs(scope)}&select=balance_points,reserved_points,used_points&limit=1`))[0] || {}; return { balance: Number(row.balance_points || 0), reserved: Number(row.reserved_points || 0), used: Number(row.used_points || 0) }; }
  return { list, get, config, receipt, generate, refine, markStatus, createSkill, setSkill, credits, audit };
}

module.exports = { createMeooAiTemplateRepository, MeooAiTemplateRepositoryError };