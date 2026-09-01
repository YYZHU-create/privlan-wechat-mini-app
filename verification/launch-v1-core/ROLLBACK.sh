#!/bin/sh
set -eu
src="admin/launch-v1-services.js"
out="verification/launch-v1-core/rollback-copy.js"
cp "$src" "$out"
node --check "$out" >/dev/null
printf '%s\n' 'rollback-copy syntax PASS'
