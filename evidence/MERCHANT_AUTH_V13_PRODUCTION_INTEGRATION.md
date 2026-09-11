# Merchant Auth V13 Production Source Integration

## Baseline and source

- Production validated baseline: `107b48d01a94edd273d59f9f656816a12ae3921e`
- V13 verified source: `d949c15dd18e13f8c0db1a79111b179ed5486902`
- Imported Function SHA256: `b3b2664b0e39133083495c27de91be4a6ce71aa10b3f9617664d1d0321880900`

## Imported files and reasons

| Path | Reason |
| --- | --- |
| `functions/privlan-merchant-api/index.ts` | Frozen V13 Merchant Auth runtime source. |
| `tests/privlan-merchant-login/build.mjs` | Builds the real Function source from its integration worktree into the Node test target without rewriting business logic. |
| `tests/privlan-merchant-login/fakes/fake-supabase.ts` | Deterministic Supabase test double used by the focused harness. |
| `tests/privlan-merchant-login/fakes/fake-scrypt.ts` | Deterministic scrypt test implementation used by the focused harness. |
| `tests/privlan-merchant-login/authorization-contract.test.mjs` | Verifies membership-derived authorization scope, owner fail-closed behavior, audit requirements, and the exact Supabase import pin against the integration worktree source. |
| `tests/privlan-merchant-login/login.test.mjs` | Verifies login authorization and audit-failure compensation. |
| `tests/privlan-merchant-login/signed-upload-probe.test.mjs` | Verifies the signed-upload probe contract. |
| `tests/privlan-merchant-login/signed-upload-execute.test.mjs` | Verifies signed-upload execution authorization and write sequencing. |
| `tests/privlan-merchant-login/proxy-upload.test.mjs` | Verifies proxy-upload authorization and storage boundaries. |
| `tests/privlan-merchant-login/capacity-gate.test.mjs` | Verifies capacity probe authorization and isolated storage namespace behavior. |
| `tests/privlan-merchant-login/mp-images.test.mjs` | Verifies merchant image access scope. |
| `tests/privlan-merchant-login/probe-runtime-config.test.mjs` | Verifies runtime-configured probe scope, disabled behavior, and foreign-scope denial. |

## Scope

This integration adds only the Function runtime source and its focused V13 harness. It contains no database migration, secret, UI, Container, or deployment configuration change.

## Harness root binding

The original focused harness addressed `/home/project`. On this Windows runner that path resolved to a separate checkout at `2b5465019ac186ec10ba4135175ce90ee76563c0`, whose Function SHA256 was `0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55`. Its path conversion also produced `file:///C:/C:/...` module URLs, which stopped the focused suite before test execution. The harness now resolves its own repository root and module URLs from `import.meta.url`, preserving every assertion while binding build and source checks to this integration commit on both Windows and POSIX runners.

| Modified harness file | Reason |
| --- | --- |
| `tests/privlan-merchant-login/build.mjs` | Resolves the source root from its own module location. |
| `tests/privlan-merchant-login/authorization-contract.test.mjs` | Resolves the Function source and built module URLs portably. |
| `tests/privlan-merchant-login/capacity-gate.test.mjs` | Resolves built module and sibling-source URLs portably. |
| `tests/privlan-merchant-login/login.test.mjs` | Resolves built module URLs portably. |
| `tests/privlan-merchant-login/mp-images.test.mjs` | Resolves built module URLs portably. |
| `tests/privlan-merchant-login/probe-runtime-config.test.mjs` | Resolves built module URLs portably. |
| `tests/privlan-merchant-login/proxy-upload.test.mjs` | Resolves built module URLs portably. |
| `tests/privlan-merchant-login/signed-upload-execute.test.mjs` | Resolves built module URLs portably. |
| `tests/privlan-merchant-login/signed-upload-probe.test.mjs` | Resolves built module URLs portably. |
