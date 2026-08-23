#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?usage: ROLLBACK.sh <disposable-copy>}"
tracked=(
  admin/merchant-routes.js
  admin/saas-service.js
  admin/customer-service.js
  admin/appointment-service.js
  admin/appointment-routes.js
  admin/public/app.js
  admin/public/styles.css
  admin/test/appointment-postgres-integration.test.js
  admin/test/merchant-http.test.js
)
for rel in "${tracked[@]}"; do
  backup="$ROOT/$rel.sprint1-backup"
  target="$ROOT/$rel"
  if [[ ! -f "$backup" ]]; then
    echo "missing rollback backup: $rel" >&2
    exit 2
  fi
  cp "$backup" "$target"
done
rm -f "$ROOT/admin/test/merchant-os-sprint1.test.js"
rm -f "$ROOT/admin/e2e/sprint1-final-gate.spec.js"
echo "ROLLBACK_APPLIED=YES"