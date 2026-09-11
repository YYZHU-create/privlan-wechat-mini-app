#!/bin/sh
set -eu
SUPPORTED_NODE_MAJORS="22 23 24"
EXPECTED_PNPM_VERSION=11.7.0
ACTUAL_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
case " $SUPPORTED_NODE_MAJORS " in
  *" $ACTUAL_NODE_MAJOR "*) ;;
  *)
    echo "Expected Node.js >=22 <25; found $(node --version)" >&2
    exit 1
    ;;
esac
corepack enable
corepack prepare "pnpm@$EXPECTED_PNPM_VERSION" --activate
cd /code/admin
pnpm install --prod --frozen-lockfile
