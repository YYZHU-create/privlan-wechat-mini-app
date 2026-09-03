# Feeldao OS Production Rollback

Rollback is a separately authorized platform action. This repository provides a fail-closed plan validator; it does not execute a rollback.

## Required approved plan fields

```text
CURRENT_RELEASE_SHA
CURRENT_IMAGE_DIGEST
TARGET_RELEASE_SHA
TARGET_IMAGE_DIGEST
CURRENT_ROUTE_OWNER
ROLLBACK_ROUTE_OWNER
EXPECTED_PRODUCTION_PROJECT
EXPECTED_PRODUCTION_SERVICE
ACTUAL_PRODUCTION_PROJECT
ACTUAL_PRODUCTION_SERVICE
```

Before a platform operator changes an image or route, save the approved non-secret plan outside the repository and validate it:

```sh
node scripts/validate-rollback-plan.js /approved/path/rollback-plan.json
```

The validator fails on empty values, unsafe identifier formats, or project/service mismatches. A `PASS` validates the plan inputs only; it does not perform any remote operation.

## Authorized execution order

1. Reconfirm the Production project and service match the approved plan.
2. Reconfirm current release SHA, image digest, and route owner.
3. Restore the approved target image digest.
4. Verify `/health`, then authenticated Operator health, login, session, and audit gates.
5. If B2 is separately authorized, restore the approved route owner and verify the public route.
6. Record final image digest, route owner, and validation results.

Database rollback is not automatic. Preserve existing migrations and data; investigate compatibility through the read-only schema checker before any separately authorized database recovery work.
