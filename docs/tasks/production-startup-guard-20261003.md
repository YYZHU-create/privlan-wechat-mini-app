# Production application startup protection

## Objective and authority

Production project: `g8o5cv1om41o`; Staging: `asmhysidbg5g`.
The user authorized task-scoped implementation, validation, commit/push, Staging publication and one Production overwrite after applicable gates pass. Migration, database restore, rollback execution and route cutover retain their separate authorization boundaries.

Base: `origin/main` / `2097ea813ac92c96370717b33a28aac275b6e498`, refreshed 2026-10-03. Working branch: `codex/production-startup-guard`, isolated managed worktree. `docs/prompts/sprint-x.md` is absent in this base and the old checkout. Existing work and verification assets in other checkouts are preserved.

## Implementation and loading order

Platform environment -> shell `.runtime.env` if present -> shell defaults -> validated target runtime config -> application migration policy -> server environment validation -> database factory. The Docker entry calls the same bootstrap directly; package `start` validates the target before starting its server. Hosted starts reject absent/mismatched config. Meoo backend plus a native URL is rejected as ambiguous instead of selecting a different connection.

Normal application startup forces auto migration off; the database factory independently refuses automatic migration even after a late override. Explicit migration APIs remain separate. A native URL is retained verbatim. Production config explicitly selects Production with Media V1/lifecycle/Canary off; Staging remains its own target.

## Executed local verification

- `pnpm test --test-concurrency=1` with pnpm 10.33.3 / Node 24.19.0: 421 passed, 0 failed, 4 existing skips (2026-10-03). Default parallel execution exhausted local memory; serial mode ran the full suite, not a reduced selection.
- Focused startup/config/deployment/cutover tests: 44 passed, 0 failed, 1 existing Windows POSIX skip. The added test executes Git Bash `start.sh` on Windows, so the shell protection itself was tested.
- Local Docker build and actual HTTP smoke: inherited auto-migrate `1` yielded `application-startup autoMigrate=0 environment=production declaredProject=g8o5cv1om41o`; `/health` 200. Isolated unavailable database, no Production connection. Local smoke is not database restore evidence.
- Migration manifest: PASS; digest `e0d5bc236b5b2b6ff03594e7fd0afd0e65cbdba03a35404f8a18ae0fd9324f0e`.
- Syntax and whitespace checks: PASS.

## Fresh read-only platform/database evidence

2026-10-03 CLI 0.5.4: Production v12 SUCCESS/ACTIVE; Staging v71 SUCCESS/ACTIVE. Project-specific CLI query identities at 06:49:21–22Z: Production `ra_supabase_74z0ong0wmvmwj`, Staging `ra_supabase_z1ota9ew3gblan`; project/instance IDs separately checked. Secret names only were inspected, not their values or effective injection.

Production history contains 001–014; complete 001–016 history match is NOT VERIFIED (015/016 absent). Against a freshly constructed isolated 001–014 catalog: 68 tables, 680 columns and 328 named PK/FK/unique/check constraints have matching structure/definitions. Production constraints are validated. This is bounded catalog compatibility, not full domain/extra-schema proof. Staging has all 001–016 plus three provider migrations, matching baseline structure; one pre-existing orders check remains NOT VALID as allowed by its original migration. No constraint was changed.

Staging recoverable upload count: 0, using the current repository's exact phase/operation/expired-lease predicate; no recovery action was invoked.

## Recovery evidence and publication phases

Existing official support ticket `00069SJR2Y` was read again on 2026-10-03. Its 2026-10-01 reply confirms Node/Express ingress and reports then-effective auto-migrate 1, suggests CLI overwrite, and says no restore-verified backup. The current ticket has no later concrete recoverable baseline/restore-verification record. Historical reply is not a fresh runtime measurement.

CLI exposes release listing but no restore/activate command on this installed command surface. Current v12 activity alone does not prove an executable rollback. Current Production recoverable artifact and applicable database/files restore-verification evidence remain NOT VERIFIED. Retain the existing Production authorization; these conditions must be satisfied before invoking its single submit.

Candidate `8f3732393aeaa204ec35048fc321e69bc12b279e` was committed/pushed and remote SHA verified. GitHub CI run `37105104679` passed Node 22, Node 24.15.0 and Docker smoke.

