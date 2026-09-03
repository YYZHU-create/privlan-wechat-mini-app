# Feeldao OS Deployment

Current Production procedures are maintained in [docs/runbooks/production-deployment.md](docs/runbooks/production-deployment.md), [docs/runbooks/production-rollback.md](docs/runbooks/production-rollback.md), and [docs/runbooks/production-inputs.md](docs/runbooks/production-inputs.md).

`/health` is a public liveness endpoint that returns only `{"status":"ok"}`. Production readiness requires the authenticated Operator health, login, session, and audit gates documented in the deployment runbook.

Internal `ATELIER_*` environment variables remain compatibility identifiers. Deployment metadata is supplied through verified environment values or a build-generated `runtime-build.json`; stale repository release files are not trusted.
