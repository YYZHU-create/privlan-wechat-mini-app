const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../ops-public/app.js"), "utf8");

test("operator navigation exposes only PostgreSQL-backed SaaS pages", () => {
  for (const view of ["overview", "tenants", "plans", "licenses", "subscriptions", "audit"]) {
    assert.match(source, new RegExp(`id: "${view}"`));
  }
  assert.equal((source.match(/\{ id: "(?:overview|tenants|plans|licenses|subscriptions|audit)"/g) || []).length, 6);
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
