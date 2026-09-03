# Feeldao OS Production Inputs

All values below are external Production inputs. Store values in the approved platform or secret manager, not in this repository or a PR description. `MEOO_ACTUAL_NODE_VERSION=NOT_VERIFIED` until the platform owner provides a read-only runtime record.

| Input | Purpose and expected format | Owner | Validation stage |
| --- | --- | --- | --- |
| `DEDICATED_PRODUCTION_MEOO_PROJECT_ID` | Dedicated Meoo project identifier | Platform owner | B1 deployment |
| `PRODUCTION_SERVICE_ID` | Production service identifier | Platform owner | B1 deployment |
| `PRODUCTION_PUBLIC_DOMAIN` | Approved public domain name | Platform owner | B2 cutover |
| `PRODUCTION_DATABASE_IDENTITY` | Non-secret immutable database identity label | Platform owner | Pre-deploy read-only check |
| `PRODUCTION_DATABASE_READ_ONLY_ACCESS_PATH` | Approved read-only access mechanism | Platform owner | Pre-deploy only |
| `PRODUCTION_SECRET_NAMES` | Names of required secrets, never values | Platform owner | B1 deployment |
| `PRODUCTION_NODE_VERSION` | Runtime version; expected `22.x` | Platform owner | B1 deployment |
| `PRODUCTION_PORT` | Service port; expected `9000` | Platform owner | B1 deployment |
| `PRODUCTION_HEALTHCHECK_PATH` | Liveness path; expected `/health` | Platform owner | B1 deployment |
| `CURRENT_PRODUCTION_RELEASE_SHA` | Full 40- or 64-character Git SHA | Platform owner | Rollback planning |
| `CURRENT_PRODUCTION_IMAGE_DIGEST` | Immutable image digest | Platform owner | Rollback planning |
| `CURRENT_PUBLIC_OPS_ROUTE_OWNER` | Existing public `/ops/` route owner | Platform owner | B2 cutover |
| `CURRENT_OPS_API_ROUTE_OWNER` | Existing Ops API route owner | Platform owner | B2 cutover |
| `CURRENT_SIMPLIFIED_SPA_DEPLOYMENT_UNIT` | Existing simplified SPA deployment unit | Platform owner | B2 cutover |
| `LATEST_VALID_BACKUP_TIME` | Timestamp of the latest restore-verified backup | Platform owner | B1 deployment |
| `ROLLBACK_IMAGE_DIGEST` | Approved immutable rollback image digest | Platform owner | Rollback planning |
| `ROLLBACK_ROUTE_TARGET` | Approved route target identifier | Platform owner | B2 cutover |

Codex may read-only verify supplied identifiers, image metadata, and documented runtime settings after access is explicitly authorized. B1 actions are deployment-stage only. B2 actions are cutover-stage only. Neither stage authorizes database migration execution, secret disclosure, or changes to unrelated Production resources.
