#!/usr/bin/env sh
set -eu
ROOT="${1:-$(pwd)}"
PATCH="$ROOT/verification/sprint2-operation-engine/DIFF_FILE"
if [ ! -f "$PATCH" ]; then
  echo "Sprint 2 patch record is not available: $PATCH" >&2
  exit 2
fi
TMP="${TMPDIR:-/tmp}/atelier-sprint2-rollback-$$.patch"
trap 'rm -f "$TMP"' EXIT HUP INT TERM
awk '
$0 == "--- PATCH START ---" { active = 1; next }
$0 == "--- PATCH END ---" { exit }
active {
  sub(/^PATCH\|/, "")
  if ($0 == "[CONTEXT_BLANK]") print " "
  else print
}
' "$PATCH" > "$TMP"
cd "$ROOT"
git apply --reverse --check "$TMP"
git apply --reverse "$TMP"
echo "Sprint 2 source rollback applied."
echo "For a staging database where migration 007 was applied, use a reviewed forward-fix migration; this script does not alter database data."
