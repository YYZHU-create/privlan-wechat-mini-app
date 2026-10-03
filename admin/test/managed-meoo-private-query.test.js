"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { createPrivateMeooQuery } = require("../managed-meoo-private-query");
const projectId = "asmhysidbg5g";
const credential = { apiBaseUrl: "https://meoo.com", credentialType: "bearer", accessToken: "synthetic-private-token" };
test("private query binds project and keeps SQL/results off console and files", async () => {
  let count = 0;
  const query = createPrivateMeooQuery({ projectId, loadCredentials: () => credential, fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, `https://meoo.com/open/v1/cli-compat/projects/${projectId}/cloud/database/query`);
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer synthetic-private-token");
    assert.equal(JSON.parse(options.body).disable_statement_timeout, false);
    return { ok: true, json: async () => ({ success: true, data: [{ proof: "synthetic-private-hash" }] }) };
  } });
  assert.deepEqual(await query({ projectId, sql: "select 'synthetic-private-hash'" }), [{ proof: "synthetic-private-hash" }]);
  assert.equal(count, 1);
});
test("wrong target, credential origin/scope and expired OAuth never invoke network", async () => {
  for (const credentials of [{ ...credential, apiBaseUrl: "https://other.example" }, { ...credential, projectUrlId: "g8o5cv1om41o" },
    { ...credential, credentialType: "oauth", accessTokenExpiresAt: 0 }]) {
    const query = createPrivateMeooQuery({ projectId, loadCredentials: () => credentials, fetchImpl: () => assert.fail("network reached") });
    await assert.rejects(query({ projectId, sql: "select 1" }), /AUTH_MIGRATION_CLI_CREDENTIAL_/);
  }
  const query = createPrivateMeooQuery({ projectId, loadCredentials: () => credential, fetchImpl: () => assert.fail("network reached") });
  await assert.rejects(query({ projectId: "g8o5cv1om41o", sql: "select 1" }), /BINDING_MISMATCH/);
});
test("HTTP refusal, malformed response and network failure are sanitized and never retried", async () => {
  for (const fetchResponse of [() => { throw new Error("synthetic-private-token"); },
    () => ({ ok: false }), () => ({ ok: true, json: async () => ({ success: false, message: "synthetic-private-hash" }) }),
    () => ({ ok: true, json: async () => ({ data: { query: "private", rows: null } }) })]) {
    let count = 0;
    const query = createPrivateMeooQuery({ projectId, loadCredentials: () => credential, fetchImpl: async () => { count++; return fetchResponse(); } });
    await assert.rejects(query({ projectId, sql: "select 1" }), error => error.message === "AUTH_MIGRATION_PRIVATE_QUERY_NOT_CONFIRMED");
    assert.equal(count, 1);
  }
});
test("timeout aborts the original request without resubmission", async () => {
  let count = 0;
  const query = createPrivateMeooQuery({ projectId, timeoutMs: 5, loadCredentials: () => credential, fetchImpl: async (_, { signal }) => {
    count++; return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("private")), { once: true }));
  } });
  await assert.rejects(query({ projectId, sql: "select 1" }), /PRIVATE_QUERY_NOT_CONFIRMED/);
  assert.equal(count, 1);
});
