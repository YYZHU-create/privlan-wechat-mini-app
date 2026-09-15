#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT/admin"
unset DATABASE_URL
export ATELIER_DB_BACKEND="${ATELIER_DB_BACKEND:-meoo}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-9000}"
export ATELIER_ENVIRONMENT="${ATELIER_ENVIRONMENT:-staging}"
export ATELIER_RELEASE_METADATA_PATH="${ATELIER_RELEASE_METADATA_PATH:-$ROOT/runtime-build.json}"
if [ -f "$ROOT/.runtime.env" ]; then
  set -a
  . "$ROOT/.runtime.env"
  set +a
fi
CONFIG_PATH="${ATELIER_RUNTIME_CONFIG_PATH:-$ROOT/runtime-config.json}"
if [ -f "$CONFIG_PATH" ]; then
  node -e 'const { loadRuntimeConfig } = require("./target-runtime-config"); const result = loadRuntimeConfig(process.argv[1], { env: process.env, deploymentProjectId: process.env.MEOO_PROJECT_URL_ID }); console.log(`runtime-config-loaded schema=${result.config.schemaVersion} digest=${result.runtimeConfigDigest}`);' "$CONFIG_PATH"
fi
exec node server.js
