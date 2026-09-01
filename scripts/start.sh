#!/bin/sh
set -eu
cd /code/admin
unset DATABASE_URL
export ATELIER_DB_BACKEND="${ATELIER_DB_BACKEND:-meoo}"
export PRIVLAN_ADMIN_HOST="${PRIVLAN_ADMIN_HOST:-0.0.0.0}"
export PORT="${PORT:-9000}"
export ATELIER_ENVIRONMENT="${ATELIER_ENVIRONMENT:-staging}"
export ATELIER_GIT_SHA="${ATELIER_GIT_SHA:-dac39641b8d3a486c523e939e299f56ad73e47f1}"
export ATELIER_GIT_BRANCH="${ATELIER_GIT_BRANCH:-codex/ai-template-generator-v1}"
exec node server.js
