# Test Results

Current candidate verification (2026-09-24):

| Check | Command / scope | Result |
|---|---|---|
| Focused Media V1 | `node --test admin/test/media-service-v1.test.js admin/test/media-staging-diagnostic-route.test.js admin/test/g2b-storage-integration.test.js` | 54 tests; 54 passed; 0 failed; 0 skipped; exit 0 |
| Full admin repository suite | `pnpm test` in `admin/` | 388 tests; 384 passed; 0 failed; 4 skipped; exit 0 |
| PG17 opt-in integration | `node --test test/media-upload-postgrest-pg17.integration.test.js` in `admin/` | 1 skipped; 0 executed; opt-in requires `FEELDAO_MEDIA_POSTGREST_PG17=1`; no PG17 integration claim for this run |
| Diff whitespace | `git diff --check` | clean; exit 0 |

The established local happy path is the passing provider-test-double service test, “V1 upload creates pending asset, object, link and ready state with an attempt marker”: `LOCAL_MEDIA_V1_HAPPY_PATH=PASS`. This does not represent a live Staging upload.

Prior pre-refactor baseline recorded immediately before this refactor: focused `media-service-v1.test.js` 32 passed/0 failed; full suite 377 tests, 373 passed/0 failed/4 skipped. The baseline included the previous logger-oriented patch and is distinct from the current candidate run.

The four skips include opt-in or platform-dependent integration coverage; the PG17/PostgREST test was specifically confirmed skipped in its standalone invocation.
