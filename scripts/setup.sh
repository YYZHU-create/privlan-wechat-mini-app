#!/bin/sh
set -eu
EXPECTED_NODE_MAJOR=22
EXPECTED_PNPM_VERSION=11.7.0
ACTUAL_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$ACTUAL_NODE_MAJOR" != "$EXPECTED_NODE_MAJOR" ]; then
  echo "Expected Node.js $EXPECTED_NODE_MAJOR.x; found $(node --version)" >&2
  exit 1
fi
corepack enable
corepack prepare "pnpm@$EXPECTED_PNPM_VERSION" --activate
cd /code/admin
pnpm install --prod --frozen-lockfile
