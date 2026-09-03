#!/usr/bin/env node
const fs = require("node:fs");

const RELEASE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,255}$/;
const REQUIRED_FIELDS = [
  "CURRENT_RELEASE_SHA", "CURRENT_IMAGE_DIGEST", "TARGET_RELEASE_SHA", "TARGET_IMAGE_DIGEST",
  "CURRENT_ROUTE_OWNER", "ROLLBACK_ROUTE_OWNER", "EXPECTED_PRODUCTION_PROJECT", "EXPECTED_PRODUCTION_SERVICE",
  "ACTUAL_PRODUCTION_PROJECT", "ACTUAL_PRODUCTION_SERVICE"
];
const FIELD_PATTERNS = {
  CURRENT_RELEASE_SHA: RELEASE_SHA_PATTERN, TARGET_RELEASE_SHA: RELEASE_SHA_PATTERN,
  CURRENT_IMAGE_DIGEST: IMAGE_DIGEST_PATTERN, TARGET_IMAGE_DIGEST: IMAGE_DIGEST_PATTERN,
  CURRENT_ROUTE_OWNER: IDENTIFIER_PATTERN, ROLLBACK_ROUTE_OWNER: IDENTIFIER_PATTERN,
  EXPECTED_PRODUCTION_PROJECT: IDENTIFIER_PATTERN, EXPECTED_PRODUCTION_SERVICE: IDENTIFIER_PATTERN,
  ACTUAL_PRODUCTION_PROJECT: IDENTIFIER_PATTERN, ACTUAL_PRODUCTION_SERVICE: IDENTIFIER_PATTERN
};

function fieldValue(plan, field) { return typeof plan?.[field] === "string" ? plan[field] : String(plan?.[field] ?? ""); }
function validateRollbackPlan(plan) {
  const missing = REQUIRED_FIELDS.filter(field => fieldValue(plan, field).length === 0);
  const invalid = REQUIRED_FIELDS.filter(field => {
    const value = fieldValue(plan, field);
    return value.length > 0 && !FIELD_PATTERNS[field].test(value);
  });
  const mismatched = [
    ["EXPECTED_PRODUCTION_PROJECT", "ACTUAL_PRODUCTION_PROJECT"],
    ["EXPECTED_PRODUCTION_SERVICE", "ACTUAL_PRODUCTION_SERVICE"]
  ].filter(([expected, actual]) => fieldValue(plan, actual) !== fieldValue(plan, expected)).map(([expected]) => expected);
  return { ok: !missing.length && !invalid.length && !mismatched.length, missing, invalid, mismatched };
}

function main(filePath) {
  if (!filePath) { process.stderr.write("ROLLBACK_PLAN=INVALID\n"); return 2; }
  let plan;
  try { plan = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { process.stderr.write("ROLLBACK_PLAN=INVALID\n"); return 2; }
  const result = validateRollbackPlan(plan);
  process.stdout.write(`ROLLBACK_PLAN=${result.ok ? "PASS" : "INVALID"}\nROLLBACK_PLAN_MISSING=${result.missing.length}\nROLLBACK_PLAN_INVALID=${result.invalid.length}\nROLLBACK_PLAN_MISMATCHED=${result.mismatched.length}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv[2]);
module.exports = { RELEASE_SHA_PATTERN, IMAGE_DIGEST_PATTERN, IDENTIFIER_PATTERN, REQUIRED_FIELDS, validateRollbackPlan };
