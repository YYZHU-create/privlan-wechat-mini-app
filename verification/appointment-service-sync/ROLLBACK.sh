#!/usr/bin/env sh
set -eu
ROOT="${1:-$(pwd)}"
BASE="$ROOT/verification/appointment-service-sync"
cp "$BASE/appointment-service.js.baseline" "$ROOT/admin/appointment-service.js"
cp "$BASE/appointment-saas.test.js.baseline" "$ROOT/admin/test/appointment-saas.test.js"
cp "$BASE/app.js.baseline" "$ROOT/admin/public/app.js"
cp "$BASE/editor-panel-redesign.test.js.baseline" "$ROOT/admin/test/editor-panel-redesign.test.js"
printf '%s\n' 'Appointment service sync rollback applied.'
