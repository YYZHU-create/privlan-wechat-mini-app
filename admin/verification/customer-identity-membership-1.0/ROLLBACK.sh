#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_REPO="${1:-}"

if [[ -z "$TARGET_REPO" ]]; then
  echo "usage: ROLLBACK.sh <target-repository>" >&2
  exit 64
fi

TARGET_REPO="$(cd "$TARGET_REPO" && pwd)"
PATCH_FILE="$SCRIPT_DIR/DIFF_FILE"

git -C "$TARGET_REPO" apply --unidiff-zero --check --reverse "$PATCH_FILE"
git -C "$TARGET_REPO" apply --unidiff-zero --reverse --index "$PATCH_FILE"
git -C "$TARGET_REPO" diff --cached --exit-code
git -C "$TARGET_REPO" diff --exit-code
echo "ROLLBACK_OK: restored tracked files to HEAD"
