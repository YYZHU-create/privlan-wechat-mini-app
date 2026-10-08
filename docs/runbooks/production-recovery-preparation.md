# Production recovery preparation

## Targets and current boundary

Production project: `g8o5cv1om41o`; database: `ra_supabase_74z0ong0wmvmwj`.
Staging project: `asmhysidbg5g`; its configuration and credentials remain separate.
This runbook prepares configuration and recovery. Production backup collection,
isolated restore, function publication and application publication are separate
execution approvals. No operation below is automatically invoked at startup.
Platform support reported no retained historical image restoration entry and no
automatic database backup. This is supplied support evidence, not a restore test.

## Production configuration bridge

Local function: `functions/feeldao-production-runtime-config/index.ts` and
`handler.mjs`. Retain platform JWT verification and exact service-role credential
verification. Node opt-in: `ATELIER_RUNTIME_SECRET_BRIDGE=production`.
Require exact project/environment, Supabase auth, Meoo database backend,
`ATELIER_AUTO_MIGRATE=0`, and no `DATABASE_URL`. Unknown modes fail closed.
The Node bootstrap invokes the loader after configuration validation and before
database/server initialization; migration policy is re-enforced afterward.
Only four existing Production secret versions are delivered:
`ATELIER_LICENSE_PEPPER`, `ATELIER_MASTER_KEY`,
`ATELIER_APPOINTMENT_GATEWAY_TOKEN`, `ATELIER_OPENID_HASH_KEY`.
Use the Production Supabase URL and credential, never Staging values. Validate
returned project, exact fields, formats and inherited conflicts before applying
any field. Delivery is a single request, no retry, no response logging or secret
storage in code/build layers. Function creation and real binding remain pending.
The hardcoded response project is a code guard, not independent evidence of
where the function was deployed. Before activation, verify platform project
binding and database identity through approved read-only access.

## Backup coverage plan

1. PostgreSQL: all authorized application tables, migration ledger, primary IDs,
   tenant/workspace/store relationships, subscriptions and permissions; include
   Operator/Merchant credentials and relevant `auth` identities after approval.
   Encrypted managed session records may be included in a restricted archive;
   live sessions must not be activated during a restore drill.
2. Schema: table/column/default/constraint/index/function/trigger definitions,
   relevant extensions and RLS/grants. Assess ownership/roles separately; do not
   blindly restore provider-owned roles or platform gateway internals.
3. Storage: enumerate only project-owned buckets and actual legacy/external
   storage referenced by application records. Capture object bytes plus paths,
   versions where available, sizes, MIME types and restricted checksum manifest.
   Database file metadata alone is not a file backup. Empty Media V1 bucket does
   not establish all legacy assets are empty.
4. Configuration: existing encryption/signing key versions must be recoverable
   through a separate controlled secret custody mechanism. No secret values,
   password-hash fingerprints or tokens in audit reports. Losing the master key
   may make otherwise complete encrypted database backups unusable.
5. Application: remote-verifiable source SHA, lockfile, frozen build manifest,
   setup/start scripts, runtime config without secrets and compatible schema
   range. A future tested rebuild target does not reconstruct unknown v12 input.

## Location and custody — selected location, protection pending

User selected `D:\FeeldaoRecovery` for primary backup custody and local isolated restore testing. User subsequently selected D-only local backups for this phase. No independent copy is configured; same-disk loss risk remains and this does not automatically clear publication recovery gates. Encryption, ACLs and retention have not been verified or activated. No backup directory or test database is created by this preparation.

Use an owner-restricted directory on a non-system encrypted volume or removable
encrypted disk: `<APPROVED_ENCRYPTED_VOLUME>:\FeeldaoRecovery\production\<UTC>`.
This is a typed location, not a created archive. Confirm the actual drive and
available capacity before collection. Keep a second encrypted copy on a
different failure domain; a second folder on the same disk is insufficient.
Keep backups outside repository, build context, web roots and artifact reports.
Restrict Windows ACLs to the owner and required recovery administrator; reject
shared/inherited broad access. Keys/passwords are entered privately and not
embedded in commands. Proposed retention: seven daily generations plus a
pre-release generation retained until that release is accepted and its recovery
window closes; confirm retention and encryption tooling before execution.
Reports contain only date, scope, byte counts, encrypted-archive integrity,
verification result and controlled location label, not raw data manifests.