One Staging image submit completed with CLI exit 0 and v72 SUCCESS/ACTIVE at `2026-10-03T07:09:47.844Z`. Build ID `d9cff7b9cd8b4eed`; frozen context digest `sha256:020b3f48d619edc00fac08d23cacb709f8cabfbdfa775583461a7ad48bb88f7d`. Retry count 0. The CLI used a separate submission copy. Publication completion is distinct from application acceptance.

Browser acceptance failed: session GET HTTP 412, platform code `CAExited`. Previously loaded UI still displayed super_admin, but new requests could not reach a running application. At `2026-10-03T07:16:00.458Z`, the platform response exposed these sanitized startup lines:

```text
application-startup autoMigrate=0 environment=staging declaredProject=asmhysidbg5g
Error: 生产环境缺少或错误配置：ATELIER_LICENSE_PEPPER、ATELIER_MASTER_KEY、ATELIER_OPS_EMAIL、ATELIER_OPS_PASSWORD、ATELIER_APPOINTMENT_GATEWAY_TOKEN、ATELIER_OPENID_HASH_KEY
```

The guard is directly observed effective before database initialization; runtime identity/health/bootstrap acceptance is incomplete. The six names exist in the project Secret list, but valid injection into the image process was not established. The frozen `.runtime.env` has only non-secret target settings, and the checked local `.env` has none of these six settings. Preserve existing encryption keys and account passwords when resolving configuration delivery.

A local-only `scripts/image-startup-preflight.js` now validates complete supplied configuration without opening a server/database or making network requests. Output is sanitized and leaves runtime injection NOT VERIFIED. Four synthetic tests cover valid input, each missing required setting, the Meoo connection credential and a NODE_ENV bypass. Final follow-up full suite: 425 passed, 0 failed, 4 existing skips (429 tests total, pnpm 10.33.3, serial execution). This tool/documentation follow-up is not deployed in v72. Future inputs must use their own exact source commit and complete target-specific configuration delivery evidence.

Both frozen contexts still match their manifests, but are NOT READY for another publication until valid Secret delivery is established. Production remains v12 SUCCESS/ACTIVE in the final readback. Production submit count: 0. No second Staging submit or recovery operation was executed.

Post-publication read-only comparison: users, operator_users, tenants, workspaces, stores, subscriptions and assets retain identical row counts, identity digests and credential-excluded row digests in both projects. This is seven-table continuity, not a whole-database/no-audit-write claim. Staging recoverable count remains 0.

## Evidence location and continuation

Detailed evidence is at `C:\Users\Administrator\.codex\artifacts\production-startup-guard-20261003`. Next: establish existing Staging application Secret delivery to the image process without returning values, validate inputs with the preflight and reconcile v72 before a distinct corrective publication. Production additionally needs its baseline application restore method and applicable database/files restore-verification records. Existing Production authorization remains recorded; execution conditions are not met.

Official references reviewed: <https://docs.meoo.com/meoo-cli>, <https://docs.meoo.com/untitled-page-2>. Documented image deployment does not establish the current instance's runtime configuration or rollback capability.

## Configuration delivery continuation — 2026-10-03

Current branch/remote before this follow-up: e2bcb55732b1800cfea7363e4141c10c7f622c7b. Read-only release queries confirm Staging v72 SUCCESS/ACTIVE and Production v12 SUCCESS/ACTIVE. The original v72 startup evidence remains a failure: six settings missing or invalid; it does not distinguish each variable's absent/empty/format condition.

| Source | Scope established | Remaining limitation |
| --- | --- | --- |
| v71 | Historical ce90 acceptance; release history retained | Exact old launch input and effective Secret binding not recovered |
| v72 frozen input | .runtime.env contains non-secret target settings only; startup guard observed 0 | Six application settings not established in target process |
| Cloud Secret list | All six names present, existing version timestamps retained | Returned value representations are opaque; not original usable values; format NOT VERIFIED |
| Corrected preflight | Models supported static bundled .runtime.env overrides, rejects bundled sensitive settings and executable shell syntax | Local inputs only; actual target injection remains NOT VERIFIED |

Do not interpret opaque Secret-list representations as invalid email/master key or as values that may be re-submitted. An initial format interpretation was discarded after all list entries exhibited the same opaque representation. No value or fingerprint is retained in the diagnostic report.

A real preflight defect was reproduced: the previous preflight accepted valid inherited settings while the bundled file assigned an empty password. The correction blocks that input before startup. It preserves the migration protection and existing database selection; production validation was not weakened. Synthetic tests do not establish original Secret delivery.

