# Canonical Project Context

## Product identity

- Feeldao OS is a multi-tenant SaaS platform for merchant workspaces.
- PrivLan is the first vertical/sample product represented in this repository.
- Existing internal code and documents may use the historical `ATELIER OS` name; this is an internal naming boundary, not evidence of a separate runtime product.
- Operator, Merchant, and Customer surfaces have separate responsibilities and authorization boundaries.

## System boundaries

- **Operator** manages platform-level operations, tenant/workspace directory, subscriptions, licenses, audit visibility, and system health.
- **Merchant** operates an authenticated tenant/workspace/store and manages configuration, products, media, appointments, customers, and publishing inputs.
- **Customer** uses generated mini-program and customer-facing surfaces and must not receive merchant or operator scope.
- Business modules derive scope from the authenticated session rather than trusting client-supplied scope identifiers.

## Core scope model

```text
tenantId -> workspaceId -> storeId
```

Membership, role, subscription, license, audit, and business records preserve this boundary.

## Technology boundary

The repository contains a compatibility Express/Vue merchant editor and platform-operations surface, WeChat mini-program code, Node.js services, PostgreSQL/pgvector schema and migrations, Meoo/Supabase adapters, and platform contracts.

Repository runtime requirements on `origin/main`:

- Node.js `22.x`
- pnpm `11.7.0`
- public liveness at `/health`
- authenticated readiness at `/ops/v1/health`

## Data and release principles

- The SaaS database and persistent identities are long-lived.
- Schema evolution is additive and backward compatible.
- Existing migrations and persistent data are not replaced or rewritten.
- Production readiness requires authenticated gates; `/health` alone is insufficient.
- Secrets belong in approved secret/platform storage, never in frontend configuration, generated mini-program files, tickets, or canonical context.
- Test evidence must bind repository, branch, commit, runtime, and database identity.

## Context rule

Conversations are temporary execution and investigation workspaces. Keep historical details only when they explain a durable decision, compatibility constraint, root cause, limitation, or unresolved gate. Use `CURRENT_STATE.md` and newer verified evidence for present state.
