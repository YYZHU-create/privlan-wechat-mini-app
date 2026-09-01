#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

if [[ ! -f "$TARGET_ROOT/admin/server.js" ]]; then
  echo "ROLLBACK_ERROR=missing-admin-server"
  exit 2
fi

cp "$SCRIPT_DIR/server.js.baseline" "$TARGET_ROOT/admin/server.js"
rm -f "$TARGET_ROOT/admin/preview-package.js" "$TARGET_ROOT/admin/test/preview-package.test.js"
echo "ROLLBACK_TARGET=$TARGET_ROOT"
echo "ROLLBACK_SERVER_RESTORED=YES"
echo "ROLLBACK_NEW_PREVIEW_FILES_REMOVED=YES"