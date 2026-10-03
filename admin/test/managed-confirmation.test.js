"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createManagedAuth } = require("../managed-auth");
const source = fs.readFileSync(path.join(__dirname, "../public/auth-confirmation.js"), "utf8");
function page(hash, response = { ok: true, json: async () => ({ ok: true }) }) {
  const handlers = {}, elements = {}, calls = [];
  for (const id of ["confirmation-form", "confirmation-status", "complete-button", "store-name", "contact-name", "template"]) {
    elements[id] = { hidden: true, disabled: false, value: id === "template" ? "retail" : "Fixture",
      reportValidity: () => true, addEventListener: (name, fn) => { handlers[name] = fn; } };
  }
  const location = { hash, pathname: "/auth/confirmation" };
  vm.runInNewContext(source, { URLSearchParams, AbortSignal,
    window: { location, history: { replaceState: (...args) => { calls.push(["clear", ...args]); location.hash = ""; } },
      addEventListener: (name, fn) => { handlers[name] = fn; } },
    document: { getElementById: id => elements[id] },
    fetch: async (url, options) => { calls.push(["fetch", url, options]); if (response instanceof Error) throw response; return response; } });
  return { handlers, elements, calls, location };
}
test("confirmation removes URL credentials before rendering and makes no GET-side provisioning request", () => {
  const p = page("#type=signup&access_token=synthetic-proof&refresh_token=discard-me");
  assert.equal(p.location.hash, "");
  assert.deepEqual(p.calls, [["clear", null, "", "/auth/confirmation"]]);
  p.handlers.DOMContentLoaded();
  assert.equal(p.elements["confirmation-form"].hidden, false);
  assert.equal(p.calls.length, 1);
});
test("only explicit form submission sends one proof request, with no cookies or token in body", async () => {
  const p = page("#type=signup&access_token=synthetic-proof&refresh_token=discard-me");
  p.handlers.DOMContentLoaded();
  await p.handlers.submit({ preventDefault() {} });
  await p.handlers.submit({ preventDefault() {} });
  const requests = p.calls.filter(c => c[0] === "fetch");
  assert.equal(requests.length, 1);
  const [, route, options] = requests[0];
  assert.equal(route, "/auth/register/complete");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, "Bearer synthetic-proof");
  assert.deepEqual(JSON.parse(options.body), { storeName: "Fixture", contactName: "Fixture", template: "retail" });
  assert.doesNotMatch(options.body, /synthetic-proof|discard-me/);
  assert.equal(p.elements["confirmation-form"].hidden, true);
});
test("invalid, recovery and error links are cleared and never expose raw provider error", () => {
  for (const hash of ["", "#type=recovery&access_token=synthetic", "#type=signup&access_token=synthetic&error=private-message"]) {
    const p = page(hash); p.handlers.DOMContentLoaded();
    assert.equal(p.elements["confirmation-form"].hidden, true);
    assert.equal(p.handlers.submit, undefined);
    assert.doesNotMatch(p.elements["confirmation-status"].textContent, /private-message/);
  }
});
test("unknown request outcome is shown and not automatically retried", async () => {
  const p = page("#type=signup&access_token=synthetic", new Error("private network detail"));
  p.handlers.DOMContentLoaded(); await p.handlers.submit({ preventDefault() {} });
  await p.handlers.submit({ preventDefault() {} });
  assert.equal(p.calls.filter(c => c[0] === "fetch").length, 1);
  assert.match(p.elements["confirmation-status"].textContent, /结果尚未确认/);
  assert.doesNotMatch(p.elements["confirmation-status"].textContent, /private network detail/);
});
test("registration redirect must be a server-configured HTTPS origin before provider signup", async () => {
  for (const applicationOrigin of [undefined, "http://merchant.test", "https://user:password@merchant.test", "https://merchant.test/path", "https://merchant.test?redirect=other"]) {
    let calls = 0;
    const auth = createManagedAuth({ projectId: "fixture", supabaseUrl: "https://provider.test", anonKey: "synthetic", applicationOrigin,
      resolveIdentityLink: async () => null, loadBusinessPrincipal: async () => null,
      createClient: () => { calls++; return {}; } });
    await assert.rejects(auth.beginRegistration({ email: "merchant@example.test", password: "synthetic-password" }), { code: "MANAGED_AUTH_REGISTRATION_NOT_CONFIGURED" });
    assert.equal(calls, 0);
  }
});
test("dedicated confirmation route has local-only policy, no third-party resources or service/database access", async () => {
  const express = require("express"), http = require("node:http"), os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "confirmation-http-"));
  const app = express();
  require("../merchant-routes").registerMerchantRoutes(app, async () => { throw new Error("GET must not access service"); }, { dataRoot: dir });
  const server = http.createServer(app); await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/confirmation`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const html = await response.text();
    assert.doesNotMatch(html, /https?:\/\/|unpkg|iconify/i);
    assert.ok(html.indexOf("<script") < html.indexOf("<link"));
    assert.deepEqual(response.headers.getSetCookie(), []);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
