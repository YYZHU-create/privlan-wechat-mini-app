# QA and Test Data Context

## Historical pitfall

Browser acceptance scripts historically created timestamped synthetic users, tenants, workspaces, memberships, and subscriptions without consistently deleting them. This polluted operational views and weakened acceptance confidence.

## Durable policy

- Use an isolated database or fixed synthetic test tenant.
- Bind cleanup to immutable IDs.
- Never delete real data solely by store name.
- Treat real PrivLan business data as protected and non-disposable.
- A passing UI test is not evidence of cleanup unless cleanup is separately verified.

## Current status

Repository cleanup scripts and verification artifacts exist, but complete live test-data isolation is `OPEN` and must be revalidated before shared-environment acceptance.
