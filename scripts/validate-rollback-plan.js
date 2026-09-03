#!/usr/bin/env node
const fs = require("node:fs");

const REQUIRED_FIELDS = [
  "CURRENT_RELEASE_SHA", "CURRENT_IMAGE_DIGEST", "TARGET_RELEASE_SHA", "TARGET_IMAGE_DIGEST",
  "CURRENT_ROUTE_OWNER", "ROLLBACK_ROUTE_OWNER", "EXPECTED_PRODUCTION_PROJECT", "EXPECTED_PRODUCTION_SERVICE"
];
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,255}$/;

function validateRollbackPlan(plan) {
  const missing = REQUIRED_FIELDS.filter(field => !String(plan?.[field] || "").trim());
  const invalid = REQUIRED_FIELDS.filter(field => String(plan?.[field] || "").trim() && !SAFE_VALUE.test(String(plan[field]).trim()));
  const mismatched = [
    ["EXPECTED_PRODUCTION_PROJECT", "ACTUAL_PRODUCTION_PROJECT"],
    ["EXPECTED_PRODUCTION_SERVICE", "ACTUAL_PRODUCTION_SERVICE"]
  ].filter(([expected, actual]) => String(plan?.[actual] || "").trim() !== String(plan?.[expected] || "").trim()).map(([expected]) => expected);
  return { ok: !missing.length && !invalid.length && !mismatched.length, missing, invalid, mismatched };
}

function main(filePath) {
  if (!filePath) { process.stderr.write("ROLLBACK_PLAN=INVALID\n"); return 2; }
  let plan;
  try { plan = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { process.stderr.write("ROLLBACK_PLAN=INVALID\n"); return 2; }
  const result = validateRollbackPlan(plan);
  process.stdout.write(`ROLLBACK_PLAN=${result.ok ? "PASS" : "INVALID"}\n`);
  process.stdout.write(`ROLLBACK_PLAN_MISSING=${result.missing.length}\n`);
  process.stdout.write(`ROLLBACK_PLAN_INVALID=${result.invalid.length}\n`);
  process.stdout.write(`ROLLBACK_PLAN_MISMATCHED=${result.mismatched.length}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv[2]);
module.exports = { REQUIRED_FIELDS, validateRollbackPlan };
