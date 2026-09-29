# Current State

AS_OF=2026-09-06
REPOSITORY=YYZHU-create/privlan-wechat-mini-app
BRANCH=codex/feeldao-canonical-project-memory
HEAD=efd7f12c44756b266938f52ea57cd981cf1324c2
SOURCE_BASE=origin/main

## PRODUCTION
PRODUCTION_PROJECT_ID=g8o5cv1om41o
PRODUCTION_PROJECT_IDENTITY=PASS
PRODUCTION_PROJECT_NAME=Feeldao OS Production
PRODUCTION_STATIC_SITE_URL=https://g8o5cv1om41o.meoo.pub/
PRODUCTION_STATIC_SITE_CONFIRMED=PASS
PRODUCTION_OPS_GATEWAY_EXISTS=PASS
PRODUCTION_OPS_GATEWAY_STATUS=ONLINE
PRODUCTION_FUNCTION_API_URL=NOT_VERIFIED
PRODUCTION_ACCESS_DOMAIN=NOT_VERIFIED
PRODUCTION_SUPABASE_URL=NOT_VERIFIED
PRODUCTION_OPS_GATEWAY_PUBLIC_INGRESS=NOT_VERIFIED
STATIC_FUNCTION_SAME_ORIGIN=NOT_VERIFIED
FUNCTION_CUSTOM_DOMAIN_SUPPORTED=NOT_VERIFIED
PRODUCTION_READINESS=BLOCKED
STATUS=BLOCKED
EVIDENCE=Latest migration input; no production mutation performed.

## STAGING
STAGING_PROJECT_ID=asmhysidbg5g
STAGING_PUBLIC_URL=https://asmhysidbg5g.meoo.pub/
STAGING_PUBLIC_IDENTITY=B1 Staging / old simplified frontend
STAGING_URL_AS_PRODUCTION_EVIDENCE=NO
STATUS=REFERENCE_ONLY
EVIDENCE=Latest migration input; staging URL is not Production evidence.

## DATABASE
DATABASE_IDENTITY=NOT_VERIFIED
SCHEMA_MIGRATION_POLICY=ADDITIVE_ONLY
FULL_SCHEMA_COMPATIBILITY=NOT_VERIFIED
AUTO_MIGRATE_ON_APPLICATION_START=0
STATUS=NOT_VERIFIED
EVIDENCE=Repository architecture baseline and production runbook on origin/main.

## AUTH
MERCHANT_SESSION_BOUNDARY=DEFINED
CSRF_MUTATION_GATE=DEFINED
TENANT_WORKSPACE_SCOPE_ENFORCEMENT=DEFINED
MERCHANT_OPERATOR_SESSION_SEPARATION=DEFINED
PRODUCTION_AUTHENTICATED_READINESS=NOT_VERIFIED
PRODUCTION_SMS_GATEWAY=NOT_VERIFIED
STATUS=BLOCKED
EVIDENCE=Repository routes/adapters and production runbook; no live production authentication performed.

## OPERATOR
OPERATOR_HEALTH_ROUTE=/ops/v1/health
OPERATOR_AUTH_REQUIRED=YES
PUBLIC_LIVENESS_ROUTE=/health
PUBLIC_LIVENESS_PROVES_DATABASE_HEALTH=NO
OPERATOR_GATEWAY_STATUS=ONLINE
PUBLIC_OPS_INGRESS=NOT_VERIFIED
STATUS=NOT_VERIFIED
EVIDENCE=Production evidence and repository runbook; public ingress and route ownership remain unverified.

## MERCHANT
MERCHANT_SCOPE=tenantId/workspaceId/storeId
MERCHANT_EDITOR=COMPATIBILITY_APPLICATION
CLIENT_SCOPE_IDENTIFIERS_TRUSTED=NO
SAVE_SYNC_STATE_MACHINE=NOT_VERIFIED
STATUS=NOT_VERIFIED
EVIDENCE=Repository architecture baseline and historical merchant scope/editor contracts.

