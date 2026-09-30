#!/usr/bin/env sh
set -eu

ROOT="${1:?usage: ROLLBACK.sh <repository-copy> [baseline-ref]}"
BASE_REF="${2:-a0633a604c2a4df53b38266249b2c27cdbaf519e}"

test -d "$ROOT/.git"
git -C "$ROOT" cat-file -e "$BASE_REF^{commit}"
git -C "$ROOT" restore --source="$BASE_REF" --worktree -- admin/platform-store.js admin/saas-service.js
rm -f "$ROOT/admin/test/operator-password-compat.test.js"
rm -f "$ROOT/docs/tasks/operator-password-hash-compat-20260930.md"
printf '%s\n' 'Operator password compatibility rollback applied.'