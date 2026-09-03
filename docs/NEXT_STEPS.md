# Next Steps

## Priority 1

Review `codex/atelier-os-saas-mvp` separately against current `main`: rerun its database, authentication, tenant-isolation, deployment, migration, and rollback tests before deciding whether to merge.

## Priority 2

Perform WeChat DevTools and test-device validation for routing, phone authorization, appointments, reminders, WebView domains, customer service, upload/review, and release behavior.

## Priority 3

Define the first production adapter deployment—database, secret/KMS handling, ingress/TLS, storage, monitoring, backups, and recovery—without promoting local JSON prototype state as production persistence.

## Blocked

- Production WeChat, Feishu, cloud collection, domain, template, and provider checks require deployment-owner credentials and platform access.
- Physical-device and release validation requires WeChat DevTools and authorized test accounts.

## Do Not Start Yet

- Do not claim that a generated project or preview QR code is uploaded, reviewed, or released.
- Do not copy branch-only PostgreSQL/SaaS capabilities into current-state documentation before merge.
- Do not expose provider, Feishu, WeChat, payment, gateway, or customer secrets in generated files or Git.
