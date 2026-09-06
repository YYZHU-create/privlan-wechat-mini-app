# Durable Decisions

## DEC-001
TITLE=GitHub repository is the engineering source of truth
STATUS=DECIDED
DECISION=Durable Feeldao OS engineering context belongs in the canonical GitHub repository; conversations remain temporary execution and investigation workspaces.
RATIONALE=New tasks must recover project context without depending on a mixed historical conversation.
CONSEQUENCES=Update context files when durable facts, decisions, risks, or gates change.
SUPERSEDES=Conversation-only project memory.
DATE=2026-09-06

## DEC-002
TITLE=Feeldao OS is multi-tenant SaaS
STATUS=DECIDED
DECISION=The product boundary is a multi-tenant SaaS platform for merchant workspaces, with PrivLan as the first vertical/sample.
RATIONALE=The repository contains tenant, workspace, store, membership, subscription, and operator surfaces.
CONSEQUENCES=Business behavior must preserve tenant and workspace isolation.
SUPERSEDES=Single-tenant local configuration as the product boundary.
DATE=2026-09-06

## DEC-003
TITLE=Tenant workspace store scope is mandatory
STATUS=DECIDED
DECISION=Merchant reads and writes use authenticated `tenantId`, `workspaceId`, and `storeId` scope.
RATIONALE=Prevents cross-tenant and cross-workspace access through client-supplied identifiers.
CONSEQUENCES=Routes, repositories, adapters, and tests enforce authenticated scope.
SUPERSEDES=Unscoped or client-trusted business access.
DATE=2026-09-06

## DEC-004
TITLE=Operator Merchant Customer auth are separate boundaries
STATUS=DECIDED
DECISION=Operator operations, merchant workspace operations, and customer-facing access do not share an implicit authorization boundary.
RATIONALE=Each actor has different data visibility and mutation authority.
CONSEQUENCES=Session, route, permission, and audit checks remain explicit.
SUPERSEDES=One shared application session model.
DATE=2026-09-06

## DEC-005
TITLE=Database evolution is additive
STATUS=DECIDED
DECISION=Preserve the long-lived database, persistent identities, existing migration history, and data; evolve through additive compatible migrations.
RATIONALE=Production recovery and cross-release identity continuity depend on permanent database identity.
CONSEQUENCES=No replacement database, destructive reset, migration rewrite, or automatic inverse migration for rollback.
SUPERSEDES=Database replacement or schema rebuild as a release strategy.
DATE=2026-09-06

## DEC-006
TITLE=Production readiness requires authenticated gates
STATUS=DECIDED
DECISION=Public `/health` is liveness only. Production readiness requires controlled Operator authentication, `/ops/v1/health`, session verification, and audit confirmation.
RATIONALE=A process can be alive while database, session, route ownership, or authorization is incorrect.
CONSEQUENCES=Do not report production readiness from a single public health response.
SUPERSEDES=Health-only release acceptance.
DATE=2026-09-06

## DEC-007
TITLE=Template Center is distinct from legacy Global Settings
STATUS=DECIDED
DECISION=Template Center is a separate architecture and is not a rename of historical Global Settings.
RATIONALE=Template lifecycle, versioning, preview, apply, restore, and migration compatibility have separate semantics.
CONSEQUENCES=Legacy configuration compatibility must be documented before migration or implementation claims.
SUPERSEDES=Global Settings as the final template architecture.
DATE=2026-09-06

## DEC-008
TITLE=Evidence is bound to execution identity
STATUS=DECIDED
DECISION=Test and deployment evidence identifies repository, branch, commit, runtime, and database identity.
RATIONALE=Multiple checkouts, ports, and database paths previously produced conflicting observations.
CONSEQUENCES=Historical runtime observations are not current truth without revalidation.
SUPERSEDES=Unbound screenshots, logs, or one-time HTTP checks as release evidence.
DATE=2026-09-06

## DEC-009
TITLE=Real PrivLan data is not a disposable test fixture
STATUS=DECIDED
DECISION=Use synthetic or isolated test tenants and never delete data solely by a human-readable store name.
RATIONALE=Historical browser QA created persistent test tenants and risked confusing test data with real business data.
CONSEQUENCES=QA cleanup and isolation must be explicit and auditable.
SUPERSEDES=Shared production-like data for routine browser testing.
DATE=2026-09-06

## DEC-010
TITLE=Canonical context excludes transient debugging material
STATUS=DECIDED
DECISION=Temporary ports, one-off errors, secrets, credentials, speculative conclusions, and chat transcripts do not belong in canonical context.
RATIONALE=Canonical memory must remain concise, current, and safe to reuse.
CONSEQUENCES=Retain historical details only when they explain a durable decision, root cause, limitation, or open gate.
SUPERSEDES=Conversation transcript as documentation.
DATE=2026-09-06

## DEC-011
TITLE=Separate architecture, audit, implementation, and production records
STATUS=DECIDED
DECISION=Architecture decisions, audit findings, implementation work, and production acceptance remain separate records with explicit evidence status.
RATIONALE=Mixed conversation threads otherwise make historical proposals and incomplete checks appear to be current implementation or acceptance evidence.
CONSEQUENCES=Canonical context records durable decisions and current gates; implementation and production tasks must link their evidence without collapsing statuses.
SUPERSEDES=Mixed conversation as the sole project status record.
DATE=2026-09-06
