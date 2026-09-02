# ATELIER OS Production Smoke Contract

## READ_ONLY_SMOKE
1. GET /health returns HTTP 200, database=ok, exact release SHA, environment=production.
2. Merchant session availability and bootstrap using a dedicated controlled account.
3. Operator health/login surface using a dedicated operator account.
4. Customer, appointment, membership, workflow, media, marketing, and AI read endpoints.
5. Anonymous core reads/writes and provider RPC attempts remain denied.

## CONTROLLED_WRITE_SMOKE
Use only disposable production smoke tenant/workspace/customer records:
- merchant login/session/logout/relogin
- customer note/tag write and readback
- appointment create/status/follow-up with synthetic service/advisor
- membership points/evaluation/redemption with synthetic customer
- workflow draft/publish/execute/failure/retry with synthetic workflow
- media upload/invalid upload/delete/reference check
- marketing audience/offer/campaign issue/redeem/duplicate protection
- AI generate/validate/preview/refine/apply/explicit save/quota/audit

Every write is tagged production-smoke, has an idempotency key, and is removed after verification. Real customer records are excluded.
