const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs, runMaintenance } = require("../asset-lifecycle-maintenance");

const SCOPE = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a", actorType: "system" };

function fixture() {
  const calls = [];
  const assets = [
    { id: "purgeable", status: "deleted", deleted_at: "2025-01-01T00:00:00.000Z" },
    { id: "linked", status: "deleted", deleted_at: "2025-01-01T00:00:00.000Z" }
  ];
  const repository = {
    calls,
    async listDeletedAssets(scope, input) { calls.push(["list", scope, input]); return assets; },
    async listAssetLinks(_scope, id) { return id === "linked" ? [{ id: "link-a" }] : []; },
    async listAssetObjects(_scope, id) { return id === "purgeable" ? [{ object_key: "tenant/a/original.png" }] : []; },
    async purgeDeletedAsset(scope, id, input) { calls.push(["purge", scope, id, input]); return { id, purged: true }; },
    async cleanupDeletedAssetLinks(scope, id, input) { calls.push(["cleanup", scope, id, input]); return { id, linksRemoved: 1 }; }
  };
  const provider = { async verifyDeleted(_scope, key) { calls.push(["verify", key]); return true; } };
  return { repository, provider, calls };
}

test("maintenance defaults to a scoped dry run and performs zero metadata writes", async () => {
  const options = parseArgs(["--tenant-id=tenant-a", "--workspace-id=workspace-a", "--store-id=store-a", "--actor-id=ops-a", "--mode=purge"]);
  const { repository, provider, calls } = fixture();
  const summary = await runMaintenance({ repository, provider, options, now: new Date("2026-02-01T00:00:00.000Z") });
  assert.equal(summary.dryRun, true); assert.equal(summary.eligible, 1); assert.equal(summary.applied, 0);
  assert.equal(calls.some(call => call[0] === "purge"), false);
  assert.deepEqual(summary.skipped, [{ assetId: "linked", code: "ASSET_LINKS_PRESENT" }]);
});

test("maintenance requires an explicit apply flag and stable run ID before purging", async () => {
  assert.throws(() => parseArgs(["--tenant-id=tenant-a", "--workspace-id=workspace-a", "--actor-id=ops-a", "--apply"]), /RUN_ID_REQUIRED/);
  const options = parseArgs(["--tenant-id=tenant-a", "--workspace-id=workspace-a", "--actor-id=ops-a", "--mode=purge", "--apply", "--run-id=asset-maintenance-1"]);
  const { repository, provider, calls } = fixture();
  const summary = await runMaintenance({ repository, provider, options, now: new Date("2026-02-01T00:00:00.000Z") });
  assert.equal(summary.applied, 1);
  const purge = calls.find(call => call[0] === "purge");
  assert.equal(purge[2], "purgeable"); assert.equal(purge[3].requestId, "asset-maintenance-1:purgeable");
});

test("historical link reconciliation only selects deleted assets and writes through its dedicated RPC", async () => {
  const options = parseArgs(["--tenant-id=tenant-a", "--workspace-id=workspace-a", "--actor-id=ops-a", "--mode=reconcile-links", "--apply", "--run-id=asset-links-1"]);
  const { repository, provider, calls } = fixture();
  const summary = await runMaintenance({ repository, provider, options });
  assert.equal(summary.applied, 1);
  assert.equal(calls.some(call => call[0] === "purge"), false);
  assert.equal(calls.find(call => call[0] === "cleanup")[2], "linked");
});
