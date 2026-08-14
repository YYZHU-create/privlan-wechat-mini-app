#!/bin/sh
set -eu

target="${1:-$(dirname "$0")/MODIFIED_FILE}"
sed -i 's/^source=options\.id$/source=block.productId/;s/^invalid=product-missing$/invalid=fallback-first-product/' "$target"
printf '%s\n' "ROLLBACK_OK branch=dynamic-product-id field=productId restored=block.productId"
