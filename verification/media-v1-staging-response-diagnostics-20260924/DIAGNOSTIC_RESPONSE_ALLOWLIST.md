# Diagnostic Response Allowlist

A diagnostic object is attached only to internal HTTP 5xx responses when the Staging/auth/header gate is satisfied.

Allowed keys:
- `requestId`: bounded identifier matching `[A-Za-z][A-Za-z0-9_-]{1,100}`, otherwise `null`.
- `lastCompletedPhase`: fixed phase allowlist, otherwise `null`.
- `failedOperation`: fixed operation allowlist, otherwise `UPLOAD_REQUEST`.
- `errorClass`: `MediaServiceError`, `StorageProviderError`, `DatabaseError`, or `PostgrestError`; all other names map to `UNKNOWN_INTERNAL`.
- `dbCode`: only explicit SQLSTATE allowlist and only for `DatabaseError`.
- `providerStatus`: integer 400–599 and only for `StorageProviderError`.
- `providerCode`: explicit provider-code allowlist and only for `StorageProviderError`.

No message, stack, payload, request headers/body, cookies/tokens, credentials, scope IDs, canonical object key, signed URL, or provider response body is copied into the diagnostic. Existing public response fields remain unchanged when the gate is inactive.
