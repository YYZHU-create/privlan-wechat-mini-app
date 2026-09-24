#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?usage: ROLLBACK.sh /absolute/path/to/asset-v1-final-candidate}"
EXPECTED_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel)"
EXPECTED_BASE="343a374bdf00c3db09256045388267a721281ab5"
[[ -d "$ROOT/.git" || -f "$ROOT/.git" ]] || { echo "ROLLBACK=FAIL: not a Git checkout"; exit 2; }
[[ "$EXPECTED_ROOT" == "$ROOT" ]] || { echo "ROLLBACK=FAIL: path mismatch"; exit 2; }
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$EXPECTED_BASE" ]] || { echo "ROLLBACK=FAIL: unexpected HEAD"; exit 2; }
[[ "${ALLOW_DIAGNOSTIC_CANDIDATE_ROLLBACK:-}" == "1" ]] || { echo "ROLLBACK=FAIL: set ALLOW_DIAGNOSTIC_CANDIDATE_ROLLBACK=1"; exit 2; }
git -C "$ROOT" restore --source="$EXPECTED_BASE" --worktree -- \
  admin/asset-repository.js admin/error-response.js admin/media-service-v1.js admin/merchant-routes.js \
  admin/test/g2b-storage-integration.test.js admin/test/media-service-v1.test.js
rm -f -- "$ROOT/admin/test/media-staging-diagnostic-route.test.js"
rm -rf -- "$ROOT/verification/media-v1-staging-response-diagnostics-20260924"
echo "ROLLBACK=PASS"
echo "RESTORED_HEAD=$(git -C "$ROOT" rev-parse HEAD)"
echo "RESTORED_STATUS=$(git -C "$ROOT" status --porcelain)"
