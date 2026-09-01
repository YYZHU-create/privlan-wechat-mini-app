#!/usr/bin/env bash
set -euo pipefail

root="${1:?isolated copy required}"
baseline="${2:?baseline copy required}"
node - "$root" "$baseline" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [root, baseline] = process.argv.slice(2);
const tracked = ["admin/saas-service.js", "admin/merchant-routes.js", "admin/test/merchant-http.test.js", "platform/schema.sql"];
const newFiles = ["platform/migrations/008_workflow_runtime.sql", "admin/workflow-service.js", "admin/workflow-routes.js", "admin/test/workflow-runtime.test.js", "admin/verify-sprint3a-staging.js"];
for (const file of tracked) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(baseline, file), target);
}
for (const file of newFiles) fs.rmSync(path.join(root, file), { force: true });
console.log("ROLLBACK=PASS; tracked files restored; new files removed");
NODE
