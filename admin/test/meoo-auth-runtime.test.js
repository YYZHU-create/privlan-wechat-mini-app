const test = require("node:test");
const assert = require("node:assert/strict");
const { createSaasService } = require("../saas-service");
const { validateDatabaseBackend } = require("../runtime-config");
const { hashPassword } = require("../platform-store");

test("Meoo backend does not require DATABASE_URL", () => {
  assert.equal(validateDatabaseBackend({ ATELIER_DB_BACKEND: "meoo", SUPABASE_URL: "https://target.example", SUPABASE_SERVICE_ROLE_KEY: "server-only" }), "meoo");
});

test("synthetic Meoo auth keeps ATELIER password and session semantics", async () => {
  const calls = [];
  const repository = {
    async findUserByLogin(login) { calls.push(["user", login]); return { id: "user-1", login_identifier: login, password_hash: hashPassword("synthetic-password"), display_name: "Synthetic", status: "active" }; },
    async findMembership(userId) { calls.push(["membership", userId]); return { tenant_id: "tenant-1", workspace_id: "workspace-1", role: "owner" }; },
    async createSession(input) { calls.push(["create", input]); return input; },
    async recordAudit(input) { calls.push(["audit", input.action]); },
    async loadSession(tokenHash) { calls.push(["load", tokenHash]); return { session_id: "session-1", user_id: "user-1", workspace_id: "workspace-1", csrf_token_hash: "csrf-hash", expires_at: new Date(Date.now() + 3600000).toISOString(), login_identifier: "owner@example.com", display_name: "Synthetic", user_status: "active", tenant_id: "tenant-1", workspace_name: "Workspace", plan_id: "TRIAL", store_id: "store-1", store_name: "Store", public_store_id: "public-1", role: "owner", subscription_id: null, subscription_status: "active", subscription_plan_id: "TRIAL" }; },
    async revokeSession(id) { calls.push(["revoke", id]); }
  };
  const service = createSaasService({ db: {}, authRepository: repository });
  const result = await service.login({ login: "Owner@Example.com", password: "synthetic-password" }, { requestId: "req-1" });
  assert.equal(result.user.id, "user-1");
  assert.equal(result.session.token.length > 20, true);
  assert.equal(calls.some(call => call[0] === "create"), true);
  const scope = await service.resolveSession(result.session.token);
  assert.equal(scope.tenantId, "tenant-1");
  assert.equal(scope.workspaceId, "workspace-1");
  assert.equal(scope.storeId, "store-1");
  await service.logout(scope.sessionId, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: scope.userId, requestId: "req-2" });
  assert.deepEqual(calls.filter(call => call[0] === "revoke")[0], ["revoke", "session-1"]);
});
