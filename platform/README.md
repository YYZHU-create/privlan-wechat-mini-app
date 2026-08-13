# ATELIER OS platform foundation

The current Express/Vue editor remains the compatibility application. The files in this directory define the first stable SaaS boundary so the editor can be migrated without changing generated mini-program behavior all at once.

## Implemented locally

- ATELIER OS merchant shell and platform-operations workspace.
- Tenant/store scoped `/v1` read APIs.
- Configurable plan entitlements and publishing records.
- DeepSeek proxy with FAQ fallback and deterministic sensitive actions.
- Shared and merchant AppID channel states in the release workspace.
- PostgreSQL/pgvector schema and TypeScript public contracts.

## Production adapters still required

- WeChat QR login, phone binding and invitation flows.
- TencentDB PostgreSQL, Redis, COS/CDN, queue workers and KMS.
- WeChat Open Platform authorization and code-audit publishing jobs.
- WeChat Pay service-provider/sub-merchant onboarding and merchant payment callbacks.
- Production order, inventory, shipping, refunds, subscriptions and invoicing.
- RAG document ingestion, malware scanning, embeddings and Feishu sync jobs.
- Monitoring, immutable audit export, backups, recovery drills and legal pages.

Never place DeepSeek, Feishu, WeChat or payment secrets in frontend configuration or generated mini-program files.
