#!/usr/bin/env sh
set -eu
target="${1:?path to rollback copy is required}"
rm -f -- "$target"
