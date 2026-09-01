#!/usr/bin/env sh
set -eu
ROOT="${1:-$(pwd)}"
BASE="$ROOT/verification/editor-panel-redesign"
cp "$BASE/app.js.baseline" "$ROOT/admin/public/app.js"
cp "$BASE/styles.css.baseline" "$ROOT/admin/public/styles.css"
rm -f "$ROOT/admin/test/editor-panel-redesign.test.js"
printf '%s\n' 'Editor panel source rollback applied.'