The platform cloud UI exposes a name list with creation/deletion controls, not a verified binding control for the new image. Current documented image auto-injection covers platform-managed connection credentials; arbitrary application Secret injection is not established. No Secret was changed and no corrective image was submitted.

Existing support ticket 00069SJR2Y was read again: no concrete baseline reactivation/retained artifact procedure or restore-verification record was added. Latest visible reply (2026-10-03 15:21 local) asks whether further help is needed. Database metadata and uploaded file restore coverage remain separately NOT VERIFIED. Existing seven-table continuity and schema evidence are historical evidence tied to 8f/e2; no new live acceptance is claimed.

Next required external evidence: formally reuse the six existing Staging Secret versions in the image process, with names/binding object/presence/format only; identify an executable current Production baseline recovery target and applicable database/uploaded-file restore records. New Staging submit count 0; Production submit count 0. Authorization retained.

## 2026-10-08 Production managed-auth preparation
This section supersedes historical Staging failure state for current preparation. Staging v74 accepted source8386407ce28b52c44ac1501ee923cb5601e78463; task archive meoo-managed-auth-20261004.md. Documentation commits after that SHA do not relabel deployed source.
Production release readback2026-10-08T05:31:27Z: g8o5cv1om41o/v12/SUCCESS/ACTIVE. Project-scoped read-onlySQL2026-10-08T05:32:01.204Z confirms expected database ra_supabase_74z0ong0wmvmwj; schema_migrations contains001–014. Public users/operator_users/merchant_sessions/operator_sessions exist; managed_auth_identity_links and managed_auth_session_state are absent. This is a concrete compatibility gap for readManagedAuthConfig/verifyManagedAuthSchema, not a proposal to enable automatic migration.

| Workstream | Evidence and required next step | Status |
|---|---|---|
| Accounts | Preserve existing merchant/operator IDs, permissions, PRIVLAN data and subscriptions; separately review exact Production mappings and provider account existence before provisioning. Staging provider IDs/passwords are not Production inputs. Password entry remains private. | NOT_VERIFIED |
| Configuration | Candidate normal startup guard/project selector implemented and Staging accepted. Establish Production-specific credential source and delivery; Staging-only bridge must not be reused or renamed without reviewed target controls and authorization. Keep Media/lifecycle/Canary OFF and normal startup migrate:false/auto-migrate0. | NOT_VERIFIED |
| Schema | Production lacks managed-auth prerequisites017–021. Prepare an independent additive migration plan from exact repository files, verify dependencies/columns/constraints/triggers and baseline before seeking Production migration authorization. Do not include Media015/016 implicitly. | BLOCKED_STRUCTURE_MISSING |
| Application recovery | Currentv12 listed active; no newly verified immutable restoration target/operation or rehearsal evidence. Historical UI support statement is not proof that this CLI image is restorable. | NOT_VERIFIED |
| Data/files recovery | Obtain database-specific backup date/range/restore-test result and file-object coverage separately. Local source rollback and SQL snapshots are not restore verification. | NOT_VERIFIED |

Execution order:read-only Production account/structure/config evidence -> reviewed017–021 migration and identity mapping proposal -> approved recovery evidence -> separately authorized necessary Production mutations -> Production-specific frozen input/preflight -> one deployment under existing applicable authorization -> runtime identity, fresh-login/session/role/health/audit acceptance. Maintain permanent database andIDs. Seven-day session requirements apply to both surfaces; new merchant email verification remains required. Production migration/account/function/config operations are not covered by the old image publication authorization alone.
PRE_DEPLOY_READY=NO; PRODUCTION_DEPLOYMENT_SUBMIT_COUNT_THIS_TASK=0; PRODUCTION_MIGRATION_COUNT_THIS_TASK=0. No production or staging mutation performed during this archive/preparation milestone.
Current evidence: C:/Users/Administrator/.codex/artifacts/meoo-managed-auth-20261004/config-recovery-20261008/preflight-8386407/PRODUCTION_RELEASE_READBACK.json and PRODUCTION_SCHEMA_READONLY.json. Official reference https://docs.meoo.com/meoo-cli; fresh page retrieval this milestone failed(connection); prior successfully retrieved documentation does not establish runtime configuration or recovery.

