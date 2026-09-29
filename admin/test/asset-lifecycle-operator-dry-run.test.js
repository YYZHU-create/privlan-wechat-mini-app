const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { ServiceError } = require("../saas-service");
const { generateLifecycleMaintenanceReport } = require("../asset-lifecycle-report");
const { createOperatorReadLimiter, registerOpsSaasRoutes } = require("../merchant-routes");

const TENANT = "1460dca3-802f-4cb7-808d-2cb1865fb0a1";
const WORKSPACE = "f013b82e-b869-4f52-9598-8eb53deed303";

function lifecycleFixture() {
  const calls = [];
  const deletedCanary = { id: "dbb3a3d4-2320-4d5f-b7ca-560d32ac5f5e", status: "deleted", deleted_at: "2026-09-18T00:00:00.000Z" };
  return {
    calls,
    repository: {
      async countDeletedAssets(scope, input) {
        calls.push(["countDeletedAssets", scope, input]);
        if (input.retentionCutoff) return 0;
        return input.withLinks ? 1 : 1;
      },
      async purgeDeletedAsset() { throw new Error("PURGE_MUST_NOT_BE_CALLED"); },
      async cleanupDeletedAssetLinks() { throw new Error("CLEANUP_MUST_NOT_BE_CALLED"); },
      async finalizeAssetDeletion() { throw new Error("FINALIZE_MUST_NOT_BE_CALLED"); }
    }
  };
}

async function start(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function request(baseUrl, pathname, actor) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: actor ? { "x-test-actor": actor } : {} });
  return { status: response.status, body: await response.json() };
}

test("operator lifecycle report is aggregate-only, scoped, and has no mutation or storage dependency", async () => {
  const { repository, calls } = lifecycleFixture();
  const events = [];
  const report = await generateLifecycleMaintenanceReport({
    repository,
    scope: { tenantId: TENANT, workspaceId: WORKSPACE },
    requestId: "ops_lifecycle_test",
    operatorUserId: "op-test",
    now: new Date("2026-09-19T00:00:00.000Z"),
    onEvent: (event, fields) => events.push({ event, fields })
  });
  assert.deepEqual(report, {
    mode: "dry-run",
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    purgeCandidateCount: 0,
    retentionCandidateCount: 1,
    reconciliationCandidateCount: 1,
    requestId: "ops_lifecycle_test",
    generatedAt: "2026-09-19T00:00:00.000Z",
    storageVerificationRequired: false
  });
  assert.equal(calls.filter(call => call[0] === "countDeletedAssets").length, 4);
  assert.equal(calls.every(call => call[2].allStores === true), true);
  assert.equal(calls[0][2].allStores, true);
  assert.equal(events[0].event, "asset_lifecycle_dry_run_requested");
  assert.equal(events[0].fields.operatorUserId, "op-test");
  assert.equal(events[0].fields.candidateCounts.reconciliation, 1);
});

test("operator dry-run route rejects unauthenticated, merchant, non-platform, and cross-scope callers", async () => {
  const { repository } = lifecycleFixture();
  const logs = [];
  const app = express();
  app.use((req, _res, next) => {
    if (req.get("x-test-actor") === "operator") req.operator = { userId: "op-1", role: "super_admin" };
    if (req.get("x-test-actor") === "support") req.operator = { userId: "op-2", role: "support" };
    if (req.get("x-test-actor") === "merchant") req.merchantScope = { tenantId: TENANT, workspaceId: WORKSPACE, role: "owner" };
    next();
  });
  const service = {
    async validateOperatorScope(tenantId, workspaceId) {
      if (tenantId === TENANT && workspaceId === WORKSPACE) return { tenantId, workspaceId };
      throw new ServiceError(404, "ASSET_LIFECYCLE_SCOPE_NOT_FOUND", "租户或工作区不存在");
    }
  };
  registerOpsSaasRoutes(app, async () => service, {
    buildLifecycleReport: input => generateLifecycleMaintenanceReport({ repository, ...input, now: new Date("2026-09-19T00:00:00.000Z") }),
    lifecycleLogger: { info: entry => logs.push(entry) }
  });
  const { server, baseUrl } = await start(app);
  try {
    const target = `/ops/v1/asset-lifecycle/dry-run?tenantId=${TENANT}&workspaceId=${WORKSPACE}&operatorUserId=spoofed`;
    assert.equal((await request(baseUrl, target)).status, 401);
    assert.equal((await request(baseUrl, target, "merchant")).status, 401);
    assert.equal((await request(baseUrl, target, "support")).status, 403);
    assert.equal((await request(baseUrl, `/ops/v1/asset-lifecycle/dry-run?tenantId=${TENANT}&workspaceId=00000000-0000-0000-0000-000000000000`, "operator")).status, 404);
    const allowed = await request(baseUrl, target, "operator");
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.data.mode, "dry-run");
    assert.equal(allowed.body.data.retentionCandidateCount, 1);
    assert.equal(allowed.body.data.reconciliationCandidateCount, 1);
    assert.equal(allowed.body.data.purgeCandidateCount, 0);
    assert.match(allowed.body.requestId, /^ops_lifecycle_/);
    assert.doesNotMatch(JSON.stringify(allowed.body), /service.?role|secret|storage.*key|database.*url/i);
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]).operatorUserId, "op-1");
    assert.doesNotMatch(logs[0], /spoofed/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("operator dry-run returns a fixed database error without raw backend details", async () => {
  const app = express();
  app.use((req, _res, next) => { req.operator = { userId: "op-1", role: "super_admin" }; next(); });
  registerOpsSaasRoutes(app, async () => ({ async validateOperatorScope() { return { tenantId: TENANT, workspaceId: WORKSPACE }; } }), {
    buildLifecycleReport: async () => { throw new Error("postgresql://operator:password@private-host/feeldao"); },
    lifecycleLogger: { info() {} }
  });
  const { server, baseUrl } = await start(app);
  try {
    const result = await request(baseUrl, `/ops/v1/asset-lifecycle/dry-run?tenantId=${TENANT}&workspaceId=${WORKSPACE}`, "operator");
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "DATABASE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(result.body), /postgresql|password|private-host/i);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("operator dry-run reads are bounded per platform operator", () => {
  let now = 0;
  const limit = createOperatorReadLimiter({ limit: 2, windowMs: 60_000, now: () => now });
  limit("op-1"); limit("op-1");
  assert.throws(() => limit("op-1"), error => error.code === "OPS_RATE_LIMITED");
  limit("op-2");
  now = 60_001;
  limit("op-1");
});

test("operator lifecycle report uses exact aggregate totals beyond the legacy batch size", async () => {
  const calls = [];
  const report = await generateLifecycleMaintenanceReport({
    repository: {
      async countDeletedAssets(_scope, input) {
        calls.push(input);
        if (input.retentionCutoff && input.withLinks) return 37;
        if (input.retentionCutoff) return 137;
        if (input.withLinks) return 142;
        return 145;
      }
    },
    scope: { tenantId: TENANT, workspaceId: WORKSPACE },
    requestId: "ops_scale_test",
    operatorUserId: "op-scale",
    now: new Date("2026-09-19T00:00:00.000Z")
  });
  assert.equal(report.retentionCandidateCount, 145);
  assert.equal(report.reconciliationCandidateCount, 142);
  assert.equal(report.purgeCandidateCount, 100);
  assert.equal(calls.length, 4);
});
