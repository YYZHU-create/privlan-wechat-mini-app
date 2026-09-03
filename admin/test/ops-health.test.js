const test = require("node:test");
const assert = require("node:assert/strict");
const { isHealthyApplicationResponse } = require("../ops-public/health");

test("application health accepts only a successful JSON status ok payload", () => {
  const cases = [
    ["200 + status ok", true, { status: "ok" }, true],
    ["200 + HTML fallback", true, null, false],
    ["200 + invalid JSON", true, null, false],
    ["200 + wrong status", true, { status: "failed" }, false],
    ["non-2xx", false, { status: "ok" }, false],
    ["network error", false, null, false]
  ];
  for (const [name, responseOk, payload, expected] of cases) {
    assert.equal(isHealthyApplicationResponse(responseOk, payload), expected, name);
  }
});

test("application health rejects arrays and inherited or missing status values", () => {
  assert.equal(isHealthyApplicationResponse(true, []), false);
  assert.equal(isHealthyApplicationResponse(true, {}), false);
  assert.equal(isHealthyApplicationResponse(true, { status: "OK" }), false);
});
