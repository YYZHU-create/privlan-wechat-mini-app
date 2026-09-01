#!/usr/bin/env bash
set -euo pipefail

repo=${1:?temporary repository path required}
base=${2:?base commit required}
git -C "$repo" restore --source "$base" -- \
  admin/meoo-supabase-adapter.js \
  admin/saas-service.js \
  admin/server.js \
  admin/test/meoo-supabase-adapter.test.js
