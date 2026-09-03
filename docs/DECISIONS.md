# Architecture and Project Decisions

Historical decision dates are not recoverable for every item. Unless a commit is cited, the original date is unknown and the decision was recorded here on 2026-08-15.

## DEC-001 — Keep the customer application native to WeChat

Status: Active
Decision: Maintain the customer experience as a native Mini Program with WeChat project configuration, pages, components, and cloud-function integration.

Reason: Authentication, subscriptions, preview, review, and device capabilities depend on the WeChat runtime.
Alternatives Considered: Replace the client with a generic mobile web application.
Impact: Routing and device behavior require WeChat DevTools/device validation; browser-only tests are insufficient.
Evidence: `app.json`, `project.config.json`, `pages/`, `cloudfunctions/`.

## DEC-002 — Derive identity at the trusted WeChat boundary

Status: Active
Decision: Use `cloud.getWXContext().OPENID` and bind sessions/records to it; do not accept a client-supplied `openId`.

Reason: A client-provided identity could expose another customer's appointments or measurements.
Alternatives Considered: Pass `openId` from Mini Program requests.
Impact: Identity-sensitive reads and writes must remain in cloud/server code and require focused authorization tests.
Evidence: `cloudfunctions/customerAuth/`, `appointmentList/`, `customerMeasurements/`.

## DEC-003 — Preserve appointment idempotency and reconciliation

Status: Active
Decision: Coordinate request locks, capacity locks, external Feishu changes, local mirrors, audit events, and reconciliation-required states.

Reason: Retries and partial external failures can otherwise duplicate appointments or silently desynchronize slot capacity.
Alternatives Considered: A single unguarded Feishu create/update sequence.
Impact: Changes to appointment creation must retain failure-phase evidence and safe retry behavior.
Evidence: commit `6aa0a28`, `cloudfunctions/appointmentCreate/`, `admin/test/appointment.test.js`.

## DEC-004 — Keep the existing local editor as the compatibility application

Status: Active
Decision: Continue using the local Express editor/generator while defining platform contracts around it.

Reason: Existing content, design, synchronization, and Mini Program generation behavior must survive platform migration.
Alternatives Considered: Rewrite the editor and generated output simultaneously.
Impact: SaaS migration must preserve generated Mini Program compatibility and provide explicit legacy import/rollback paths.
Evidence: `admin/server.js`, `admin/sync.js`, `platform/README.md`.

## DEC-005 — Treat preview and production publishing as different operations

Status: Active
Decision: Generated projects and WeChat DevTools preview QR codes are development artifacts only.

Reason: Production requires upload, platform review, domains, permissions, and release steps that preview cannot prove.
Alternatives Considered: Present a successful preview as a production release.
Impact: UI and documentation must not claim upload/review/publish success from preview output.
Evidence: `admin/server.js`, `cloudfunctions/README.md`, `README.md`.

## DEC-006 — Route AI through a provider-neutral server boundary

Status: Active
Decision: Support OpenAI-compatible providers through a server-side gateway, with scoped policy, protected secrets, URL safety checks, and rules/FAQ fallback.

Reason: Merchants need provider flexibility without exposing keys or allowing unsafe network destinations from the client.
Alternatives Considered: Embed one provider and API key in the Mini Program.
Impact: Provider secrets remain write-only/server-side; sensitive actions stay deterministic and audited.
Evidence: `admin/ai-gateway.js`, `admin/platform-store.js`, `admin/server.js`, `cloudfunctions/serviceQuery/`.

## DEC-007 — Do not promote branch-only SaaS work into current state

Status: Active
Decision: Keep PostgreSQL/deployment/merchant-auth work on `codex/atelier-os-saas-mvp` classified as unmerged until reviewed and merged.

Reason: Repository branch existence is not proof that code is available on `main` or deployed.
Alternatives Considered: Document the most advanced branch as production state.
Impact: Project memory must always name the code baseline and separate active branch work from current capabilities.
Evidence: Git comparison between `origin/main` and `origin/codex/atelier-os-saas-mvp`.
