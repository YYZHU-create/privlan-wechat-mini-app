#!/usr/bin/env bash
set -euo pipefail

target="${1:-.}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

git -C "$target" apply --reverse --check "$script_dir/DIFF_FILE"
git -C "$target" apply --reverse "$script_dir/DIFF_FILE"
printf 'ROLLBACK_APPLIED target=%s\n' "$(cd "$target" && pwd)"
