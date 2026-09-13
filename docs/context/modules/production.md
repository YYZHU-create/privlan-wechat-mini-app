# Production Context

## Runtime contract

The repository production runbook defines a Node.js `>=22 <25` compatibility contract, with Node.js 22 as the `.node-version` and Docker baseline, and pnpm `10.33.3` for the Meoo image builder. The builder supplies Node.js 24.15.0 / pnpm 10.33.3 on Linux `/code` as root. A public health response does not prove database health or production readiness.

## Current production evidence

The latest migration inputs identify the Feeldao OS Production project and confirm its static site URL and online Ops gateway. Function API URL, access domain, Supabase URL, public Ops ingress, same-origin function behavior, and custom function domain support remain `NOT_VERIFIED`.

Staging uses a separate project and URL and must not be treated as Production evidence.

## Release gates

B1 image deployment and B2 public `/ops/` cutover are separately authorized phases. Production rollback restores approved image/route state and does not auto-run inverse database migrations.

## Revalidation rule

Historical URLs, ports, release SHAs, image digests, route owners, runtime values, and database identities are evidence only and require current read-only verification before operational use.
