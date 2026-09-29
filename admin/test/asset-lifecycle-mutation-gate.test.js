const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createMediaService } = require("../media-service-v1");
const { registerMerchantRoutes } = require("../merchant-routes");

const SCOPE = {
  userId: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  workspaceId: "00000000-0000-0000-0000-000000000003",
  storeId: "00000000-0000-0000-0000-000000000004",
  role: "owner",
  workspace: { name: "Gate test" }
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test("merchant delete cannot enable lifecycle mutations from request data", async () => {
  const calls = [];
  const mediaService = createMediaService({
    provider: {
      name: "meoo",
      async deleteObject() { calls.push("storage-delete"); },
      async verifyDeleted() { calls.push("storage-verify"); return true; }
    },
    repository: {
      async getAssetByIdScoped() { calls.push("asset-read"); return null; },
      async requestAssetDeletion() { calls.push("asset-cas"); },
      async finalizeAssetDeletion() { calls.push("asset-finalize"); }
    }
  });
  const service = {
    async resolveSession() { return SCOPE; },
    verifyCsrf() { return true; },
    assertWritable() {}
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-lifecycle-gate-"));
  const app = express();
  app.use(express.json());
  registerMerchantRoutes(app, async () => service, { dataRoot: root, imagesDir: root, mediaService });
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/api/media/v1/delete?assetLifecycleMutationsEnabled=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "atelier_merchant_session=fixture; assetLifecycleMutationsEnabled=true",
        "x-atelier-csrf": "fixture",
        "x-asset-lifecycle-mutations-enabled": "true"
      },
      body: JSON.stringify({ assetId: "asset", assetLifecycleMutationsEnabled: true })
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "ASSET_LIFECYCLE_MUTATION_DISABLED");
    assert.equal(body.message, "资产生命周期删除当前不可用");
    assert.deepEqual(calls, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
