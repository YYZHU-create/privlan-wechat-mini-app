#!/usr/bin/env sh
set -eu
TARGET_ROOT=${1:?usage: ROLLBACK.sh TARGET_ROOT}
SOURCE="$TARGET_ROOT/archive/v12/index.ts"
DESTINATION="$TARGET_ROOT/functions/privlan-merchant-api/index.ts"
test -f "$SOURCE"
test -f "$DESTINATION"
cp "$SOURCE" "$DESTINATION"