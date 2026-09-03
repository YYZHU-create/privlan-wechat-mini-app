# Current Project State

Last Verified: 2026-08-15
Code Baseline Commit: `6aa0a28e957cee489fb4bcdf07600c920d6e5032` (`origin/main` at verification time)
Document Branch: `codex/dev-remote-context`

## Current Phase

The native Mini Program, cloud-function service flows, and local editor/generator are working repository capabilities. Production-flow hardening is present on `main`. ATELIER OS has a local JSON-backed platform/API prototype on `main`, while the PostgreSQL/deployment/merchant-auth implementation remains on the separate unmerged branch `codex/atelier-os-saas-mvp`.

This documentation branch changes durable project memory only and does not change runtime behavior.

## Completed on Main

- Native Mini Program pages cover home, category, campaign, cart, product detail, account, appointment, appointment history, service chat, and HTTPS WebView flows.
- WeChat Cloud functions handle customer authentication, service bootstrap/query, appointments, reminders, and measurement lookup.
- Trusted functions derive identity from `cloud.getWXContext().OPENID`; customer sessions are bound to that identity.
- Production authentication defaults to WeChat mode. Test verification requires both `AUTH_MODE=test` and `TEST_AUTH_CODE`.
- Appointment creation uses rate limits, request/capacity locks, audit events, a customer-visible mirror, and explicit reconciliation-required events for partial external failures.
- The local Express admin tool edits store content/design, synchronizes generated Mini Program files, manages media, and drives WeChat DevTools development preview.
- The local platform prototype exposes tenant/store-scoped merchant APIs, isolated operator APIs, plan/feature data, publishing records, and provider-neutral OpenAI-compatible AI routing backed by local JSON state.
- AI provider endpoints are validated against unsafe destinations; provider secrets remain server-side and public responses omit them.

## Active Unmerged Work

- `codex/atelier-os-saas-mvp` is ahead of `main` and contains PostgreSQL migrations/runtime adapters, merchant authentication, appointment/customer SaaS work, Docker deployment, backup/restore scripts, and broader tenant-isolation tests.
- None of those branch-only capabilities are part of the `main` or production baseline until separately reviewed, tested, and merged.

## Known Issues and Verification Gaps

- The `main` platform state is local JSON/prototype storage, not a production PostgreSQL service.
- WeChat QR login, payment, automatic code-audit publishing, production object storage/CDN, queues, KMS, monitoring, immutable audit export, and disaster-recovery drills are not production-complete.
- Mini Program routing, permissions, phone authorization, subscription messages, WebView domains, customer service, upload/review, and physical-device behavior require WeChat DevTools and device validation.
- Production Feishu tables, WeChat cloud collections, environment values, domains, and templates are deployment-owned and cannot be proven from source alone.
- Repeated cloud-function common helpers create maintenance drift risk.

## Important Constraints

- Never accept client-provided identity or expose provider, Feishu, WeChat, payment, or gateway secrets to the Mini Program.
- Generated previews and development QR codes are not production releases.
- Preserve appointment idempotency, capacity locking, audit, mirror, and reconciliation behavior.
- Keep `main` status and unmerged feature-branch status explicit in every project-state update.

## Current Production / Development State

- Mini Program development: import the repository root in WeChat DevTools; personal settings stay in untracked `project.private.config.json`.
- Local admin development: `cd admin && npm ci && npm start`.
- Cloud deployment: create the documented collections and configure environment variables before deploying functions.
- Verification on 2026-08-15: 33 admin tests, 14 focused AI tests, syntax checks for every tracked JavaScript file, `git diff --check`, and npm audit (0 vulnerabilities) passed. WeChat DevTools, physical devices, and production cloud services remain unverified in this environment.
