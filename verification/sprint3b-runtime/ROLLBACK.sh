#!/usr/bin/env bash
set -euo pipefail
target="${1:?target worktree required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
new_files=(
  admin/domain-event.js
  admin/test/workflow-integration.test.js
  admin/workflow-integration-service.js
  admin/workflow-integration-mappings.js
  admin/verify-sprint3b-staging.js
  platform/migrations/009_workflow_integration.sql
  platform/migrations/010_workflow_event_contract_immutability.sql
  docs/prompts/sprint-3b-workflow-integration.md
)
exclude_args=()
for file in "${new_files[@]}"; do
  exclude_args+=("--exclude=$file")
done
git -C "$target" apply --reverse --check "${exclude_args[@]}" "$script_dir/DIFF_FILE"
git -C "$target" apply --reverse "${exclude_args[@]}" "$script_dir/DIFF_FILE"
for file in "${new_files[@]}"; do
  rm -f "$target/$file"
done
rm -f "$target/verification/sprint3b-runtime/DIFF_FILE" "$target/verification/sprint3b-runtime/ROLLBACK.sh"
rm -rf "$target/verification/sprint3b-runtime"
git -C "$target" diff --exit-code
printf "ROLLBACK_STATUS=PASS\n"
