# Meoo and Database Context

## Database policy

The SaaS database has permanent identity and evolves through additive migrations. The repository architecture protects existing migrations and data.

## Current Meoo B1 evidence

The latest available target read-stability record reports:

- Workflow Versions DB query: `PASS`
- Workflow Versions REST attempt 1: `FAIL_FETCH_FAILED`
- Workflow Versions REST attempts 2 and 3: `PASS`
- Users, Customers, Appointments: `PASS` on all three attempts
- Target service-role read path: `UNSTABLE`
- Pre-cutover target preflight: `NOT_RUN`
- Safe to resume T2: `NO`
- T2 cutover: `NOT_RUN`

Source: `C:\Users\Administrator\WorkBuddy\2026-08-31-meoo-b1-deployment-readiness\verification\meoo-b1-target-rest-read-stability\VERIFICATION.txt`.

## Interpretation

Earlier historical cutover or parity claims are superseded where they conflict with this evidence. This file records the current gate, not a successful cutover.

## Safe rules

No database replacement, destructive reset, migration-history rewrite, or cutover execution belongs in a context migration.
