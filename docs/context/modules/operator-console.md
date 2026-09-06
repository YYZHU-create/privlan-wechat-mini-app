# Operator Console Context

## Boundary

The Operator Console is a platform-operations surface, separate from Merchant editing. It covers tenant/workspace directory, subscriptions, licenses, audit visibility, and system health.

## Health behavior

- `/health` is public liveness.
- `/ops/v1/health` requires Operator authentication.
- The readiness gate includes controlled login, session verification, and audit confirmation.
- The console must not display secrets, credentials, full license codes, or production configuration.

## Status

The historical RC review remains evidence-incomplete. Current route ownership and public ingress are `NOT_VERIFIED` even though the latest supplied production evidence reports the Ops gateway online.
