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
