# ATELIER OS Sprint 3B Workflow Domain Integration

## Objective

Integrate the existing Customer and Appointment domains with the Sprint 3A Workflow Runtime Core without moving business ownership into Workflow Runtime.

Sprint 3B should make domain events capable of starting or advancing generic workflows, generate runtime tasks from approved integration mappings, and preserve the existing audit trail and tenant/workspace security boundary.

## Scope

- Appointment lifecycle events that can be consumed by Workflow Runtime.
- Customer follow-up workflow integrations.
- Server-side task generation from approved domain events and workflow references.
- Audit integration for workflow-triggered domain actions and task generation.
- Idempotent event-to-workflow handling.
- Tenant/workspace-scoped integration adapters and event payloads.
- Documentation and tests for event contracts and integration behavior.

## Out Of Scope

- Workflow Builder
- AI workflow generation
- Marketing automation
- Commerce logic
- BPMN or visual workflow editing
- Industry-specific workflow branches
- Reimplementation of Customer, Appointment, Staff, or Commerce business rules inside Workflow Runtime

## Architecture Rules

- Keep Workflow Runtime generic and domain-neutral.
- Customer and Appointment services remain the owners of their business state and validation rules.
- Integrations use domain events, stable references, and adapters; they must not duplicate domain mutation logic.
- `workflow-service.js` remains limited to runtime orchestration, instance/task transitions, event persistence, and audit coordination.
- Event consumers must be idempotent and safe to retry.
- Workflow task generation must bind to an immutable Workflow Version and the authenticated tenant/workspace scope.
- Existing Sprint 1, Sprint 2, and Sprint 3A module boundaries and behavior remain compatible.
- No client-supplied tenant, workspace, user, or actor identity may override authenticated session scope.

## Integration Contract Rules

- Appointment events must identify the event type, appointment reference, tenant, workspace, actor, timestamp, and a bounded payload.
- Customer follow-up integrations must reference the existing customer and appointment records without copying ownership of those records into Workflow tables.
- Event delivery must define duplicate handling, retry behavior, and terminal failure behavior before implementation.
- Task generation must be deterministic for the same event and idempotency key.
- Audit records must identify the originating event, workflow instance/task, actor, action, timestamp, and scoped metadata without secrets or credentials.

## Database Rules

- Use additive PostgreSQL migrations only when integration persistence requires new tables, indexes, or compatible fields.
- Do not replace the database, rebuild the schema, delete migration history, or rewrite existing migrations.
- Do not modify or repurpose `users`, `memberships`, `tenants`, `workspaces`, or `merchant_sessions`.
- Preserve all existing Customer, Appointment, Staff, Workflow, tenant, workspace, and user identifiers.
- Prefer append-only integration event records and unique idempotency constraints.
- Do not execute a migration during preparation or documentation-only work.

## Security Rules

- Resolve tenant, workspace, user, role, and actor identity from the authenticated merchant session or trusted server-side event context.
- Enforce tenant/workspace scope on event publication, consumption, task generation, reads, and writes.
- Reject cross-tenant or cross-workspace event references before creating or advancing a Workflow instance.
- Preserve Merchant Session, CSRF, authorization, and existing API boundary behavior.
- Record scoped audit metadata without passwords, tokens, API keys, or other credentials.

## Test Requirements

Before implementation, establish passing baselines for:

- `AUTH_LOGIN_EXISTING_USER`
- `SESSION_RESTORE`
- `WORKSPACE_LOAD`
- `TENANT_ISOLATION`
- Sprint 3A Workflow Runtime lifecycle and concurrency tests

Integration tests must cover:

- Appointment event publication and schema validation.
- Customer follow-up event to Workflow instance/task generation.
- Duplicate event delivery and idempotent task generation.
- Invalid transitions and missing domain references.
- Cross-tenant/workspace event denial.
- Audit records for event consumption, instance creation, and task generation.
- Existing Customer, Appointment, Staff, Authentication, and Workflow regressions.
- Retry and terminal failure behavior without duplicate instances or tasks.

## Release Gate

- `DATABASE_IDENTITY_MATCH=PASS`
- `MIGRATION_ONLY=PASS`
- `AUTH_LOGIN_EXISTING_USER=PASS`
- `SESSION_RESTORE=PASS`
- `WORKSPACE_LOAD=PASS`
- `USER_LOGIN_REGRESSION=PASS`
- `CUSTOMER_REGRESSION=PASS`
- `APPOINTMENT_REGRESSION=PASS`
- `STAFF_REGRESSION=PASS`
- `WORKFLOW_REGRESSION=PASS`
- `WORKFLOW_INTEGRATION=PASS`
- `TENANT_ISOLATION=PASS`
- `EXISTING_DATA_COUNT_MATCH=PASS`
- `ROLLBACK_PLAN_EXISTS=PASS`

No gate may be reported as passing without observed evidence. Sprint 3B implementation starts only after the Context Report and Scope Proposal are reviewed and approved.
