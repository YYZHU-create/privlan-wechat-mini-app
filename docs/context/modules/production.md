# Production Context

## Runtime contract

The repository production runbook defines a Node.js `>=22 <25` compatibility contract, with Node.js 22 as the `.node-version` and Docker baseline, and pnpm `10.33.3` for the Meoo image builder. The builder supplies Node.js 24.15.0 / pnpm 10.33.3 on Linux `/code` as root. A public health response does not prove database health or production readiness.

## Current production evidence

The latest migration inputs identify the Feeldao OS Production project and confirm its static site URL and online Ops gateway. Function API URL, access domain, Supabase URL, public Ops ingress, same-origin function behavior, and custom function domain support remain `NOT_VERIFIED`.

Staging uses a separate project and URL and must not be treated as Production evidence.

## Release gates

B1 deployment to the verified target mode and B2 public `/ops/` cutover are separately authorized phases. Production rollback restores an approved target/route state and does not auto-run inverse database migrations.

## Revalidation rule

Historical URLs, ports, release SHAs, image digests, route owners, runtime values, and database identities are evidence only and require current read-only verification before operational use.

## Meoo deployment-unit evidence and current gate

The current Meoo evidence ledger is [production-evidence-gates.md](../../runbooks/production-evidence-gates.md). It separates Meoo's documented deployment modes from the deployment object actually bound to this Production project. Meoo documentation describes static Web releases and HTTP server/image deployments; Edge Functions are managed as separate function objects. This does not prove which mode or upstream currently serves this project's public paths.

Route evidence is recorded by layer: `/ops/` is an SPA/client route, `/ops/v1/*` is an API ingress, and a direct Edge Function URL is a separate ingress. Different request URLs or matching request-ID/audit shapes are behavioral observations, not proof that different handlers or services own the requests. The current `/ops/v1/*` upstream and source identity remain `NOT_VERIFIED`.

`GATES_NOT_CLEARED` is the current Production readiness state in the evidence snapshot. Release-object identity, effective runtime configuration, route ownership, an approved target-specific rollback, and a restore-verified backup remain open. A logical snapshot is a comparison baseline, not a verified backup. No deployment or migration is authorized by this documentation update.
