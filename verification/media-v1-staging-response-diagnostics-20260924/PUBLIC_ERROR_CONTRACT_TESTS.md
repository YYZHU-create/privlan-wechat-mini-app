# Public Error Contract and Disclosure Tests

- `DIAGNOSTIC_DISABLED_PUBLIC_CONTRACT_UNCHANGED=PASS`: direct response-contract assertion preserves the exact public-safe 500 body without a diagnostic object.
- `PRODUCTION_DIAGNOSTIC_BYPASS_BLOCKED=PASS`: actual Express route integration with `production` plus the opt-in header returns no diagnostic object.
- `DIAGNOSTIC_SECRET_DISCLOSURE_TEST=PASS`: serialized response excludes credential markers, scope identifiers, object key, signed URL, provider body, raw error text, and stack markers.
- `DIAGNOSTIC_PAYLOAD_DISCLOSURE_TEST=PASS`: serialized response excludes base64/Data URL payload and sensitive filename marker; integration also excludes request-body marker, cookie/session marker, CSRF marker, and authenticated fixture scope IDs.
- Unknown internal errors are reduced to `errorClass=UNKNOWN_INTERNAL`.
- `RAW_INTERNAL_ERROR_DISCLOSURE=NO`; `STACK_DISCLOSURE=NO`.
