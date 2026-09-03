# Feeldao OS Production Deployment

## Runtime contract

| Surface | Required value |
| --- | --- |
| Repository Node.js | `22.x` from `.node-version` and `admin/package.json` |
| pnpm | `11.7.0` from `admin/package.json`, CI, Dockerfile, and `scripts/setup.sh` |
| Liveness | `GET /health` returns only `{"status":"ok"}` and does not prove database health |
| Readiness gate | authenticated `GET /ops/v1/health`, controlled Operator login, session probe, and audit confirmation |

The Meoo runtime must be configured to Node.js 22 before deployment. Its current runtime version is an external platform value and must be recorded as `NOT_VERIFIED` until the platform owner provides or permits read-only verification.

## Required authorization phases

### B1 — image deployment

B1 deploys a reviewed image to the dedicated Production project after the platform owner supplies the inputs in [production-inputs.md](production-inputs.md). Before starting B1, verify the selected project, service, image digest, Node.js 22 runtime, port, and healthcheck path. Use the committed migration manifest as a compatibility gate; do not enable automatic migration on steady-state application instances.

After B1, record the deployed release SHA and image digest, then run the liveness and authenticated readiness gates. A successful `/health` response alone is insufficient.

### B2 — public `/ops/` cutover

B2 is separately authorized. Confirm the current owner of the public `/ops/` and Ops API routes, the simplified SPA deployment unit, the rollback route target, and the intended Feeldao OS Operator Console binding. B1 completion does not authorize B2.

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
