# Known Issues and Open Gates

## ISSUE-MEOO-001
MODULE=Database / Meoo
SEVERITY=HIGH
STATUS=OPEN
DESCRIPTION=Workflow Versions target REST reads were unstable: first attempt failed, later attempts passed; the service-role read path remains unstable.
EVIDENCE=2026-08-31 target REST read-stability verification.
NEXT_SAFE_ACTION=Run the approved read-only target preflight and isolate gateway/path instability before any T2 cutover decision.
BLOCKS=T2 cutover and safe resume.

## ISSUE-PROD-001
MODULE=Production
SEVERITY=HIGH
STATUS=OPEN
DESCRIPTION=Production Function API URL, access domain, Supabase URL, public Ops ingress, same-origin behavior, and function custom-domain support remain unverified.
EVIDENCE=CURRENT_STATE.md production and domain records; production runbook requires separate B1/B2 gates.
NEXT_SAFE_ACTION=Obtain an approved read-only platform verification path and record route ownership without mutating production.
BLOCKS=Native route decision and full rewrite readiness.

## ISSUE-AUTH-001
MODULE=Merchant Auth
SEVERITY=HIGH
STATUS=OPEN
DESCRIPTION=Production SMS gateway, formal authentication readiness, session restoration, workspace loading, and current runtime auth behavior have not been reverified in the current production environment.
EVIDENCE=Historical Auth work plus production runbook.
NEXT_SAFE_ACTION=Execute controlled authenticated readiness checks without copying credentials into artifacts.
BLOCKS=Production Auth gate.

## ISSUE-MEDIA-001
MODULE=Product Media
SEVERITY=MEDIUM
STATUS=OPEN
DESCRIPTION=The complete editor-to-preview-to-generator media contract, legacy `img`/`gallery` normalization, large-media/package behavior, and adapter storage direction are not fully reverified.
EVIDENCE=Historical Product Media thread and current media adapters.
NEXT_SAFE_ACTION=Create a single-target Product Media implementation/audit task with explicit fixtures and generated-package checks.
BLOCKS=Confident media closure and archive of mixed media history.

## ISSUE-CONFIG-001
MODULE=Merchant Admin / Config
SEVERITY=MEDIUM
STATUS=OPEN
DESCRIPTION=The historical non-ASCII config corruption guard, save guard, backup policy, and full default/override/restore state machine are not current verified implementation facts.
EVIDENCE=Historical editor evidence and merchant-admin context.
NEXT_SAFE_ACTION=Run a focused compatibility test with UTF-8 round trips, legacy shapes, override removal, save concurrency, and backup recovery.
BLOCKS=Config migration closure.

## ISSUE-TEMPLATE-001
MODULE=Template Center
SEVERITY=MEDIUM
STATUS=OPEN
DESCRIPTION=Template Center architecture is decided, but implementation status and legacy Global Settings migration semantics are not fully verified.
EVIDENCE=Canonical Template Center decision and current template code.
NEXT_SAFE_ACTION=Document and test version, snapshot, preview, apply, restore, and compatibility rules.
BLOCKS=Template migration closure.

## ISSUE-QA-001
MODULE=QA / Test Data
SEVERITY=HIGH
STATUS=OPEN
DESCRIPTION=Historical browser acceptance created persistent synthetic tenants without a consistently verified cleanup boundary.
EVIDENCE=Historical QA evidence and repository cleanup artifacts.
NEXT_SAFE_ACTION=Use a fixed synthetic tenant or isolated database and verify cleanup by immutable identifiers.
BLOCKS=Reliable shared-environment acceptance.

## ISSUE-RUNTIME-001
MODULE=Environment / Runtime
SEVERITY=MEDIUM
STATUS=OPEN
DESCRIPTION=Multiple checkouts, ports, branches, SHAs, and database identities previously produced conflicting observations.
EVIDENCE=Historical runtime diagnostics.
NEXT_SAFE_ACTION=Bind every new verification to repository, branch, full SHA, process identity, runtime, and database identity.
BLOCKS=Trustworthy environment conclusions.

## ISSUE-SECURITY-001
MODULE=Security / Integrations
SEVERITY=HIGH
STATUS=OPEN
DESCRIPTION=AI fallback, SSRF controls, key protection, error redaction, and customer-data permission boundaries need a single current security acceptance record.
EVIDENCE=Historical AI/security discussions and current platform README.
NEXT_SAFE_ACTION=Create a focused security acceptance task with non-secret fixtures and route-level checks.
BLOCKS=Security closure.
