# FEELDAO Asset Contract v1

## Authority and scope

PostgreSQL is the metadata and relationship authority. Binary objects live in a
private, server-selected Meoo Storage bucket. Production uses the exact
`feeldao-production-media` bucket; non-Production environments use an explicit
project-local bucket such as staging's `merchant-assets`. The provider boundary
is represented by `storage_provider`, `bucket`, and `object_key`; provider SDK
response blobs are not canonical fields.

Temporary signed URLs and tokens are delivery credentials, never asset identity.

## Identity and objects

`assets.id` is an immutable UUID for a logical asset. `asset_objects` stores one
physical object per `(asset_id, variant)`, including provider, bucket, canonical
object key, byte size, MIME type, and SHA-256 checksum. Canonical keys follow:

`tenant/{tenant_id}/workspace/{workspace_id}/asset/{asset_id}/{variant}.{extension}`

`(storage_provider, bucket, object_key)` and `(asset_id, variant)` are unique, and
object keys are never reused after deletion.

## Scope and links

Every canonical asset is tenant and workspace scoped. `store_id` is nullable for
workspace-level assets and required by store-scoped application operations.
`asset_links` provides tenant/workspace-scoped links to products, branding, and
content. Product IDs currently originate in `workspace_configs.document.products`
and are numeric JSON values, so `entity_id` is text; entity existence remains an
application-level check until products become relational.

The application resolves scope from authenticated membership; it never trusts
client-supplied tenant/workspace IDs. Cross-scope equality between an asset and a
link is checked in the service layer.

## Purpose, visibility, and lifecycle

V1 purposes are `product_main`, `product_gallery`, `product_detail`, `brand_logo`,
`workspace_branding`, `mini_program_banner`, `content_image`, and `content_video`.
Persistent visibility is `PRIVATE` (default) or `PUBLISHED`; signed access is a
delivery mechanism, not a visibility state. Status values are `pending`, `ready`,
`failed`, `deletion_requested`, and `deleted`, with transitions:

* `pending -> ready | failed`
* `ready -> deletion_requested`
* `deletion_requested -> deleted`

The service layer enforces transitions. `deleted_at` records metadata deletion
after provider deletion and post-delete verification.

## Integrity and deletion

`size_bytes` is non-negative. Each stored variant records a SHA-256 checksum of
its actual bytes. Storage deletion and metadata deletion are separate operations:
the service requests exact-key deletion for every registered variant and verifies
provider absence before metadata finalization. Content deletion is irreversible;
the metadata tombstone is not a restore source. Foreign keys never cascade into
Storage.

`015_asset_lifecycle_v1` finalizes a deletion transactionally after the provider
verification. It requires a recent verification timestamp and the exact count of
registered objects, removes only links belonging to the scoped asset, marks the
asset `deleted`, and writes `asset.deleted` to `audit_events`. The audit metadata
contains IDs, scope, actor/request identity, timestamps, object count, and
non-sensitive object identity evidence; it never stores object bytes or names.

## Retention, reconciliation, and purge

Deleted `assets` and their `asset_objects` metadata are retained for 30 days.
`asset_links` are removed at logical-deletion finalization. Existing links on
previously deleted assets are reconciled only through the separately invoked,
audited maintenance operation.

The server-side lifecycle maintenance command requires an explicit tenant and
workspace scope, actor ID, bounded batch size, and a stable run ID for writes.
It is dry-run by default. Purge candidates are derived from `status='deleted'`
and `deleted_at` at or before the 30-day cutoff; eligibility is not persisted as
another status. Every registered object must be reverified absent, links must be
absent, and an `asset.deleted` audit event must exist before `asset.purged` is
written and the object rows then tombstone are removed transactionally.

`failed` assets and deleted assets whose objects remain present are reconciliation
cases. They are not ordinary purge candidates. There is no scheduler in V1.

## Lifecycle mutation capability

`MEDIA_ASSET_V1_ENABLED` controls the Asset V1 service surface. It does not
authorize lifecycle writes. `ASSET_LIFECYCLE_MUTATIONS_ENABLED` is a separate,
target-bound server configuration field and defaults to `false`. The Merchant
delete operation and maintenance `--apply` reject before metadata or Storage
access unless this capability is explicitly enabled by the deployed runtime
configuration.

On migration 014, lifecycle mutations remain disabled while the 015 lifecycle
RPCs are unavailable. After migration 015 is applied and independently
verified, a separately authorized runtime configuration change may enable the
capability. Operator dry-run remains read-only and independent of this setting.

The rollout sequence is: 014 with lifecycle mutations disabled, deployment and
read-only dry-run verification, real dry-run acceptance and recovery evidence,
015 application and verification, explicit lifecycle capability enablement,
then lifecycle acceptance.

## Operator dry-run report

The candidate includes `GET /ops/v1/asset-lifecycle/dry-run` as a fixed,
server-side report surface. It requires an authenticated `super_admin` Operator
session plus explicit `tenantId` and `workspaceId`; it is not available to
Merchant, Customer, or ordinary Operator roles. The server validates that the
workspace belongs to the tenant before running a bounded report.

The route accepts no command, mode, apply flag, RPC name, SQL, or credential.
Its report module performs only scoped Asset and Asset Link reads and returns
aggregate candidate counts, a request ID, and generation time. It has no
Storage provider dependency and no mutation path. `purgeCandidateCount` is a
bounded metadata candidate count; any later purge still requires per-object
Storage absence verification under the separately authorized apply operation.
The route emits a sanitized process event and applies a per-Operator read rate
limit. It remains candidate source until separately reviewed and deployed.

## Legacy compatibility

The existing `assets.object_key`, `original_name`, `mime_type`, `bytes`, and
`metadata` columns are retained for legacy readers and writers. Existing product
media remains in `workspace_configs.document.products[*].img`, `gallery`, and
`detailImages`; branding remains under `document.brand`. The first migration does
not rewrite JSON or switch product reads/writes.

## RLS and rollout

The additive `013_asset_contract_v1` migration does not expose the new tables to
clients by design. `014_asset_access_hardening` is required before rollout: it
enables RLS on `asset_objects` and `asset_links`, revokes `PUBLIC`, `anon`, and
`authenticated` privileges, and grants only the DML required by the server-side
`service_role` path. No client-facing policies are created in V1. Service Role
access still requires application scope authorization.

Because 013 is already rehearsed on Staging, 014 remains a separate forward
migration for that environment. Production must apply the two migrations as one
atomic rollout (or keep the API exposure disabled until 014 is complete); a
sequential 013-only Production rollout is not approved.

## Migration and rollback

`platform/migrations/013_asset_contract_v1.sql` adds lifecycle columns, the
`asset_objects` and `asset_links` tables, constraints, and indexes. `015_asset_lifecycle_v1.sql`
adds lifecycle indexes and server-side RPCs without changing existing identifiers.
These migrations do not move Storage objects or modify product JSON. Rollback is a
feature-flag or read-path rollback while preserving additive rows; lifecycle purges
remain intentional forward operations and require current audit reconciliation.

Before the next deployment-bearing lifecycle stage, upgrade the Meoo CLI to the
platform-required version and record the resulting CLI version in deployment
evidence.
