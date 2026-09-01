#!/usr/bin/env sh
set -eu
target=${1:?target copy required}
backup=${2:?backup copy required}
cp "$backup" "$target"
cmp -s "$backup" "$target"
printf '%s\n' 'ROLLBACK_EXIT=0'
