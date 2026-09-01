const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8");

test("membership navigation keeps a distinct membership view", () => {
  assert.match(source, /const currentView = ref\(mvpViews\.has\(requestedView\) \? requestedView : "overview"\)/);
  assert.match(source, /const isNavActive = item => currentView\.value === item\.id/);
  assert.match(source, /if \(id === "membership"\) \{\s*appointmentWorkspace\.customerSection = "membership";\s*appointmentWorkspace\.tab = "customers";\s*\}/);
  assert.doesNotMatch(source, /id = "customers";/);
});

test("customer and membership destinations render distinct headings", () => {
  assert.match(source, /currentView === 'customers' \|\| currentView === 'membership' \|\| currentView === 'appointments'/);
  assert.match(source, /currentView==='customers'\?'CUSTOMER CENTER':currentView==='membership'\?'MEMBERSHIP CENTER':'APPOINTMENTS'/);
  assert.match(source, /currentView==='customers'\?'客户中心':currentView==='membership'\?'会员中心':'预约管理'/);
  assert.match(source, /currentView==='membership'\?'管理会员计划、等级和积分规则。'/);
});

test("membership route loads the existing membership data contract", () => {
  assert.match(source, /id === "customers" \|\| id === "membership" \|\| id === "appointments" \|\| id === "overview"/);
  assert.match(source, /currentView\.value==="overview"\|\|currentView\.value==="customers"\|\|currentView\.value==="membership"\|\|currentView\.value==="appointments"/);
  for (const endpoint of ["/v1/membership-program", "/v1/membership-levels"]) assert.equal(source.includes(endpoint), true);
});
