#!/bin/sh
set -eu
cd /code/admin
unset DATABASE_URL
export ATELIER_DB_BACKEND="${ATELIER_DB_BACKEND:-meoo}"
export PRIVLAN_ADMIN_HOST="${PRIVLAN_ADMIN_HOST:-0.0.0.0}"
export PORT="${PORT:-9000}"
exec node server.js