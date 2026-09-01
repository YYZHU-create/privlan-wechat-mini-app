# ATELIER OS AI Development Prompt Registry

## Objective

Store project-level AI development prompts under `docs/prompts/<sprint-name>.md` and require Codex to read the applicable Sprint prompt before implementation.

## Sprint Prompt Standard

Every Sprint prompt must define:

- Objective
- Scope
- Out Of Scope
- Architecture Rules
- Database Rules
- Security Rules
- Test Requirements
- Release Gate

## Database Stability

ATELIER OS is a long-lived SaaS. The production database evolves only through additive migrations. Existing data and permanent user, tenant, workspace, customer, and order identifiers must remain stable.

Core tables `users`, `memberships`, `tenants`, `workspaces`, and `merchant_sessions` require explicit review before any feature change.

## Sprint Execution Flow

1. Read the applicable Sprint prompt.
2. Produce a Context Report from files actually read.
3. Produce an Implementation Plan.
4. Confirm database, authentication, migration, and tenant-isolation impact.
5. Wait for approval before implementation.
6. After implementation, produce a Release Checkpoint with observed evidence.

## Registered Prompts

- `sprint-3a-workflow-runtime.md`
