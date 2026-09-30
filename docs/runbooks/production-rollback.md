# Feeldao OS Production Rollback

Rollback is a separately authorized platform action. The existing plan validator validates the repository's image/service-specific plan shape; it does not execute a rollback and does not validate static-release or Edge Function rollback plans.

First identify the actual Meoo deployment object; do not assume the Production project is an image service. Meoo documents static Web and HTTP server/image deployment modes, while Edge Functions are separately managed. Current evidence and open gates are recorded in [production-evidence-gates.md](production-evidence-gates.md).

## Required approved plan fields

```text
EXPECTED_PRODUCTION_PROJECT
ACTUAL_PRODUCTION_PROJECT
DEPLOYMENT_MODE
CURRENT_RELEASE_OR_FUNCTION_IDENTITY
TARGET_RELEASE_OR_FUNCTION_IDENTITY
CURRENT_SOURCE_OR_ARTIFACT_IDENTITY
TARGET_SOURCE_OR_ARTIFACT_IDENTITY
CURRENT_SPA_ROUTE_OWNER
TARGET_SPA_ROUTE_OWNER
CURRENT_OPS_API_UPSTREAM_OWNER
TARGET_OPS_API_UPSTREAM_OWNER
```

For an HTTP server/image target, include actual and target service IDs and immutable image digests. For a static Web release, use the platform's actual release/source/artifact identities and a verified way to republish or restore the selected target. For Edge Functions, record the function name, deployed version/source identity, and approved target revision separately. Do not put image-only fields on a static target or combine SPA and API route ownership into one field.

For an image/service rollback, before a platform operator changes an image or route, save the approved non-secret plan outside the repository and validate it:

```sh
node scripts/validate-rollback-plan.js /approved/path/rollback-plan.json
```

The validator fails on empty values, unsafe identifier formats, or project/service mismatches. A `PASS` validates those image/service plan inputs only; it does not perform any remote operation or prove that the platform can restore the target. Static Web and Edge Function plans require their own verified platform procedure and target-specific evidence.

## Authorized execution order

1. Reconfirm the Production project and deployment mode/target match the approved plan.
2. Reconfirm current release or function identity, source/artifact identity, and separate SPA/API route owners.
3. Restore or republish the approved target using the verified target-specific platform procedure. A new deploy from source is a forward deployment unless it is proven to restore the exact approved prior state.
4. Verify `/health`, then authenticated Operator health, login, session, and audit gates for the restored target.
5. If B2 is separately authorized, restore the approved public SPA and API route mappings independently and verify each path.
6. Record final target identity, route mappings, and validation results.

Database rollback is not automatic. Preserve existing migrations and data; investigate compatibility through the read-only schema checker before any separately authorized database recovery work.

A logical data snapshot is not a platform backup and does not prove restore capability. Database recovery readiness requires an actual restore-verification record and an approved target-specific procedure. Until these identities and recovery controls are verified, Production readiness remains `GATES_NOT_CLEARED`.
