# Meoo B1 staging cutover operations

## Scope

This runbook applies only to the pinned deployment packaging release. It uses the controlled staging source environment and a dedicated Meoo staging project. Production is not part of this procedure.

## Freeze and write barrier

1. The staging operator records the native staging route, process identity, and recovery command.
2. The operator removes the native Merchant route from normal ingress and verifies that authenticated business-write endpoints are no longer reachable.
3. The operator sets the approved cutover environment flags only for the one-shot launcher.
4. The launcher captures the source snapshot, migrates the dedicated target, and verifies fidelity.
5. The Meoo candidate stays on a staging-specific URL and is limited to designated testers until all smoke gates pass.
6. Staging business writes are enabled only after the designated tester approves the write-enable gate.

## Pre-write rollback

Before any authoritative Meoo business write, disable the Meoo staging route, restore the recorded native staging route, and remove the write-freeze state. The native source remains authoritative during this interval.

## Post-write rule

After an authoritative Meoo business write, native routing is not a rollback action. Reconciliation requires a separately approved divergence plan.

## Required launcher flags

- `ATELIER_CUTOVER_WRITE_FREEZE_CONFIRMED=1`
- `ATELIER_CUTOVER_AUTHORITATIVE_WRITES=blocked`
- `ATELIER_CUTOVER_TARGET_BUILD_APPROVED=1` for target schema construction
- `ATELIER_CUTOVER_REAL_DATA_MIGRATION_APPROVED=1` for final snapshot migration

The launcher records only non-secret metadata in `.cutover-artifacts/`, which is excluded from Git and image deployment context.