## 2026-10-08 Production account read-only review and migration plan
Fresh project-scopedSQL at2026-10-08T05:34:21.165Z: expected ProductionDB match; exact requested merchant target1/active1, original Operator target1/active-super_admin1; merchant memberships1/workspaces1/all_ownertrue. Target provider email in Productionauth.users count0. No rowIDs, hashes, passwords or provider credentials exported. This supports candidate mapping cardinality, not password ownership verification or permission to create provider accounts. Production principals must be reread and exactIDs checked privately at execution; do not reuse StagingIDs.
Focused offline tests20/20PASS covering migration preflight/schema/provisioning/sessionRPC. Additional isolatedPGlite installation of exact001–014 then017–021PASS;19ledgerentries and all4required new objects present, no015/016applied. Test baseline is repository synthetic schema, not a production clone; catalog/constraint/default/trigger drift and real data impact remain separately unverified. EvidencePRODUCTION_ACCOUNT_PREFLIGHT.json, PRODUCTION_MIGRATION_OFFLINE_TESTS.txt, PRODUCTION_MIGRATION_PATH_TEST.json under existing preflight-8386407 artifact directory.

### Proposed independent Production migration scope (not executed)
1.017: create identity-link table, scoped unique indexes/FKs and server-only access. No provider/business account inserted byDDL.
2.018: add auth_provider to both existing session tables, NOT NULL defaultlegacy, CHECKlegacy/supabase. Existing sessions receivelegacy provenance; no password or permanentID rewrite. This affects existing tables and requires reviewed lock window and postDDL verification.
3.019: create server-side verified-new-merchant provisioning function. Installing function does not invoke it or create a store; existing-account mapping must use separate migration path. Review production default/constraint/trigger compatibility for its18insert targets before enabling new registration.
4.020: create encrypted provider-state table with scopedFKs and fixed7-day constraint, server-only access.
5.021: add lease/rotation/revocation columns to new state table; create scoped session RPC, restrict invocation to service_role.
Execute only these5exactfiles in order, explicit transaction per migration including ledger insertion. Stop on mismatch or uncertain write; read ledger/object state before any resume. Automatic startup migration remains0/migrate:false. NoMedia015/016. Existing files use create/add rather than IFNOTEXISTS; do not blindly reapply.
Pre-execution: verify sourceSHA/fileSHA256; project/DB; exactledger001–014; required columns/defaults/constraints/triggers and privileges; seven-table baseline; approved backup/recovery and application fallback; independently authorize Production017–021. Preserve existingusers/tenants/workspaces/storeIDs and subscriptions; provision no accounts duringDDL.
PostDDL: ledger17–21 exactlyonce, requiredobjects/columns/server-only permissions, existingIDs/counts and sessionlegacy labels; verify application can still run its approved baseline. If a migration transactionfails, transaction rollback only; after successfulDDL do not drop newtables/columns or rewriteledger as an automaticrollback. Preserve additive schema and restore approved compatible application subject to recovery authorization. Local test is not Productionbackuprestore proof.
Subsequent identity provisioning needs separate authorization and privatepassword verification of both original principals; deterministicprofileusername/triggercollision preflight, explicitproviderID-to-oldID links, noemailauto-linking. Keep newregistration disabled until provisioning runtime/default/constraint/trigger checks satisfied.
CURRENT_ACCOUNT_MAPPING_REVIEW=PASS_CARDINALITY_ONLY; LOCAL_MIGRATION_PATH=PASS; PRODUCTION_MIGRATION_EXECUTION=0; PRODUCTION_DEPLOYMENT=0; PRE_DEPLOY_READY=NO. Production config delivery and program/data/files restoration remainNOT_VERIFIED. GitHubpush/readback again failedTLSbefore establishing remote synchronization; local archive commit remains available.

## 2026-10-08 Production dependency/config/recovery review
Read-only catalog at06:19:45.037Z matches exact Production database. Migration019's18 existing INSERT targets have all columns and omitted-required defaults; column type/nullability/default comparisons match001–014;81 constraint definitions match and no missing non-NOT-NULL constraint.161 local PGlite NOT NULL catalog entries differ in representation only, with identical information_schema nullability. Inspected target tables/auth.users return no noninternal triggers. Structure precheck PASS_SCOPED, not migration execution approval. Current runtime-secret-bridge.js explicitly only allows Staging; Production-specific delivery remains NOT_VERIFIED. Concrete current-image recovery and database/uploaded-object restore-verification records remain NOT_VERIFIED. No Production mutation. Evidence: C:/Users/Administrator/.codex/artifacts/meoo-managed-auth-20261004/config-recovery-20261008/preflight-8386407/PRODUCTION_STRUCTURE_CONFIG_RECOVERY_REVIEW.md and catalog JSONs. PRE_DEPLOY_READY=NO.
