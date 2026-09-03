# Project Roadmap

## Phase 1 — Native storefront and local editor

Status: Completed on main

- Native customer pages, custom navigation, product/cart/account experiences, and tracked design assets.
- Local Express editor, media/config management, source synchronization, generation, and development preview.

## Phase 2 — Trusted service and production-flow hardening

Status: Completed on main; production deployment still requires external configuration

- WeChat-derived identity, session binding, rate limits, and audit events.
- Appointment options/create/list/reminder flows with locks, idempotency, mirrors, and reconciliation signals.
- HTTPS-only WebView handling and explicit separation of test/production authentication.
- Provider gateway/fallback path without Mini Program model secrets.

## Phase 3 — ATELIER OS local platform boundary

Status: Prototype completed on main

- JSON-backed tenant/store/workspace state and merchant/operator API separation.
- Plan, feature, publishing, support, incident, audit, and AI-policy prototypes.
- PostgreSQL schema and TypeScript contracts as a target boundary.

## Phase 4 — SaaS persistence and merchant operations

Status: Active on unmerged `codex/atelier-os-saas-mvp`

- PostgreSQL migrations and runtime adapters.
- Merchant authentication, appointment/customer persistence, tenant isolation, Docker deployment, and operational backup/restore.
- Must pass a separate branch review and migration/rollback verification before merge.

## Phase 5 — Production platform adapters

Status: Planned

- WeChat QR login/phone binding/invitations and Open Platform code-audit publishing.
- WeChat Pay, production orders/inventory/shipping/refunds, subscriptions, and invoicing.
- TencentDB/Redis/COS/CDN/queues/KMS, monitoring, immutable audit export, backups, and recovery drills.
- RAG ingestion, malware scanning, embeddings, and production Feishu synchronization.

## Phase 6 — Production release validation

Status: Planned

- Verify domains, permissions, phone authorization, subscriptions, customer service, preview/upload/review/release, and rollback in WeChat tooling.
- Record environment-specific runbooks without committing credentials.
