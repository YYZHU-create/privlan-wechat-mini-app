#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$DIR/rollback-test-copy.js}"
cp "$DIR/MODIFIED_FILE.baseline.js" "$TARGET"
cmp -s "$TARGET" "$DIR/MODIFIED_FILE.baseline.js"
printf 'ROLLBACK_RESTORED=%s\n' "$TARGET"