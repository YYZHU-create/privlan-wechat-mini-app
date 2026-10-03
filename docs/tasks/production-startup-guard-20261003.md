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

Staging publication/acceptance: pending this candidate commit and frozen input. Production submit count in this preparation: 0.

## Evidence location and continuation

Detailed local evidence is outside the repository at `C:\Users\Administrator\.codex\artifacts\production-startup-guard-20261003` (test logs, schema catalogs/comparison, Docker smoke, baseline/rollback records and release provenance). It contains no credentials. Next: commit/push exact changes, freeze this committed candidate, publish once to Staging after data-continuity prechecks, capture runtime acceptance, then evaluate Production recovery evidence. Missing platform recovery records do not invalidate the completed startup tests.

Official references reviewed: <https://docs.meoo.com/meoo-cli>, <https://docs.meoo.com/untitled-page-2>. Documented image deployment does not establish the current instance's runtime configuration or rollback capability.
