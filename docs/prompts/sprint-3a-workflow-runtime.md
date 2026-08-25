# ATELIER OS Sprint 3A Workflow Runtime Core

## Objective

Implement a generic Workflow Runtime Core as a reusable ATELIER OS platform capability.

## Scope

- Workflow Definition
- Workflow Version
- Workflow Instance
- Workflow Task
- Workflow Event
- Workflow Audit

## Out Of Scope

- BPMN
- Workflow Builder
- AI Workflow Generator
- Marketplace
- Complex rules engine

## Architecture Rules

- Keep the runtime domain-neutral and reusable across tenants and workspaces.
- Do not encode PrivLan, fashion, beauty, or other industry-specific process branches.
- Preserve existing Merchant OS module boundaries and Sprint 1/Sprint 2 behavior.
- Require explicit state transitions and append-only event/audit history.

## Database Rules

- Add only new Workflow-related migration files after existing migration `007`.
- Use additive, forward-compatible PostgreSQL changes.
- Preserve all existing data and stable identifiers.
- Keep every runtime record scoped by `tenant_id` and `workspace_id`; use `store_id` only where the workflow explicitly belongs to a store.
- Do not modify `users`, `memberships`, `tenants`, `workspaces`, or `merchant_sessions`.
- Do not replace the database, rebuild the schema, delete migration history, or rewrite an existing migration.

## Security Rules

- Resolve tenant, workspace, user, and role from the authenticated merchant session rather than request-supplied scope identifiers.
- Enforce tenant and workspace scope on every read and write.
- Validate transitions and task mutations server-side.
- Record actor, action, target, timestamp, and scoped metadata in audit events without secrets or credentials.

## Test Requirements

Before implementation, establish passing baselines for:

- `AUTH_LOGIN_EXISTING_USER`
- `SESSION_RESTORE`
- `WORKSPACE_LOAD`
- `TENANT_ISOLATION`

Implementation tests must cover definition/version immutability, instance transitions, task lifecycle, append-only events, audit records, concurrency/idempotency, invalid transitions, and cross-tenant/workspace denial.

## Release Gate

- `DATABASE_IDENTITY_MATCH=PASS`
- `MIGRATION_ONLY=PASS`
- `AUTH_LOGIN_EXISTING_USER=PASS`
- `SESSION_RESTORE=PASS`
- `WORKSPACE_LOAD=PASS`
- `USER_LOGIN_REGRESSION=PASS`
- `TENANT_ISOLATION=PASS`
- `EXISTING_DATA_COUNT_MATCH=PASS`
- `ROLLBACK_PLAN_EXISTS=PASS`

No gate may be reported as passing without observed evidence. Sprint 3A implementation starts only after the Context Report and Implementation Plan are approved.
