# ATELIER OS Production Deployment Runbook

## PRE-PRODUCTION
- Approve a dedicated Production Meoo project distinct from asmhysidbg5g.
- Record project/database identity and provider version.
- Configure production secrets in the approved Secret Manager; do not send values in chat or Git.
- Confirm migration manifest 001-012 plus provider migrations 001-003.
- Create and verify an off-site database backup and media backup relationship.
- Bind monitoring/alert destination, domain, TLS, and edge policy.

## DEPLOYMENT
- Assert exact committed RC SHA b8afbe2e595ddb572eb41a05c559bfc4b9f54454 or a newly reverified RC SHA.
- Run read-only migration preflight.
- Deploy image once to the dedicated Production project.
- Apply only reviewed pending schema migrations in deterministic order.
- Execute READ_ONLY_SMOKE and CONTROLLED_WRITE_SMOKE.

## AUTHORITY BARRIER
Human approval is required before production writes, schema deployment, data import, or public traffic switch.

## POST-RELEASE
Observe health, 5xx, latency, auth, workflow, marketing, AI, media, database, storage, and backup alerts; confirm backup after the observation window.

## ROLLBACK
Use production-rollback-runbook.md and preserve the authoritative database until reconciliation is complete.
