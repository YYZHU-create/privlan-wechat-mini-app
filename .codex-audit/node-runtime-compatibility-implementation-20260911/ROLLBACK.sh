#!/usr/bin/env bash
set -eu
TARGET="${1:?usage: ROLLBACK.sh <target-file>}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cp "$SCRIPT_DIR/BASELINE_FILE" "$TARGET"
printf 'ROLLBACK_RESULT=RESTORED\n'
