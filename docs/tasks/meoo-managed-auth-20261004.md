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

## Login service integration milestone

Both service login methods accept an injected managedAuth adapter, retain original business IDs and issue only opaque application cookies through existing HTTP handlers. Managed rejection never falls back to local password verification, provider outage maps to 503, and application session expiry is bounded by provider expiry. Provider tokens are neither persisted nor returned by business login results. This is not yet enabled by server wiring. Managed password changes, registration, provider refresh/logout coordination and retirement of original-session acceptance remain incomplete and are required before remote cutover. The retained old verifier is currently for the unchanged live release and migration proof, not the requested final architecture.

## Provider session operations milestone

The managed-auth adapter now implements provider refresh with original-business-identity revalidation, session-local sign-out, and current-password reauthentication before password changes. Temporary proof-session revocation is attempted on update success/rejection; cleanup failure is exposed separately from the password update outcome. These operations are not wired into HTTP cookies or enabled server runtime yet. Seven focused synthetic tests pass. Live account setup, registration, coordinated application logout/revocation and complete managed HTTP middleware remain required.

## Managed password HTTP/service milestone

Merchant password changes now use the injected managed provider and never read/write the original hash in managed mode. Native and Meoo business-session revocation paths preserve the authenticated original identity. If provider update completed but application revocation/audit failed, HTTP reports passwordChanged plus incomplete cleanup instead of claiming the update failed. Shared Operator-session invalidation remains required before cutover. Five focused tests include localhost HTTP behavior. Server activation and actual account operations remain pending.

## Shared-password session invalidation milestone
Managed password changes discover the other surface using the verified provider subject and exact project/origin link before the provider mutation. Missing links add no target; mismatches/outages abort before mutation. Native and Meoo cleanup revoke only the explicitly linked original merchant/operator identities. Partial cleanup remains exposed. Focused checks 15/15 pass; admin full suite 471 total/467 pass/4 skipped before two final focused additions. Actual account setup, registration and server cutover remain pending. No remote writes or deployments.

## Managed-session cutover milestone
Additive migration 018 adds auth_provider provenance to merchant/operator sessions, retaining all existing rows as legacy. New managed login marks supabase; both native/Meoo lookup paths reject legacy or missing provenance when managed mode is enabled. Existing non-managed paths do not require the new column before authorized migration. Provider expiry is capped at existing merchant maximum. Local PGlite migration proves existing IDs/rows preserved and enum constraints; focused 7/7, Admin 476 total/472 passed/0 failed/4 skipped. Migration manifest digest 21fba452cd59f40f19b9b159ac5063acdf467ce59f9eb2ed58fca2226e5adad5. No remote migration, account operations or deployment. Registration email-verification policy has been asked; server activation remains pending.

## Email-first registration milestone
User selected email verification before new merchant provisioning. beginRegistration uses provider signUp with email/password only; returns no IDs or sessions and treats existing-account replies generically. Unexpected automatic confirmation fails closed and attempts local provider-session cleanup. verifyRegistration gets the trusted provider user and requires email_confirmed_at, ignoring metadata role/verification flags. Managed register has no business writes before confirmation; HTTP returns202/no cookies. Focused8/8 and Admin484 total/480pass/0fail/4skip. Actual mail delivery, provider settings, verification callback and post-confirmation merchant provisioning remain pending. Existing-account migration remains the separate agreed plan. No remote account/database writes or deployments. Official reference: https://supabase.com/docs/reference/javascript/auth-signup

## Verified merchant provisioning milestone
Native database completeRegistration trusts provider-verified email/subject, not input login/role; new business records and merchant-only provider link commit atomically. No local password is stored for new managed accounts (unusable marker satisfies the existing schema); no application session is issued until normal managed login. Existing business email rejects auto-linking; explicit original-account migration remains separate. Repeat provider-subject completion returns alreadyProvisioned. Late-link failure test proves transaction rollback leaves no new users/tenants/workspaces/stores/memberships/subscriptions/links. Additive HTTP completion route accepts provider proof via Bearer header and whitelists business form fields. Focused12/12; Admin488 total/484pass/0fail/4skip. Meoo REST transactional provisioning remains to implement and fails closed; provider confirmation callback/UI/server wiring and real environment acceptance remain pending. No remote mutations/deployments.

## Meoo transactional provisioning milestone
Additive migration019 adds server-only security-invoker provision_managed_merchant RPC, rejects PUBLIC/anon/authenticated execution and grants service_role when present. Provider subject locking/unique email preserve existing accounts; merchant-only business records, original registration defaults and identity link commit together. Repository sends one bounded no-redirect RPC with server credentials and never forwards provider token/password; unknown outcome reports503 and no automatic retry. Local tests prove default rows, no Operator grant, idempotency, existing email rejection, ordinary-role denial and rollback after late audit failure. Focused8/8, Admin492 total/488pass/0fail/4skip. Manifest148f844b229e5b8add75b0c765bc8776d85fd218bcd22f4e853c4f52c4fcfcf2. Actual Meoo RPC availability/grants, migrations, server wiring and confirmation callback/UI remain pending; no remote writes/deployments. Reference https://supabase.com/docs/guides/database/functions

## Registration pending UI milestone
The actual submitAuth now stops on emailVerificationRequired=true, clears password, remains logged out and loads no business data. Baseline reproduced false-session behavior (1 failure); modified2/2 and related18/18 pass; restored independent baseline reproduces same failure. No remote mutations. Confirmation callback, server activation and real account migration remain pending. Evidence: registration-ui under existing artifacts.

## Email confirmation callback milestone
Server-configured HTTPS application origin now supplies exact /auth/confirmation emailRedirectTo; absent/invalid origin fails before provider signup. Dedicated local-only page clears query/fragment before styles/render, holds proof only in memory and requires explicit form submission; one bounded POST, no automatic retry, no cookie/session issuance. GET route uses no service or database. Focused24/24; Admin500 total496pass0fail4skip; local Chromium desktop/mobile passes using an intercepted synthetic completion request, no real provider writes. Frozen baseline8/8 and isolated rollback8/8. Evidence: confirmation-callback in existing artifact root. Provider mail/redirect settings, server activation, original-password migration and live acceptance remain pending. Official references https://supabase.com/docs/reference/javascript/auth-signup and https://supabase.com/docs/guides/auth/redirect-urls .
