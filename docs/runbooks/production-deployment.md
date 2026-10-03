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

Use the committed migration manifest as a compatibility gate. Ordinary application startup forces `ATELIER_AUTO_MIGRATE=0` after configuration loading and the database factory always uses `migrate: false`. Explicit migration commands are a separate authorized operation. A project-level variable-name listing is insufficient evidence of a running instance's effective state.

The migration protection evidence has two phases, so an old release's inherited value does not create a circular prerequisite for deploying its replacement:

1. **Before deployment:** verify the exact candidate, frozen target configuration and manifest, actual shell/Docker/direct application entrypoints, inherited/file overrides, and zero startup migration SQL in isolated tests. Confirm target database continuity and required schema compatibility. Keep recovery/backup and other applicable release gates intact.
2. **After deployment:** verify the new runtime's source/config identity and sanitized startup evidence that migrations are disabled before database initialization, then perform health and authenticated acceptance. Report the previous runtime separately; do not describe candidate tests as observations of Production.

Hosted starts require a validated target config. Packaged deployments provide `runtime-config.json`; Docker/Compose/CI may explicitly select `/app/runtime-config/production.json`. Target mismatch, missing hosted config, or simultaneous Meoo backend and native `DATABASE_URL` fail before database initialization. Startup preserves the configured URL and does not substitute another database.

Compare migration history and structural compatibility separately. Production can retain 001–014 when Media V1/lifecycle/Canary are disabled and the candidate's enabled paths are proven compatible; record missing 015/016 rather than declaring the entire manifest matched. Enabling paths that depend on those migrations requires the separate migration gate.

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
