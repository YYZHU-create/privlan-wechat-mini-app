# FEELDAO OS — Diagnostic Delayed Reread Probe

Date: 2026-09-25
Project: `asmhysidbg5g`
Base candidate: `d6555aff0ab5139f5083072df8b6683d1743e616` (`codex/asset-v1-final-candidate`)

## Implementation

The diagnostic observation is enabled only when the media service runs with `runtimeEnvironment === "staging"` and receives the request-local diagnostic state created by the authenticated, explicit-header Staging route. After the first `ASSET_CONFIRM` operation records `ASSET_CONFIRM_REREAD_NOT_FOUND`, the service waits exactly 250 ms and invokes `getAssetByIdScoped(scope, attempt.asset_id)` once. The existing scope object, asset ID, repository instance, method, and service-role client are reused. No scope predicate is relaxed.

The delayed read records only `FOUND`, `NOT_FOUND`, or `ERROR`; diagnostic state starts at `NOT_RUN`. A found row is compared against the existing asset/attempt binding predicates and records only `YES` or `NO`. The row and observation error are not returned. The original `failureError`, `failedOperation`, and `assetConfirmReason` remain authoritative; the observation does not feed the upload result or recovery decision. A follow-on recovery invocation does not perform a second delayed observation.

The Staging diagnostic envelope exposes `delayedRereadResult`, `delayedRereadDelayMs=250`, and, only for `FOUND`, `delayedRereadBindingMatch`. The existing environment/authentication/header gate remains in force. Ordinary response status and public fields remain unchanged.

## Verification

Baseline before edits: focused Media service and diagnostic-route tests passed, 53/53.

After edits:

| Check | Command | Result |
|---|---|---|
| Delayed-reread focused scenarios | `pnpm exec node --test --test-name-pattern="delayed reread" test/media-service-v1.test.js` | 7 passed / 0 failed (parent suite plus six scenario subtests) |
| Media focused suite | `pnpm exec node --test test/media-service-v1.test.js test/media-runtime-config.test.js test/media-runtime-diagnostic.test.js test/media-staging-diagnostic-route.test.js test/media-upload-client.test.js test/meoo-media-repository.test.js test/workspace-media.test.js` | 114 passed / 0 failed / 0 skipped |
| PostgreSQL 17 + PostgREST integration | `$env:FEELDAO_MEDIA_POSTGREST_PG17='1'; pnpm exec node --test test/media-upload-postgrest-pg17.integration.test.js` | 1 passed / 0 failed; PostgreSQL 17.0.11; migrations 001–016; normal create→immediate reread passed in disposable local integration |
| Full admin suite | `pnpm test` | 401 passed / 0 failed / 4 skipped |
| Patch whitespace | `git diff --check` and staged `git diff --cached --check` | PASS |

Delayed-reread scenarios verify: immediate confirmation found → `NOT_RUN`; immediate miss then delayed found → original request still fails; delayed miss → `NOT_FOUND`; delayed exception → `ERROR` while the first failure classification remains; mismatched delayed row binding → `FOUND` plus `NO`; Production and Staging without diagnostic state → no observation. The test also asserts identical scope object and asset ID for immediate and delayed repository reads, preserves the prior public response fields/status, and checks diagnostic serialization for private errors, stack text, IDs, filename, and object-key-shaped data.

## State and result

```text
DELAYED_REREAD_DIAGNOSTIC_IMPLEMENTED=YES
DELAYED_REREAD_DELAY_MS=250
IMMEDIATE_REREAD_COUNT=1
MAX_DELAYED_DIAGNOSTIC_REREAD_COUNT=1
DELAYED_REREAD_QUERY_IDENTICAL=YES
BUSINESS_RESULT_CHANGED_BY_DELAYED_REREAD=NO
FORMAL_RETRY_BEHAVIOR_CHANGED=NO
PUBLIC_ERROR_CONTRACT_CHANGED=NO (Staging diagnostic envelope extended; ordinary response fields/status preserved)
PRODUCTION_DIAGNOSTIC_BYPASS_BLOCKED=YES
SOURCE_CODE_CHANGED=YES (admin/media-service-v1.js, admin/error-response.js)
TESTS_CHANGED=YES (admin/test/media-service-v1.test.js)
DATABASE_SCHEMA_CHANGED=NO
STORAGE_BEHAVIOR_CHANGED=NO
COMPENSATION_POLICY_CHANGED=NO
DEPLOYMENT_EXECUTED=NO
NEW_STAGING_UPLOAD_EXECUTED=NO
REMOTE_STATE_MUTATED=NO
PRODUCTION_MUTATED=NO
READY_FOR_DELAYED_REREAD_DIAGNOSTIC_DEPLOYMENT=YES
RESULT=PASS
```

Candidate commit SHA is recorded in the task completion summary after commit creation.
