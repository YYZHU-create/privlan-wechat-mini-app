# Feeldao OS Production Inputs

All values below are external Production evidence or inputs. Store values in the approved platform or secret manager, not in this repository or a PR description. `MEOO_ACTUAL_NODE_VERSION=NOT_VERIFIED` until the platform owner provides a read-only runtime record.

Meoo documents static Web releases and HTTP server/image deployments, and separately managed Edge Functions. This project must first be bound to its actual deployment mode and target. A service ID or image digest is applicable to an image target, not automatically to a static release; a listed Edge Function is not proof of ownership for a same-origin API path. See [production-evidence-gates.md](production-evidence-gates.md) for the current evidence state and decision.

| Input | Purpose and expected format | Owner | Validation stage |
| --- | --- | --- | --- |
| `DEDICATED_PRODUCTION_MEOO_PROJECT_ID` | Dedicated Meoo project identifier | Platform owner | B1 deployment |
| `PRODUCTION_DEPLOYMENT_MODE_AND_TARGET` | Verified project-bound target type and identity: static Web release, HTTP server/image target, or separately managed Edge Function(s), as applicable | Platform owner | B1 preflight |
| `PRODUCTION_SERVICE_ID` | Required only if the verified target is an HTTP server/image service | Platform owner | B1 preflight |
| `PRODUCTION_EDGE_FUNCTION_IDENTITIES` | Function name/version and source identity, recorded separately from the Web release | Platform owner | B1/API preflight |
| `PRODUCTION_PUBLIC_DOMAIN` | Approved public domain name | Platform owner | B2 cutover |
| `PRODUCTION_SPA_ROUTE_MAPPING` | Public host/path mapping for the static application and `/ops/` client route | Platform owner | B2 preflight |
| `PRODUCTION_OPS_API_ROUTE_MAPPING` | Public host/path mapping and upstream owner for `/ops/v1/*`, separate from the SPA route | Platform owner | B2 preflight |
| `PRODUCTION_DATABASE_IDENTITY` | Non-secret immutable database identity label | Platform owner | Pre-deploy read-only check |
| `PRODUCTION_DATABASE_READ_ONLY_ACCESS_PATH` | Approved read-only access mechanism | Platform owner | Pre-deploy only |
| `PRODUCTION_SECRET_NAMES` | Names of required secrets, never values | Platform owner | B1 deployment |
| `PRODUCTION_EFFECTIVE_RUNTIME_CONFIG` | Redacted runtime-bound configuration state, including effective migration and feature-gate values; project-level name presence is insufficient | Platform owner | B1 preflight |
| `PRODUCTION_NODE_VERSION` | Required for a server/image runtime; supported contract `>=22 <25` (Node 22 Docker baseline) | Platform owner | B1 deployment |
| `PRODUCTION_PORT` | Required only for a server/image service; expected `9000` under the repository image contract | Platform owner | B1 deployment |
| `PRODUCTION_HEALTHCHECK_PATH` | Required for a server/image service; repository liveness path is `/health` | Platform owner | B1 deployment |
| `CURRENT_PRODUCTION_RELEASE_IDENTITY` | Current release object type/ID and source/build/artifact identity; include an image digest only for an image target | Platform owner | Rollback planning |
| `CURRENT_PUBLIC_OPS_SPA_OWNER` | Existing public `/ops/` static application/SPA route owner | Platform owner | B2 cutover |
| `CURRENT_OPS_API_UPSTREAM_OWNER` | Existing `/ops/v1/*` API upstream, recorded separately from the SPA owner | Platform owner | B2 cutover |
| `LATEST_VALID_BACKUP_TIME` | Timestamp of the latest restore-verified backup | Platform owner | B1 deployment |
| `APPROVED_ROLLBACK_TARGET` | Prior static release/source, image/service, or function identity as applicable, plus a verified recovery procedure | Platform owner | Rollback planning |
| `RESTORE_VERIFIED_BACKUP_RECORD` | Backup time/scope/database identity, actual restore verification, and recorded RPO/RTO | Platform owner | B1 deployment |

Codex may read-only verify supplied identifiers, applicable release metadata, and documented runtime settings after access is explicitly authorized. Mark unsupported-by-current-evidence fields `NOT_VERIFIED` or `NOT_EXPOSED`; do not infer platform non-existence from a missing field in one CLI output. B1 actions are deployment-stage only. B2 actions are cutover-stage only. Neither stage authorizes database migration execution, secret disclosure, or changes to unrelated Production resources.
