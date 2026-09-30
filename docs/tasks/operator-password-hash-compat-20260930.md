# Operator password hash compatibility

STATUS=LOCAL_VALIDATION_PASS
BRANCH=codex/operator-hash-compat
BASE_COMMIT=a0633a604c2a4df53b38266249b2c27cdbaf519e

## Objective

Allow the Operator authentication path to verify the fixed historical five-part scrypt format while preserving the existing two-part password format and Merchant authentication behavior.

## Scope

- `admin/platform-store.js`: add a strictly bounded Operator-only legacy verifier.
- `admin/saas-service.js`: use the Operator-specific verifier for `operator_users` authentication.
- `admin/test/operator-password-compat.test.js`: verify both accepted formats, malformed-input rejection, wrong-password rejection, service wiring, and Merchant isolation.

## Compatibility contract

The existing generated format remains `base64(salt16).base64(scrypt64)`. The Operator compatibility path additionally accepts only `$scrypt$N=16384,r=8,p=1$<base64url-salt16>$<base64url-scrypt32>`. Parameters and decoded lengths are fixed, encodings must be canonical, comparisons use `timingSafeEqual`, and unrecognized formats fail closed.

## Verification

- Focused Operator compatibility and service/repository tests: PASS, 6/6.
- Existing `merchant-http.test.js`: PASS, 6/6.
- Full Admin suite in serial mode: PASS, 409 passed / 0 failed / 4 skipped.
- Syntax checks and `git diff --check`: PASS.

The default parallel full-suite run encountered a Windows `VirtualAlloc` resource failure in `merchant-http.test.js`; that test passed alone, and the full suite passed with `--test-concurrency=1`.

## Runtime state

No Staging or Production deployment, database write, password reset, session revocation, migration, or configuration change was performed. Production acceptance remains a later, separately authorized task.
