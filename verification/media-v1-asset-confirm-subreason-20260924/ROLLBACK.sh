#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?usage: ROLLBACK.sh <disposable-modified-copy-root> <DIFF.patch>}"
PATCH="${2:?usage: ROLLBACK.sh <disposable-modified-copy-root> <DIFF.patch>}"
[[ -d "$ROOT" && -f "$PATCH" ]] || { echo "INPUT_NOT_FOUND"; exit 2; }
(cd "$ROOT" && git apply --reverse --check "$PATCH" && git apply --reverse "$PATCH")
echo "ROLLBACK_OK reverse_patch_applied=1"