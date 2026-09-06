#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  printf '%s\n' "ROLLBACK_RESULT=FAIL_INVALID_ARGUMENTS"
  exit 2
fi
baseline_file="$1"
target_file="$2"
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line"
done < "$baseline_file" > "$target_file"
printf '%s\n' "ROLLBACK_RESULT=RESTORED"
