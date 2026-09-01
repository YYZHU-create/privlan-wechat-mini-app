const test = require("node:test");
const assert = require("node:assert/strict");
const { createMeooMediaRepository } = require("../meoo-media-repository");
const SCOPE = { tenantId: "tenant-a", workspaceId: "workspace-a", storeId: "store-a" };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body == null ? "" : JSON.stringify(body) });

test("Meoo media repository scopes reads and writes", async () => {
  const calls = [];
  const repo = createMeooMediaRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, [{ id: "asset-a", tenant_id: "tenant-a", workspace_id: "workspace-a", store_id: "store-a", object_key: "asset-a.png", original_name: "a.png", mime_type: "image/png", bytes: 10, metadata: {} }]); } });
  assert.equal((await repo.listAssets(SCOPE))[0].id, "asset-a");
  await repo.createAsset(SCOPE, { id: "asset-b", objectKey: "b.png", originalName: "b.png", mimeType: "image/png", bytes: 4, metadata: {} });
  assert.match(calls[0].url, /tenant_id=eq\.tenant-a/); assert.match(calls[0].url, /workspace_id=eq\.workspace-a/); assert.match(calls[0].url, /store_id=eq\.store-a/);
  const body = JSON.parse(calls[1].options.body); assert.equal(body.tenant_id, "tenant-a"); assert.equal(body.workspace_id, "workspace-a"); assert.equal(body.store_id, "store-a");
});

test("Meoo media repository retries transient reads and normalizes failure", async () => {
  let attempts = 0;
  const repo = createMeooMediaRepository({ url: "https://probe.example", serviceRoleKey: "key", fetchImpl: async () => { attempts += 1; return attempts < 3 ? response(503, { message: "busy" }) : response(200, []); } });
  assert.deepEqual(await repo.listAssets(SCOPE), []); assert.equal(attempts, 3);
});
