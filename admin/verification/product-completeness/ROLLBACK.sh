#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$SCRIPT_DIR/MODIFIED_FILE"
BACKUP="$SCRIPT_DIR/MODIFIED_FILE.rollback-baseline"
if [[ -f "$BACKUP" ]]; then cp "$BACKUP" "$TARGET"; fi
node --check "$TARGET"
