# Asset Schema v1 Atomic Production Rollout

Production execution is a single explicit PostgreSQL transaction containing the exact 013 and 014 bodies. Never run 013 independently in Production.

## Artifact

- SQL: `deployment/asset-schema/atomic-013-014.sql`
- Bundle SHA-256: `C4FAAF04A291538B0203BA6AEE4DD5E7C49C2319941D14AE9E845B47CED09986`
- Source commit: `c3614ae2b48f8b25a79967a4aa2d7789e57c50d7`
- 013 SHA-256: `053784542786EC73CF678A0334ABF9E09E07BD4B4412C67CDE0B84AE5D34A28B`
- 014 SHA-256: `82657B870C2B8568A854DBC069475603326B55DD9C118DDDA9A1EC281DD7F2AB`

## Execution contract

`BEGIN;` → exact 013 body → exact 014 body → `COMMIT;` in one `meoo db query --file` request scoped to Production project `g8o5cv1om41o` / database `156650`. Verify all three hashes and latest migration `012_launch_v1_domains` immediately before execution.

The 014 hardening must be complete before commit: RLS enabled on `asset_objects` and `asset_links`; `PUBLIC`, `anon`, and `authenticated` denied; `service_role` explicitly granted required DML.

After the schema transaction commits, write `schema_migrations` registry entries as a separate idempotent bookkeeping step. If registry insertion fails, reconcile and retry; do not perform destructive rollback.

Global default privileges remain a separate security gate.
