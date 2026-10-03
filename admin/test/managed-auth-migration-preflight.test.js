"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { hashPassword } = require("../platform-store");
const { verifyExistingAccountMigration } = require("../managed-auth-migration-preflight");
const password = "synthetic-test-only";
const salt = Buffer.alloc(16, 7);
const legacy = `$scrypt$N=16384,r=8,p=1$${salt.toString("base64url")}$${crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url")}`;
function input() { return { projectId: "synthetic-staging", providerOrigin: "https://auth.example.test", targetEmail: "merchant@example.test", password,
  providerAccountExists: false,
  merchant: { id: "original-merchant", login_identifier: "merchant@example.test", status: "active", password_hash: hashPassword(password) },
  operator: { id: "original-operator", email: "ops-admin@localhost", status: "active", role: "super_admin", password_hash: legacy } }; }

test("same original password proves both formats while preserving separate business identities", () => {
  const source = input(); const result = verifyExistingAccountMigration(source);
  assert.deepEqual(result.identities, [{ surface: "merchant", businessUserId: "original-merchant" }, { surface: "operator", businessUserId: "original-operator" }]);
  assert.equal(result.originalPasswordsVerified, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes(source.merchant.password_hash), false);
  assert.equal(serialized.includes(legacy), false);
});
test("merchant password cannot authorize a different operator password", () => {
  const source = input(); source.operator.password_hash = hashPassword("different-synthetic");
  assert.throws(() => verifyExistingAccountMigration(source), { code: "AUTH_MIGRATION_ORIGINAL_PASSWORD_INVALID" });
});
test("wrong original password is rejected before any provisioning", () => {
  assert.throws(() => verifyExistingAccountMigration({ ...input(), password: "wrong-synthetic" }), { code: "AUTH_MIGRATION_ORIGINAL_PASSWORD_INVALID" });
});
test("existing or unknown provider account requires explicit reconciliation", () => {
  for (const providerAccountExists of [true, undefined]) assert.throws(() => verifyExistingAccountMigration({ ...input(), providerAccountExists }), { code: "AUTH_MIGRATION_PROVIDER_ACCOUNT_NOT_CLEAR" });
});
test("inactive or non-admin original operator cannot be provisioned as administrator", () => {
  for (const patch of [{ status: "disabled" }, { role: "viewer" }]) {
    const source = input(); Object.assign(source.operator, patch);
    assert.throws(() => verifyExistingAccountMigration(source), { code: "AUTH_MIGRATION_BUSINESS_IDENTITIES_INVALID" });
  }
});
test("different merchant email cannot silently claim PRIVLAN identity", () => {
  assert.throws(() => verifyExistingAccountMigration({ ...input(), targetEmail: "other@example.test" }), { code: "AUTH_MIGRATION_MERCHANT_IDENTIFIER_MISMATCH" });
});

test("a different privileged operator cannot replace the authorized original operator", () => {
  const source = input(); source.operator.email = "other-admin@example.test";
  assert.throws(() => verifyExistingAccountMigration(source), { code: "AUTH_MIGRATION_OPERATOR_IDENTIFIER_MISMATCH" });
});
