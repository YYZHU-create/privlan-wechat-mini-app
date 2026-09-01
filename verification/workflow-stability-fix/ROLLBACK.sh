#!/bin/sh
set -eu
cp "$(dirname "$0")/MODIFIED_FILE" "$(dirname "$0")/../../admin/meoo-launch-v1-repository.js"
cp "$(dirname "$0")/FIXTURES_BASELINE.js" "$(dirname "$0")/../../admin/test/meoo-live-fixtures.js"
printf '%s\n' 'ROLLBACK_RESTORED=PASS'
