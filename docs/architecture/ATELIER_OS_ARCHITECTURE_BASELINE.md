# ATELIER OS Architecture Baseline

## 1. Platform Overview

ATELIER OS is a multi-tenant SaaS platform for merchant workspaces.

Core principles:

- **Permanent Database Identity**: the long-lived SaaS database and stable identifiers remain continuous across releases.
- **Additive Migration Only**: schema evolution adds compatible tables, columns, indexes, and constraints without replacing the database or rewriting migration history.
- **Domain Boundary**: Customer, Appointment, Staff/Operation, Commerce, and Workflow responsibilities remain explicit.
- **Tenant Isolation**: every merchant read and write is scoped to the authenticated tenant and workspace.
- **Authentication Stability**: existing merchant login, session restoration, CSRF, and workspace loading remain protected release gates.

## 2. Current Architecture

```text
ATELIER OS
|
├── SaaS Core
|   ├── Authentication
|   ├── Tenant
|   ├── Workspace
|   ├── Session
|   └── Permission
|
├── Customer Domain
|
├── Appointment Domain
|
├── Operation Engine
|   ├── Staff
|   ├── Capability
|   ├── Schedule and Leave
|   └── Resource and Conflict Control
|
└── Workflow Runtime
    ├── Definition
    ├── Version
    ├── Instance
    ├── Task
    ├── Event
    └── Audit Integration
```

## 3. SaaS Core

SaaS Core owns:

- User identity
- Tenant identity
- Workspace identity
- Merchant sessions
- Permissions and authenticated merchant scope

Protected tables:

- `users`
- `memberships`
- `tenants`
- `workspaces`
- `merchant_sessions`

Business modules must not break or replace the identity system. Merchant APIs derive tenant and workspace scope from the authenticated merchant session rather than trusting client-supplied scope identifiers.

## 4. Sprint 1 Foundation

Sprint 1 established the Customer and Appointment domain foundations:

- Customer 360
- Appointment foundation
- Customer scope isolation
- Appointment availability
- Appointment timeline
- Follow-up records and idempotency

These capabilities provide the base customer identity, scheduling, and history surfaces used by later platform modules.

## 5. Sprint 2 Operation Engine

Sprint 2 completed the Operation Engine foundation:

- Staff
- Staff assignment
- Capability
- Schedule
- Leave
- Resource foundation
- Appointment conflict control
- Audit coverage

The Operation Engine provides the people, resources, and time capabilities required to fulfill appointments while preserving existing Appointment behavior.

## 6. Sprint 3A Workflow Runtime

Sprint 3A completed the generic Workflow Runtime Core:

- Workflow Definition
- Workflow Version
- Workflow Instance
- Workflow Task
- Workflow Event
- Existing audit integration

Workflow Runtime is a reusable platform capability. It is domain-neutral and does not encode industry workflows.

The runtime explicitly excludes:

- Fashion hardcoding
- Beauty hardcoding
- Industry-specific workflow `if/else` branches
- BPMN
- Workflow Builder
- AI Workflow Generator
- Marketplace behavior
- Complex rules-engine behavior

Published Workflow Versions are database-protected as immutable. Instances bind to an exact version, idempotent starts are scoped by tenant/workspace/key, and event sequence allocation is transaction-safe.

## 7. Domain Boundary

Workflow Runtime does not own:

- Customer business logic
- Appointment business logic
- Staff business logic
- Commerce logic

Workflow connects to business domains through:

- Events
- Stable references
- Adapters

This preserves domain ownership while allowing future Workflow Domain Integration.

## 8. Database Architecture

ATELIER OS uses a permanent, long-lived SaaS database.

Forbidden database operations:

- Replacing the database
- Rebuilding the schema
- Import/export replacement of live data
- Deleting migration history
- Rewriting existing migrations

Allowed evolution:

- Additive migrations
- New tables
- New nullable or compatible fields
- New indexes
- Compatible constraints and relationships

Migration state:

- Sprint 1 migrations established SaaS Core, workspace resources, appointments, and initial platform capabilities.
- Sprint 2 migrations established the Operation Engine foundation.
- Sprint 3A Migration `008_workflow_runtime.sql` adds Workflow Runtime tables and constraints only.
- Existing protected SaaS and business table data remains stable across the Sprint 3A release.

## 9. Security Architecture

The merchant authentication boundary consists of:

- Merchant Session
- CSRF protection for mutations
- Tenant scope enforcement
- Workspace scope enforcement
- Server-side transition and authorization checks
- Existing audit event recording

Release changes must preserve:

- `AUTH_REGRESSION`
- Session restoration
- Workspace loading
- Tenant isolation

Workflow routes inherit the authenticated merchant middleware and do not expose public Workflow Definition CRUD.

## 10. Future Roadmap

- **Sprint 3B** — Workflow Domain Integration
- **Sprint 4** — Commerce Engine
- **Sprint 5** — Membership
- **Sprint 6** — Marketing
- **Sprint 7** — Template Center
- **Sprint 8** — AI Agent
