const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../ops-public/app.js"), "utf8");

test("operator navigation exposes only PostgreSQL-backed SaaS pages", () => {
  for (const view of ["overview", "tenants", "plans", "licenses", "subscriptions", "audit", "system"]) {
    assert.match(source, new RegExp(`id: "${view}"`));
  }
  assert.equal((source.match(/\{ id: "(?:overview|tenants|plans|licenses|subscriptions|audit|system)"/g) || []).length, 7);
});

test("operator UI contains no legacy-only actions or misleading control-plane copy", () => {
  for (const forbidden of [
    "createPlatformConnection", "retryPublish", "rollbackPublish", "toggleFlag", "createTicket", "createIncident",
    "startImpersonation", "endImpersonation", "updateTenant", "updatePlan", "/ops/v1/ai/connections",
    "/ops/v1/publish-jobs", "/ops/v1/feature-flags", "/ops/v1/support-tickets", "/ops/v1/incidents",
    "/ops/v1/impersonation-sessions", "本地控制面", "核心服务正常"
  ]) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /SaaS Control Plane/);
  assert.match(source, /\.mount\("#ops-app"\)/);
  assert.match(source, /\/ops\/v1\/health/);
  assert.match(source, /只读查看租户、工作区和订阅关系/);
  assert.match(source, /plan_catalog，本页面仅供运营核对/);
});

test("system page uses safe health signals and current Feeldao branding", () => {
  assert.match(source, /view===\'system\'/);
  assert.match(source, /fetch\("\/health"/);
  assert.match(source, /await response\.json\(\)/);
  assert.match(source, /FeeldaoOpsHealth\.isHealthyApplicationResponse/);
  assert.match(source, /\/ops\/v1\/health/);
  assert.match(source, /api\("\/ops\/v1\/auth\/session"/);
  assert.doesNotMatch(source, /audit-logs/);
  assert.match(source, /密钥与凭证.*不展示/);
  assert.match(source, /生产配置.*不展示/);
  assert.match(source, /公开存活探针，不需要运营认证/);
  assert.match(source, /需要 Operator Auth 的运营状态接口/);
  assert.match(source, /访问要求.*公开/);
  assert.match(source, /访问要求.*Operator Auth/);
  assert.doesNotMatch(source, /ATELIER OS/);
  assert.doesNotMatch(source, /window\.confirm/);
});


test("license dialogs manage focus and keyboard boundaries", () => {
  for (const pattern of [
    /licenseTrigger = ref\(null\)/, /disableTrigger = ref\(null\)/,
    /openLicenseDialog\(event\)/, /focusFirstDialog\(/, /focusableInDialog\(/,
    /event\.key !== "Tab"/, /event\.shiftKey/, /event\.key === "Escape"/,
    /restoreFocus\(/, /data-dialog="license"/, /data-dialog="disable"/
  ]) assert.match(source, pattern);
  assert.doesNotMatch(source, /window\.confirm/);
});
