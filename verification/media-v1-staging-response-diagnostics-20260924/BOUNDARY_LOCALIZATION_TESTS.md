# Boundary Localization Tests

Executed: `node --test admin/test/media-service-v1.test.js admin/test/media-staging-diagnostic-route.test.js admin/test/g2b-storage-integration.test.js` from the repository root.

Result: 54 tests, 54 passed, 0 failed, 0 skipped; exit 0.

Assertions:
- `ASSET_CONFIRM_DIAGNOSTIC_TEST=PASS` — injected scoped asset confirmation failure reports `ASSET_CONFIRM` after `ASSET_CREATED`.
- `JOURNAL_ADVANCE_DIAGNOSTIC_TEST=PASS` — failed journal PATCH reports `JOURNAL_DB_ASSET_CREATED_WRITE`; a separate readback failure reports `JOURNAL_DB_ASSET_CREATED_VERIFY`.
- `STORAGE_EXISTS_DIAGNOSTIC_TEST=PASS` — failed expected-object verification reports `STORAGE_EXISTS_CHECK` after `DB_ASSET_CREATED`.
- `STORAGE_PUT_DIAGNOSTIC_TEST=PASS` — synthetic provider PUT failure reports `STORAGE_PUT` after `DB_ASSET_CREATED`; this is local synthetic evidence, not a real Staging upload.
- Route integration verifies the response gate with an authenticated fixture session and prevents unauthenticated requests reaching the media handler.
