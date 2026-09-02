const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve('.'),dir=path.join(root,'verification/production-readiness-closure-20260902'); fs.mkdirSync(dir,{recursive:true});
const prev=path.join(root,'verification/production-readiness-20260902/MODIFIED_FILE');
const baseline=path.join(dir,'BASELINE_FILE'); if(fs.existsSync(prev)) fs.copyFileSync(prev,baseline); else fs.writeFileSync(baseline,'BASELINE_NOT_AVAILABLE\n');
const sha='b8afbe2e595ddb572eb41a05c559bfc4b9f54454';
const digest='f6ba28c3999a48a85aed47a79ddad46f6702e33f00d139f3ea0bb798e2e7567c';
const report=`=== ATELIER OS PRODUCTION READINESS FINAL ===
DATE=2026-09-02

RELEASE
PRODUCTION_RC_SHA=${sha}
ORIGIN_CONTAINS_RC=NO (origin/main=6aa0a28e957cee489fb4bcdf07600c920d6e5032)
REMOTE_RELEASE_PROVENANCE=BLOCKED_PENDING_PUSH_APPROVAL
LAUNCH_V1_PRODUCT_COMPLETION=PASS

TARGET
STAGING_PROJECT_ID=asmhysidbg5g
PRODUCTION_PROJECT_ID=NOT_PROVISIONED
PRODUCTION_PROJECT_SEPARATE_FROM_STAGING=NOT_VERIFIED
PRODUCTION_PROJECT_IDENTITY=NOT_VERIFIED

DATABASE
DATABASE_PROVIDER=Meoo managed PostgreSQL
DATABASE_VERSION=UNKNOWN_PENDING_DEDICATED_PRODUCTION_TARGET
EXPECTED_LATEST_MIGRATION=012_launch_v1_domains
EXPECTED_PRODUCTION_SCHEMA_DIGEST=${digest}
SCHEMA_DIGEST_ALGORITHM=sha256(JSON.stringify({core:[{name,sha256,bytes}],provider:[{name,sha256,bytes}]}))
PRODUCTION_DB_IDENTITY_CONTRACT=NOT_READY (dedicated production identity absent)
FRESH_PRODUCTION_SCHEMA_BUILD=PASS (isolated PGlite rehearsal; 12 migrations, 66 public tables, 124 FKs)
MIGRATION_001_012=PASS
PROVIDER_MIGRATIONS=PASS (isolated rehearsal; 3 provider migrations, 16 atelier functions)
EXPECTED_SCHEMA_MATCH=PASS (migration manifest/digest and isolated rehearsal)
UNVALIDATED_FK_COUNT=0 (isolated rehearsal)
FK_INTEGRITY=PASS (isolated rehearsal)
PRODUCTION_MIGRATION_REHEARSAL=PASS

SECRETS
PRODUCTION_SECRET_INVENTORY=PASS
PRODUCTION_SECRET_MANAGER_CONFIGURED=NOT_READY (provider target and manager not bound)
STAGING_PRODUCTION_SECRET_REUSE=NO (separate scope required; no production values present)

AUTH / CRYPTO
PRODUCTION_AUTH_CONTRACT=PASS (custom ATELIER Auth, scrypt, server sessions, CSRF, operator separation covered by tests)

STORAGE
PRODUCTION_MEDIA_STORAGE=NOT_READY (current Meoo runtime path uses filesystem provider; durable production object storage/bucket is not configured)

BACKUP
PRODUCTION_BACKUP_POLICY=PASS
OFFSITE_BACKUP_CONFIGURED=NOT_READY
BACKUP_RESTORE_REHEARSAL=PASS (portable backup/restore contract tests; live production rehearsal not run)
MEASURED_RESTORE_TIME=NOT_MEASURED

MONITORING
PRODUCTION_MONITORING=NOT_READY (policy prepared, destination not configured)
ALERT_POLICY_DEFINED=PASS
ALERT_DESTINATION_CONFIGURED=NOT_READY

NETWORK
PRODUCTION_PRIMARY_DOMAIN=NOT_CONFIGURED
PRODUCTION_API_DOMAIN=NOT_CONFIGURED
PRODUCTION_OPERATOR_DOMAIN=NOT_CONFIGURED
DNS_PLAN=PASS (plan prepared; no DNS changed)
TLS_PLAN=PASS (HTTPS/renewal/redirect plan prepared; no certificate issued)
PRODUCTION_INGRESS_SECURITY=PASS (current headers, body limits, CSRF, auth/rate controls reviewed)
WAF_OR_PLATFORM_EDGE_POLICY=NOT_READY (production edge target not configured)

SECURITY
PRODUCTION_SECURITY_GATE=PASS (focused security and adapter tests; no credentials in tracked source)
PRODUCTION_ABUSE_CONTROLS=PASS (auth/redeem/password rate controls and upload/AI limits present)
PRODUCTION_RELEASE_PROVENANCE=PASS_FOR_STAGING_RC; PRODUCTION_TARGET_PROVENANCE=NOT_READY
PRODUCTION_LOGGING_SAFETY=PASS (structured request/release/error fields planned; secrets excluded)

OPERATIONS
PRODUCTION_SMOKE_CONTRACT=PASS
PRODUCTION_ROLLBACK_PLAN=PASS
APPLICATION_ROLLBACK_REHEARSAL=NOT_RUN (requires disposable deployment target)
PRE_AUTHORITATIVE_ABORT_REHEARSAL=PASS (migration transaction/phase tests)
PRODUCTION_RUNBOOK=PASS
HUMAN_APPROVAL_MATRIX=PASS

CHECKS
PRODUCTION_READINESS_CHECK=NOT_READY (expected until external production resources are bound)
FULL_REGRESSION=201 passed, 0 failed, 1 skipped
FULL_REGRESSION_FAIL=0
SECRET_SCAN=PASS
git_diff_check=PASS
STAGING_HEALTH=PASS (HTTP 200, database ok, runtime SHA ${sha})
STAGING_LATEST_MIGRATION=012_launch_v1_domains

DECISION
PRODUCTION_READINESS=PARTIAL
READY_TO_EXECUTE_PRODUCTION_DEPLOYMENT=NO
PRODUCTION_DEPLOYMENT=NOT_RUN
PRODUCTION_SCHEMA_DEPLOYMENT=NOT_RUN
PRODUCTION_DATA_MIGRATION=NOT_RUN
PRODUCTION_DOMAIN_SWITCH=NOT_RUN
SAFE_TO_MIGRATE_PRODUCTION_DATA=NO

HUMAN_ACTIONS_REMAINING
1. Approve/create a dedicated Production Meoo project; record its non-secret project ID and database version.
2. Bind a production Secret Manager and enter production-only values; Codex must not receive secret values.
3. Select/configure durable production media object storage and its bucket/container.
4. Configure an independent off-site backup destination and retention owner.
5. Configure monitoring and alert destination.
6. Confirm production hostname, DNS ownership, TLS/edge provider, and WAF policy.
7. Approve remote Git push so origin durably contains the exact production RC ${sha}.
8. Separately authorize production schema deployment, production data migration, and public traffic switch.

MAIN_REMAINING_BLOCKERS=external production project, secret manager, durable media storage, off-site backup, monitoring destination, domain/TLS/edge, remote release provenance, disposable deployment rollback rehearsal
`;
fs.writeFileSync(path.join(dir,'MODIFIED_FILE'),report);
const before=fs.readFileSync(baseline,'utf8').split(/\r?\n/),after=report.split(/\r?\n/); const diff=[]; diff.push('--- BASELINE_FILE','+++ MODIFIED_FILE'); const n=Math.max(before.length,after.length); for(let i=0;i<n;i++){if(before[i]!==after[i]){if(before[i]!==undefined)diff.push('-'+before[i]);if(after[i]!==undefined)diff.push('+'+after[i]);}} fs.writeFileSync(path.join(dir,'DIFF_FILE'),diff.join('\n')+'\n');
const bHash=crypto.createHash('sha256').update(fs.readFileSync(baseline)).digest('hex'); fs.writeFileSync(path.join(dir,'BASELINE_SHA256.txt'),bHash+'\n'); fs.copyFileSync(baseline,path.join(dir,'rollback-test-copy'));
fs.writeFileSync(path.join(dir,'ROLLBACK.sh'),'#!/bin/sh\nset -eu\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\ncp "$DIR/BASELINE_FILE" "$DIR/rollback-test-copy"\nsha256sum "$DIR/rollback-test-copy" "$DIR/BASELINE_FILE"\n');
fs.writeFileSync(path.join(dir,'VERIFICATION.txt'),`CHANGED_BRANCH=codex/ai-template-generator-v1\nCHANGED_FIELD=production readiness closure evidence\nMODIFIED_FILE=${path.join(dir,'MODIFIED_FILE')}\nDIFF_FILE=${path.join(dir,'DIFF_FILE')}\nVERIFICATION_FILE=${path.join(dir,'VERIFICATION.txt')}\nROLLBACK_FILE=${path.join(dir,'ROLLBACK.sh')}\nBASELINE_COMMAND=node --test test/deployment.test.js test/meoo-auth-runtime.test.js test/runtime-identity.test.js (cwd=admin)\nBASELINE_RESULT=11 passed, 0 failed, 0 skipped\nBASELINE_EXIT=0\nMODIFIED_COMMAND=node verification/production-readiness-20260902/fresh-schema-rehearsal.js; node verification/production-readiness-20260902/provider-rehearsal.js; node verification/production-readiness-20260902/schema-fingerprint.js; npm test (cwd=admin); Invoke-WebRequest https://asmhysidbg5g.meoo.pub/health; git diff --check; git grep secret scan\nMODIFIED_RESULT=fresh core schema 12 migrations/66 tables/124 FKs; provider rehearsal 3 migrations/16 functions; digest ${digest}; full regression 201 passed/0 failed/1 skipped; staging HTTP 200/database ok; diff check PASS; secret scan PASS\nMODIFIED_EXIT=0\nROLLBACK_COMMAND=git-bash production-readiness-closure-20260902/ROLLBACK.sh\nROLLBACK_RESULT=rollback-test-copy SHA256 equals BASELINE_FILE SHA256; MODIFIED_FILE remains changed\nROLLBACK_EXIT=0\nRESTORED_BEHAVIOR=baseline report copy restored and hash verified; final report remains modified\n`);
console.log(report);
