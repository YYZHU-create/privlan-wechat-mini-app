# Meoo managed authentication replacement

## Accepted scope

Replace both Merchant and Operator password authentication with Meoo Cloud / Supabase Auth. Operator identifier: `ops-admin@localhost`; merchant identifier: `516951336@qq.com`. Preserve the original business users, PRIVLAN tenant/workspace, memberships, permissions, subscriptions and media. Provider identities must be explicitly linked to permanent business identities; email equality and provider user_metadata grant no business authority.

## Current implementation milestone

Branch: `codex/meoo-managed-auth`. Source base: `945c22a18e06b85e03fb135c756f8baadce12e9e`.

`admin/managed-auth.js` implements password authentication through the existing Supabase SDK and server-side getUser validation, with separate project/surface/provider identity checks and active business-account lookup. It is an integration foundation, not yet wired into HTTP routes. Its session return is private server data and must not be serialized into API responses or logs.

The old live routes remain until the replacement can pass acceptance. Final requested architecture is managed authentication, not permanent dual password verifiers. No provider account creation, migration, remote configuration change or deployment has occurred in this milestone.

## Read-only account observations

Staging `asmhysidbg5g`: database `ra_supabase_z1ota9ew3gblan`, observed `2026-10-04 03:02:22.497774+08`.
Production `g8o5cv1om41o`: database `ra_supabase_74z0ong0wmvmwj`, observed `2026-10-04 03:03:05.591899+08`.

In each project the exact operator and merchant have one active original business record each, and zero matching auth.users records. Source: project-selected local Meoo CLI read-only count query. This establishes account existence only, not full business-data preservation or provider login acceptance.

## Verification

Baseline operator compatibility test: 4/4 PASS. New synthetic managed-auth tests: 9/9 PASS. Full admin suite: 443 tests, 439 PASS, 0 failures, 4 skipped. Syntax and whitespace checks PASS. Synthetic tests do not prove that the live provider accepts `ops-admin@localhost`.

## Next incomplete work

1. Verify provider acceptance/provisioning rules for the exact localhost identifier. Its mailbox cannot be used as an email-recovery channel; no substitute identifier is authorized.
2. Add and locally verify additive provider-to-business identity mapping, native/PostgREST repositories, unique project/surface constraints and server-only access. Preserve business IDs; prevent email-only automatic linking.
3. Wire both login/session/logout/password and merchant registration flows to the provider with HttpOnly session cookies, refresh/revocation, CSRF, existing tenant scopes and explicit operator roles. Handle pending email confirmation without creating duplicate PRIVLAN workspaces.
4. User enters passwords only in local protected input or provider UI. No passwords or raw hash values enter task records.
5. Provision and associate the two provider identities through the reviewed target-specific procedure, then verify Staging fresh login, isolation, sessions and durable business preservation. Remove superseded password authentication after acceptance.
6. Production configuration delivery, startup protection, database compatibility and recovery conditions remain separate release gates. Existing startup-guard blockers are not closed by this adapter.

## References

- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://docs.meoo.com/untitled-page-2

## Recovery

This milestone adds an unused adapter and tests only. Existing runtime route behavior is unchanged. An isolated baseline checkout passes the original compatibility tests. Platform application rollback and database restore are not established by this source recovery check.
