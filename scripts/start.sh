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
exec node server.js