## Collection permissions and consistency

Require explicitly scoped Production read/export access. Existing OAuth SQL
access does not prove native PostgreSQL `pg_dump` permission. Determine whether
a supported direct connection and privileges cover both `public` and `auth`.
If not, document the gap and design a supported export; do not label paginated
SELECT output a complete database backup. `pg_dump --format=custom --no-owner`
is the preferred starting point when permission is confirmed; never execute
the current restore script against Production as part of this preparation.
Storage requires project-scoped object list/read permission. Do not invoke
registration, business functions, sequence changes or migrations to collect.
Database dump uses a consistent snapshot; storage collection is not atomic with
it. Record start/end windows, concurrent modifications and reconciliation; if
referenced object coverage cannot be reconciled, backup gate remains incomplete.
Production key retrieval is a separately controlled credential operation.

## Isolated restore verification — execution not yet approved

1. Confirm an empty disposable database and storage destination independent of
   both Production and Staging. It is a test copy, not a replacement primary.
   Record destination identity and operator-approved cleanup policy.
2. Block email, SMS, webhook, payments, scheduler/recovery workers and public
   ingress. Do not import live gateway credentials or make restored session
   tokens usable. Keep automatic migrations disabled.
3. Verify archive integrity/decryption privately. Restore approved schema/data
   to the empty destination with reviewed ownership/grants handling. The legacy
   `restore-postgres.ps1` uses `--clean`; do not use it unchanged for this drill.
4. Restore object bytes to isolated storage. Rewrite routing only in disposable
   test configuration; preserve original business IDs and backup originals.
5. Compare approved per-table counts and ID sets, migration ledger, critical
   foreign keys, subscriptions/permissions, credential-format classes and
   encrypted-field readability. Reconcile every referenced file in scope with
   object existence and private integrity checks. Never expose hash/passwords.
6. Run known compatible application against the isolated copy. Auth acceptance
   uses separately approved test credentials; prevent outgoing provider requests
   from restored accounts. Record any inability to validate auth separately.
7. Record backup start/end, recovered snapshot time, restore start/end, results,
   gaps and measured elapsed recovery time. RPO depends on backup age at the
   incident; agree maximum acceptable RPO/RTO before treating measures as PASS.
8. Retain restricted evidence. Disposal of sensitive test data requires its
   approved scope; do not automatically delete shared databases or volumes.

## Application rebuild recovery

Platform history is not retained image recovery. Preserve a known compatible
source/build/config combination, rehearse rebuilding outside Production, and
verify schema compatibility. A re-publication is a remote write needing its own
authorization; this runbook does not approve automatic fallback/retry. Current
v12 equivalent-source recovery remains NOT_VERIFIED until independently bound.

## Acceptance and separate authorizations

Local bridge tests may PASS while real Production delivery is NOT_VERIFIED.
Backup plan may be complete while actual backup/restore gates remain pending.
Before production backup: approve database/schema/object scope, encrypted
destination, retention, credential use and read/export window.
Before restore drill: approve exact isolated targets, provisioning costs,
sensitive data handling, worker isolation and eventual disposal.
Before bridge publication: approve exact Production function and existing secret
bindings. Application deployment and migration retain their own project gates.

Reference: https://docs.meoo.com/meoo-cli documents image runtime and warns that
container-local storage is nonpersistent; it does not establish actual backup.

## 2026-10-08 local tool execution
D:\FeeldaoRecovery created with inheritance disabled; current owner, SYSTEM and Administrators only. Child test directory inherits this restricted ACL. Docker29.8.0 available; cached postgres:17-alpine used in a dedicated network-none container. Synthetic source/restore databases successfully exercised pg_dump custom format and pg_restore with exit0, exact fixture ID/data comparison true. Container stopped, retained for inspection. This is local synthetic tooling proof, not Production backup/restore. Actual Production cloud response binds the target app but does not contain a native PostgreSQL connection URI; no credentials/data exported. BitLocker/encrypted archive remains NOT_VERIFIED before sensitive data collection.
