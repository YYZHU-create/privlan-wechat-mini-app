# Meoo managed authentication replacement

## Accepted scope

Replace both Merchant and Operator password authentication with Meoo Cloud / Supabase Auth. Original Operator business identifier: `ops-admin@localhost`; the user subsequently selected `516951336@qq.com` for the new Operator login. Merchant identifier also remains `516951336@qq.com`. One provider subject may have two explicit surface-specific links, preserving separate business accounts and permissions. The user confirmed that both original passwords are the same and selected retaining this password. Preserve the original business users, PRIVLAN tenant/workspace, memberships, permissions, subscriptions and media. Provider identities must be explicitly linked to permanent business identities; email equality and provider user_metadata grant no business authority.

## Current implementation milestone

Branch: `codex/meoo-managed-auth`. Source base: `945c22a18e06b85e03fb135c756f8baadce12e9e`.

`admin/managed-auth.js` implements password authentication through the existing Supabase SDK and server-side getUser validation, with separate project/surface/provider identity checks and active business-account lookup. It is an integration foundation, not yet wired into HTTP routes. Its session return is private server data and must not be serialized into API responses or logs.

The old live routes remain until the replacement can pass acceptance. Final requested architecture is managed authentication, not permanent dual password verifiers. No provider account creation, migration, remote configuration change or deployment has occurred in this milestone.

## Read-only account observations

Staging `asmhysidbg5g`: database `ra_supabase_z1ota9ew3gblan`, observed `2026-10-04 03:02:22.497774+08`.
Production `g8o5cv1om41o`: database `ra_supabase_74z0ong0wmvmwj`, observed `2026-10-04 03:03:05.591899+08`.

In each project the exact operator and merchant have one active original business record each, and zero matching auth.users records. Source: project-selected local Meoo CLI read-only count query. This establishes account existence only, not full business-data preservation or provider login acceptance.

## Verification

Baseline operator compatibility test: 4/4 PASS. Managed-auth and mapping focused tests: 14/14 PASS. Full admin suite after additive mapping: 448 tests, 444 PASS, 0 failures, 4 skipped. Syntax, whitespace and migration-manifest checks PASS. Synthetic local tests do not establish live account provisioning or login acceptance.

## Next incomplete work

1. The shared original password choice is confirmed. Await local protected input at actual provisioning time. Official Supabase migration documentation supports bcrypt/Argon2 hash imports; existing project code uses scrypt. Direct import of the existing formats is not established. Proposed procedure: local hidden entry of the selected original password, verify against its original account, submit the same password to provider. Both privileged identity links require independent authorization checks, not merely merchant password proof. No such account operation has been executed.
2. Identity mapping preparation implemented: migration 017 adds only a separate mapping table, including provider origin/project/surface uniqueness and original business foreign keys. Native and Meoo read repositories retrieve explicit identities and omit password columns. Local synthetic PostgreSQL tests prove mismatched-surface/duplicate/dangling-link rejection and denied anon/authenticated read grants; no remote migration has run.
3. Wire both login/session/logout/password and merchant registration flows to the provider with HttpOnly session cookies, refresh/revocation, CSRF, existing tenant scopes and explicit operator roles. Handle pending email confirmation without creating duplicate PRIVLAN workspaces.
4. User enters passwords only in local protected input or provider UI. No passwords or raw hash values enter task records.
5. Provision and associate the two provider identities through the reviewed target-specific procedure, then verify Staging fresh login, isolation, sessions and durable business preservation. Remove superseded password authentication after acceptance.
6. Production configuration delivery, startup protection, database compatibility and recovery conditions remain separate release gates. Existing startup-guard blockers are not closed by this adapter.

## References

- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://docs.meoo.com/untitled-page-2

## Recovery

This milestone adds an unused adapter and tests only. Existing runtime route behavior is unchanged. An isolated baseline checkout passes the original compatibility tests. Platform application rollback and database restore are not established by this source recovery check.

## Shared-password preflight milestone

The new managed-auth-migration-preflight module independently checks both original account passwords, active status, administrator role, merchant identifier and provider-account absence. It returns only an immutable identity plan, never the password/hash. Synthetic checks pass 20/20 together with provider and mapping tests. Actual account provisioning and HTTP route replacement remain incomplete. The user requires questions before ambiguous operations.

Admin suite for this milestone: 454 tests, 450 passed, 0 failed, 4 skipped. Root-wide discovery also ran and produced 8 failures in tests/privlan-merchant-login due to missing generated fixture modules with malformed Windows file URLs; that broader test setup is not reported as passing and has not been changed. No remote account or database writes occurred.