## MEDIA
MEDIA_REPOSITORY_PRESENT=YES
MEDIA_NORMALIZATION_CONTRACT=NOT_VERIFIED
EDITOR_PREVIEW_GENERATOR_PARITY=NOT_VERIFIED
LARGE_MEDIA_POLICY=NOT_VERIFIED
MEDIA_STORAGE_ADAPTER_DIRECTION=NOT_VERIFIED
STATUS=OPEN
EVIDENCE=Current media adapters and historical Product Media evidence; end-to-end parity not re-run.

## CONFIG
DESIGN_SYSTEM_OVERRIDE_KEYS=HISTORICAL_CONTRACT
UTF8_NON_ASCII_CORRUPTION_GUARD=NOT_VERIFIED
LEGACY_CONFIG_COMPATIBILITY=NOT_VERIFIED
RESTORE_DEFAULT_SEMANTICS=NOT_VERIFIED
STATUS=OPEN
EVIDENCE=Historical editor evidence; focused compatibility verification remains outstanding.

## TEMPLATE
TEMPLATE_CENTER_ARCHITECTURE=DECIDED
TEMPLATE_CENTER_IMPLEMENTATION=NOT_VERIFIED
LEGACY_GLOBAL_SETTINGS_EQUIVALENCE=NO
PREVIEW_APPLY_RESTORE_ACCEPTANCE=NOT_VERIFIED
STATUS=OPEN
EVIDENCE=Template Center decision conversation and current template code.

## QA
TEST_TENANT_POLLUTION_HISTORY=KNOWN
TEST_DATA_ISOLATION_POLICY=OPEN
REAL_PRIVLAN_DATA_AS_TEST_FIXTURE=NO
STATUS=OPEN
EVIDENCE=Historical QA evidence and repository cleanup scripts; complete live cleanup not verified here.

## MEOO
TARGET_PROJECT_ID=asmhysidbg5g
WORKFLOW_VERSIONS_DB_QUERY=PASS
WORKFLOW_VERSIONS_COUNT=0
WORKFLOW_VERSIONS_REST_ATTEMPT_1=FAIL_FETCH_FAILED
WORKFLOW_VERSIONS_REST_ATTEMPT_2=PASS
WORKFLOW_VERSIONS_REST_ATTEMPT_3=PASS
USERS_REST=PASS_3_OF_3
CUSTOMERS_REST=PASS_3_OF_3
APPOINTMENTS_REST=PASS_3_OF_3
INCIDENT_CLASS=WORKFLOW_VERSIONS_REST_OR_GATEWAY_PATH_UNSTABLE
TARGET_SERVICE_ROLE_READ_PATH=UNSTABLE
PRE_CUTOVER_TARGET_PREFLIGHT=NOT_RUN
SAFE_TO_RESUME_T2=NO
T2_CUTOVER=NOT_RUN
STATUS=BLOCKED
EVIDENCE=2026-08-31 target REST read-stability verification file supplied for migration.

## DOMAIN
PRODUCTION_STATIC_DOMAIN=CONFIRMED
PRODUCTION_ACCESS_DOMAIN=NOT_VERIFIED
PUBLIC_OPS_ROUTE_OWNER=NOT_VERIFIED
FUNCTION_CUSTOM_DOMAIN=NOT_VERIFIED
READY_FOR_MEOO_NATIVE_SPIKE=NO
READY_FOR_FULL_MEOO_REWRITE=NO
MEOO_NATIVE_ROUTE=CONDITIONAL
STATUS=NOT_VERIFIED
EVIDENCE=Latest migration input and production runbook; no DNS or route mutation performed.

## ENVIRONMENT / RUNTIME
REPOSITORY_RUNTIME=Node.js >=22 <25 / pnpm 10.33.3 (Meoo image builder contract; Node 22 remains development and Docker baseline)
CURRENT_RUNTIME_INSTANCE=NOT_VERIFIED
DATABASE_RUNTIME_IDENTITY=NOT_VERIFIED
PROCESS_CHECKOUT_BINDING=REQUIRED_FOR_NEW_EVIDENCE
STATUS=NOT_VERIFIED

