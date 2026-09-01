#!/bin/sh
set -eu
cd /code/admin
unset DATABASE_URL
export ATELIER_DB_BACKEND="${ATELIER_DB_BACKEND:-meoo}"
export PRIVLAN_ADMIN_HOST="${PRIVLAN_ADMIN_HOST:-0.0.0.0}"
export PORT="${PORT:-9000}"
export ATELIER_ENVIRONMENT="${ATELIER_ENVIRONMENT:-staging}"
if [ -z "${ATELIER_GIT_SHA:-}" ] && command -v git >/dev/null 2>&1 && [ -d /code/.git ]; then ATELIER_GIT_SHA="$(git -C /code rev-parse HEAD)"; fi
export ATELIER_GIT_SHA="${ATELIER_GIT_SHA:-unknown}"
if [ -z "${ATELIER_GIT_BRANCH:-}" ] && command -v git >/dev/null 2>&1 && [ -d /code/.git ]; then ATELIER_GIT_BRANCH="$(git -C /code branch --show-current)"; fi
export ATELIER_GIT_BRANCH="${ATELIER_GIT_BRANCH:-unknown}"
exec node server.js
