# Production Meoo Deployment Evidence Gates

## Current decision

```ini
PRODUCTION_PROJECT_ID=g8o5cv1om41o
PRODUCTION_READINESS=GATES_NOT_CLEARED
PRODUCTION_DEPLOYMENT_AUTHORIZED=NO
PRODUCTION_MIGRATION_AUTHORIZED=NO
EVIDENCE_SNAPSHOT_UTC=2026-09-30T05:58:48Z
EVIDENCE_BASIS=USER_SUPPLIED_READ_ONLY_AUDIT_SUMMARY
```

The snapshot time and observations below come from the supplied read-only audit summary. They were not independently re-collected during this documentation update. Recheck time-sensitive platform facts before operational use.

## Meoo deployment objects

**Documented:** Meoo supports static Web publication and HTTP server/image publication for suitable Web projects. Edge Functions are separately listed and deployed as function objects. These are platform capabilities, not proof of the deployment mode or binding used by this Production project.

**Project observation in the supplied audit:** one `create-desktop` application record and three listed Edge Functions were visible. That evidence does not establish the active application's release object, whether it runs as static or server/image, or a service/image/source binding. Do not describe the absence of a field in the inspected command output as proof that Meoo has no corresponding platform capability.

References: [Meoo CLI guide](https://docs.meoo.com/meoo-cli), [Project import, build and release](https://docs.meoo.com/untitled-page-2), [Release API](https://docs.meoo.com/api-10), [Meoo documentation index](https://docs.meoo.com/llms.txt).

## Route evidence: keep ingress layers distinct

| Layer | Meaning | Current evidence state |
| --- | --- | --- |
| SPA route `/ops/` | Client-side application route delivered by a Web application; not itself proof of a platform host-to-service mapping | `PUBLIC_ROUTE_OWNER=NOT_VERIFIED` |
| Same-origin API path `/ops/v1/*` | API ingress whose handler/upstream must be established separately from the SPA route | `API_ROUTE_OWNER_AND_UPSTREAM=NOT_VERIFIED` |
| Direct Edge Function URL, such as `/functions/v1/<function>/...` | A distinct request ingress addressed to a named function | Function object names/versions may be listed; equivalence to a same-origin API path is `NOT_VERIFIED` |

Different request URLs establish different observed ingress paths; they do not, by themselves, establish different handlers, services, or code versions. Likewise, a request-ID shape or matching audit-event fields may show behavioral compatibility with a source implementation, but cannot bind a live request to that implementation without route/runtime identity evidence.

The supplied audit described multiple observed login request paths, including the same-origin `/ops/v1/auth/login` path and a direct function URL. Record these as separate ingress observations. Do not label them separate handlers unless an authoritative route or runtime binding proves that attribution. The request-ID/audit-shape comparison remains a fingerprint, not an owner identification.

## Release and runtime identity

```ini
V12_OBJECT_TYPE=NOT_VERIFIED
CURRENT_PRODUCTION_SOURCE_SHA=NOT_VERIFIED
CURRENT_PRODUCTION_BUILD_ID=NOT_VERIFIED
CURRENT_PRODUCTION_ARTIFACT_ID=NOT_VERIFIED
CURRENT_PRODUCTION_IMAGE_DIGEST=NOT_VERIFIED
RELEASE_TO_RUNTIME_TARGET_BINDING=NOT_VERIFIED
```

The supplied audit did not independently observe a `v12` release object in the inspected platform read surface; `v12` remains a user-provided label until its object type and source are confirmed. Do not interpret a function version number as an application release number, or a local checkout SHA as the live source SHA.

## Effective configuration

Project-level secret/configuration name inventory is not equivalent to service binding or runtime injection. `PRESENT` means only that a name appeared in the inspected inventory; `ABSENT` means only that it did not appear in that inventory. Neither establishes an effective runtime value or feature state.

```ini
ATELIER_AUTO_MIGRATE_EFFECTIVE_STATE=NOT_VERIFIED
MEDIA_V1_EFFECTIVE_STATE=NOT_VERIFIED
MEDIA_STORAGE_EFFECTIVE_STATE=NOT_VERIFIED
CANARY_EFFECTIVE_STATE=NOT_VERIFIED
LIFECYCLE_MUTATION_GATE_EFFECTIVE_STATE=NOT_VERIFIED
```

No Secret value belongs in this ledger. Production migration execution remains gated until the effective migration setting and target runtime are verified.

## Rollback and database recovery

- A new Edge Function deployment from a selected source revision is a new deployment. It is not a demonstrated rollback unless the current and target function code identities are known and the platform's restoration procedure is verified.
- A static Web release is not considered restorable until the intended prior release/source is identified and an applicable re-publish or activation procedure is demonstrated from platform evidence.
- An image rollback requires the target service, current and target immutable image identities, and service binding to be verified.
- A logical SQL snapshot is a comparison baseline only. It is not a platform backup, restore verification, or substitute for a documented backup record and restore test.

```ini
APPROVED_TARGET_SPECIFIC_ROLLBACK=NOT_VERIFIED
RESTORE_VERIFIED_BACKUP_RECORD=NOT_VERIFIED
RPO=NOT_VERIFIED
RTO=NOT_VERIFIED
```

## Open gates

| Gate | Current status | Minimum closure evidence |
| --- | --- | --- |
| Production deployment object and active release identity | `NOT_VERIFIED` | Project-bound deployment mode/object and active release-to-runtime identity from an authoritative platform record |
| `/ops/` and `/ops/v1/*` route ownership | `NOT_VERIFIED` | Separate host/path-to-owner/upstream mapping for SPA and API ingress |
| Effective runtime configuration | `NOT_VERIFIED` | Redacted runtime-bound settings, including effective `ATELIER_AUTO_MIGRATE=0` and intended feature/gate states |
| Target-specific rollback | `NOT_VERIFIED` | Approved release/source or image/function target bound to the actual runtime object, plus executable recovery procedure |
| Restore-verified backup | `NOT_VERIFIED` | Backup time/scope/database label and actual restore-verification result with recorded RPO/RTO |
| Live authentication handler identity | `NOT_VERIFIED` | Runtime/source binding for the handler serving the observed login ingress; behavior fingerprints alone do not close this gate |

Overall: `GATES_NOT_CLEARED`. This evidence record authorizes no Production deployment, migration, routing/configuration change, or persistent-data mutation.
