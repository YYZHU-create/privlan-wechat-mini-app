# Asset Media Runtime V1

## Boundary

Merchant routes call `media-service-v1.js`; the service calls the provider-neutral
repository and `storage-provider.js`. Supabase/Meoo SDK types stay inside the
provider adapter. Legacy `/api/media` and `/images` references remain intact.

## Configuration

The provider is activated only when the server environment contains:

```text
MEDIA_ASSET_V1_ENABLED=true
MEDIA_STORAGE_PROVIDER=meoo
MEDIA_STORAGE_BUCKET=<server-side project-local bucket>
ATELIER_ENVIRONMENT=production|staging
```

The bucket and environment are server-controlled and are never accepted from a
request. Missing or invalid configuration fails closed. Production requires the
exact `feeldao-production-media` bucket. Non-Production requires an explicit
project-local private bucket; the current G2C staging target uses `merchant-assets`.
The Production bucket is rejected by staging to prevent cross-environment writes.

## Upload and compensation

The V1 route authenticates the merchant, validates scope and payload, creates a
`pending` asset, uploads one canonical object, verifies size/MIME/SHA-256, registers
`asset_objects`, optionally creates a `workspace_config_product` link, then marks
the asset `ready`. Any upload, verification, registration, or link failure marks
the asset `failed` and attempts deletion by the exact object key. Cleanup failure
emits `orphan_object_detected`.

Canonical keys are:

```text
tenant/{tenant_id}/workspace/{workspace_id}/asset/{asset_id}/{variant}.{extension}
```

Original filenames are metadata only. Temporary URLs are never persisted.

## Private reads and deletion

`GET /api/media/v1/content/:id` authenticates and scope-checks the asset, requires
`ready`, and streams bytes through Meoo Storage. Deletion uses
`deletion_requested → exact Storage delete → verification → deleted`.
Database cascades are not treated as Storage deletion.

## Retry and concurrency model

Each upload request generates a new asset UUID and canonical object key. The
first slice does not expose an idempotency key, so a client retry can create a
duplicate logical asset or Product link. This is an explicit known limitation,
not a cross-scope safety issue: UUID-based object identity, server-derived
scope, and exact-key compensation prevent overwriting or deleting another
request's object. A future idempotency contract should be added before relying
on retries to converge to one logical asset.

## Product compatibility

Existing `workspace_configs.document.products` and `/images/...` media remain
unchanged. The rollout mode is `ASSET_FIRST_WITH_LEGACY_FALLBACK`; legacy reads
continue while new Asset V1 objects use the provider-backed path. The canonical
link discriminator for the current JSON Product model is
`workspace_config_product`, with numeric product IDs represented as text.

## Deployment prerequisites

Run focused provider/repository/service/security tests, then the existing media and
asset-schema suites. Validate the configured bucket and runtime secrets in the
target environment without printing values. G2A does not deploy, migrate, upload,
or change Production configuration; live canary evidence belongs to G2C.