## Contradictions and precedence resolutions

CONTRADICTION_ID=CONTR-001
SOURCE_A=Historical or route-level observations treated the static site hostname as if it were the Function API base URL.
SOURCE_B=Latest production inputs explicitly separate the static site URL from Function API URL, access domain, and public Ops ingress.
CURRENT_RESOLUTION=Static site identity is confirmed; Function API URL, domain mapping, same-origin behavior, and public ingress remain NOT_VERIFIED.
STATUS=RESOLVED_WITH_NOT_VERIFIED_FIELDS

CONTRADICTION_ID=CONTR-002
SOURCE_A=Earlier Meoo parity/cutover discussions included successful or ready-to-resume interpretations.
SOURCE_B=2026-08-31 target REST read-stability evidence records a failed first Workflow Versions REST attempt, unstable service-role path, PRE_CUTOVER_TARGET_PREFLIGHT=NOT_RUN, and SAFE_TO_RESUME_T2=NO.
CURRENT_RESOLUTION=The newer stability record controls the current Meoo gate; earlier cutover interpretations remain historical.
STATUS=RESOLVED

## Historical state rule

Historical ports, URLs, SHAs, runtime observations, database credentials, and deployment results are evidence only. Revalidate them before using them as current production truth.

## Media V1 acceptance update — 2026-09-29

- Staging project `asmhysidbg5g` reached active release v69 from source `f5150d28d64f1865cd0285eba107b688950b50ef`.
- One normal Media V1 acceptance upload returned HTTP 201. Request-correlated read-only persistence evidence matched one attempt and one asset: attempt `READY_COMMITTED` / `CONSISTENT_READY`, asset `ready`, one `asset_objects` row, and zero business links (the upload was not linked to a business entity).
- The corresponding Merchant media entry rendered from its `/api/media/v1/content/<asset-id>` route with a fully loaded 2×2 image. The browser did not retain a direct HTTP status or exact Storage inventory count; those details remain unrecorded.
- The ASSET_CONFIRM repair uses the successful INSERT representation as its request-bound confirmation, with the existing scoped fallback only when that representation is absent. The 250 ms delayed-reread observation has been removed from the local candidate source and Staging diagnostic response; this local cleanup has not been deployed. Staging runtime remains v69 until a later authorized release.
- The recovery-worker lease-renewal gap remains a separately tracked, non-blocking technical debt item; it is not a blocker for this ASSET_CONFIRM upload acceptance.
- Sanitized GitHub summary: `verification/media-v1-github-synchronization-20260929/REPORT.md`.

## Media V1 follow-up — v70 deployment and runtime identity — 2026-09-29

- The recorded Meoo CLI deployment for Staging project `asmhysidbg5g` returned success with release version `70`, using source commit `11b494f9ffbf60f4fde5fa84953bb9a63f23632f`. The prepared build record lists artifact digest `sha256:11762a45e5bd716448da23e3a520f18f6c48e211b628dc2527838cbaaa193b8f` and runtime-config digest `sha256:af438c57b230b2afa585a0301151936bf568028f114f998473b30afacd181cff`.
- The supplied authenticated same-origin runtime sample returned HTTP 200 and reported the same source commit, `staging`, and the matching runtime-config digest. It reported artifact and build identity as unknown. The earlier stored acceptance result was blocked on an expected-source mismatch; the revised GET-only script passed local syntax/mock validation, but a result from executing that revised script in the authenticated browser has not been recorded.
- Therefore the deployment command result and source/config sample are recorded, while final v70 runtime acceptance and a fresh active-release readback remain `NOT_VERIFIED`. The previous v69 acceptance remains a historical result, not v70 acceptance.
- Repository synchronization record: `verification/media-v1-github-synchronization-20260929/REPORT.md`.
