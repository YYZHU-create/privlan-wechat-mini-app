# ATELIER OS Production Rollback Runbook

A. Application-only failure: stop new deployment, redeploy the previous immutable committed SHA when schema compatibility is confirmed, verify health and smoke, preserve data.

B. Pre-authoritative migration failure: abort the migration job, retain the previous authority, capture logs and backup manifest, repair forward in rehearsal before retry.

C. Post-authoritative failure: freeze new writes, preserve the authoritative database, identify the divergence window, export audit/reconciliation evidence, and reconcile before any application/database switch.

D. Bad additive migration: prefer a forward corrective migration after new-schema writes exist; do not perform an unreviewed destructive down-migration.

Meoo image deploy has no in-place rollback primitive; rollback is a new deploy of a known-good committed SHA. Database restore requires verified backup hash and explicit operator approval.
