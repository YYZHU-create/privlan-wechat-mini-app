# Product Media Context

## Durable concerns

Product media must preserve the distinction between media slot, main image, detail/gallery media, metadata, and generated mini-program output. Legacy `img` and `gallery` representations require a compatibility normalization boundary.

## Contract to preserve

The editor-to-preview-to-generator path includes upload, delete, validation, media metadata, main/detail mapping, `productMediaSlot`, and package-size constraints. The normalization boundary must support legacy `img`/`gallery` input without losing ordering, role, or metadata. Media payload bytes and media metadata should remain separable at adapter boundaries; the exact current Meoo Storage implementation remains `NOT_VERIFIED`.

The generated mini-program package is the acceptance artifact. Editor state alone does not prove that the main image, detail/gallery images, deletion behavior, invalid-media handling, or large-media policy survived generation.

## Current status

- `MEDIA_REPOSITORY_PRESENT=YES`
- Normalization and editor/preview/generator parity: `NOT_VERIFIED`
- Upload/delete/validation end-to-end: `NOT_VERIFIED`
- Large media and package handling: `NOT_VERIFIED`
- Product Media remains an open audit area.

## Required future verification

Use explicit fixtures for legacy `img`, `gallery`, `productMediaSlot`, main media, detail media, deletion, invalid media, non-ASCII metadata, and oversized media. Verify the generated mini-program package and the preview, rather than only editor state. A future implementation task should be single-target and separate from the mixed historical audit thread.

## Media V1 ASSET_CONFIRM acceptance — 2026-09-29

- Staging v69 normal upload acceptance: HTTP 201; the exact correlated attempt reached `READY_COMMITTED` / `CONSISTENT_READY`; the asset is `ready`; one `asset_objects` row exists; business-link count is zero as expected for an upload without an entity association.
- The Merchant media UI loaded the associated content route as a 2×2 image. Direct response status and exact external Storage inventory count were not retained.
- The ASSET_CONFIRM implementation accepts the validated request-bound row returned by the successful INSERT representation, avoiding a second immediate read as the normal confirmation step. A scoped read remains for absent INSERT representations. Local cleanup removed the experimental 250 ms diagnostic reread and its response fields; this cleanup is not deployed to the current v69 runtime.
- Recovery-worker lease-renewal gap: independently tracked as open non-blocking technical debt; not part of the v69 ASSET_CONFIRM acceptance gate.
- Sanitized acceptance and synchronization summary: `verification/media-v1-github-synchronization-20260929/REPORT.md`.

## Staging v70 follow-up — 2026-09-29

- The recorded deployment command returned success for v70 from source `11b494f9ffbf60f4fde5fa84953bb9a63f23632f`; its prepared artifact digest is `sha256:11762a45e5bd716448da23e3a520f18f6c48e211b628dc2527838cbaaa193b8f`.
- An authenticated runtime sample reported that source commit, `staging`, and the expected runtime-config digest; artifact/build identity fields were unknown. The revised GET-only acceptance script has local validation evidence, but no post-edit browser execution result is recorded. Treat complete v70 runtime acceptance as `NOT_VERIFIED` until that evidence is captured.
