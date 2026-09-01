const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("marketing merchant UI exposes lifecycle forms and scoped routes", () => {
  const ui = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
  for (const marker of ["openMarketingDialog('audience')", "openMarketingDialog('offer')", "openMarketingDialog('campaign')", "saveMarketing", "setMarketingStatus", "/v1/marketing/audiences", "/v1/marketing/offers", "/v1/marketing/campaigns"]) assert.ok(ui.includes(marker), marker);
  assert.ok(ui.includes("marketing.dialog")); assert.ok(ui.includes("required"));
});
