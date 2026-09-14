#!/usr/bin/env bash
set -euo pipefail
target="${1:-MODIFIED_FILE}"
baseline="${2:-MODIFIED_FILE.baseline}"
cp -- "$baseline" "$target"
printf 'ROLLBACK_RESULT=restored\n'
