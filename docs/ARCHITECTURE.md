# Current Architecture

## Native Mini Program

- The repository root is a native WeChat Mini Program project configured by `app.json` and `project.config.json`.
- `pages/` contains customer-facing screens; `components/` and `custom-tab-bar/` hold shared UI.
- `utils/` contains local configuration and client adapters. Client code calls cloud functions or configured HTTPS services and must not carry service credentials.
- `images/` and `design-assets/` are tracked source assets; generated or personal developer settings remain local.

## Trusted cloud boundary

- `cloudfunctions/` contains customer authentication, service/FAQ, appointment, reminder, and measurement functions.
- Functions derive WeChat identity from `getWXContext().OPENID`, enforce rate limits, bind sessions to that identity, and write privacy-reduced audit data.
- Appointment creation coordinates Feishu records, slot counters, request/capacity locks, local mirrors, and reconciliation audit events.
- The AI service function can call the configured ATELIER gateway; unavailable gateway/model paths fall back to rules/FAQ behavior.
- WeChat cloud collections, Feishu tables, subscription templates, and secrets are deployment configuration, not Git content.

## Local editor and generator

- `admin/server.js` is the local Express entrypoint and serves the browser operations/editor UI under `admin/public/`.
- Admin modules manage local configuration, media, design data, AI connections, synchronization, generation, QA, and preview.
- Synchronization writes approved editor configuration into Mini Program source files. Preview creates a development project and invokes the WeChat DevTools CLI to produce a temporary QR code.
- Preview does not upload a release, submit code review, configure production domains, or publish a Mini Program.

## ATELIER OS boundary on main

- `admin/platform-store.js` provides local JSON-backed workspace, tenant, plan, operator, AI policy, publishing, support, incident, and audit state.
- `/v1` merchant endpoints are tenant/store scoped; `/ops/v1` endpoints serve a separate operator surface.
- `admin/ai-gateway.js` implements a provider-neutral OpenAI-compatible request boundary with URL validation, timeout/error normalization, and server-side secrets.
- `platform/contracts.ts` and `platform/schema.sql` describe the intended public and PostgreSQL boundary. They do not prove that `main` is using PostgreSQL.

## Unmerged SaaS implementation boundary

- `codex/atelier-os-saas-mvp` adds PostgreSQL migrations/adapters, merchant authentication, appointment/customer SaaS persistence, Docker artifacts, and operational scripts.
- This branch is an active implementation candidate, not part of the current `main` architecture. Its design becomes current only after a separate review, verification, and merge.

## External and security boundaries

- WeChat Open Platform, WeChat Pay, Feishu, cloud databases, provider models, KMS, object storage/CDN, queues, and monitoring are external systems.
- Secrets belong in local/cloud environment configuration and must never be emitted into generated Mini Program files.
- Customer identity, appointments, measurements, and model access cross only trusted server/cloud boundaries.
