#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT/admin"
unset DATABASE_URL
export ATELIER_DB_BACKEND="${ATELIER_DB_BACKEND:-meoo}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-9000}"
export ATELIER_ENVIRONMENT="${ATELIER_ENVIRONMENT:-staging}"
if [ -f "$ROOT/.runtime.env" ]; then
  set -a
  . "$ROOT/.runtime.env"
  set +a
fi
if [ -z "${ATELIER_GIT_SHA:-}" ] && [ -f "$ROOT/.release-sha" ]; then ATELIER_GIT_SHA="$(cat "$ROOT/.release-sha")"; fi
if [ -f "$ROOT/release-sha" ] && [ -z "${ATELIER_GIT_SHA:-}" ]; then ATELIER_GIT_SHA="$(cat "$ROOT/release-sha")"; fi
if [ -z "${ATELIER_GIT_SHA:-}" ] && command -v git >/dev/null 2>&1 && [ -d "$ROOT/.git" ]; then ATELIER_GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"; fi
export ATELIER_GIT_SHA="${ATELIER_GIT_SHA:-unknown}"
if [ -f "$ROOT/.release-branch" ]; then ATELIER_GIT_BRANCH="$(cat "$ROOT/.release-branch")"; fi
if [ -f "$ROOT/release-branch" ] && [ -z "${ATELIER_GIT_BRANCH:-}" ]; then ATELIER_GIT_BRANCH="$(cat "$ROOT/release-branch")"; fi
if [ -z "${ATELIER_GIT_BRANCH:-}" ] && command -v git >/dev/null 2>&1 && [ -d "$ROOT/.git" ]; then ATELIER_GIT_BRANCH="$(git -C "$ROOT" branch --show-current)"; fi
export ATELIER_GIT_BRANCH="${ATELIER_GIT_BRANCH:-unknown}"
exec node server.js
