"use strict";

const crypto = require("node:crypto");
const { createPostgresDatabase } = require("./database");
const { createSaasService } = require("./saas-service");

function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required`); return value; }
function assertUatEnvironment() {
  const env = String(process.env.DATABASE_ENV || "").trim().toLowerCase();
  if (!['staging', 'uat'].includes(env)) throw new Error("DATABASE_ENV must be staging or uat");
  if (/(production|prod)/i.test(env)) throw new Error("Production environment is not allowed");
}

async function main() {
  assertUatEnvironment();
  const url = required("ATELIER_REAL_POSTGRES_URL");
  if (!process.env.ATELIER_UAT_ALLOW_REMOTE && !/^postgres(?:ql)?:\/\/(?:[^/@]+(?::[^/@]*)?@)?(?:localhost|127\.0\.0\.1|::1)(?::\d+)?\//i.test(url)) throw new Error("Refusing non-loopback UAT database without ATELIER_UAT_ALLOW_REMOTE=1");
  const login = required("ATELIER_UAT_LOGIN").toLowerCase();
  const password = String(process.env.ATELIER_UAT_PASSWORD || crypto.randomBytes(18).toString("base64url"));
  if (password.length < 8) throw new Error("ATELIER_UAT_PASSWORD must be at least 8 characters");
  // Seed identities are synthetic and must resolve to the same Customer on every
  // idempotent run. Use the configured server key when available; otherwise derive
  // a deterministic, staging-only key from the UAT login (never a production secret).
  process.env.ATELIER_OPENID_HASH_KEY ||= crypto.createHash("sha256").update(`atelier-uat:${login}`).digest("hex");
  const db = await createPostgresDatabase(url, { migrate: true });
  const service = createSaasService({ db, licensePepper: process.env.ATELIER_LICENSE_PEPPER || "uat-license-pepper" });
  try {
    let user = (await db.query("select id from users where login_identifier=$1", [login])).rows[0];
    let registration;
    if (!user) registration = await service.register({ login, password, storeName: "UAT Demo Workspace", contactName: "UAT Owner", template: "service" }, { requestId: "uat-seed" });
    const row = registration ? { tenantId: registration.workspace.tenantId, workspaceId: registration.workspace.id, storeId: registration.workspace.storeId, userId: registration.user.id } : await (async () => {
      const existing = (await db.query(`select u.id as user_id,w.id as workspace_id,w.tenant_id as tenant_id,st.id as store_id from users u join memberships m on m.user_id=u.id join workspaces w on w.id=m.workspace_id join stores st on st.workspace_id=w.id where u.login_identifier=$1 limit 1`, [login])).rows[0];
      if (!existing) throw new Error("Unable to resolve existing UAT owner");
      return { userId: existing.user_id, workspaceId: existing.workspace_id, tenantId: existing.tenant_id, storeId: existing.store_id };
    })();
    await db.query("update subscriptions set status='active',expires_at=now()+interval '30 days' where workspace_id=$1", [row.workspaceId]);
    const scope = { tenantId: row.tenantId, workspaceId: row.workspaceId, storeId: row.storeId, userId: row.userId, requestId: "uat-seed", subscription: { status: "active" } };
    const customerService = service.customerService;
    for (let i = 1; i <= 6; i++) await customerService.touchMiniProgramCustomer(scope, { openid: `uat-openid-${i}`, displayName: i % 2 ? `UAT 用户 ${i}` : "" });
    const cfg = (await service.readConfig(scope)).document;
    cfg.serviceBot ||= {}; cfg.serviceBot.faqs = [{ id: "uat-faq-1", question: "如何预约？", keywords: ["预约"], answer: "请在预约页面选择服务和时间。", enabled: true, showAsPrompt: true }, { id: "uat-faq-2", question: "营业时间", keywords: ["营业", "时间"], answer: "工作日 09:00–18:00。", enabled: true, showAsPrompt: true }];
    cfg.onboarding = { completed: false, skipped: false, step: 1 };
    await service.writeConfig(scope, cfg);
    await db.query("insert into membership_levels(tenant_id,workspace_id,store_id,name,level_order,growth_threshold) values($1,$2,$3,'进阶会员',2,1000) on conflict (tenant_id,workspace_id,store_id,level_order) do nothing", [row.tenantId, row.workspaceId, row.storeId]);
    const serviceId = crypto.randomUUID(); const advisorId = crypto.randomUUID();
    await db.query("insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes,sort_order) values($1,$2,$3,$4,'咨询服务','UAT 示例预约服务',60,1) on conflict do nothing", [serviceId,row.tenantId,row.workspaceId,row.storeId]);
    await db.query("insert into appointment_advisors(id,tenant_id,workspace_id,store_id,name,sort_order) values($1,$2,$3,$4,'UAT 服务人员',1) on conflict do nothing", [advisorId,row.tenantId,row.workspaceId,row.storeId]);
    console.log(JSON.stringify({ seeded: true, environment: process.env.DATABASE_ENV, login, generatedPassword: process.env.ATELIER_UAT_PASSWORD ? undefined : password, tenantId: row.tenantId, workspaceId: row.workspaceId, storeId: row.storeId }, null, 2));
  } finally { await db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
