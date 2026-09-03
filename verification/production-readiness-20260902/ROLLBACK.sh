#!/bin/sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cp "$DIR/BASELINE_FILE" "$DIR/rollback-test-copy"
sha256sum "$DIR/rollback-test-copy" "$DIR/BASELINE_FILE"
