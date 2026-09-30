# Feeldao OS Production Deployment

## Runtime contract

| Surface | Required value |
| --- | --- |
| Repository Node.js | `>=22 <25` from `admin/package.json`; `.node-version=22` remains the development/Docker baseline |
| pnpm | `10.33.3` from `admin/package.json`, CI, Dockerfile, and `scripts/setup.sh`; Meoo's image builder supplies this version when using that deployment mode |
| Liveness | `GET /health` returns only `{"status":"ok"}` and does not prove database health |
| Readiness gate | authenticated `GET /ops/v1/health`, controlled Operator login, session probe, and audit confirmation |

For the documented image-builder path, Meoo supplies Node.js 24.15.0 and pnpm 10.33.3 on Linux `/code`; `scripts/setup.sh` verifies those supplied tools without global Corepack shim mutation. The repository Docker compatibility image remains pinned to `node:22-bookworm-slim`. These builder facts apply to that path and do not establish that the current Production application uses an image runtime.

## Required authorization phases

Before applying B1/B2, use the [Production Meoo evidence gates](production-evidence-gates.md) to identify the actual project-bound deployment object. Meoo documents both static Web publication and HTTP server/image publication; Edge Functions are separately managed. The presence of a Dockerfile or an Edge Function does not identify which object currently serves the Production hostname. B1 and B2 are project governance phases, not proof of Meoo's internal service or route model.

### B1 — deploy to a verified target

Choose the checks by the verified deployment mode:

- **Static Web release:** verify the Meoo project and Web release object, source/build input identity, and public static route evidence. Do not require or invent an image digest for a static artifact.
- **HTTP server/image:** verify the project-bound service, immutable image/artifact identity, source/build identity, Node runtime contract (`>=22 <25`), port, and healthcheck path.
- **Edge Function:** record the exact function name/version and source revision separately from the Web application release. A function listing does not prove that a same-origin `/ops/v1/*` route maps to that function.

Use the committed migration manifest as a compatibility gate. Before any application startup or release, verify the effective `ATELIER_AUTO_MIGRATE=0` setting against the actual target runtime; a project-level variable-name listing is insufficient. The current Production evidence ledger leaves runtime identity, route ownership, and effective configuration `NOT_VERIFIED`, so the deployment gate remains `GATES_NOT_CLEARED`.

After an authorized B1 deployment, record the identity fields applicable to the verified deployment mode, then run liveness and authenticated readiness checks. A successful `/health` response alone is insufficient.

### B2 — public `/ops/` cutover

B2 is separately authorized. Treat the `/ops/` SPA client route and `/ops/v1/*` API ingress as separate route layers. Confirm each host/path mapping, owner, upstream, intended Operator Console binding, and rollback target independently. Evidence that the SPA loads does not identify the API handler; B1 completion does not authorize B2.

## Database compatibility gate

Generate and verify the repository manifest before release:

```sh
node admin/migration-manifest.js --check
```

The read-only Production verification command is run only after the platform owner provides an approved read-only access path:

```sh
DATABASE_URL="$READ_ONLY_DATABASE_URL" node admin/check-migration-compatibility.js
```

The migration history checker opens `BEGIN READ ONLY`, applies a local statement timeout, reads only `schema_migrations`, and never runs migrations. It validates migration history only; full schema compatibility remains `NOT_VERIFIED`. Record `MIGRATION_HISTORY_COMPATIBILITY=PASS` only for matching migration history, and record `FULL_SCHEMA_COMPATIBILITY=NOT_VERIFIED` unless a separate catalog contract has been verified. `ATELIER_AUTO_MIGRATE` remains `0` for the deployed application service.

## Post-deployment authenticated gate

Use a controlled Operator account approved for the deployment. Login writes a session and audit event by design. Verify: successful login, authenticated `GET /ops/v1/health`, session probe, expected audit entry, and logout. Do not include credentials or response bodies in tickets, logs, or artifacts.

## Rollback

Use [production-rollback.md](production-rollback.md). Restore the approved image and route owner first. Do not auto-run inverse database migrations.
