const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const client = require("../public/media-upload-client");

function cryptoFixture() {
  let index = 0;
  return { randomUUID() { index += 1; return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`; } };
}

function xhrFactory(plan, requests) {
  return () => {
    const xhr = {
      upload: {}, headers: {}, status: 0, responseText: "", withCredentials: false,
      open(method, url) { this.method = method; this.url = url; },
      setRequestHeader(name, value) { this.headers[name] = value; },
      send(body) {
        this.body = body;
        requests.push(this);
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        const outcome = plan.shift();
        if (outcome.type === "network") { this.onerror(); return; }
        this.status = outcome.status;
        this.responseText = JSON.stringify(outcome.body);
        this.onload();
      }
    };
    return xhr;
  };
}

test("each file gets an independent cryptographic key before its first request", () => {
  const crypto = cryptoFixture();
  const first = client.createUploadAttempt({ name: "one.png" }, { folderId: "folder-a" }, crypto);
  const second = client.createUploadAttempt({ name: "two.png" }, { folderId: "folder-a" }, crypto);
  assert.match(first.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.attemptState, "new");
  assert.equal(first.folderId, "folder-a");
});

test("V1 request carries auth credentials, CSRF, JSON body, progress and idempotency key", async () => {
  const requests = []; let progress = 0;
  const data = { id: "asset-1", status: "ready", mimeType: "image/png", bytes: 68, path: "/api/media/v1/content/asset-1" };
  const result = await client.sendUploadRequest({
    payload: { name: "hero.png", data: "data:image/png;base64,eA==", folderId: "folder-a", purpose: "content_image", variant: "original" },
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    csrfToken: "csrf-fixture",
    onProgress: value => { progress = value; },
    xhrFactory: xhrFactory([{ type: "response", status: 201, body: { ok: true, data } }], requests)
  });
  assert.deepEqual(result, data);
  assert.equal(requests[0].url, "/api/media/v1/upload");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].withCredentials, true);
  assert.equal(requests[0].headers["Idempotency-Key"], "00000000-0000-4000-8000-000000000001");
  assert.equal(requests[0].headers["x-atelier-csrf"], "csrf-fixture");
  assert.equal(requests[0].headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(requests[0].body).folderId, "folder-a");
  assert.equal(progress, 50);
});

test("network uncertainty keeps the same attempt key for retry and new attempt uses a new key", async () => {
  const crypto = cryptoFixture(); const requests = [];
  const upload = client.createUploadAttempt({ name: "hero.png" }, {}, crypto);
  const payload = { name: "hero.png", data: "same-bytes" };
  await assert.rejects(() => client.sendUploadRequest({ payload, idempotencyKey: upload.idempotencyKey, xhrFactory: xhrFactory([{ type: "network" }], requests) }), error => error.retryable === true);
  upload.attemptState = "uncertain";
  const replay = await client.sendUploadRequest({ payload, idempotencyKey: upload.idempotencyKey, xhrFactory: xhrFactory([{ type: "response", status: 201, body: { ok: true, data: { id: "same-asset", path: "/api/media/v1/content/same-asset", bytes: 68 } } }], requests) });
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  assert.equal(replay.id, "same-asset");
  const next = client.createUploadAttempt({ name: "hero.png" }, {}, crypto);
  assert.notEqual(next.idempotencyKey, upload.idempotencyKey);
});

test("409 fingerprint reuse is mapped to a safe stable message", async () => {
  const requests = [];
  await assert.rejects(() => client.sendUploadRequest({
    payload: { name: "hero.png" }, idempotencyKey: "stable-key",
    xhrFactory: xhrFactory([{ type: "response", status: 409, body: { ok: false, code: "MEDIA_IDEMPOTENCY_KEY_REUSE", message: "private internal details" } }], requests)
  }), error => error.code === "MEDIA_IDEMPOTENCY_KEY_REUSE" && error.retryable === false && !error.message.includes("private internal details"));
});

test("V1 ready data maps to the Merchant media fields and terminal retirement clears the key", () => {
  const item = client.asLegacyMediaItem({ id: "asset-a", status: "ready", mimeType: "image/png", bytes: 4096, path: "/api/media/v1/content/asset-a" }, { name: "hero.png", type: "image/png" }, "folder-a");
  assert.equal(item.mpPath, "/api/media/v1/content/asset-a");
  assert.equal(item.name, "hero.png");
  assert.equal(item.kind, "image");
  assert.equal(item.sizeKB, 4);
  assert.equal(item.folderId, "folder-a");
  const attempt = { idempotencyKey: "once", attemptState: "in-flight" };
  client.retireAttempt(attempt, "success");
  assert.equal(attempt.idempotencyKey, null);
  assert.equal(attempt.attemptState, "success");
});

test("actual Merchant caller uses the V1 adapter and keeps manual retry bound to its upload object", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(source, /function uploadRequest\(payload, onProgress, idempotencyKey\)/);
  assert.match(source, /uploadRequest\(payload, value => \{ upload\.progress = value; \}, upload\.idempotencyKey\)/);
  assert.match(source, /uploadSingleFile\(upload\.file, upload\.addToCarousel, upload\.folderId, upload\)/);
  assert.match(source, /MediaUploadClient\.retireAttempt\(upload, "cleaned"\)/);
  assert.doesNotMatch(source, /\/api\/media\/upload/);
});
