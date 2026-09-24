# FEELDAO OS — ASSET_CONFIRM Sub-Reason Diagnostic

## Identity and scope

```text
PROJECT=asmhysidbg5g
BASE_COMMIT=a257bc3a35c9e1d261c4d2741641a14fc7a09e15
BRANCH=codex/asset-v1-final-candidate
AGENTS_REFERENCE_STALE=YES (docs/prompts/sprint-x.md absent; not created)
FIRST_FAILED_OPERATION=ASSET_CONFIRM
```

Reused the preceding ASSET_CONFIRM root-cause record at `verification/media-v1-asset-confirm-root-cause-20260924/REPORT.md` and the single-upload evidence under `verification/media-v1-single-diagnostic-upload-20260924/`. This change adds only request-local Staging diagnostic classification and tests. No upload logic, repository query, retry, Storage, compensation, schema, or authorization behavior was changed.

## A. Actual confirmation branches

Frozen-source review of `admin/media-service-v1.js` (`persistAttemptAsset`, `exactAsset`, and `uploadBoundary`) and `admin/asset-repository.js` (`createPendingAsset`, `getAssetByIdScoped`) found:

| Actual branch | Existing behavior/code | Diagnostic reason |
|---|---|---|
| Scoped reread returns no row | `exactAsset` returns null; confirmation throws `MEDIA_UPLOAD_ASSET_CREATE_INDETERMINATE` (503) | `ASSET_CONFIRM_REREAD_NOT_FOUND` |
| Scoped reread throws repository/database/PostgREST error | Reread exception propagates through the ASSET_CONFIRM boundary; repository failures are `AssetRepositoryError` | `ASSET_CONFIRM_REREAD_ERROR` |
| Reread returns a row but any of six exact bindings differ (`id`, tenant, workspace, store, object key, `metadata.uploadAttemptId`) | One combined predicate throws `MEDIA_UPLOAD_ASSET_BINDING_MISMATCH` (409) | `ASSET_CONFIRM_BINDING_MISMATCH` |
| Other exception at the confirmation boundary | Propagates as the original error | `ASSET_CONFIRM_OTHER_ERROR` |
| Reread returns a row and all bindings match | Confirmation succeeds | No reason field |

There is no separate status mismatch branch: `exactAsset` does not test `asset.status`. Tenant/workspace/store and metadata mismatches are members of the single binding-mismatch predicate; the diagnostic deliberately reports that actual combined branch rather than inventing finer reasons. The finite enum is derived from the two existing `MediaServiceError.code` values and the thrown reread/other-error branches.

```text
ASSET_CONFIRM_FAILURE_BRANCHES_COMPLETE=YES
EXISTING_STABLE_INTERNAL_REASON_AVAILABLE=PARTIAL (not-found and binding mismatch have stable codes; read exceptions do not)
```

## B-C. Minimal diagnostic implementation

`admin/media-service-v1.js` records `assetConfirmReason` only when the first recorded failed operation is `ASSET_CONFIRM`. It stores one finite enum on the request-local diagnostic state; it does not write journal state or serialize exception content. Because the merchant route returns `diagnosticState.failureError || error`, later reconciliation errors do not overwrite this first ASSET_CONFIRM reason.

`admin/error-response.js` emits at most one new field, `assetConfirmReason`, and only for the allowlisted enum when the sanitized failed operation is `ASSET_CONFIRM`. For a 409 binding branch, the reason may appear in the authenticated, explicit-header Staging diagnostic while the public failure status/body remain on the existing normalized contract. The preexisting Staging, authenticated scope, explicit header, and status checks remain; the 409 exception is restricted to a valid ASSET_CONFIRM enum. Production, unauthenticated, headerless, other-operation, and invalid-enum paths omit the field/diagnostic.

No raw row, IDs, scope values, error message, stack, payload, or secret is added. The adapter provides no safe underlying SQLSTATE for these repository failures, so this patch adds no `dbCode`.

```text
ASSET_CONFIRM_SUBREASON_DIAGNOSTIC_COMPLETE=YES
BUSINESS_LOGIC_CHANGED=NO
DATABASE_SCHEMA_CHANGED=NO
STORAGE_BEHAVIOR_CHANGED=NO
COMPENSATION_POLICY_CHANGED=NO
PUBLIC_ERROR_CONTRACT_CHANGED=NO (non-opt-in and public response fields/status remain unchanged)
PRODUCTION_DIAGNOSTIC_BYPASS_BLOCKED=YES (verified by existing and updated route tests)
```

## D-E. Tests

The ASSET_CONFIRM tests exercise all actual branches: no row; `AssetRepositoryError`; each of the six fields in the shared mismatch predicate; and an unexpected reread exception. Every branch asserts `failedOperation=ASSET_CONFIRM` and the exact enum. Tests serialize the diagnostic and verify that fixture error text, row/scope values, object identifiers, and synthetic secret strings are absent. Happy-path upload still reaches `ready` and has no reason. Route tests verify Staging opt-in, the 409 internal binding mismatch path, normal no-header public response, Production header denial, and unauthenticated denial.

## F-G. Verification and freeze

```text
ASSET_CONFIRM_SUBREASON_TESTS=PASS (9 branch scenarios; see Verification record)
MEDIA_FOCUSED_TESTS=PASS (107 passed, 0 failed, 0 skipped)
FULL_TESTS=PASS_WITH_SKIPS (admin suite: 398 tests, 394 passed, 0 failed, 4 skipped)
PG17_POSTGREST_TESTS=NOT_REQUIRED_FOR_THIS_DIFF (persistence adapter and SQL unchanged)
GIT_DIFF_CHECK=PASS
```

Exact commands, literal summaries, baseline comparison, and rollback-copy test are recorded in `VERIFICATION.txt`; the candidate commit SHA is supplied in the handoff. `DIFF.patch` captures only the four tracked source/test changes. `ROLLBACK.sh` reverses that patch on a disposable copy after a reverse-check. No Staging upload, deployment, remote mutation, or Production operation occurred.

```text
DEPLOYMENT_EXECUTED=NO
NEW_STAGING_UPLOAD_EXECUTED=NO
REMOTE_STATE_MUTATED=NO
PRODUCTION_MUTATED=NO
```

## Result

The allowlisted request-time subreason diagnostic is implemented and locally verified. The candidate commit SHA is provided in the final handoff; deployment and another upload remain separate actions.
