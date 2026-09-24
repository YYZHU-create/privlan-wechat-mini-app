const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerMerchantRoutes } = require("../merchant-routes");

const SCOPE = { userId: "user-fixture", tenantId: "tenant-fixture", workspaceId: "workspace-fixture", storeId: "store-fixture" };

async function withServer({ environment = "staging", authenticated = true } = {}, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-diag-route-"));
  const app = express();
  app.use(express.json());
  let uploadCalls = 0;
  const mediaService = {
    async upload(_scope, _body, { diagnosticState }) {
      uploadCalls += 1;
      const error = Object.assign(new Error("fixture secret: do-not-return"), { status: 500 });
      if (diagnosticState) {
        diagnosticState.lastCompletedPhase = "ATTEMPT_CREATED";
        diagnosticState.lastFailedCompletedPhase = "ATTEMPT_CREATED";
        diagnosticState.failedOperation = "ASSET_CONFIRM";
        diagnosticState.failureError = error;
      }
      throw error;
    }
  };
  const authService = {
    async resolveSession(token) { return authenticated && token === "fixture-session" ? SCOPE : null; },
    verifyCsrf(_scope, token) { return token === "fixture-csrf"; },
    assertWritable() {}
  };
  registerMerchantRoutes(app, async () => authService, { dataRoot: root, imagesDir: root, mediaService, runtimeEnvironment: environment });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`, () => uploadCalls); }
  finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function post(base, { diagnosticHeader = false, authenticated = true } = {}) {
  return fetch(`${base}/api/media/v1/upload`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { cookie: "atelier_merchant_session=fixture-session", "x-atelier-csrf": "fixture-csrf" } : {}),
      ...(diagnosticHeader ? { "X-FEELDAO-Media-Diagnostic": "1" } : {})
    },
    body: JSON.stringify({ name: "fixture.png", data: "not-forwarded-to-diagnostic" })
  });
}

test("authenticated Staging opt-in returns the bounded diagnostic envelope", async () => {
  await withServer({ environment: "staging" }, async (base, calls) => {
    const response = await post(base, { diagnosticHeader: true });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.match(body.diagnostic.requestId, /^merchant_[a-z0-9]+_[a-f0-9]+$/);
    assert.equal(body.diagnostic.lastCompletedPhase, "ATTEMPT_CREATED");
    assert.equal(body.diagnostic.failedOperation, "ASSET_CONFIRM");
    assert.equal(body.diagnostic.errorClass, "UNKNOWN_INTERNAL");
    const serialized = JSON.stringify(body);
    for (const forbidden of ["do-not-return", "not-forwarded-to-diagnostic", "fixture.png", "fixture-session", "fixture-csrf", "tenant-fixture", "workspace-fixture", "user-fixture"]) assert.equal(serialized.includes(forbidden), false, `response disclosed ${forbidden}`);
    assert.equal(calls(), 1);
  });
});

test("diagnostic header absent preserves the public error response", async () => {
  await withServer({ environment: "staging" }, async (base, calls) => {
    const response = await post(base);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal("diagnostic" in body, false);
    assert.deepEqual(body, { ok: false, code: "INTERNAL_ERROR", message: "服务暂时不可用", error: "服务暂时不可用", data: null, requestId: body.requestId });
    assert.equal(calls(), 1);
  });
});

test("Production header cannot activate Staging diagnostics", async () => {
  await withServer({ environment: "production" }, async (base, calls) => {
    const response = await post(base, { diagnosticHeader: true });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal("diagnostic" in body, false);
    assert.equal(calls(), 1);
  });
});

test("unauthenticated request does not reach the media upload handler", async () => {
  await withServer({ environment: "staging", authenticated: false }, async (base, calls) => {
    const response = await post(base, { diagnosticHeader: true, authenticated: false });
    assert.equal(response.status, 401);
    assert.equal(calls(), 0);
  });
});
