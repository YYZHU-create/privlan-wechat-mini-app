"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { collectManagedAuthRequirements, evaluateManagedAuthSchema } = require("../managed-auth-schema-preflight");
function requirements() {
  const read = filename => fs.readFileSync(path.join(__dirname, "../../platform/migrations", filename), "utf8");
  return collectManagedAuthRequirements({ identitySql: read("017_managed_auth_identity_links.sql"), sessionSql: read("018_managed_auth_session_provenance.sql"), provisioningSql: read("019_managed_merchant_provisioning.sql") });
}
test("requirements come from committed migration inserts, references and existing auth reads", () => {
  const r = requirements();
  assert.ok(r.appointment_advisors.includes("staff_id"));
  assert.ok(r.operator_users.includes("password_hash"));
  assert.ok(r.operator_sessions.includes("id"));
  assert.equal(r.managed_auth_identity_links, undefined);
});
test("column presence never claims constraints, defaults or runtime compatibility", () => {
  const r = requirements();
  const columns = Object.entries(r).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name })));
  const result = evaluateManagedAuthSchema(r, columns);
  assert.equal(result.requiredColumnsPresent, true);
  assert.equal(result.constraintCompatibility, "NOT_VERIFIED");
  assert.equal(result.defaultsCompatibility, "NOT_VERIFIED");
  const missing = evaluateManagedAuthSchema(r, columns.filter(c => c.table_name !== "appointment_services"));
  assert.equal(missing.requiredColumnsPresent, false);
  assert.ok(missing.missingColumns.includes("appointment_services.duration_minutes"));
});
test("missing catalog and incomplete migration extraction fail closed", () => {
  assert.throws(() => evaluateManagedAuthSchema(requirements(), null), /CATALOG_NOT_VERIFIED/);
  assert.throws(() => collectManagedAuthRequirements({ identitySql: "", sessionSql: "", provisioningSql: "" }), /REQUIREMENTS_INCOMPLETE/);
});
