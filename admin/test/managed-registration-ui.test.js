"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(process.env.REGISTRATION_UI_SOURCE || path.join(__dirname, "../public/app.js"), "utf8");
const start = source.indexOf("    async function submitAuth() {");
const end = source.indexOf("    async function checkMerchantSession", start);
assert.ok(start >= 0 && end > start);
function fixture(mode, data) {
  const auth = { mode, sending: false, loading: true, password: "synthetic-password", session: null };
  let loads = 0;
  const load = async () => { loads++; };
  const submit = new Function("auth", "fetch", "loadConfig", "loadPlatform", "loadSubscription", "loadProfile", "loadBusinessTemplates", "currentView", "loadAppointmentServices", "loadCart", source.slice(start, end) + ";return submitAuth;")(
    auth, async () => ({ ok: true, json: async () => ({ ok: true, data }) }),
    load, load, load, load, load, { value: "overview" }, load, load);
  return { auth, submit, loads: () => loads };
}
test("verification-pending registration remains logged out and loads no business data", async () => {
  const f = fixture("register", { emailVerificationRequired: true });
  await f.submit();
  assert.equal(f.auth.session, null);
  assert.equal(f.auth.password, "");
  assert.equal(f.auth.sending, false);
  assert.equal(f.auth.loading, false);
  assert.match(f.auth.notice, /验证邮箱/);
  assert.equal(f.loads(), 0);
});
test("normal login still initializes the existing workspace", async () => {
  const session = { user: { id: "synthetic-user" } };
  const f = fixture("login", session);
  await f.submit();
  assert.equal(f.auth.session, session);
  assert.equal(f.loads(), 6);
});
