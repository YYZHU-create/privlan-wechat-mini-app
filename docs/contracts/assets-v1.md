# FEELDAO Asset Contract v1

## Authority and scope

PostgreSQL is the metadata and relationship authority. Binary objects live in the
Meoo Storage provider (`feeldao-production-media`, private). The provider boundary
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
the service requests exact-key deletion, verifies provider absence, then marks the
metadata row deleted. Foreign keys never cascade into Storage.

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
`asset_objects` and `asset_links` tables, constraints, and indexes. It does not
delete rows, move Storage objects, or modify product JSON. Rollback is a feature-flag
or read-path rollback while preserving additive rows; any future destructive cleanup
requires reconciliation after new rows are accounted for.
