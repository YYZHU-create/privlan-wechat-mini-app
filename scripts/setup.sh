#!/bin/sh
set -eu
SUPPORTED_NODE_MAJORS="22 23 24"
EXPECTED_NODE_MAJOR_RANGE=">=22 <25"
EXPECTED_PNPM_VERSION=10.33.3
ACTUAL_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
case " $SUPPORTED_NODE_MAJORS " in
  *" $ACTUAL_NODE_MAJOR "*) ;;
  *)
    echo "Expected Node.js $EXPECTED_NODE_MAJOR_RANGE; found $(node --version)" >&2
    exit 1
    ;;
esac
cd /code/admin
ACTUAL_PNPM_VERSION="$(pnpm --version)"
if [ "$ACTUAL_PNPM_VERSION" != "$EXPECTED_PNPM_VERSION" ]; then
  echo "Expected pnpm $EXPECTED_PNPM_VERSION; found $ACTUAL_PNPM_VERSION" >&2
  exit 1
fi
pnpm install --prod --frozen-lockfile
