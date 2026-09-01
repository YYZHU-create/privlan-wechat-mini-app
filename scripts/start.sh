#!/bin/sh
set -eu
cd /code/admin
unset DATABASE_URL
export ATELIER_DB_BACKEND="${ATELIER_DB_BACKEND:-meoo}"
export PRIVLAN_ADMIN_HOST="${PRIVLAN_ADMIN_HOST:-0.0.0.0}"
export PORT="${PORT:-9000}"
export ATELIER_ENVIRONMENT="${ATELIER_ENVIRONMENT:-staging}"
export ATELIER_GIT_SHA="${ATELIER_GIT_SHA:-unknown}"
export ATELIER_GIT_BRANCH="${ATELIER_GIT_BRANCH:-unknown}"
exec node server.js
